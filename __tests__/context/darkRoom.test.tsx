import React from 'react';
import { act, create } from 'react-test-renderer';

jest.mock('react-native-css-interop/jsx-runtime', () => jest.requireActual('react/jsx-runtime'));
jest.mock('react-native', () => ({
  Platform: { OS: 'ios' },
  AppState: { addEventListener: () => ({ remove: () => {} }) },
  Appearance: { addChangeListener: () => ({ remove: () => {} }) },
}));
jest.mock('expo-system-ui', () => ({ setBackgroundColorAsync: () => Promise.resolve() }));
jest.mock('nativewind', () => ({ colorScheme: { set: () => {} }, vars: (v: unknown) => v }));
jest.mock('../../modules/system-bars', () => ({ setNavigationBarDarkIcons: () => Promise.resolve() }));
jest.mock('../../libs/halloweenOverride', () => ({
  HALLOWEEN_THEME: 'horror', isHalloweenDay: () => false, msUntilLocalMidnight: () => 1e9,
}));
jest.mock('../../hooks/useAppPrefs', () => ({
  useAppPrefs: () => ({ theme: 'system-light', themeHues: {}, brandColors: [], halloweenOptOut: false }),
  getAppPrefs: () => ({ themeHues: {}, halloweenOptOut: false }),
  setAppPref: () => {},
}));

const { AppThemeProvider, DarkRoomProvider, useAppTheme } = require('../../context/ThemeContext');

it('keeps the app on System Light while a dark room shows System inside it', () => {
  const seen: Record<string, { isLight: boolean; themeChoice: string }> = {};
  const Probe = ({ name }: { name: string }) => {
    const { isLight, themeChoice } = useAppTheme();
    seen[name] = { isLight, themeChoice };
    return null;
  };
  act(() => {
    create(
      <AppThemeProvider>
        <Probe name="home" />
        <DarkRoomProvider>
          <Probe name="live" />
        </DarkRoomProvider>
      </AppThemeProvider>,
    );
  });
  expect(seen.home).toEqual({ isLight: true, themeChoice: 'system-light' });
  expect(seen.live).toEqual({ isLight: false, themeChoice: 'system' });
});
