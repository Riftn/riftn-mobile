import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import type { UnifiedFeedItem } from '../../services/feed.unified.service';
import { useSaveProfileView } from '../../hooks/useSaveProfileView';
import VideosRoute from '../../components/Profile/VideosRoute';
import ProfileImageGrid from '../../components/Profile/ProfileImageGrid';
import { getProfileViewDefault, getProfileViewReaderPref, ProfileViewModeContext, startingProfileView, useProfileViewState } from '../../libs/profileViewMode';

const mockPatchUser = jest.fn(async () => {});
type LayoutPayload = { defaultProfileView?: string; profileViewOthers: string; layoutViewer: string };
const mockUpdateProfile = jest.fn<Promise<void>, [LayoutPayload]>(async () => {});
jest.mock('../../context/AuthContext', () => ({
  useUser: () => ({ walletAddress: 'owner', customs: { defaultProfileView: 'grid' } }),
  useAuthActions: () => ({ patchUser: mockPatchUser }),
}));
jest.mock('../../services/auth.service', () => ({ AuthService: {
  updateProfile: (payload: LayoutPayload) => mockUpdateProfile(payload),
} }));
jest.mock('../../libs', () => ({ toastError: jest.fn() }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
const mockStorage = new Map<string, string>();
jest.mock('../../libs/storage', () => ({ storage: {
  getString: (k: string) => mockStorage.get(k),
  set: (k: string, v: string) => mockStorage.set(k, v),
  delete: (k: string) => mockStorage.delete(k),
} }));
jest.mock('react-native-css-interop/jsx-runtime', () => jest.requireActual('react/jsx-runtime'));
jest.mock('../../services/feed.unified.service', () => ({}));
jest.mock('react-native', () => ({ View: 'View', TouchableOpacity: 'TouchableOpacity', StyleSheet: { create: (s: unknown) => s }, useWindowDimensions: () => ({width: 390}) }));
jest.mock('react-native-reanimated', () => ({ __esModule: true, default: {FlatList: 'FlatList'} }));
jest.mock('expo-image', () => ({ Image: 'Image' }));
jest.mock('../../components/Home/CompactVideoInfiniteList', () => 'VideoList');
jest.mock('../../libs/profileFeedOrigin', () => ({
  useProvidedProfileFeed: () => null,
  ProfileFeedOriginContext: jest.requireActual('react').createContext(null),
}));
jest.mock('../../components/Home/FeedCard', () => 'FeedCard');
jest.mock('../../components/ui/Icon', () => 'Icon');
jest.mock('../../context/ThemeContext', () => ({ useAppTheme: () => ({ theme: 'system', isMinimal: false, colors: { card: '#18181b' } }) }));
jest.mock('../../hooks/useCinematicPhone', () => ({ useCinematicPhone: () => false }));
jest.mock('../../navigation/tabBarLayout', () => ({ TAB_BAR_CONTENT_INSET: 80 }));
jest.mock('../../libs/misc', () => ({}));

it('restores the owner’s choice when Images reopens and scopes it to the reader', () => {
  const images: UnifiedFeedItem[] = Array.from({length: 6}, (_, i) => ({ id: String(i), postType: 'feed-images' }));
  function Profile({ reader, videos = false }: { reader: string; videos?: boolean }) {
    const state = useProfileViewState('owner', 'grid', reader);
    return <ProfileViewModeContext.Provider value={state}>
      <button onClick={() => state.setMode('list')} />
      {videos ? <VideosRoute address="owner" search="example" /> : <ProfileImageGrid images={images} />}
    </ProfileViewModeContext.Provider>;
  }
  let page!: ReactTestRenderer;
  const imageList = () => page.root.findAll(node => String(node.type) === 'FlatList')[0];
  const listData = () => imageList().props.data;
  act(() => { page = create(<Profile reader="owner" />); });
  expect(listData()).toHaveLength(2);
  expect(imageList().props.contentContainerStyle).toMatchObject({ paddingBottom: 80 });
  act(() => page.root.findByType('button').props.onClick());
  expect(listData()).toBe(images);
  expect(imageList().props.contentContainerStyle).toMatchObject({ paddingBottom: 80 });
  expect(mockStorage.size).toBe(1);
  act(() => page.update(<Profile reader="owner" videos />));
  const videoList = () => page.root.findAll(node => String(node.type) === 'VideoList')[0];
  expect(videoList().props.grid).toBe(false);
  expect(videoList().props.search).toBe('example');
  act(() => page.unmount());
  act(() => { page = create(<Profile reader="owner" />); });
  expect(listData()).toBe(images);
  act(() => page.update(<Profile reader="visitor" />));
  expect(listData()).toHaveLength(2);
  act(() => page.update(<Profile reader="visitor" videos />));
  expect(videoList().props.grid).toBe(true);
  act(() => page.root.findByType('button').props.onClick());
  expect(videoList().props.grid).toBe(false);
  act(() => page.unmount());
  act(() => { page = create(<Profile reader="visitor" />); });
  expect(listData()).toBe(images);
  act(() => page.unmount());
});

it('uses the saved reader layout across profiles and reads choices from older accounts', () => {
  const account = { defaultProfileView: 'list' as const, profileViewOthers: 'list' as const, customs: { defaultProfileView: 'grid' } };
  expect(getProfileViewDefault(account)).toBe('list');
  expect(startingProfileView('grid', getProfileViewReaderPref(account), false)).toBe('list');
  expect(getProfileViewReaderPref({ customs: { defaultProfileView: 'list' } })).toBe('list');
  expect(getProfileViewReaderPref({ customs: { defaultProfileView: 'list', profileViewOthers: 'owner' } })).toBe('owner');
});

it('keeps the last account selection when an earlier profile layout update is in flight', async () => {
  const local = jest.fn();
  function Owner() {
    const state = useSaveProfileView({ mode: 'grid', setMode: local }, true);
    return <button onClick={state.setMode as any} />;
  }
  let finish!: () => void;
  mockUpdateProfile.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
  let page!: ReactTestRenderer;
  act(() => { page = create(<Owner />); });
  const choose = (mode: 'grid' | 'list') => act(async () => {
    page.root.findByType('button').props.onClick(mode);
  });
  await choose('list');
  expect(mockUpdateProfile).toHaveBeenCalledTimes(1);
  await choose('grid');
  expect(mockUpdateProfile).toHaveBeenCalledTimes(1);
  await act(async () => { finish(); });
  expect(mockUpdateProfile.mock.calls.map(([payload]) => payload)).toEqual([
    { defaultProfileView: 'list', profileViewOthers: 'list', layoutViewer: 'owner' },
    { defaultProfileView: 'grid', profileViewOthers: 'grid', layoutViewer: 'owner' },
  ]);
  expect(mockPatchUser).toHaveBeenCalledTimes(2);
  expect(local).not.toHaveBeenCalled();
  act(() => page.unmount());
});
