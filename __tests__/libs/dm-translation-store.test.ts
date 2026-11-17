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
