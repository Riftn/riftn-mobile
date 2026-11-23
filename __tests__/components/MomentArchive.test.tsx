import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Pressable } from 'react-native';
import MomentArchive from '../../components/Profile/MomentArchive';
import { getStory } from '../../services/stories.service';
import { openStoryViewer, closeStoryViewer } from '../../store/stories.store';

const mockItem = { id: 'expired', address: 'owner', type: 'photo', caption: 'Yesterday', createdAt: '2026-08-01', status: 'ready', expired: true };
const mockArchive = { isSuccess: true, data: { pages: [{ items: [mockItem, { ...mockItem, address: 'other' }, { ...mockItem, isMature: true }] }] }, refetch: jest.fn() };
let mockWallet = 'owner';
jest.mock('react-native-css-interop/jsx-runtime', () => jest.requireActual('react/jsx-runtime'));
jest.mock('react-native', () => ({ Text: 'Text', View: 'View', Pressable: 'Pressable', ScrollView: 'ScrollView' }));
jest.mock('expo-image', () => ({ Image: 'Image' }));
jest.mock('@expo/vector-icons/Ionicons', () => () => null);
jest.mock('@tanstack/react-query', () => ({ useInfiniteQuery: () => mockArchive }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }) }));
jest.mock('../../context/AuthContext', () => ({ useUser: () => ({ address: mockWallet }) }));
jest.mock('../../hooks/useKidsModeLock', () => ({ useKidsModeLock: () => false }));
jest.mock('../../config/storefront', () => ({ MATURE_CONTENT_ENABLED: true }));
jest.mock('../../services/stories.service', () => ({ getStory: jest.fn() }));
jest.mock('../../libs/toast', () => ({ toastError: jest.fn() }));
jest.mock('../../store/stories.store', () => {
  const storiesState = { viewer: null as object | null };
  return { storiesState, openStoryViewer: jest.fn(() => { storiesState.viewer = {}; }), closeStoryViewer: jest.fn() };
});

it('opens an expired personal Moment after confirming ownership and closes it on account switch', async () => {
  let tree!: ReactTestRenderer;
  act(() => { tree = create(<MomentArchive />); });
  act(() => tree.root.findByType(Pressable).props.onPress());
  const buttons = tree.root.findAllByType(Pressable);
  expect(buttons).toHaveLength(2);
  const get = getStory as jest.Mock;
  get.mockResolvedValueOnce({ author: { address: 'other' }, item: mockItem });
  await act(async () => { await buttons[1].props.onPress(); });
  expect(openStoryViewer).not.toHaveBeenCalled();
  get.mockResolvedValueOnce({ author: { address: 'owner' }, item: mockItem });
  await act(async () => { await buttons[1].props.onPress(); });
  expect(openStoryViewer).toHaveBeenCalledWith([expect.objectContaining({ own: true, items: [mockItem] })], 0, true);
  mockWallet = 'second';
  act(() => tree.update(<MomentArchive />));
  expect(closeStoryViewer).toHaveBeenCalledTimes(1);
  expect(tree.root.findAllByType(Pressable)).toHaveLength(1);
  act(() => tree.unmount());
});
