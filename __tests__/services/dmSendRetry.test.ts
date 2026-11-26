const mockConfirm = jest.fn();
const mockFeePayer = jest.fn(async () => '0xfee');
jest.mock('../../store/dm.store', () => ({
  dmState: { optimisticByConversation: {} },
  dmActions: {
    addOptimistic: jest.fn(), removeOptimistic: jest.fn(), failOptimistic: jest.fn(),
    retryOptimistic: jest.fn(), upsertMessages: jest.fn(), migrateOptimistic: jest.fn(),
  },
}));
jest.mock('../../libs/dmLocked', () => ({ lockDhbForUsd: () => 0 }));
jest.mock('../../services/dm/dm.api', () => ({ uploadDmMedia: jest.fn(), tipNotify: jest.fn(), forwardDmMessage: jest.fn() }));
jest.mock('../../libs/assets.util', () => ({ guessMime: () => 'image/jpeg' }));
jest.mock('../../libs/logger', () => ({ createLogger: () => ({ debug: jest.fn(), warn: jest.fn(), error: jest.fn(), info: jest.fn() }) }));
jest.mock('../../config/constants', () => ({ supportedTokens: [] }));
jest.mock('expo-crypto', () => ({
  randomUUID: () => require('node:crypto').randomUUID(),
  getRandomBytes: (n: number) => new Uint8Array(require('node:crypto').randomBytes(n)),
}));
jest.mock('expo-file-system/legacy', () => ({}));
jest.mock('../../libs/dm-e2ee/keys', () => ({ prepareOutgoing: async (_p: string, content: string) => ({ content }), prepareSession: jest.fn() }));
jest.mock('../../libs/dm-e2ee/media', () => ({ encodeMediaDescriptor: jest.fn() }));
jest.mock('../../libs/dm-e2ee/media-send', () => ({ prepareMediaDescriptor: jest.fn() }));
jest.mock('../../libs/dm-destruct', () => ({ ...jest.requireActual('../../libs/dm-destruct'), destructFromChoice: jest.fn() }));
jest.mock('../../libs/dm-e2ee/media-files', () => ({}));
jest.mock('../../libs/dm-e2ee/peer', () => ({ peerAddressForConversation: () => null }));
jest.mock('../../libs/dm-send-confirmation', () => ({
  confirmDmSend: (...args: unknown[]) => mockConfirm(...args),
  isUnconfirmedSend: (e: any) => !!e?.unconfirmed,
}));

import { dmSendQueue } from '../../services/dm/dm.send';
import { dmActions } from '../../store/dm.store';

const mockActions = dmActions as unknown as Record<string, jest.Mock>;

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeAll(() => {
  dmSendQueue.init({ on: () => () => {}, emitAuthed: jest.fn() } as any);
  dmSendQueue.setFeePayer(mockFeePayer as any);
});
beforeEach(() => jest.clearAllMocks());

it('keeps the pending line key on the saved copy so the bubble is not re-mounted', async () => {
  mockConfirm.mockResolvedValueOnce({ _id: 'server-1', conversation: 'c1', content: 'hi' });
  const tempId = dmSendQueue.sendText({ conversationId: 'c1', userId: 'me', address: '0xme', content: 'hi' });
  expect(await dmSendQueue.waitForDelivery(tempId)).toBe(true);
  expect(mockActions.upsertMessages).toHaveBeenCalledWith('c1', [expect.objectContaining({ _id: 'server-1', _clientKey: tempId })]);
  expect(mockActions.removeOptimistic).toHaveBeenCalledWith('c1', tempId);
});

it('keeps a failed line for Retry, resends it in place and never pays the fee twice', async () => {
  mockConfirm.mockRejectedValueOnce(new Error('offline'));
  const tempId = dmSendQueue.sendText({
    conversationId: 'c1', userId: 'me', address: '0xme', content: 'paid hi',
    dmFee: { required: true, fee: 10, hasFreeAccess: false } as any,
  });
  expect(await dmSendQueue.waitForDelivery(tempId)).toBe(false);
  expect(mockActions.failOptimistic).toHaveBeenCalledWith('c1', tempId, 'offline');
  expect(mockActions.removeOptimistic).not.toHaveBeenCalled();
  expect(dmSendQueue.canRetry(tempId)).toBe(true);

  mockConfirm.mockResolvedValueOnce({ _id: 'server-2', conversation: 'c1', content: 'paid hi' });
  expect(dmSendQueue.retry(tempId)).toBe(true);
  expect(mockActions.retryOptimistic).toHaveBeenCalledWith('c1', tempId);
  await flush(); await flush();
  expect(mockActions.upsertMessages).toHaveBeenCalledWith('c1', [expect.objectContaining({ _id: 'server-2', _clientKey: tempId })]);
  expect(mockFeePayer).toHaveBeenCalledTimes(1);
  expect(dmSendQueue.canRetry(tempId)).toBe(false);
});

it('resends a line whose confirmation got lost, with its own id so the server can dedupe it', async () => {
  const lost = Object.assign(new Error('not confirmed'), { unconfirmed: true });
  mockConfirm.mockRejectedValueOnce(lost).mockResolvedValueOnce({ _id: 'server-3', conversation: 'c1', content: 'again' });
  const tempId = dmSendQueue.sendText({ conversationId: 'c1', userId: 'me', address: '0xme', content: 'again' });
  expect(await dmSendQueue.waitForDelivery(tempId)).toBe(true);
  expect(mockConfirm).toHaveBeenCalledTimes(2);
  expect(mockConfirm.mock.calls[1][1]).toMatchObject({ clientId: tempId, content: 'again' });
  expect(mockActions.failOptimistic).not.toHaveBeenCalled();
});

it('keeps a Not sent line on the phone and brings it back with Retry after a restart', async () => {
  const { loadUnsent } = require('../../libs/dm-unsent-store');
  mockConfirm.mockRejectedValueOnce(new Error('refused'));
  const tempId = dmSendQueue.sendText({
    conversationId: 'c9', userId: 'me', address: '0xme', content: 'keep me',
    replyTo: { _id: 'quoted-1', content: 'quoted', sender: 'other' } as any,
  });
  expect(await dmSendQueue.waitForDelivery(tempId)).toBe(false);
  expect(loadUnsent().map((l: any) => l.tempId)).toContain(tempId);

  // A fresh launch: nothing in memory, the line comes back from storage.
  (dmSendQueue as any).failedJobs.clear();
  (dmSendQueue as any).restored = false;
  dmSendQueue.restoreUnsent();
  expect(dmSendQueue.canRetry(tempId)).toBe(true);
  expect(mockActions.addOptimistic).toHaveBeenCalledWith('c9', expect.objectContaining({
    _tempId: tempId, content: 'keep me', uploadStatus: 'failed', replyTo: expect.objectContaining({ _id: 'quoted-1' }),
  }));

  mockConfirm.mockResolvedValueOnce({ _id: 'server-9', conversation: 'c9', content: 'keep me' });
  dmSendQueue.retry(tempId);
  await flush(); await flush();
  expect(loadUnsent().map((l: any) => l.tempId)).not.toContain(tempId);
});

it('forgets a line the sender drops', async () => {
  const { loadUnsent } = require('../../libs/dm-unsent-store');
  mockConfirm.mockRejectedValueOnce(new Error('refused'));
  const tempId = dmSendQueue.sendText({ conversationId: 'c1', userId: 'me', address: '0xme', content: 'drop me' });
  await dmSendQueue.waitForDelivery(tempId);
  dmSendQueue.discard('c1', tempId);
  expect(loadUnsent().map((l: any) => l.tempId)).not.toContain(tempId);
});
