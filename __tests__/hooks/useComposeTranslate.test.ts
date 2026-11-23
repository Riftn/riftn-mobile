import { act, renderHook } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useComposeTranslate } from '../../hooks/useComposeTranslate';
import { translateText } from '../../services/translation.service';

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('../../services/translation.service', () => ({ translateText: jest.fn() }));
jest.mock('../../libs/ai-consent', () => ({ ensureAiConsent: () => Promise.resolve(true) }));
jest.mock('../../libs/haptics', () => ({ haptic: { tap: jest.fn() } }));
jest.mock('../../libs/toast', () => ({ toastError: jest.fn(), toastInfo: jest.fn() }));
jest.mock('../../i18n', () => ({ SUPPORTED_LANGUAGES: [] }));
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async () => null), setItem: jest.fn(async () => {}),
}));

it('translates a request draft privately into the preferred language, and remembers an explicit choice', async () => {
  const update = jest.fn();
  (translateText as jest.Mock).mockResolvedValue({ translatedText: 'Hola' });
  const { result } = renderHook(() => useComposeTranslate('Hello', update, 'es'));
  await act(async () => { await result.current.translate(); });
  expect(translateText).toHaveBeenCalledWith('Hello', 'es', 'auto', { isPublic: false });
  expect(update).toHaveBeenCalledWith('Hola');
  await act(async () => { result.current.choose('fr'); });
  expect(result.current.lang).toBe('fr');
  expect(AsyncStorage.setItem).toHaveBeenCalledWith('riftn.chat.translateTo', 'fr');
  expect(translateText).toHaveBeenLastCalledWith('Hello', 'fr', 'auto', { isPublic: false });
});

it('leaves the draft alone when translation fails', async () => {
  const update = jest.fn();
  (translateText as jest.Mock).mockRejectedValue(new Error('offline'));
  const { result } = renderHook(() => useComposeTranslate('Hello', update, 'es'));
  await act(async () => { await result.current.translate(); });
  expect(update).not.toHaveBeenCalled();
});
