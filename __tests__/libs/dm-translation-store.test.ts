import { act, renderHook } from '@testing-library/react-native';

jest.mock('../../services/translation.service', () => ({
  translateText: jest.fn(),
  getUserLanguage: () => 'en',
}));
jest.mock('../../libs/toast', () => ({ toastError: jest.fn(), toastSuccess: jest.fn() }));

import { translateText } from '../../services/translation.service';
import { __resetAutoTranslateBudget } from '../../libs/auto-translate-budget';
import {
  __resetDmTranslations,
  canTranslateDm,
  getDmTranslation,
  toggleDmTranslation,
  translateDmAndAbove,
  useDmTranslation,
} from '../../libs/dm-translation-store';

const mockTranslate = translateText as jest.Mock;
beforeEach(() => { __resetDmTranslations(); __resetAutoTranslateBudget(); mockTranslate.mockReset(); });

it('offers Translate only for messages with words', () => {
  expect(canTranslateDm('Selam reis')).toBe(true);
  expect(canTranslateDm('👍🔥')).toBe(false);
  expect(canTranslateDm('https://riftn.com/p/1')).toBe(false);
});

it('translates a held message privately, then flips back to the original and again', async () => {
  mockTranslate.mockResolvedValue({ translatedText: 'Hi boss', sourceLang: 'tr', sameLanguage: false });
  const { result } = renderHook(() => useDmTranslation('m1'));
  await act(() => toggleDmTranslation('m1', 'Selam reis https://riftn.com/x'));
  expect(mockTranslate).toHaveBeenCalledWith('Selam reis', 'en', 'auto', { isPublic: false });
  expect(result.current).toEqual({ status: 'shown', text: 'Hi boss' });
  await act(() => toggleDmTranslation('m1', 'Selam reis'));
  expect(result.current).toEqual({ status: 'hidden', text: 'Hi boss' });
  await act(() => toggleDmTranslation('m1', 'Selam reis'));
  expect(result.current?.status).toBe('shown');
  expect(mockTranslate).toHaveBeenCalledTimes(1);
});

it('leaves the message alone when it is already in your language or the call fails', async () => {
  mockTranslate.mockResolvedValueOnce({ translatedText: 'hello', sourceLang: 'en', sameLanguage: true });
  await toggleDmTranslation('m2', 'hello there');
  expect(getDmTranslation('m2')).toBeUndefined();
  mockTranslate.mockRejectedValueOnce(new Error('down'));
  await toggleDmTranslation('m3', 'bonjour mon ami');
  expect(getDmTranslation('m3')).toBeUndefined();
});

describe('auto-translate for received messages', () => {
  const { autoTranslateDm, shouldAutoTranslateDm } = require('../../libs/dm-translation-store');
  const consent = require('../../libs/ai-consent');

  it('picks lines that plainly read as another language, not slang or your own language', () => {
    expect(shouldAutoTranslateDm('bom dia galera, tudo bem?', 'en')).toBe(true);
    expect(shouldAutoTranslateDm('Привет, как дела?', 'en')).toBe(true);
    expect(shouldAutoTranslateDm('hiya bashmo bro', 'en')).toBe(false);
    expect(shouldAutoTranslateDm('good morning everyone, thanks for the help', 'en')).toBe(false);
    expect(shouldAutoTranslateDm('👍🔥', 'en')).toBe(false);
    expect(shouldAutoTranslateDm('Привет, как дела?', 'ru')).toBe(true);
  });

  it('translates once, quietly, and leaves same-language answers alone', async () => {
    jest.spyOn(consent, 'hasAiConsent').mockReturnValue(true);
    mockTranslate.mockResolvedValueOnce({ translatedText: 'Hi, how are you?', sourceLang: 'ru', sameLanguage: false });
    await autoTranslateDm('a1', 'Привет, как дела?');
    expect(getDmTranslation('a1')).toEqual({ status: 'shown', text: 'Hi, how are you?' });
    await toggleDmTranslation('a1', 'Привет, как дела?');
    await autoTranslateDm('a1', 'Привет, как дела?');
    expect(getDmTranslation('a1')?.status).toBe('hidden');
    expect(mockTranslate).toHaveBeenCalledTimes(1);

    mockTranslate.mockResolvedValueOnce({ translatedText: 'hello', sourceLang: 'en', sameLanguage: true });
    await autoTranslateDm('a2', 'hello there');
    expect(getDmTranslation('a2')).toBeUndefined();
  });

  it('does nothing without AI permission', async () => {
    jest.spyOn(consent, 'hasAiConsent').mockReturnValue(false);
    await autoTranslateDm('a3', 'Привет, как дела?');
    expect(mockTranslate).not.toHaveBeenCalled();
  });
});

it('Translate on one message also translates the earlier ones, quietly and nearest first', async () => {
  mockTranslate.mockImplementation(async (text: string) => (
    text === 'ok' ? { translatedText: 'ok', sameLanguage: true } : { translatedText: `EN:${text}`, sameLanguage: false }
  ));
  await toggleDmTranslation('done', 'zaten cevrildi');
  mockTranslate.mockClear();
  await translateDmAndAbove('tapped', 'Selam reis', [
    { id: 'old', content: 'nasilsin', at: 1 },
    { id: 'newer', content: 'iyi misin', at: 2 },
    { id: 'emoji', content: '👍', at: 3 },
    { id: 'same', content: 'ok', at: 4 },
    { id: 'done', content: 'zaten cevrildi', at: 5 },
    { id: 'tapped', content: 'Selam reis', at: 6 },
  ]);
  expect(getDmTranslation('tapped')).toEqual({ status: 'shown', text: 'EN:Selam reis' });
  expect(getDmTranslation('old')).toEqual({ status: 'shown', text: 'EN:nasilsin' });
  expect(getDmTranslation('newer')).toEqual({ status: 'shown', text: 'EN:iyi misin' });
  // Already in the reader's language, emoji-only and already translated lines are left alone.
  expect(getDmTranslation('same')).toBeUndefined();
  expect(getDmTranslation('emoji')).toBeUndefined();
  const asked = mockTranslate.mock.calls.map((call) => call[0]);
  expect(asked).toContain('Selam reis');
  expect(asked.filter((text) => text !== 'Selam reis')).toEqual(['ok', 'iyi misin', 'nasilsin']);
});

describe('Translate on your own line', () => {
  const { translateOwnDm } = require('../../libs/dm-translation-store');
  const AsyncStorageModule = require('@react-native-async-storage/async-storage');
  const AsyncStorage = AsyncStorageModule.default ?? AsyncStorageModule;

  it('goes into your language and flips back without another call', async () => {
    mockTranslate.mockResolvedValue({ translatedText: 'See you tomorrow', sourceLang: 'tr', sameLanguage: false });
    await translateOwnDm('o1', 'Yarın görüşürüz');
    expect(mockTranslate).toHaveBeenCalledWith('Yarın görüşürüz', 'en', 'auto', { isPublic: false });
    expect(getDmTranslation('o1')).toEqual({ status: 'shown', text: 'See you tomorrow' });
    await translateOwnDm('o1', 'Yarın görüşürüz');
    expect(getDmTranslation('o1')?.status).toBe('hidden');
    expect(mockTranslate).toHaveBeenCalledTimes(1);
  });

  it('uses the composer language when the line is already in yours', async () => {
    jest.spyOn(AsyncStorage, 'getItem').mockResolvedValueOnce('tr');
    mockTranslate
      .mockResolvedValueOnce({ translatedText: 'see you tomorrow', sourceLang: 'en', sameLanguage: true })
      .mockResolvedValueOnce({ translatedText: 'Yarın görüşürüz', sourceLang: 'en', sameLanguage: false });
    await translateOwnDm('o2', 'see you tomorrow');
    expect(mockTranslate).toHaveBeenLastCalledWith('see you tomorrow', 'tr', 'auto', { isPublic: false });
    expect(getDmTranslation('o2')).toEqual({ status: 'shown', text: 'Yarın görüşürüz' });
  });

  it('leaves it alone when both languages match the line', async () => {
    jest.spyOn(AsyncStorage, 'getItem').mockResolvedValueOnce(null);
    mockTranslate.mockResolvedValue({ translatedText: 'hello there', sourceLang: 'en', sameLanguage: true });
    await translateOwnDm('o3', 'hello there');
    expect(mockTranslate).toHaveBeenCalledTimes(1);
    expect(getDmTranslation('o3')).toBeUndefined();
  });
});
