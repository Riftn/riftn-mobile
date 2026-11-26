import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import manifest from '../../i18n/locale-manifest.json';
import bundledCopy from '../../i18n/offline-connection-copy.json';
import NoInternetScreen from '../../screens/NoInternetScreen';

jest.mock('react-native-css-interop/jsx-runtime', () => jest.requireActual('react/jsx-runtime'));
jest.mock('react-native', () => {
  const React = jest.requireActual('react');
  return {
    View: 'View', Text: 'Text', ScrollView: 'ScrollView', ActivityIndicator: 'ActivityIndicator',
    TouchableOpacity: (props: object) => React.createElement('TouchableOpacity', { accessible: true, ...props }),
    StyleSheet: { create: (styles: unknown) => styles, flatten: (style: unknown) => style },
  };
});
jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: 'SafeAreaView' }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ i18n: { language: 'en' } }) }));
jest.mock('../../i18n', () => ({
  isLanguageReady: () => false,
  readPreferredLanguage: async () => 'tr',
}));
jest.mock('../../components/ui/ThemePanel', () => 'ThemePanel');
jest.mock('../../components/ui/Icon', () => 'Icon');
jest.mock('../../components/ui/AccentButtonGradient', () => 'AccentButtonGradient');
jest.mock('../../context/ThemeContext', () => ({ useAppTheme: () => ({ skin: null }) }));

it('includes complete offline copy for every published locale', () => {
  expect(Object.keys(bundledCopy).sort()).toEqual([...manifest.languages].sort());
  for (const copy of Object.values(bundledCopy)) {
    expect(copy.noInternetHint).toContain('{{action}}');
    expect(Object.values(copy).every(text => text.trim().length > 0)).toBe(true);
  }
});

it('shows saved Turkish on cold start before a locale pack loads and keeps Retry localized while checking', async () => {
  let finishRetry!: () => void;
  const onRetry = jest.fn(() => new Promise<void>(resolve => { finishRetry = resolve; }));
  const view = render(<NoInternetScreen onRetry={onRetry} />);
  expect(view.queryByText('No Internet Connection')).toBeNull();
  expect(await view.findByText('İnternet Bağlantısı Yok')).toBeTruthy();
  expect(view.getByText(bundledCopy.tr.noInternetHint.replace('{{action}}', bundledCopy.tr.tryAgain))).toBeTruthy();

  const retry = view.getByRole('button', { name: 'Tekrar dene' });
  fireEvent.press(retry);
  expect(onRetry).toHaveBeenCalledTimes(1);
  expect(view.getByRole('button', { name: 'Tekrar dene', disabled: true, busy: true })).toBeTruthy();
  await act(async () => { finishRetry(); });
  expect(view.getByRole('button', { name: 'Tekrar dene', disabled: false, busy: false })).toBeTruthy();
});
