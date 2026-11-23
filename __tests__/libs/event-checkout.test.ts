import { runEventCheckout, type GateReply } from '../../libs/event-checkout';

const wallet = '0xguest';
const event = { id: 'event', creator_wallet_address: '0xHost', gate_fee: 35 };
const hash = '0x' + 'a'.repeat(64);
const quote = { canSubmit: true, reference: '4000000000000021', recipient: '0xhost', amount: 35 };
function fixture() {
  const request = jest.fn(async (action: string): Promise<GateReply> => {
    if (action === 'prepare') return quote;
    if (action === 'check_claim') return { canSubmit: true };
    return action === 'confirm' ? { paid: true } : {};
  });
  const storage = {
    getItem: jest.fn(async (): Promise<string | null> => null),
    setItem: jest.fn(async (_key: string, _value: string) => {}),
    removeItem: jest.fn(async (_key: string) => {}),
  };
  const send = jest.fn(async (_reference: string, beforeSubmit: () => Promise<void>) => { await beforeSubmit(); return hash; });
  return { request, send, storage, pause: async () => {} };
}

test('checks the claim immediately before signing and persists the returned hash before verification', async () => {
  const deps = fixture();
  expect(await runEventCheckout(event, wallet, 'claim', deps)).toEqual({ state: 'paid' });
  expect(deps.send.mock.calls[0][0]).toBe(quote.reference);
  expect(deps.request.mock.calls.map(([action]) => action)).toEqual(['prepare','check_claim','record','confirm']);
  expect(deps.storage.setItem.mock.invocationCallOrder[0]).toBeLessThan(deps.request.mock.invocationCallOrder[2]);
});
test('a changed quote releases the unused claim without opening the wallet', async () => {
  const deps = fixture();
  deps.request.mockResolvedValueOnce({ ...quote, amount: 70 });
  await expect(runEventCheckout(event, wallet, 'claim', deps)).rejects.toThrow();
  expect(deps.send).not.toHaveBeenCalled();
  expect(deps.request.mock.calls.map(([action]) => action)).toEqual(['prepare','release']);
});
test('a restarted app with a local hash repairs a lost record response without sending again', async () => {
  const deps = fixture();
  deps.request.mockResolvedValueOnce({ ...quote, canSubmit: false });
  deps.storage.getItem.mockResolvedValue(JSON.stringify({ claim: 'original', hash }));
  expect(await runEventCheckout(event, wallet, 'new', deps)).toEqual({ state: 'paid' });
  expect(deps.request).toHaveBeenCalledWith('record','original',hash);
  expect(deps.send).not.toHaveBeenCalled();
});
test('a second device checks the server hash and retains a pending payment', async () => {
  const deps = fixture();
  deps.request.mockImplementation(async action => action === 'prepare' ? { canSubmit: false, hash } : { pending: true });
  expect(await runEventCheckout(event, wallet, 'new', deps)).toEqual({ state: 'pending', hash });
  expect(deps.send).not.toHaveBeenCalled();
  expect(deps.storage.removeItem).not.toHaveBeenCalled();
});
test('manual recovery never initiates a new wallet send', async () => {
  const deps = fixture();
  expect(await runEventCheckout(event, wallet, 'claim', deps, { hash: '' })).toEqual({ state: 'ready' });
  expect(deps.send).not.toHaveBeenCalled();
});
test('an unknown error after submission preserves the reservation', async () => {
  const deps = fixture();
  deps.send.mockImplementation(async (_, beforeSubmit) => { await beforeSubmit(); throw new Error('connection interrupted'); });
  await expect(runEventCheckout(event, wallet, 'claim', deps)).rejects.toThrow('interrupted');
  expect(deps.request.mock.calls.map(([action]) => action)).toEqual(['prepare','check_claim']);
});
