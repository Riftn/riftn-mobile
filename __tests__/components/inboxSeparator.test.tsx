import React from 'react';
import { act, create } from 'react-test-renderer';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ChatCard, useChatListSpacing } from '../../components/DM/ChatCard';
import { setAppPref } from '../../hooks/useAppPrefs';
import { Text } from 'react-native';

jest.mock('react-native-css-interop/jsx-runtime', () => jest.requireActual('react/jsx-runtime'));
jest.mock('dehub-jsx/jsx-runtime', () => jest.requireActual('react/jsx-runtime'));
jest.mock('react-native', () => ({
  Text: 'Text', View: 'View', Platform: { OS: 'ios', select: (v: { ios?: unknown }) => v.ios },
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
}));
jest.mock('../../context/ThemeContext', () => ({ useAppTheme: () => ({ isLight: true }) }));
jest.mock('../../libs/defaultChain', () => ({
  getDefaultChainId: () => 1, loadDefaultChains: jest.fn(), subscribeDefaultChain: jest.fn(),
}));
jest.mock('../../libs/minimalBootGuard', () => ({ claimMinimalLaunch: () => true }));
jest.mock('../../libs/bootReveal', () => ({ bootRevealed: true }));

function InboxRow() {
  const { gap } = useChatListSpacing();
  return <ChatCard unread checked><Text>{gap}</Text></ChatCard>;
}

it('keeps the clean list (no gap, unread dot) whatever the feed layout is', async () => {
  await AsyncStorage.setItem('riftn.chat.cards', 'false');
  let view!: ReturnType<typeof create>;
  await act(async () => { view = create(<InboxRow />); });
  expect(view.root.findByType(Text).props.children).toBe(0);
  expect(view.root.findAllByProps({ testID: 'chat-card-unread' }).length).toBeGreaterThan(0);
  await act(async () => { setAppPref('feedSeparator', 'bento'); });
  expect(view.root.findByType(Text).props.children).toBe(0);
  expect(await AsyncStorage.getItem('dehub.feedSeparator')).toBe('bento');
  await act(async () => { setAppPref('feedSeparator', 'line'); });
  expect(view.root.findByType(Text).props.children).toBe(0);
  expect(await AsyncStorage.getItem('dehub.feedSeparator')).toBe('line');
  act(() => view.unmount());
});
