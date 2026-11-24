import React from 'react';
import { act, create } from 'react-test-renderer';

jest.mock('dehub-jsx/jsx-runtime', () => jest.requireActual('react/jsx-runtime'));
jest.mock('react-native', () => ({
  View: 'View', Image: 'Image',
  Pressable: ({ children, ...props }: any) => require('react').createElement('Pressable', props,
    typeof children === 'function' ? children({ pressed: false }) : children),
  Platform: { OS: 'android', select: (x: any) => x.android ?? x.default },
  StyleSheet: { create: (x: any) => x, absoluteFill: {} },
}));
jest.mock('react-native-gesture-handler', () => ({
  GestureDetector: ({ children }: any) => children,
  Gesture: { Pan: () => {
    const chain: any = {};
    for (const key of ['enabled', 'minDistance', 'activeOffsetX', 'failOffsetY', 'onStart', 'onUpdate', 'onEnd']) chain[key] = () => chain;
    return chain;
  } },
}));
jest.mock('react-native-reanimated', () => ({
  __esModule: true, default: { View: 'View' },
  useSharedValue: (value: any) => ({ value }), useAnimatedStyle: () => ({}),
  Easing: { bezier: jest.fn() }, withTiming: jest.fn(), cancelAnimation: jest.fn(), runOnJS: (fn: any) => fn,
}));
jest.mock('react-native-svg', () => ({ __esModule: true, default: 'Svg', Defs: 'Defs', RadialGradient: 'RadialGradient', Rect: 'Rect', Stop: 'Stop' }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (_key: string, options: any) => options?.defaultValue }) }));
jest.mock('../../i18n/copy', () => ({ translateCopy: (_key: string, options: any) => options.defaultValue }));
let mockMinimal = false;
jest.mock('../../context/ThemeContext', () => ({ useAppTheme: () => ({ isMinimal: mockMinimal, isLight: false }) }));
jest.mock('../../hooks/useAppPrefs', () => ({ useAppPrefs: () => ({ shorts: true }) }));
jest.mock('../../hooks/useSwipeBack', () => ({ useSwipeBackAction: jest.fn() }));
jest.mock('../../components/page/pillGlide', () => ({ usePillGlide: () => ({ ref: null, pillStyle: {} }) }));
jest.mock('../../theme/skins', () => ({ GRAIN: 1, glassTint: jest.fn() }));
jest.mock('../../components/ui/GlassIndicator', () => ({ __esModule: true, default: () => null, GLASS_SHADOW: {} }));
jest.mock('../../components/ui/FrostedPill', () => ({ __esModule: true, default: () => null, LIGHT_PILL_SHADOW: {} }));
jest.mock('../../components/ui/NavPillSurface', () => () => null);
jest.mock('../../components/theme/HudBrackets', () => () => null);
jest.mock('../../components/Home/FeedSearchBar', () => () => null);
const mockIconRender = jest.fn();
jest.mock('../../components/ui/Icon', () => ({
  __esModule: true,
  default: (props: any) => { mockIconRender(props); return require('react').createElement('Icon', props); },
}));

import FeedNavBar from '../../components/Home/FeedNavBar';

describe.each([false, true])('feed navigation stability (minimal=%s)', (minimal) => {
  it('updates only the old and new tab, preserves stroke and routes presses correctly', () => {
    mockMinimal = minimal;
    const props = {
      progress: { value: 0 } as any, isFilterOpen: false, hasActiveFilters: false,
      onPostTypeChange: jest.fn(), onFilterPress: jest.fn(), onActiveTabLongPress: jest.fn(),
    };
    let tree: ReturnType<typeof create>;
    act(() => { tree = create(<FeedNavBar {...props} activeIndex={0} />); });
    const original = tree!.root.findAllByType('Icon' as any).find(node => node.props.name === 'House');
    for (const activeIndex of [1, 2, 0]) {
      mockIconRender.mockClear();
      // Home supplies a new closure as its selected tab/search state changes.
      props.onPostTypeChange = jest.fn();
      act(() => tree!.update(<FeedNavBar {...props} activeIndex={activeIndex} />));
      const tabRenders = mockIconRender.mock.calls.map(([p]) => p).filter(p => p.name !== 'Settings2');
      expect(tabRenders).toHaveLength(2);
      expect(tabRenders.every(p => p.strokeWidth === 2)).toBe(true);
      expect(tree!.root.findAllByType('Icon' as any).find(node => node.props.name === 'House')).toBe(original);
    }
    const tabs = tree!.root.findAllByType('Pressable' as any).filter(node => node.props.accessibilityRole === 'tab');
    act(() => tabs[2].props.onPress());
    expect(props.onPostTypeChange).toHaveBeenCalledWith('feed-images');
    expect(tabs[0].props.accessibilityState.selected).toBe(true);
    act(() => tree!.unmount());
  });
});
