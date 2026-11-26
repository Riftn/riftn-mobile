import React from 'react';
import { render, screen } from '@testing-library/react-native';
import { BadgeMuseumPanel } from '../../components/Profile/BadgeMuseum';
import { badgeMuseumIsShown } from '../../hooks/useMilestones';

jest.mock('dehub-jsx/jsx-runtime', () => jest.requireActual('react/jsx-runtime'));
jest.mock('react-native-css-interop/jsx-runtime', () => jest.requireActual('react/jsx-runtime'));
jest.mock('react-native', () => {
  const value = () => ({ interpolate: () => 0 });
  return {
    View: 'View', Text: 'Text', ScrollView: 'ScrollView', TouchableOpacity: 'TouchableOpacity',
    Animated: {
      View: 'Animated.View',
      Value: jest.fn().mockImplementation(value),
      timing: () => ({ start: () => {} }),
    },
    Easing: { bezier: () => () => 0 },
    useWindowDimensions: () => ({ width: 390, height: 844 }),
    StyleSheet: {
      create: (styles: unknown) => styles,
      flatten: (styles: unknown) => (Array.isArray(styles) ? Object.assign({}, ...styles) : styles),
    },
  };
});
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('../../context/ThemeContext', () => ({
  useAppTheme: () => ({ accent: [140, 76, 222], isLight: false, theme: 'hazy' }),
  useThemeRootStyle: () => null,
}));
jest.mock('../../components/ui/GlassModal', () => 'GlassModal');
jest.mock('../../components/ui/Icon', () => 'Icon');
jest.mock('react-native-svg', () => ({
  __esModule: true,
  default: 'Svg', Circle: 'Circle', Defs: 'Defs', RadialGradient: 'RadialGradient', Stop: 'Stop',
}));
jest.mock('../../libs/api.client', () => ({ apiClient: { get: jest.fn() } }));

let mockData: any = null;
jest.mock('@tanstack/react-query', () => ({ useQuery: () => ({ data: mockData }) }));

const step = (id: string, kind: string, rarity: number, earned: boolean) => ({ id, kind, goal: 1, rarity, value: earned ? 1 : 0, earned });
const museum = (over: Record<string, unknown> = {}) => ({
  address: '0xabc',
  milestones: [
    step('views_1k', 'views', 30, true),
    step('likes_1k', 'likes', 72, true),
    step('followers_1k', 'followers', 80, true),
    step('videos_10', 'videos', 40, true),
    step('videos_200', 'videos', 92, false),
  ],
  top: ['followers_1k', 'likes_1k', 'videos_10'],
  earned: 4,
  total: 5,
  hidden: false,
  updatedAt: '2026-11-23T00:00:00Z',
  ...over,
});

const medalIcons = () =>
  screen.UNSAFE_root.findAll((n: any) => n.type === 'Icon' && n.parent?.parent?.type === 'Animated.View').map((n: any) => n.props.name);

it('is off until the owner switches it on', () => {
  expect(badgeMuseumIsShown(undefined)).toBe(false);
  expect(badgeMuseumIsShown({ badgeMuseumVisibility: 'hidden' })).toBe(false);
  expect(badgeMuseumIsShown({ badgeMuseumVisibility: 'public' })).toBe(true);
});

it('puts the three rarest earned medals on the profile podium when switched on', () => {
  mockData = museum();
  render(<BadgeMuseumPanel address="0xabc" />);
  // Second, first, third: the rarest stands in the middle.
  expect(medalIcons()).toEqual(['Heart', 'Users', 'Clapperboard']);
  expect(screen.getByText(/badgeMuseum\.seeAll/)).toBeTruthy();
});

it('renders nothing until a badge is earned', () => {
  mockData = museum({ milestones: [step('videos_200', 'videos', 92, false)], earned: 0, top: [] });
  render(<BadgeMuseumPanel address="0xabc" />);
  expect(screen.toJSON()).toBeNull();
});

it('shows nothing on the profile while off, the owner included', () => {
  mockData = museum({ hidden: true });
  const panel = render(<BadgeMuseumPanel address="0xabc" />);
  expect(panel.toJSON()).toBeNull();
});
