import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import MomentCaption from '../../components/Stories/MomentCaption';
import { translateText } from '../../services/translation.service';
import { toastSuccess } from '../../libs/toast';

jest.mock('react-native-css-interop/jsx-runtime', () => jest.requireActual('react/jsx-runtime'));
jest.mock('react-native', () => ({
  View: 'View', Text: 'Text', Pressable: 'Pressable', ActivityIndicator: 'ActivityIndicator',
  StyleSheet: { create: (value: object) => value, hairlineWidth: 0.5, flatten: (value: object) => Array.isArray(value) ? Object.assign({}, ...value) : value },
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key, i18n: { language: 'tr' } }),
}));
jest.mock('../../components/ui/Icon', () => 'Icon');
jest.mock('../../components/common/ViewerChrome', () => ({ ChromeFill: () => null, CHROME_HAIRLINE: 'rgba(255,255,255,0.15)' }));
jest.mock('../../components/Stories/StoryRoom', () => ({ TEXT_SHADOW: {} }));
jest.mock('../../libs/ai-consent', () => ({ ensureAiConsent: jest.fn(async () => true) }));
jest.mock('../../libs/toast', () => ({ toastError: jest.fn(), toastSuccess: jest.fn() }));
jest.mock('../../services/translation.service', () => ({
  getUserLanguage: () => 'tr',
  translateText: jest.fn(),
}));

const mockTranslate = translateText as jest.Mock;

beforeEach(() => { jest.clearAllMocks(); });

it('shows no chip on a caption in the viewer\'s language', () => {
  const view = render(<MomentCaption text="Günaydın herkese, harika bir gün" publicContent />);
  expect(view.queryByLabelText('Translate')).toBeNull();
});

it('translates the caption on tap and flips back to the original', async () => {
  mockTranslate.mockResolvedValue({ translatedText: 'Herkese günaydın, ne gün ama', sourceLang: 'en', sameLanguage: false });
  const view = render(<MomentCaption text="Good morning everyone, what a day" publicContent />);

  await act(async () => { fireEvent.press(view.getByLabelText('Translate')); });
  expect(mockTranslate).toHaveBeenCalledWith('Good morning everyone, what a day', 'tr', 'auto', { isPublic: true });
  expect(view.getByText('Herkese günaydın, ne gün ama')).toBeTruthy();

  await act(async () => { fireEvent.press(view.getByLabelText('See original')); });
  expect(view.getByText('Good morning everyone, what a day')).toBeTruthy();

  // Back to the translation without asking again.
  await act(async () => { fireEvent.press(view.getByLabelText('Translate')); });
  expect(view.getByText('Herkese günaydın, ne gün ama')).toBeTruthy();
  expect(mockTranslate).toHaveBeenCalledTimes(1);
});

it('drops the chip when the translator says it is already in the viewer\'s language', async () => {
  mockTranslate.mockResolvedValue({ translatedText: 'Good morning everyone, what a day', sourceLang: 'tr', sameLanguage: true });
  const view = render(<MomentCaption text="Good morning everyone, what a day" publicContent={false} />);

  await act(async () => { fireEvent.press(view.getByLabelText('Translate')); });
  expect(mockTranslate).toHaveBeenCalledWith('Good morning everyone, what a day', 'tr', 'auto', { isPublic: false });
  expect(toastSuccess).toHaveBeenCalledWith('Already in your language');
  expect(view.queryByLabelText('Translate')).toBeNull();
});
