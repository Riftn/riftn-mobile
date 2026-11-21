// The signed-wallet RPC owns the reservation and is the only source of admission.
export type GateReply = {
  paid?: boolean; pending?: boolean; reverted?: boolean; mismatch?: boolean;
  canSubmit?: boolean; reference?: string; recipient?: string; amount?: number;
  hash?: string; staleClaim?: string; error?: string;
};
type GateRequest = (action: string, claim: string, hash?: string) => Promise<GateReply>;
export type GateOutcome =
  | { state: 'paid' | 'reverted' | 'ready' }
  | { state: 'recover'; hash?: string; staleClaim?: string }
  | { state: 'pending'; hash: string };

export const isEntryHash = (hash: string) => /^0x[0-9a-f]{64}$/i.test(hash);

export async function runEventCheckout(
  event: { id: string; creator_wallet_address: string; gate_fee: number },
  wallet: string,
  claim: string,
  deps: {
    request: GateRequest;
    storage: { getItem(key: string): Promise<string | null>; setItem(key: string, value: string): Promise<void>; removeItem(key: string): Promise<void> };
    send: (reference: string, beforeSubmit: () => Promise<void>) => Promise<string | undefined>;
    pause: () => Promise<void>;
  },
  recovery?: { hash: string },
): Promise<GateOutcome> {
  const key = `event-entry:8453:${event.id}:${wallet.toLowerCase()}`;
  const clear = () => deps.storage.removeItem(key).catch(() => {});
  const quote = await deps.request('prepare', claim);
  if (quote.paid) {
    await clear();
    return { state: 'paid' };
  }
  const saved = await deps.storage.getItem(key).catch(() => null);
  let pending: { claim: string; hash: string } | undefined;
  if (saved) {
    try {
      const value = JSON.parse(saved);
      if (typeof value?.claim === 'string' && isEntryHash(value.hash)) pending = value;
    } catch { /* The server still owns the reservation and its recorded hash. */ }
  }
  let hash = recovery?.hash || pending?.hash || quote.hash;
  if (!hash && recovery && quote.canSubmit) {
    await deps.request('release', claim);
    return { state: 'ready' };
  }
  if (!hash && !recovery && quote.canSubmit) {
    let submitting = false;
    try {
      if (!quote.reference || Number(quote.amount) !== event.gate_fee || quote.recipient !== event.creator_wallet_address.toLowerCase()) {
        throw new Error('The entry fee changed. Reopen this event before paying.');
      }
      hash = await deps.send(quote.reference, async () => {
        if (!(await deps.request('check_claim', claim)).canSubmit) throw new Error('This payment is already being handled.');
        submitting = true;
      });
    } catch (error) {
      const code = (error as { code?: unknown })?.code;
      if (!submitting || code === 4001 || code === 'ACTION_REJECTED') await deps.request('release', claim).catch(() => {});
      throw error;
    }
    if (!hash || !isEntryHash(hash)) return { state: 'recover' };
    // Either copy suffices after a restart. Preserve the hash in the UI if both writes fail.
    await deps.storage.setItem(key, JSON.stringify({ claim, hash })).catch(() => {});
    try { await deps.request('record', claim, hash); }
    catch { return { state: 'pending', hash }; }
  } else if (pending && pending.hash === hash && !quote.hash) {
    await deps.request('record', pending.claim, pending.hash);
  }
  if (!hash || !isEntryHash(hash)) return { state: 'recover', staleClaim: quote.staleClaim };
  for (let attempt = 0; attempt < 12; attempt++) {
    if (attempt) await deps.pause();
    const result = await deps.request('confirm', claim, hash);
    if (result.paid || result.reverted) {
      await clear();
      return { state: result.paid ? 'paid' : 'reverted' };
    }
    if (result.mismatch) return { state: 'recover', hash };
    if (!result.pending) throw new Error('The verifier returned an unexpected payment status.');
  }
  return { state: 'pending', hash };
}
