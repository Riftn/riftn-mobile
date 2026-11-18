import React from 'react';
import { render, act } from '@testing-library/react-native';

jest.mock('react-native-css-interop/jsx-runtime', () => jest.requireActual('react/jsx-runtime'));
jest.mock('react-native', () => ({
  View: 'View',
  StyleSheet: { absoluteFill: {}, flatten: (style: unknown) => style || {} },
  AppState: { addEventListener: () => ({ remove: () => {} }) },
}));
jest.mock('../../config/env', () => ({ __esModule: true, default: { REOWN_PROJECT_ID: 'test' } }));
jest.mock('../../libs/wallets.local', () => ({ forgetDeviceVerification: jest.fn() }));
jest.mock('@reown/appkit-ethers5-react-native', () => ({ AppKit: 'Picker' }));

(globalThis as any).__REOWN_APPKIT_INSTANCE__ = { open: jest.fn() };

import WalletRuntimeHost, { ScreenWalletPicker } from '../../components/auth/WalletRuntimeHost';

const Page = (props: { children?: React.ReactNode }) => <>{props.children}</>;
const pickers = (view: ReturnType<typeof render>) => view.UNSAFE_queryAllByType('Picker' as any);
const pickersInPage = (view: ReturnType<typeof render>) =>
  view.UNSAFE_queryAllByType(Page).flatMap(page => page.findAllByType('Picker' as any));

// iPhone shows the sign-in page as a native modal above the app's root view.
// The wallet picker must then be drawn by that page, and only once.
describe('wallet picker host', () => {
  it('is drawn by the app when no page has claimed it', () => {
    const view = render(<WalletRuntimeHost />);
    expect(pickers(view)).toHaveLength(1);
  });

  it('moves into a page that claims it and comes back when the page closes', () => {
    const view = render(<><WalletRuntimeHost /><Page><ScreenWalletPicker /></Page></>);
    expect(pickers(view)).toHaveLength(1);
    expect(pickersInPage(view)).toHaveLength(1);
    act(() => { view.rerender(<><WalletRuntimeHost /><Page /></>); });
    expect(pickers(view)).toHaveLength(1);
    expect(pickersInPage(view)).toHaveLength(0);
  });

  it('is drawn once, by the newest page, when two claim it', () => {
    const view = render(<><WalletRuntimeHost /><ScreenWalletPicker /><Page><ScreenWalletPicker /></Page></>);
    expect(pickers(view)).toHaveLength(1);
    expect(pickersInPage(view)).toHaveLength(1);
  });
});
