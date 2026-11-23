const mockTranslate = jest.fn();
const mockGet = jest.fn();
jest.mock('../../services/translation.service', () => ({ translateText: (...a: unknown[]) => mockTranslate(...a) }));
jest.mock('../../libs/ai-consent', () => ({ hasAiConsent: () => true }));
jest.mock('../../libs/api.client', () => ({ apiClient: { get: (...a: unknown[]) => mockGet(...a) } }));

import { clearTranslateOutChats, isTranslateOutOn, setTranslateOutChats, translateOutgoing } from '../../libs/dm-translate-out';

describe('Send in their language', () => {
  beforeEach(() => {
    mockTranslate.mockReset();
    mockGet.mockReset().mockResolvedValue({ result: { language: 'en' } });
    clearTranslateOutChats();
    setTranslateOutChats([{ conversationId: 'c1', translateOutAt: '2026-11-22T00:00:00Z' }]);
  });

  it('sends the line in their language and keeps what was typed', async () => {
    mockTranslate.mockResolvedValue({ translatedText: 'How are you?', sameLanguage: false });
    await expect(translateOutgoing('c1', ' Nasılsın? ')).resolves.toEqual({ content: 'How are you?', original: 'Nasılsın?', lang: 'en' });
    expect(mockTranslate).toHaveBeenCalledWith('Nasılsın?', 'en', 'auto', { isPublic: false });
  });

  it('is off unless turned on, and never in an encrypted chat', async () => {
    expect(isTranslateOutOn('c2')).toBe(false);
    setTranslateOutChats([{ conversationId: 'c1', translateOutAt: '2026-11-22T00:00:00Z', encryptedAt: '2026-11-22T00:00:00Z' }]);
    expect(isTranslateOutOn('c1')).toBe(false);
    await expect(translateOutgoing('c1', 'Nasılsın?')).resolves.toBeNull();
    expect(mockTranslate).not.toHaveBeenCalled();
  });

  it('sends as typed when it already reads in their language or the translator fails', async () => {
    mockTranslate.mockResolvedValueOnce({ translatedText: 'Hello there', sameLanguage: true });
    await expect(translateOutgoing('c1', 'Hello there')).resolves.toBeNull();
    mockTranslate.mockRejectedValueOnce(new Error('down'));
    await expect(translateOutgoing('c1', 'Nasılsın?')).resolves.toBeNull();
  });

  it('sends as typed when they never picked a language', async () => {
    mockGet.mockResolvedValue({ result: { language: null } });
    clearTranslateOutChats();
    setTranslateOutChats([{ conversationId: 'c1', translateOutAt: '2026-11-22T00:00:00Z' }]);
    await expect(translateOutgoing('c1', 'Nasılsın?')).resolves.toBeNull();
  });
});
