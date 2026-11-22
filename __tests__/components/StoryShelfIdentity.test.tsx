import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import StoryShelf from '../../components/Stories/StoryShelf';

const mockOpenLive = jest.fn();
const mockOpenStory = jest.fn();
const mockOpenCreator = jest.fn();
const mockLive = { id: 'live-room', kind: 'stream', wallet: 'host', title: 'Trail watch', displayName: 'Maya Chen', cover: 'broadcast.jpg' };
let mockIsLight = false;
const mockAccount = { hideBadgeAndBalance: false };
jest.mock('dehub-jsx/jsx-runtime', () => jest.requireActual('react/jsx-runtime'));
jest.mock('react-native', () => ({
  ScrollView: 'ScrollView', Text: 'Text', TouchableOpacity: 'TouchableOpacity', View: 'View', Platform: { OS: 'android' },
  StyleSheet: { create: (styles: unknown) => styles, absoluteFill: {}, absoluteFillObject: {}, hairlineWidth: 0.5 },
}));
jest.mock('react-native-gesture-handler', () => ({ GestureDetector: 'GestureDetector' }));
jest.mock('expo-image', () => ({ Image: 'Image' }));
jest.mock('expo-linear-gradient', () => ({ LinearGradient: 'Gradient' }));
jest.mock('expo-blur', () => ({ BlurView: 'BlurView' }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string, options?: { defaultValue: string }) => options?.defaultValue || key }) }));
jest.mock('valtio', () => ({ useSnapshot: () => ({}) }));
jest.mock('@tanstack/react-query', () => ({ useQuery: () => ({ data: { liveHosts: ['host'], shelf: [{
  author: { address: 'creator', username: 'the_handle', displayName: 'River Song' },
  items: [{ status: 'ready', type: 'photo', mediaUrl: 'opening.jpg', createdAt: new Date().toISOString() }],
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

it('renders readable captions on sharp covers and respects badge visibility', () => {
  let tree!: ReactTestRenderer;
  act(() => { tree = create(<StoryShelf />); });
  const nodes = () => tree.root.findAll(node => typeof node.type === 'string');
  for (const label of ['Your day', 'Maya Chen', 'River Song']) {
    const text = nodes().find(node => String(node.type) === 'Text' && node.props.children === label);
    expect(text?.props.style).toMatchObject({ color: '#fff' });
  }
  expect(nodes().some(node => node.props.source === 42)).toBe(true);
  expect(nodes().some(node => node.props.source?.uri === 'opening.jpg')).toBe(true);
  expect(nodes().some(node => node.props.blurRadius)).toBe(false);
  act(() => tree.unmount());
  mockAccount.hideBadgeAndBalance = true;
  act(() => { tree = create(<StoryShelf />); });
  expect(nodes().some(node => node.props.source === 42)).toBe(false);
  expect(nodes().some(node => node.props.source?.uri === 'opening.jpg')).toBe(true);
  expect(nodes().some(node => node.props.blurRadius)).toBe(false);
  act(() => tree.unmount());
});

it('keeps Live, Stories and the create button independently tappable', () => {
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
  expect(mockOpenStory).toHaveBeenCalledTimes(1);
  act(() => tree.unmount());
});

it('uses a thin grey outline on all three tile types in light mode', () => {
  let tree!: ReactTestRenderer;
  mockIsLight = true;
  try {
    act(() => { tree = create(<StoryShelf />); });
    const outlines = tree.root.findAll(node => Array.isArray(node.props.style) && node.props.style.some(
      (style: { borderColor?: string } | undefined) => style?.borderColor === 'rgba(113,113,122,0.24)',
    ));
    expect(outlines).toHaveLength(3);
    for (const outline of outlines) {
      expect(outline.props.style).toContainEqual({ borderColor: 'rgba(113,113,122,0.24)' });
    }
  } finally {
    act(() => tree?.unmount());
    mockIsLight = false;
  }
});

it('shows the time on a glass chip the size of the face opposite it', () => {
  let tree!: ReactTestRenderer;
  act(() => { tree = create(<StoryShelf />); });
  const chips = tree.root.findAll(node => Array.isArray(node.props.style) && node.props.style.some(
    (style: { borderColor?: string } | undefined) => style?.borderColor === 'rgba(255,255,255,0.55)',
  ));
  expect(chips.length).toBeGreaterThan(0);
  const flat = Object.assign({}, ...chips[0].props.style.filter(Boolean));
  expect(flat).toMatchObject({ height: 24, minWidth: 24, borderRadius: 8, top: 7, right: 7 });
  act(() => tree.unmount());
});
