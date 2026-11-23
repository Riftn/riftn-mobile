const mockPost = jest.fn();
const mockUser = jest.fn();
const mockConversation = jest.fn();
const mockWantsEncryption = jest.fn();
const mockEncrypt = jest.fn();

jest.mock('../../libs/api.client', () => ({ apiClient: { post: (...a: any[]) => mockPost(...a) } }));
jest.mock('../../libs/auth.utils', () => ({ getAuthUser: () => mockUser() }));
jest.mock('../../services/dm/dm.api', () => ({ getConversation: (id: string) => mockConversation(id) }));
jest.mock('../../libs/dm-e2ee/encrypt-choice', () => ({ chatWantsEncryption: (...a: any[]) => mockWantsEncryption(...a) }));
jest.mock('../../libs/dm-e2ee/keys', () => ({ encryptForPeer: (...a: any[]) => mockEncrypt(...a) }));

import { needsChat, sendQuickReply } from '../../libs/quick-reply';

const ME = '0xme';
const BOB = '0xbob';

beforeEach(() => {
  jest.clearAllMocks();
  mockUser.mockResolvedValue({ address: ME });
  mockConversation.mockResolvedValue({ participants: [{ participant: { address: ME } }, { participant: { address: BOB } }] });
  mockWantsEncryption.mockResolvedValue(false);
  mockPost.mockResolvedValue({ result: { dmId: 'c1', status: 'sent', messageId: 'm1' } });
});

describe('quick reply', () => {
  it('sends plain text to an unencrypted chat', async () => {
    await expect(sendQuickReply({ conversationId: 'c1', text: ' hi ' })).resolves.toMatchObject({ status: 'sent' });
    expect(mockPost).toHaveBeenCalledWith('/dm/quick-reply', { dmId: 'c1', content: 'hi' }, { isAuthRequired: true });
  });

  it('seals the words for an encrypted chat', async () => {
    mockWantsEncryption.mockResolvedValue(true);
    mockEncrypt.mockResolvedValue('sealed');
    await sendQuickReply({ conversationId: 'c1', text: 'hi' });
    expect(mockEncrypt).toHaveBeenCalledWith(BOB, 'hi');
    expect(mockPost.mock.calls[0][1]).toEqual({ dmId: 'c1', content: 'sealed' });
  });

  it('never sends an encrypted chat in the clear', async () => {
    mockWantsEncryption.mockResolvedValue(true);
    mockEncrypt.mockResolvedValue(null);
    const error = await sendQuickReply({ conversationId: 'c1', text: 'hi' }).catch((e) => e);
    expect(needsChat(error)).toBe(true);
    expect(mockPost).not.toHaveBeenCalled();
  });

  it('never replies from a different saved account', async () => {
    const error = await sendQuickReply({ conversationId: 'c1', text: 'hi', recipient: '0xother' }).catch((e) => e);
    expect(needsChat(error)).toBe(true);
    expect(mockPost).not.toHaveBeenCalled();
  });
});
