/**
 * Settings → Reset wallet: move the signed-in account onto a brand-new
 * built-in wallet, the same thing the web's Settings row does.
 *
 * For a wallet that was lost or whose key someone else now has, including an
 * account first made with an outside wallet (SafePal, MetaMask) that has no
 * built-in wallet row at all.
 *
 * Proof of WHO is the account's own email, phone, Google or Apple sign-in (the
 * Supabase session), never a signature from the old wallet: a leaked key signs
 * as well as its owner. The move is strict and pinned to the account on
 * screen, so a failure never signs in to a blank account and a different
 * login on this phone can never move someone else's profile.
 */
import { AuthService } from '../../services';
import { getSupabaseAccessToken, getSupabaseUserId } from '../../services/auth/supabaseAuth.service';
import { createAndSaveEvmWalletForIdentity } from '../identity-wallet';
import { finishWalletReplacement } from './finish-replacement';
import { fetchWallet } from './store';
import { generateMnemonic12 } from './derive';
import { translateCopy as _translateCopy } from '../../i18n/copy';

export const RESET_NEEDS_LOGIN = 'RESET_NEEDS_LOGIN';

/** The wallet a refused attempt already saved, so a retry reuses it. */
let pending: { userId: string; fromAddress: string; secret: string; savedAddress?: string } | null = null;

export async function resetWalletFromSettings(params: {
  fromAddress: string;
  password: string;
  twoFactorCode?: string;
  signInWithWallet: (address: string, chainId: number, privateKey: string, meta?: Record<string, any>) => Promise<unknown>;
}): Promise<{ address: string }> {
  const { fromAddress, password, signInWithWallet } = params;
  const uid = await getSupabaseUserId();
  const token = uid ? await getSupabaseAccessToken() : null;
  if (!uid || !token) {
    throw Object.assign(new Error(_translateCopy('resetWallet.needsLogin', {
      defaultValue: "Sign in with this account's email, phone or Google first, then try again.",
    })), { code: RESET_NEEDS_LOGIN });
  }

  const existing = await fetchWallet(uid);
  const retry = pending && pending.userId === uid && pending.fromAddress.toLowerCase() === fromAddress.toLowerCase()
    ? pending : null;
  const ownRetry = !!retry?.savedAddress && !!existing &&
    existing.ethAddress.toLowerCase() === retry.savedAddress.toLowerCase();
  const secret = retry?.secret ?? generateMnemonic12();
  pending = { userId: uid, fromAddress, secret, savedAddress: retry?.savedAddress };

  // Saves the new wallet for this login: archives the old built-in one when
  // there is one, otherwise a plain first save. A retry of our own reuses it.
  const created = await createAndSaveEvmWalletForIdentity(
    uid,
    { kind: 'password', password },
    secret,
    existing && !ownRetry ? { address: existing.ethAddress, clearOtherSeedCopies: false } : undefined,
  );
  pending.savedAddress = created.address;

  await finishWalletReplacement(created.address, created.privateKey, signInWithWallet,
    (address, chainId) => AuthService.rotateWallet(address, chainId, {
      expectedFromAddress: fromAddress,
      twoFactorCode: params.twoFactorCode?.trim() || undefined,
      strict: true,
    }));
  pending = null;
  return { address: created.address };
}
