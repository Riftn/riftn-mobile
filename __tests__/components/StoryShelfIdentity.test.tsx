import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { StoryCreateTile } from '../../components/Stories/StoryCreateBar';
import StoryShelf from '../../components/Stories/StoryShelf';
import HoldSheet from '../../components/ui/HoldSheet';
import { setActivityBarHidden, setActivityItemsHidden } from '../../libs/activity-shelf-preferences';

const mockOpenLive = jest.fn();
const mockOpenStory = jest.fn();
const mockOpenCreator = jest.fn();
const mockLive = { id: 'live-room', kind: 'stream', wallet: 'host', title: 'Trail watch', displayName: 'Maya Chen', cover: 'broadcast.jpg' };
let mockIsLight = false;
const mockAccount = { hideBadgeAndBalance: false };
jest.mock('dehub-jsx/jsx-runtime', () => jest.requireActual('react/jsx-runtime'));
jest.mock('react-native', () => ({
  ScrollView: 'ScrollView', Text: 'Text', TouchableOpacity: 'TouchableOpacity', View: 'View',
  Animated: { View: 'AnimatedView', Value: function MockValue() { return {}; }, loop: () => ({ start: () => {}, stop: () => {} }), sequence: () => ({}), timing: () => ({}) },
  Easing: { inOut: () => () => 0, ease: () => 0 },
  AccessibilityInfo: { isReduceMotionEnabled: () => Promise.resolve(true) },
  StyleSheet: { create: (styles: unknown) => styles, absoluteFill: {}, absoluteFillObject: {}, hairlineWidth: 0.5 },
}));
jest.mock('../../components/Stories/StoryCreateBar', () => ({
  __esModule: true, default: () => null, StoryCreateTile: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock('react-native-gesture-handler', () => ({ GestureDetector: 'GestureDetector' }));
jest.mock('expo-image', () => ({ Image: 'Image' }));
jest.mock('expo-linear-gradient', () => ({ LinearGradient: 'Gradient' }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string, options?: { defaultValue: string }) => options?.defaultValue || key }) }));
jest.mock('valtio', () => ({ useSnapshot: () => ({}) }));
jest.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({}), useQuery: () => ({ data: { askedHosts: 'host', liveHosts: ['host'], shelf: [{
  author: { address: 'creator', username: 'the_handle', displayName: 'River Song' },
  items: [{ id: 'opening', status: 'ready', type: 'photo', mediaUrl: 'opening.jpg', createdAt: new Date().toISOString() }],
}] } }) }));
jest.mock('../../hooks/useStoriesEnabled', () => ({ useStoriesEnabled: () => ({ storiesEnabled: true }) }));
jest.mock('../../context/AuthContext', () => ({ useUser: () => ({ address: 'owner' }), useAuthActions: () => ({ requireAuth: (run: () => void) => run() }) }));
jest.mock('../../context/PagerGestureContext', () => ({ useHorizontalScrollGuard: () => null, useHorizontalSectionGuard: () => null }));
jest.mock('../../context/ThemeContext', () => ({ useAppTheme: () => ({ isLight: mockIsLight }) }));
jest.mock('../../hooks/useKidsModeLock', () => ({ useKidsModeLock: () => false }));
jest.mock('../../hooks/useAccountBadge', () => ({ useBadgeAccount: () => mockAccount }));
jest.mock('../../components/Home/LiveNowBar', () => ({ LiveFace: 'LiveFace', useLiveNowItems: () => ({ items: [mockLive], open: mockOpenLive }) }));
jest.mock('../../libs/misc', () => ({ getBadgeUrlFor: () => 42 }));
jest.mock('../../components/ui/Icon', () => 'Icon');
jest.mock('../../components/common/Avatar', () => 'Avatar');
jest.mock('../../services/stories.service', () => ({}));
jest.mock('../../store/stories.store', () => ({ openStoryViewer: (...args: unknown[]) => mockOpenStory(...args), openStoryCreator: () => mockOpenCreator(), storiesState: {} }));
jest.mock('../../config/storefront', () => ({}));
jest.mock('../../hooks/useLiveAudience', () => ({ useLiveAudience: () => ({ data: undefined }) }));
jest.mock('../../components/ui/HoldSheet', () => 'HoldSheet');
jest.mock('../../libs/toast', () => ({ toastSuccess: jest.fn() }));
jest.mock('../../services/block.service', () => ({ blockUser: jest.fn() }));
jest.mock('../../services/mute.service', () => ({ muteUser: jest.fn() }));

it('names each pill and respects badge visibility', () => {
  let tree!: ReactTestRenderer;
  act(() => { tree = create(<StoryShelf />); });
  const nodes = () => tree.root.findAll(node => typeof node.type === 'string');
  for (const label of ['Maya Chen', 'River Song']) {
    expect(nodes().some(node => String(node.type) === 'Text' && node.props.children === label)).toBe(true);
  }
  expect(nodes().some(node => node.props.source === 42)).toBe(true);
  act(() => tree.unmount());
  mockAccount.hideBadgeAndBalance = true;
  act(() => { tree = create(<StoryShelf />); });
  expect(nodes().some(node => node.props.source === 42)).toBe(false);
  act(() => tree.unmount());
  mockAccount.hideBadgeAndBalance = false;
});

it('keeps separate Live, Story, and Create controls', () => {
  let tree!: ReactTestRenderer;
  act(() => { tree = create(<StoryShelf />); });
  const tap = (label: string) => {
    const button = tree.root.findByProps({ accessibilityRole: 'button', accessibilityLabel: label });
    act(() => button.props.onPress());
  };
  tap('Trail watch, stages.live');
  expect(mockOpenLive).toHaveBeenCalledWith(mockLive);
  tap('River Song');
  expect(mockOpenStory).toHaveBeenCalledWith(expect.any(Array), 0);
  const createTile = tree.root.findByType(StoryCreateTile);
  const plus = createTile.findByProps({ name: 'Plus' });
  const storyAvatar = tree.root.findByProps({ name: 'River Song', size: 36 });
  expect(createTile.props.height).toBe(52);
  expect(plus.props.size).toBe(16);
  expect(plus.parent?.props.style).toEqual(storyAvatar.parent?.props.style);
  expect(mockOpenStory).toHaveBeenCalledTimes(1);
  act(() => tree.unmount());
});

it('offers the activity actions on long press and hides only the selected story', () => {
  let tree!: ReactTestRenderer;
  act(() => { tree = create(<StoryShelf />); });
  const pill = (name: string) => tree.root.findByProps({ accessibilityRole: 'button', accessibilityLabel: name });
  const select = (key: string) => {
    const sheet = tree.root.findByType(HoldSheet);
    expect(sheet.props.visible).toBe(true);
    const tile = (sheet.props.tiles as { key: string; onPress: () => void }[]).find(item => item.key === key);
    expect(tile).toBeDefined();
    act(() => tile?.onPress());
  };
  try {
    act(() => pill('Trail watch, stages.live').props.onLongPress());
    select('open');
    expect(mockOpenLive).toHaveBeenCalledWith(mockLive);
    act(() => pill('River Song').props.onLongPress());
    expect(tree.root.findByType(HoldSheet).props.tiles.map((tile: { label: string }) => tile.label)).toEqual([
      'Hide activity bar', 'Hide story', 'Watch', 'Mute creator', 'Block creator',
    ]);
    select('hide-item');
    expect(tree.root.findAllByProps({ accessibilityLabel: 'River Song' })).toHaveLength(0);
    expect(pill('Trail watch, stages.live')).toBeTruthy();
  } finally {
    act(() => tree.unmount());
    setActivityBarHidden(false);
    setActivityItemsHidden(['story:opening'], false);
  }
});

it('outlines live and moment pills with no grey fill in light mode', () => {
  let tree!: ReactTestRenderer;
  mockIsLight = true;
  try {
    act(() => { tree = create(<StoryShelf />); });
    const pills = tree.root.findAll(node => String(node.type) === 'TouchableOpacity' && Array.isArray(node.props.style) && node.props.style.some(
      (style: { borderColor?: string } | undefined) => style?.borderColor === 'hsla(240,8%,4%,0.1)',
    ));
    expect(pills).toHaveLength(2);
    for (const pill of pills) {
      expect(pill.props.style).toContainEqual({ borderColor: 'hsla(240,8%,4%,0.1)', backgroundColor: 'transparent' });
    }
  } finally {
    act(() => tree?.unmount());
    mockIsLight = false;
  }
});

it('shows no time chip on moment tiles; the time lives inside the moment', () => {
  let tree!: ReactTestRenderer;
  act(() => { tree = create(<StoryShelf />); });
  const flatten = (style: unknown): Record<string, unknown> =>
    Array.isArray(style) ? Object.assign({}, ...style.filter(Boolean).map(flatten)) : (style as Record<string, unknown>) ?? {};
  const rims = tree.root.findAll(node => typeof node.type === 'string'
    && flatten(node.props.style).borderColor === 'rgba(255,255,255,0.55)');
  expect(rims).toHaveLength(0);
  act(() => tree.unmount());
});
