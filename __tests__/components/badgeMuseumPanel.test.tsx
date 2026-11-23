import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { BadgeMuseumPanel } from '../../components/Profile/BadgeMuseum';

jest.mock('dehub-jsx/jsx-runtime', () => jest.requireActual('react/jsx-runtime'));
jest.mock('react-native-css-interop/jsx-runtime', () => jest.requireActual('react/jsx-runtime'));
jest.mock('react-native', () => ({
  View: 'View', Text: 'Text', ScrollView: 'ScrollView', TouchableOpacity: 'TouchableOpacity',
  useWindowDimensions: () => ({ width: 390, height: 844 }),
  StyleSheet: {
    create: (styles: unknown) => styles,
    flatten: (styles: unknown) => (Array.isArray(styles) ? Object.assign({}, ...styles) : styles),
  },
}));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('../../context/ThemeContext', () => ({
  useAppTheme: () => ({ accent: [140, 76, 222], isLight: false }),
  useThemeRootStyle: () => null,
}));
jest.mock('../../components/ui/GlassModal', () => 'GlassModal');
jest.mock('../../components/ui/Icon', () => 'Icon');
jest.mock('react-native-svg', () => ({
  __esModule: true,
  default: 'Svg', Defs: 'Defs', LinearGradient: 'LinearGradient', RadialGradient: 'RadialGradient', Polygon: 'Polygon', Stop: 'Stop',
}));

let mockData: any = null;
jest.mock('../../hooks/useMilestones', () => ({ useMilestones: () => ({ data: mockData }) }));

const step = (id: string, kind: string, rarity: number, earned: boolean) => ({ id, kind, goal: 1, rarity, value: earned ? 1 : 0, earned });
const museum = (over: Record<string, unknown> = {}) => ({
  address: '0xabc',
  milestones: [step('views_1k', 'views', 30, true), step('likes_1k', 'likes', 72, true), step('videos_200', 'videos', 92, false)],
  top: ['likes_1k', 'views_1k'],
  earned: 2,
  total: 3,
  hidden: false,
  updatedAt: '2026-11-23T00:00:00Z',
  ...over,
});

function layOut() {
  const grid = screen.UNSAFE_root.findAll((n: any) => typeof n.props?.onLayout === 'function')[0];
  fireEvent(grid, 'layout', { nativeEvent: { layout: { width: 360, height: 100 } } });
}

it('shows only earned badges, rarest first', () => {
  mockData = museum();
  render(<BadgeMuseumPanel address="0xabc" />);
  layOut();
  const tiles = screen.getAllByLabelText(/badgeMuseum\.open$/).map((n: any) => n.props.accessibilityLabel);
  expect(tiles).toEqual(['badgeMuseum.name.likes. badgeMuseum.open', 'badgeMuseum.name.views. badgeMuseum.open', 'badgeMuseum.open']);
  expect(screen.queryByText('badgeMuseum.hiddenNote')).toBeNull();
});

it('renders nothing until a badge is earned', () => {
  mockData = museum({ milestones: [step('videos_200', 'videos', 92, false)], earned: 0, top: [] });
  render(<BadgeMuseumPanel address="0xabc" own />);
  expect(screen.toJSON()).toBeNull();
});

it('keeps a hidden museum to its owner, with a note', () => {
  mockData = museum({ hidden: true });
  const visitor = render(<BadgeMuseumPanel address="0xabc" />);
  expect(visitor.toJSON()).toBeNull();
  visitor.unmount();
  render(<BadgeMuseumPanel address="0xabc" own />);
  expect(screen.getByText('badgeMuseum.hiddenNote')).toBeTruthy();
});
