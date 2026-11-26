import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import SuperPowersScreen from '../../screens/SuperPowersScreen';

let mockStatus: any;
let mockPurchases = false;
const mockCancelBoost = jest.fn();
jest.mock('react-native-css-interop/jsx-runtime', () => jest.requireActual('react/jsx-runtime'));
jest.mock('react-native', () => ({
  View: 'View', Text: 'Text', ScrollView: 'ScrollView', Pressable: 'Pressable',
  ActivityIndicator: 'ActivityIndicator', Image: 'Image',
  useWindowDimensions: () => ({ width: 390, height: 844 }),
  StyleSheet: { create: (s: unknown) => s, flatten: (s: unknown) => s },
}));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }) }));
jest.mock('../../theme', () => ({ theme: { colors: { accent: '#fff' } } }));
jest.mock('../../libs', () => ({ badgeImage: () => null, toastError: jest.fn(), toastSuccess: jest.fn() }));
jest.mock('../../context/AuthContext', () => ({ useUser: () => ({ address: '0xgranted' }) }));
jest.mock('../../config/storefront', () => ({ get DIGITAL_PURCHASES_ENABLED() { return mockPurchases; } }));
jest.mock('../../hooks/useSuperpowers', () => ({
  useSuperpowers: () => ({ data: mockStatus, isLoading: false, refetch: jest.fn() }),
  useSuperpowerLadder: () => ({ data: { powers: [
    { key: 'team_up', label: 'Team up', available: true, tier: null },
  ], tiers: [] }, isLoading: false }),
  useCancelBoost: () => ({ mutate: mockCancelBoost }),
}));
jest.mock('../../components/ui/Icon', () => 'Icon');
jest.mock('../../components/ScreenHeader', () => 'ScreenHeader');
jest.mock('react-native-svg', () => ({ __esModule: true, default: 'Svg', Circle: 'Circle', Defs: 'Defs', LinearGradient: 'LinearGradient', Path: 'Path', Stop: 'Stop' }));
jest.mock('../../components/page/PageKit', () => {
  const h = require('react').createElement;
  return {
    PageSection: ({ children }: any) => h('View', null, children),
    PageEmpty: ({ title, body, action }: any) => h('View', null, h('Text', null, title), body ? h('Text', null, body) : null, action),
    KitButton: ({ label, onPress, disabled }: any) => h('Pressable', { onPress, disabled, accessibilityRole: 'button' }, h('Text', null, label)),
    PageTabs: () => null,
    ThemeIcon: () => null,
    useFlatPage: () => true,
  };
});
jest.mock('../../components/Badge/BadgeProgress', () => ({ BadgeProgress: () => null }));
jest.mock('../../components/common/SuperPowerIcon', () => 'SuperPowerIcon');
jest.mock('../../components/ui/GlassModal', () => ({ __esModule: true, default: ({ visible, children }: any) => visible ? children : null }));
jest.mock('../../components/common/SpendPowerSheet', () => {
  const element = require('react').createElement;
  return { __esModule: true, default: ({ power }: any) => power ? element('Text', { testID: 'spend-power' }, power.key) : null };
});
jest.mock('../../components/common/TeamUpSheet', () => {
  const element = require('react').createElement;
  return { __esModule: true, default: ({ visible }: any) => visible ? element('Text', { testID: 'team-up' }, 'Team up open') : null };
});
jest.mock('../../components/Dpay/BuyDhbSheet', () => {
  const element = require('react').createElement;
  return { __esModule: true, default: () => element('Text', { testID: 'token-purchase' }, 'Token purchase') };
});

beforeEach(() => {
  mockStatus = undefined;
  mockPurchases = false;
  mockCancelBoost.mockClear();
});

const boost = { key: 'boost', label: 'Boost', summary: 'Boost a post', tier: 'Crab', unlocked: true, available: true };

it('lets iOS users cancel an active boost from usage without offering a purchase or new boost', () => {
  mockStatus = { tier: 'Crab', badgeBalance: 0, boostsLeft: 2, bookings: [
    { id: 'queued', power: 'boost', status: 'active', startsAt: '2026-11-27T00:00:00Z', served: 0 },
    { id: 'completed', power: 'boost', status: 'completed', startsAt: '2026-11-26T00:00:00Z', served: 4 },
  ], powers: [boost] };
  const view = render(<SuperPowersScreen />);
  expect(view.getByText('Boost a post')).toBeTruthy();
  fireEvent.press(view.getByText('superpowers.pastUsage'));
  expect(view.getByText('superpowers.usageTitle')).toBeTruthy();
  expect(view.getByText('converter.statusQueued')).toBeTruthy();
  fireEvent.press(view.getByText('common.cancel'));
  expect(mockCancelBoost).toHaveBeenCalledWith('queued', expect.any(Object));
  expect(view.queryByText('auth.use')).toBeNull();
  expect(view.queryByTestId('token-purchase')).toBeNull();
});

it('shows Team up in the iOS catalog without opening the team management sheet', () => {
  const view = render(<SuperPowersScreen />);
  fireEvent.press(view.getByLabelText('Team up'));
  expect(view.getByText('Team up')).toBeTruthy();
  expect(view.getByText('storefront.unavailable')).toBeTruthy();
  expect(view.queryByTestId('team-up')).toBeNull();
  expect(view.queryByText('superpowers.getDhb')).toBeNull();
});

it('keeps existing boost and Team up actions available on Android', () => {
  mockPurchases = true;
  mockStatus = { tier: 'Crab', badgeBalance: 0, boostsLeft: 2, bookings: [], powers: [
    boost, { key: 'team_up', label: 'Team up', available: true, tier: null },
  ] };
  const view = render(<SuperPowersScreen />);
  fireEvent.press(view.getByText('auth.use'));
  expect(view.getByTestId('spend-power').props.children).toBe('boost');
  fireEvent.press(view.getByLabelText('Team up'));
  fireEvent.press(view.getAllByText('Team up').slice(-1)[0]);
  expect(view.getByTestId('team-up')).toBeTruthy();
});

it('retains the optional token purchase on platforms where it is enabled', () => {
  mockPurchases = true;
  const view = render(<SuperPowersScreen />);
  expect(view.getByText('superpowers.getDhb')).toBeTruthy();
  expect(view.getByTestId('token-purchase')).toBeTruthy();
});
