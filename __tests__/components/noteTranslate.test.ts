import { act, renderHook, waitFor } from '@testing-library/react-native';
import { resetNoteTranslations, useNoteWords } from '../../components/DM/note-translate';
import { translateText } from '../../services/translation.service';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key, i18n: { language: 'en' } }),
}));
let mockAuto = true;
jest.mock('../../libs/auto-translate-setting', () => ({
  autoTranslateEnabled: () => mockAuto,
  subscribeAutoTranslate: () => () => {},
}));
jest.mock('../../libs/ai-consent', () => ({
  ensureAiConsent: jest.fn(async () => true),
  subscribeAiConsent: () => () => {},
}));
jest.mock('../../services/translation.service', () => ({
  getUserLanguage: () => 'en',
  translateText: jest.fn(),
}));

const mockTranslate = translateText as jest.Mock;
const TRANSLATED = 'What a beautiful day today';

beforeEach(() => {
  jest.clearAllMocks();
  mockAuto = true;
  act(() => resetNoteTranslations());
  mockTranslate.mockResolvedValue({ translatedText: TRANSLATED, sourceLang: 'tr', sameLanguage: false });
});

it('translates a note in another language on sight, and flips back to the original', async () => {
  const { result } = renderHook(() => useNoteWords('Bugün ne güzel bir gün'));
  await waitFor(() => expect(result.current.shown).toBe(TRANSLATED));
  expect(mockTranslate).toHaveBeenCalledWith('Bugün ne güzel bir gün', 'en', 'auto', { isPublic: false });
  expect(result.current.offer).toBe(true);

  act(() => result.current.showOriginal());
  expect(result.current.shown).toBe('Bugün ne güzel bir gün');

  await act(async () => { await result.current.translate(); });
  expect(result.current.shown).toBe(TRANSLATED);
  expect(mockTranslate).toHaveBeenCalledTimes(1);
});

it('asks once for the same note shown in several places', async () => {
  const a = renderHook(() => useNoteWords('Yarın sinemaya gidiyoruz'));
  const b = renderHook(() => useNoteWords('Yarın sinemaya gidiyoruz'));
  await waitFor(() => expect(b.result.current.shown).toBe(TRANSLATED));
  expect(a.result.current.shown).toBe(TRANSLATED);
  expect(mockTranslate).toHaveBeenCalledTimes(1);
});

it('sends nothing for a note in the reader\'s language, or your own note', async () => {
  const same = renderHook(() => useNoteWords('going to the beach with the kids today'));
  const own = renderHook(() => useNoteWords('Bugün çok yorgunum ama mutluyum', true));
  await act(async () => {});
  expect(mockTranslate).not.toHaveBeenCalled();
  expect(same.result.current.offer).toBe(false);
  expect(own.result.current.offer).toBe(false);
});

it('waits for a tap when auto-translate is off', async () => {
  mockAuto = false;
  const { result } = renderHook(() => useNoteWords('Akşam yemeği hazır mı'));
  await act(async () => {});
  expect(mockTranslate).not.toHaveBeenCalled();
  expect(result.current.offer).toBe(true);
  await act(async () => { await result.current.translate(); });
  await waitFor(() => expect(result.current.shown).toBe(TRANSLATED));
});

it('drops the offer when the translator says it is already in the reader\'s language', async () => {
  mockTranslate.mockResolvedValue({ translatedText: 'Merhaba dünya', sourceLang: 'en', sameLanguage: true });
  const { result } = renderHook(() => useNoteWords('Merhaba dünya'));
  await waitFor(() => expect(result.current.offer).toBe(false));
  expect(result.current.shown).toBe('Merhaba dünya');
});
