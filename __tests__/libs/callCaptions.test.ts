jest.mock('@react-native-async-storage/async-storage', () => ({
  multiGet: jest.fn(() => Promise.resolve([])),
  setItem: jest.fn(() => Promise.resolve()),
}));
const mockInvoke = jest.fn();
jest.mock('../../services/supabase', () => ({ supabase: { functions: { invoke: (...args: unknown[]) => mockInvoke(...args) } } }));
jest.mock('../../libs/auth.utils', () => ({ getAuthToken: jest.fn(() => Promise.resolve('tok')) }));

import { fetchCallCaptionTopic, frameLevel, CAPTION_LANGUAGES } from '../../libs/callCaptions';

describe('call captions helpers', () => {
  it('measures loudness of 16-bit PCM', () => {
    expect(frameLevel(new Uint8Array(0))).toBe(0);
    expect(frameLevel(new Uint8Array(64))).toBe(0);
    // Full-scale negative samples (0x8000) read as -1.
    const loud = new Uint8Array([0x00, 0x80, 0x00, 0x80]);
    expect(frameLevel(loud)).toBeCloseTo(1, 5);
  });

  it('asks the server for the private call channel, never the room name', async () => {
    mockInvoke.mockResolvedValueOnce({ data: { topic: 'abc123' }, error: null });
    await expect(fetchCallCaptionTopic('group-call-00000000-0000-0000-0000-000000000000', '0xABC'))
      .resolves.toBe('call-captions:abc123');
    expect(mockInvoke).toHaveBeenCalledWith('stage-caption-token', expect.objectContaining({
      body: { spaceId: 'group-call-00000000-0000-0000-0000-000000000000', topicOnly: true },
      headers: { 'x-dehub-token': 'tok', 'x-wallet-address': '0xabc' },
    }));
  });

  it('gives no channel when the server refuses', async () => {
    mockInvoke.mockResolvedValueOnce({ data: null, error: new Error('403') });
    await expect(fetchCallCaptionTopic('dm-call-x', '0xabc')).resolves.toBeNull();
  });

  it('offers the same languages as the website', () => {
    expect(CAPTION_LANGUAGES.map((l) => l.code)).toEqual(['en', 'es', 'fr', 'de', 'pt', 'it', 'ja', 'ko', 'zh', 'ar', 'hi', 'ru', 'tr', 'id']);
  });
});

