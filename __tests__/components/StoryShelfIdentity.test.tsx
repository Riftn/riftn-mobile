import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import StoryShelf from '../../components/Stories/StoryShelf';
import { ActivityShelfMenu } from '../../components/Stories/ActivityShelfMenu';
import HoldSheet from '../../components/ui/HoldSheet';
import { getActivityShelfPreferences, setActivityBarHidden, setActivityItemsHidden } from '../../libs/activity-shelf-preferences';

const mockOpenLive = jest.fn();
const mockOpenStory = jest.fn();
const mockOpenCreator = jest.fn();
const mockLive = { id: 'live-room', kind: 'stream', wallet: 'host', title: 'Trail watch', displayName: 'Maya Chen', cover: 'broadcast.jpg' };
let mockIsLight = false;
const mockAccount = { hideBadgeAndBalance: false };
let mockSeen = false;
jest.mock('dehub-jsx/jsx-runtime', () => jest.requireActual('react/jsx-runtime'));
jest.mock('react-native', () => ({
  ScrollView: 'ScrollView', Text: 'Text', TouchableOpacity: 'TouchableOpacity', View: 'View',
  Animated: { View: 'AnimatedView', Value: function MockValue() { return {}; }, loop: () => ({ start: () => {}, stop: () => {} }), sequence: () => ({}), timing: () => ({}) },
  Easing: { inOut: () => () => 0, ease: () => 0 },
  AccessibilityInfo: { isReduceMotionEnabled: () => Promise.resolve(true) },
  StyleSheet: { create: (styles: unknown) => styles, absoluteFill: {}, absoluteFillObject: {}, hairlineWidth: 0.5 },
}));
jest.mock('../../components/Stories/StoryCreateBar', () => ({
  __esModule: true, default: () => null,
}));
jest.mock('react-native-gesture-handler', () => ({ GestureDetector: 'GestureDetector' }));
jest.mock('expo-image', () => ({ Image: 'Image' }));
jest.mock('expo-linear-gradient', () => ({ LinearGradient: 'Gradient' }));
jest.mock('react-native-reanimated', () => ({
  __esModule: true, default: { View: 'AnimatedView' }, ReduceMotion: { System: 'system' },
  useSharedValue: (value: number) => ({ value }), useAnimatedStyle: (style: () => unknown) => style(),
  withTiming: (value: number) => value,
}));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string, options?: { defaultValue: string }) => options?.defaultValue || key }) }));
jest.mock('valtio', () => ({ useSnapshot: () => ({}) }));
jest.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({}), useQuery: () => ({ data: { askedHosts: 'host', liveHosts: ['host'], shelf: [{
  author: { address: 'creator', username: 'the_handle', displayName: 'River Song', avatarImageUrl: 'https://riftn.com/avatar.jpg' }, seen: mockSeen,
  items: [{ id: 'opening', status: 'ready', type: 'photo', mediaUrl: 'opening.jpg', createdAt: new Date().toISOString() }],
}] } }) }));
jest.mock('../../hooks/useStoriesEnabled', () => ({ useStoriesEnabled: () => ({ storiesEnabled: true }) }));
jest.mock('../../context/AuthContext', () => ({ useUser: () => ({ address: 'owner' }), useAuthActions: () => ({ requireAuth: (run: () => void) => run() }) }));
jest.mock('../../context/PagerGestureContext', () => ({ usePagerGestureRef: () => null }));
jest.mock('../../context/ThemeContext', () => ({ useAppTheme: () => ({ isLight: mockIsLight, colors: { card: '#1c1c1c', border: '#333' } }) }));
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

it('names each tile and respects badge visibility', () => {
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
  tap('Add a moment');
  expect(mockOpenCreator).toHaveBeenCalledTimes(1);
  const getButton = (label: string) => tree.root.findByProps({ accessibilityRole: 'button', accessibilityLabel: label });
  const createTile = getButton('Add a moment');
  const storyTile = getButton('River Song');
  const avatar = storyTile.findByProps({ uri: 'https://riftn.com/avatar.jpg' });
  expect(createTile.props.style[0]).toEqual(storyTile.props.style[0]);
  expect(avatar.props.name).toBe('River Song');
  expect(storyTile.findAllByProps({ source: { uri: 'opening.jpg' } })).toHaveLength(0);
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
    act(() => sheet.props.onDismiss());
  };
  try {
    act(() => pill('Trail watch, stages.live').props.onLongPress());
    select('open');
    expect(mockOpenLive).toHaveBeenCalledWith(mockLive);
    act(() => pill('River Song').props.onLongPress());
    expect(tree.root.findByType(HoldSheet).props.tiles.map((tile: { label: string }) => tile.label)).toEqual([
      'Hide activity bar', 'Hide story', 'Watch story', 'Mute creator', 'Block creator',
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

it('waits for native dismissal before opening a status and keeps status visibility separate', () => {
  const open = jest.fn();
  const close = jest.fn();
  const view = <ActivityShelfMenu visible bar="status" onClose={close}
    target={{ kind: 'status', ids: ['status:one'], creator: 'creator', open }} />;
  let tree!: ReactTestRenderer;
  act(() => { tree = create(view); });
  const sheet = tree.root.findByType(HoldSheet);
  const tiles = sheet.props.tiles as { key: string; label: string; onPress: () => void }[];
  try {
    expect(tiles.map(tile => tile.label)).toEqual(['Hide status bar', 'Hide status', 'View status', 'Mute creator', 'Block creator']);
    act(() => tiles.find(tile => tile.key === 'open')?.onPress());
    expect(close).toHaveBeenCalledTimes(1);
    expect(open).not.toHaveBeenCalled();
    act(() => sheet.props.onDismiss());
    expect(open).toHaveBeenCalledTimes(1);
    act(() => tiles.find(tile => tile.key === 'hide-bar')?.onPress());
    act(() => sheet.props.onDismiss());
    expect(getActivityShelfPreferences()).toMatchObject({ statusesHidden: true, hidden: false });
  } finally {
    act(() => tree.unmount());
    setActivityBarHidden(false, 'status');
  }
});

it('keeps the live outline transparent in light mode', () => {
  let tree!: ReactTestRenderer;
  mockIsLight = true;
  try {
    act(() => { tree = create(<StoryShelf />); });
    const pills = tree.root.findAll(node => String(node.type) === 'TouchableOpacity' && Array.isArray(node.props.style) && node.props.style.some(
      (style: { borderColor?: string } | undefined) => style?.borderColor === 'hsla(240,8%,4%,0.1)',
    ));
    expect(pills).toHaveLength(1);
    for (const pill of pills) {
      expect(pill.props.style).toContainEqual({ borderColor: 'hsla(240,8%,4%,0.1)', backgroundColor: 'transparent' });
    }
  } finally {
    act(() => tree?.unmount());
    mockIsLight = false;
  }
});

it('fades a watched portrait and exposes its watched state', () => {
  mockSeen = true;
  let tree!: ReactTestRenderer;
  try {
    act(() => { tree = create(<StoryShelf />); });
    const button = tree.root.findByProps({ accessibilityRole: 'button', accessibilityLabel: 'River Song' });
    expect(button.props.accessibilityHint).toBe('Watched');
    const media = button.findAll(node => String(node.type) === 'AnimatedView')[0];
    expect(media.props.style).toContainEqual({ opacity: 0.48 });
  } finally {
    act(() => tree?.unmount());
    mockSeen = false;
  }
});
