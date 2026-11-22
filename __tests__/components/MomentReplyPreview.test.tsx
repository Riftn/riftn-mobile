import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { TouchableOpacity } from 'react-native';
import MomentReplyPreview from '../../components/DM/MomentReplyPreview';
import { openStoryViewer } from '../../store/stories.store';
import { toastError } from '../../libs/toast';

const mockData = {
  author: { address: 'owner', displayName: 'Owner' },
  item: { id: 'moment', createdAt: '', expiresAt: '', viewed: false, status: 'ready', type: 'photo', mediaUrl: 'photo.jpg' },
};
const mockRefetch = jest.fn();
jest.mock('react-native-css-interop/jsx-runtime', () => jest.requireActual('react/jsx-runtime'));
jest.mock('react-native', () => ({ Text: 'Text', TouchableOpacity: 'TouchableOpacity', View: 'View' }));
jest.mock('expo-image', () => ({ Image: 'Image' }));
jest.mock('@tanstack/react-query', () => ({ useQuery: () => ({ isSuccess: true, data: mockData, refetch: mockRefetch }) }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('../../context/AuthContext', () => ({ useUser: () => ({ address: 'reader' }) }));
jest.mock('../../hooks/useKidsModeLock', () => ({ useKidsModeLock: () => false }));
jest.mock('../../services/stories.service', () => ({}));
jest.mock('../../config/storefront', () => ({}));
jest.mock('../../components/Stories/story-utils', () => ({ nameOf: (account: {displayName: string}) => account.displayName }));
jest.mock('../../components/ui/Icon', () => () => null);
jest.mock('../../store/stories.store', () => ({ openStoryViewer: jest.fn() }));
jest.mock('../../libs/toast', () => ({ toastError: jest.fn() }));

it('rechecks the selected Moment before opening and handles a revoked reply link', async () => {
  mockData.item.expiresAt = new Date(Date.now() + 60_000).toISOString();
  let tree!: ReactTestRenderer;
  act(() => { tree = create(<MomentReplyPreview id="moment" onLongPress={jest.fn()} />); });
  const open = tree.root.findByType(TouchableOpacity).props.onPress;
  mockRefetch.mockResolvedValueOnce({ isSuccess: false });
  await act(async () => { await open(); });
  expect(openStoryViewer).not.toHaveBeenCalled();
  expect(toastError).toHaveBeenCalledWith('stories.originalUnavailable');
  mockRefetch.mockResolvedValueOnce({ isSuccess: true, data: mockData });
  await act(async () => { await open(); });
  expect(openStoryViewer).toHaveBeenCalledWith([expect.objectContaining({ items: [mockData.item] })], 0, true);
  act(() => tree.unmount());
});
