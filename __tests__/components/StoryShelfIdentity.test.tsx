import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import StoryShelf from '../../components/Stories/StoryShelf';

const mockTheme = { isLight: true, theme: 'system' };
const mockAccount = { hideBadgeAndBalance: false };
jest.mock('react-native-css-interop/jsx-runtime', () => jest.requireActual('react/jsx-runtime'));
jest.mock('react-native', () => ({
  ScrollView: 'ScrollView', Text: 'Text', TouchableOpacity: 'TouchableOpacity', View: 'View',
  StyleSheet: { create: (styles: unknown) => styles },
}));
jest.mock('react-native-gesture-handler', () => ({ GestureDetector: 'GestureDetector' }));
jest.mock('expo-image', () => ({ Image: 'Image' }));
jest.mock('expo-linear-gradient', () => ({ LinearGradient: 'Gradient' }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string, options?: { defaultValue: string }) => options?.defaultValue || key }) }));
jest.mock('valtio', () => ({ useSnapshot: () => ({}) }));
jest.mock('@tanstack/react-query', () => ({ useQuery: () => ({ data: { shelf: [{
  author: { address: 'creator', username: 'the_handle', displayName: 'River Song' },
  items: [{ status: 'ready', type: 'photo', mediaUrl: 'opening.jpg' }],
}] } }) }));
jest.mock('../../hooks/useStoriesEnabled', () => ({ useStoriesEnabled: () => ({ storiesEnabled: true }) }));
jest.mock('../../context/AuthContext', () => ({ useUser: () => ({ address: 'owner' }), useAuthActions: () => ({}) }));
jest.mock('../../context/PagerGestureContext', () => ({ useHorizontalScrollGuard: () => null, useHorizontalSectionGuard: () => null }));
jest.mock('../../context/ThemeContext', () => ({ useAppTheme: () => mockTheme }));
jest.mock('../../hooks/useKidsModeLock', () => ({ useKidsModeLock: () => false }));
jest.mock('../../hooks/useAccountBadge', () => ({ useBadgeAccount: () => mockAccount }));
jest.mock('../../components/Home/LiveNowBar', () => ({ useLiveNowItems: () => ({ items: [] }) }));
jest.mock('../../libs/misc', () => ({ getBadgeUrlFor: () => 42 }));
jest.mock('../../components/ui/Icon', () => 'Icon');
jest.mock('../../components/common/Avatar', () => 'Avatar');
jest.mock('../../services/stories.service', () => ({}));
jest.mock('../../store/stories.store', () => ({}));
jest.mock('../../config/storefront', () => ({}));

it('renders light captions, shows a sharp opening frame and respects badge visibility', () => {
  let tree!: ReactTestRenderer;
  act(() => { tree = create(<StoryShelf />); });
  const nodes = () => tree.root.findAll(node => typeof node.type === 'string');
  for (const label of ['Your day', 'River Song']) {
    const text = nodes().find(node => String(node.type) === 'Text' && node.props.children === label);
    expect(text?.props.style).toContainEqual({ color: '#20242b' });
  }
  expect(nodes().some(node => node.props.source === 42)).toBe(true);
  expect(nodes().some(node => node.props.source?.uri === 'opening.jpg')).toBe(true);
  expect(nodes().some(node => node.props.blurRadius)).toBe(false);
  act(() => tree.unmount());
  mockAccount.hideBadgeAndBalance = true;
  mockTheme.isLight = false;
  act(() => { tree = create(<StoryShelf />); });
  expect(nodes().some(node => node.props.source === 42)).toBe(false);
  expect(nodes().some(node => node.props.source?.uri === 'opening.jpg')).toBe(true);
  expect(nodes().some(node => node.props.blurRadius)).toBe(false);
  act(() => tree.unmount());
});
