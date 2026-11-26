import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Image } from 'expo-image';
import StoryViewer from '../../components/Stories/StoryViewer';
import StoryComments from '../../components/Stories/StoryComments';
import { sendStoryReply } from '../../components/Stories/story-reply';
import { deleteStory, type ShelfEntry, type StoryItem } from '../../services/stories.service';
import { hasAudioFocus, requestAudioFocus } from '../../libs/audioFocus';
import { requestFeedVideoFocus } from '../../libs/feedVideoFocus';

jest.mock('react-native-css-interop/jsx-runtime', () => jest.requireActual('react/jsx-runtime'));
jest.mock('react-native', () => ({
  View: 'View', Text: 'Text', TextInput: 'TextInput', Pressable: 'Pressable',
  TouchableOpacity: 'TouchableOpacity', ScrollView: 'ScrollView',
  KeyboardAvoidingView: 'KeyboardAvoidingView', ActivityIndicator: 'ActivityIndicator',
  Dimensions: { get: () => ({ width: 390, height: 844 }) },
  PanResponder: { create: () => ({ panHandlers: {} }) },
  Platform: { OS: 'ios', select: (options: any) => options.ios },
  StyleSheet: { create: (value: object) => value, flatten: (value: object) => Array.isArray(value) ? Object.assign({}, ...value) : value },
}));
jest.mock('expo-image', () => ({ Image: 'Image' }));
jest.mock('expo-linear-gradient', () => ({ LinearGradient: 'LinearGradient' }));
jest.mock('expo-clipboard', () => ({}));
const mockPlayer = { addListener: jest.fn(() => ({ remove: jest.fn() })), play: jest.fn(), pause: jest.fn() };
jest.mock('expo-video', () => ({ useVideoPlayer: () => mockPlayer, VideoView: 'VideoView' }));
jest.mock('expo-audio', () => ({ useAudioPlayer: () => ({}) }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 40, bottom: 30 }) }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key }) }));
jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({}) }));
jest.mock('../../context/WebSocketContext', () => ({ useWebSocketApi: () => ({}) }));
jest.mock('../../components/Stories/story-reply', () => ({ sendStoryReply: jest.fn() }));
jest.mock('../../context/AuthContext', () => ({ useUser: () => ({ address: 'owner' }), useAuthActions: () => ({ requireAuth: (fn: () => void) => fn() }) }));
jest.mock('../../context/ThemeContext', () => ({ DarkRoomProvider: ({ children }: React.PropsWithChildren) => children, useAppTheme: () => ({ theme: 'system', colors: { accent: '#fff' } }) }));
jest.mock('../../components/Stories/StoryRoom', () => ({ StoryRoomChat: () => null, FloatHearts: () => null, ReplyTo: () => null, TEXT_SHADOW: {}, useMomentComments: () => ({ data: undefined }) }));
jest.mock('../../components/common/ViewerChrome', () => ({ ChromeFill: () => null, CHROME_HAIRLINE: 'rgba(255,255,255,0.15)' }));
jest.mock('../../components/ui/Icon', () => 'Icon');
jest.mock('../../components/common/Avatar', () => 'Avatar');
jest.mock('../../components/DM/ShareToDmSheet', () => () => null);
jest.mock('../../components/Stories/MomentIcons', () => ({ MomentHeart: 'MomentHeart', MomentComment: 'MomentComment', MomentShare: 'MomentShare' }));
jest.mock('../../components/Stories/StoryComments', () => jest.fn(() => null));
jest.mock('../../components/Stories/MomentCaption', () => () => null);
jest.mock('../../libs/toast', () => ({ toastError: jest.fn(), toastSuccess: jest.fn() }));
jest.mock('../../libs/misc', () => ({ getAvatarUrl: () => null }));
jest.mock('../../services/stories.service', () => ({ deleteStory: jest.fn(async () => ({ ok: true })) }));
jest.mock('../../store/stories.store', () => ({}));

function mount(durations: number[], author = 'owner') {
  const items: StoryItem[] = durations.map((durationMs, index) => ({
    id: `moment-${index}`, type: 'photo', durationMs, mediaUrl: `https://example.com/${index}.jpg`,
    mentions: [], audience: 'everyone', createdAt: new Date().toISOString(), viewed: false,
    address: author, status: 'ready', posterUrl: null, overlayUrl: null, width: 1080, height: 1920,
    muted: false, caption: null, song: null, allowReplies: true, liked: false,
    expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
  }));
  const entries: ShelfEntry[] = [{
    author: { address: author, username: author, displayName: null, avatarImageUrl: null },
    own: author === 'owner', following: false, seen: false, latestAt: items[0].createdAt, items,
  }];
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  const onClose = jest.fn();
  const viewer = render(<QueryClientProvider client={client}><StoryViewer entries={entries} index={0} onOpenProfile={jest.fn()} onClose={onClose} /></QueryClientProvider>);
  const load = () => fireEvent(viewer.UNSAFE_getByType(Image), 'load');
  return { viewer, onClose, load, dispose: () => { viewer.unmount(); client.clear(); } };
}

beforeEach(() => { jest.useFakeTimers(); jest.clearAllMocks(); });
afterEach(() => jest.useRealTimers());

it('pauses both muted feed video and audible background media even for a photo Moment', () => {
  const stopFeed = jest.fn();
  const stopAudio = jest.fn();
  requestFeedVideoFocus(stopFeed);
  requestAudioFocus(stopAudio);

  const { dispose } = mount([30_000]);
  expect(stopFeed).toHaveBeenCalledTimes(1);
  expect(stopAudio).toHaveBeenCalledTimes(1);
  expect(hasAudioFocus()).toBe(true);
  dispose();
  expect(hasAudioFocus()).toBe(false);
});

it('waits for the photo to load and honours its selected duration while the menu pauses it', () => {
  const { viewer, onClose, load, dispose } = mount([37_000]);
  act(() => jest.advanceTimersByTime(40_000));
  expect(onClose).not.toHaveBeenCalled();
  load();
  act(() => jest.advanceTimersByTime(20_000));
  fireEvent.press(viewer.getByLabelText('Moment options'));
  act(() => jest.advanceTimersByTime(40_000));
  expect(onClose).not.toHaveBeenCalled();
  fireEvent.press(viewer.getByText('Cancel'));
  act(() => jest.advanceTimersByTime(16_950));
  expect(onClose).not.toHaveBeenCalled();
  act(() => jest.advanceTimersByTime(50));
  expect(onClose).toHaveBeenCalledTimes(1);
  dispose();
});

it('gives the next photo its full duration after the current photo is deleted', async () => {
  const { viewer, onClose, load, dispose } = mount([30_000, 10_000]);
  load();
  act(() => jest.advanceTimersByTime(8_000));
  fireEvent.press(viewer.getByLabelText('Moment options'));
  fireEvent.press(viewer.getByText('Delete moment'));
  await act(async () => { fireEvent.press(viewer.getByText('Delete')); });
  expect(deleteStory).toHaveBeenCalledWith('moment-0');
  expect(viewer.UNSAFE_getByType(Image).props.source.uri).toBe('https://example.com/1.jpg');
  load();
  act(() => jest.advanceTimersByTime(9_950));
  expect(onClose).not.toHaveBeenCalled();
  act(() => jest.advanceTimersByTime(50));
  expect(onClose).toHaveBeenCalledTimes(1);
  dispose();
});


it('sends the composer draft privately and opens public comments separately', async () => {
  const { viewer, dispose } = mount([30_000], 'author');
  let finish: (outcome: 'sent') => void = () => {};
  jest.mocked(sendStoryReply).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  const field = viewer.getByPlaceholderText('Send a private reply…');
  fireEvent.changeText(field, 'Private');
  fireEvent(field, 'submitEditing');
  fireEvent(field, 'submitEditing');
  expect(sendStoryReply).toHaveBeenCalledTimes(1);
  expect(sendStoryReply).toHaveBeenCalledWith('moment-0', 'Private', expect.any(String), 'owner', expect.any(Object));
  expect(StoryComments).not.toHaveBeenCalled();

  await act(async () => { finish('sent'); });
  expect(viewer.getByPlaceholderText('Send a private reply…').props.value).toBe('');
  fireEvent.press(viewer.getByLabelText('Comments'));
  expect(StoryComments).toHaveBeenCalled();
  expect(sendStoryReply).toHaveBeenCalledTimes(1);
  dispose();
});
