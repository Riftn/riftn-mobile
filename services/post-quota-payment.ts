/**
 * Paying for a post that ran past the daily allowance
 * ===================================================
 * Mirror of dehubweb's `lib/dhb-payment.ts` + `lib/post-quota-settle.ts`.
 *
 * One DHB transfer to the treasury, after the post has landed, on whichever
 * of Base or BNB can cover it. Same shape as the AI-credit top-up next door
 * and for the same reason: DHB is the token the app already runs on, so a
 * separate balance to fund first would be a second money path for no reason.
 *
 * The dangerous moment is the gap between the DHB leaving the wallet and the
 * server hearing about it. Lose the settle call there and the creator has
 * paid while the bill is still open — and an open bill is what blocks their
 * next paid post, so they would be asked to pay for the same post twice. So
 * the hash is never dropped: retried immediately, then stashed and re-sent
 * the next time the composer opens. Settling is idempotent server-side, so
 * replaying one costs nothing.
 */

import { storage } from "../libs/storage";
import AsyncStorage from "@react-native-async-storage/async-storage";
import i18n from "i18next";
import { ethers } from "ethers";
import { buildContract } from "../libs/contract.factory";
import { createAuthAdapter } from "./auth/authAdapter";
import { writeContractAA } from "../libs/aa.write";
import { ethersService } from "./ethers.service";
import { getAuthMethod } from "../libs/auth.utils";
import { ERC20Abi } from "../config/abis";
import { ChainId, DHB_ADDRESSESS } from "../config/constants";
import { settlePostCharge } from "./post-quota.service";
import { translateCopy as _translateCopy } from '../i18n/copy';

/** Chains a posting charge can be paid and confirmed on. Anything else is unsettleable. */
export const QUOTA_CHAIN_IDS: number[] = [ChainId.BASE_MAINNET, ChainId.BSC_MAINNET];

const PENDING_KEY = "@dhb_post_quota_pending_settlements";

/** Beyond this a stashed hash is not a transient failure and retrying it helps nobody. */
const MAX_ATTEMPTS = 12;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export interface QuotaPaymentResult {
  txHash: string;
  chainId: number;
}

/**
 * The most DHB this wallet holds on any one payable chain.
 *
 * The most, not the total: a transfer settles on one chain, so what matters
 * is whether either side covers the bill on its own. Zero on any failure —
 * the server checks the same thing and is the authority.
 */
export async function readDhbBalance(): Promise<number> {
  try {
    const { address } = await getAuthMethod();
    if (!address) return 0;

    const balances = await Promise.all(
      QUOTA_CHAIN_IDS.map(async (chainId) => {
        try {
          const raw = await ethersService.getErc20Balance(
            DHB_ADDRESSESS[chainId],
            address,
            chainId,
          );
          return parseFloat(ethers.utils.formatUnits(raw, 18));
        } catch {
          return 0;
        }
      }),
    );
    return Math.max(0, ...balances);
  } catch {
    return 0;
  }
}

/**
 * Send `amountDhb` to `treasury` and return the mined transaction.
 *
 * Rounds up to a whole DHB — the price is quoted in whole tokens, and a
 * fractional amount only invites float drift between quote and transfer.
 */
export async function payPostQuota(
  amountDhb: number,
  treasury: string,
  // What the shortfall message calls the thing being paid for. Defaults to a
  // post because that is every existing caller; "Migrate all" passes its own,
  // since telling someone a batch of 300 videos is "this post" is nonsense.
  subjectLabel = _translateCopy("copy.6b8b2992d430", { defaultValue: "This post" }),
  onBroadcast?: (payment: QuotaPaymentResult) => void,
  onReverted?: (payment: QuotaPaymentResult) => void,
  expectedWallet?: string,
): Promise<QuotaPaymentResult> {
  const amount = Math.ceil(amountDhb);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error(_translateCopy("copy.99c7a77baaf9", { defaultValue: "Nothing to pay." }));
  if (!treasury) throw new Error(_translateCopy("copy.7d5825cf909d", { defaultValue: "No payment address configured." }));

  const { address } = await getAuthMethod();
  if (!address) throw new Error(_translateCopy("copy.8b6d7b59cd4a", { defaultValue: "Sign in to pay for this post." }));

  const amountWei = ethers.utils.parseUnits(String(amount), 18);

  // Pick the chain that can cover it, largest balance first, so a wallet
  // holding enough on BNB is not sent to Base to fail.
  const balances = await Promise.all(
    QUOTA_CHAIN_IDS.map(async (chainId) => {
      try {
        const raw = await ethersService.getErc20Balance(
          DHB_ADDRESSESS[chainId],
          address,
          chainId,
        );
        return { chainId, raw };
      } catch {
        return { chainId, raw: ethers.BigNumber.from(0) };
      }
    }),
  );

  const payable = balances
    .filter((b) => b.raw.gte(amountWei))
    .sort((a, b) => (b.raw.gt(a.raw) ? 1 : -1))[0];

  if (!payable) {
    const held = balances.reduce(
      (max, b) => Math.max(max, parseFloat(ethers.utils.formatUnits(b.raw, 18))),
      0,
    );
    throw new Error(
      i18n.t("postQuota.notEnoughTokens", {
        subject: subjectLabel,
        amount: amount.toLocaleString(),
        held: Math.floor(held).toLocaleString(),
      }),
    );
  }

  const provider = await createAuthAdapter().getProvider();
  const tokenContract = await buildContract(
    provider,
    ERC20Abi,
    DHB_ADDRESSESS[payable.chainId],
    true,
  );

  if (expectedWallet && (address.toLowerCase() !== expectedWallet.toLowerCase()
      || (await getAuthMethod()).address?.toLowerCase() !== expectedWallet.toLowerCase())) {
    throw new Error(i18n.t("multiPost.signIn"));
  }
  const tx = await writeContractAA(tokenContract, "transfer", [treasury, amountWei], {
    context: "Post allowance",
  });

  // wait() resolves with status 0 for a REVERTED transaction rather than
  // throwing, so ignoring the receipt would report a failed transfer as paid.
  if (tx.hash) onBroadcast?.({ txHash: tx.hash, chainId: payable.chainId });
  const receipt = await tx.wait(1).catch(error => {
    if (tx.hash && error?.receipt?.status === 0) onReverted?.({ txHash: tx.hash, chainId: payable.chainId });
    throw error;
  });
  if (receipt && receipt.status !== undefined && receipt.status !== 1) {
    if (tx.hash) onReverted?.({ txHash: tx.hash, chainId: payable.chainId });
    throw new Error(_translateCopy("copy.f22b5983f90d", { defaultValue: "The DHB transfer did not go through. Nothing has been charged." }));
  }

  const txHash: string | undefined = receipt?.transactionHash || receipt?.hash || tx.hash;
  if (!txHash) {
    throw new Error(_translateCopy("copy.19193d550a1f", { defaultValue: "The transfer went through but its hash is unknown — contact support." }));
  }

  if (txHash !== tx.hash) onBroadcast?.({ txHash, chainId: payable.chainId });
  return { txHash, chainId: payable.chainId };
}

interface PendingSettlement {
  txHash: string;
  chainId: number;
  attempts: number;
}

async function readPending(): Promise<PendingSettlement[]> {
  try {
    const raw = await AsyncStorage.getItem(PENDING_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writePending(rows: PendingSettlement[]): Promise<void> {
  try {
    if (!rows.length) await AsyncStorage.removeItem(PENDING_KEY);
    else await AsyncStorage.setItem(PENDING_KEY, JSON.stringify(rows));
  } catch {
    // Storage failing must not break posting. The immediate retries still ran;
    // this only gives up the later ones.
  }
}

/**
 * What became of a settle attempt.
 *
 * "pending" and "abandoned" both used to be `false`, which is how a charge the
 * app had permanently given up on was reported to the creator as one it would
 * "finish confirming shortly". They are different facts and the caller has to
 * be able to tell them apart.
 */
export type SettleOutcome = "settled" | "pending" | "abandoned";

/**
 * Tell the server about a transfer, retrying until it sticks.
 *
 * "settled" once the charge is closed. "pending" means the hash is stashed and
 * will be retried when the composer next opens. "abandoned" means the retries
 * are spent — the hash is moved to the abandoned list rather than deleted, and
 * the caller must say so, because the DHB has gone and the still-open charge is
 * what blocks the creator's next paid post.
 */
export async function settleWithRetry(
  txHash: string,
  chainId: number,
  startingAttempts = 0,
  // Injectable for the same reason persistPayout takes a `sleep`: otherwise a
  // test of the retry ladder has to sit through 8.5 seconds of real waiting.
  delaysMs: number[] = [0, 2500, 6000],
  receiptKey?: string,
): Promise<SettleOutcome> {
  // Three immediate goes with a widening gap. A transfer that is mined but
  // not yet visible to the read RPC answers `pending` and clears in seconds;
  // anything longer is left to the stash.
  const delays = delaysMs;

  for (let i = 0; i < delays.length; i++) {
    if (delays[i]) await wait(delays[i]);
    try {
      const result = await settlePostCharge(txHash, chainId);
      if (result?.settled) {
        if (receiptKey) storage.delete(receiptKey);
        else await writePending((await readPending()).filter((r) => r.txHash !== txHash));
        return "settled";
      }
    } catch (e) {
      console.warn("[PostQuota] settle attempt failed", e);
    }
  }

  const attempts = startingAttempts + delays.length;
  const rows = receiptKey ? [] : (await readPending()).filter((r) => r.txHash !== txHash);

  if (attempts >= MAX_ATTEMPTS) {
    console.warn(`[PostQuota] giving up on settling ${txHash} after ${attempts} attempts`);
    // Stop retrying, but do not lose the hash. The DHB is gone and the charge
    // is still open server-side, which is what will block the next paid post,
    // so the creator needs the reference to get it reconciled.
    if (!await recordAbandoned({ txHash, chainId, attempts })) return "pending";
    if (!receiptKey) await writePending(rows);
    if (receiptKey) storage.delete(receiptKey);
    return "abandoned";
  }

  if (receiptKey) storage.set(receiptKey, JSON.stringify({ txHash, chainId, attempts }));
  else {
    rows.push({ txHash, chainId, attempts });
    await writePending(rows);
  }
  return "pending";
}

/**
 * Transfers the app has stopped trying to settle.
 *
 * Kept because the money moved: without the hash there is nothing to reconcile
 * a real payment against. Capped so a long outage cannot grow this without
 * bound; the oldest go first, since the newest is the one still blocking.
 */
const ABANDONED_KEY = "@dhb_post_quota_abandoned_settlements";
const MAX_ABANDONED = 20;

export async function readAbandonedSettlements(): Promise<PendingSettlement[]> {
  try {
    const raw = await AsyncStorage.getItem(ABANDONED_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function recordAbandoned(row: PendingSettlement): Promise<boolean> {
  try {
    const rows = (await readAbandonedSettlements()).filter(
      (r) => r.txHash !== row.txHash,
    );
    rows.push(row);
    await AsyncStorage.setItem(
      ABANDONED_KEY,
      JSON.stringify(rows.slice(-MAX_ABANDONED)),
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * Retry anything stranded by an earlier session.
 *
 * Called when the composer opens — the moment the creator is about to need a
 * clear tab. Costs one request per stranded hash, which is normally none.
 */
const receiptKeyFor = (wallet: string, hash: string) => "quota-receipt:" + wallet.toLowerCase() + ":" + hash;
const settling = new Map<string, Promise<SettleOutcome>>();

export function rememberPostPayment(wallet: string, payment: QuotaPaymentResult): void {
  storage.set(receiptKeyFor(wallet, payment.txHash), JSON.stringify({ ...payment, attempts: 0 }));
}

export function forgetRevertedPostPayment(wallet: string, payment: QuotaPaymentResult): void {
  storage.delete(receiptKeyFor(wallet, payment.txHash));
}

export function settlePostPayment(wallet: string, payment: QuotaPaymentResult, attempts = 0): Promise<SettleOutcome> {
  const key = receiptKeyFor(wallet, payment.txHash);
  const existing = settling.get(key);
  if (existing) return existing;
  const run = settleWithRetry(payment.txHash, payment.chainId, attempts, undefined, key)
    .finally(() => settling.delete(key));
  settling.set(key, run);
  return run;
}

export async function flushPendingSettlements(): Promise<void> {
  const { address } = await getAuthMethod();
  if (!address) return;
  const prefix = "quota-receipt:" + address.toLowerCase() + ":";
  for (const key of storage.getAllKeys().filter(key => key.startsWith(prefix))) {
    const raw = storage.getString(key);
    if (!raw) continue;
    const payment: PendingSettlement = JSON.parse(raw);
    await settlePostPayment(address, payment, payment.attempts);
  }
  const rows = await readPending();
  for (const row of rows) {
    await settleWithRetry(row.txHash, row.chainId, row.attempts);
  }
}
