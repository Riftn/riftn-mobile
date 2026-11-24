import { act, cleanup, renderHook } from '@testing-library/react-native';

jest.mock('react-native-css-interop', () => ({ createInteropElement: require('react').createElement }));
const mockInsert = jest.fn(); const mockToken = jest.fn(); const mockUpdate = jest.fn();
const mockCreate = jest.fn();
const mockWalletSession = jest.fn(); const mockPush = jest.fn();
const mockCheck = jest.fn(); const mockTrack = jest.fn();
const mockToastInfo = jest.fn(); const mockToastWarning = jest.fn();
let mockPresence: Record<string, unknown[]> = {};
let mockWallet = '0xabcdef0123456789abcdef0123456789abcdef01';
jest.mock('../../context/AuthContext', () => ({ useAuth: () => ({ user: { walletAddress: mockWallet } }) }));
jest.mock('../../config/agora.config', () => ({ AGORA_APP_ID: 'app' }));
jest.mock('../../libs/call-ringtone', () => ({ startCallRingtone: jest.fn(), stopCallRingtone: jest.fn() }));
jest.mock('../../libs/logger', () => ({ createLogger: () => ({ warn: jest.fn(), error: jest.fn() }) }));
jest.mock('../../libs/api.client', () => ({ apiClient: { post: (...args: unknown[]) => mockPush(...args) } }));
jest.mock('../../libs/wallet-session', () => ({ ensureWalletSession: (...args: unknown[]) => mockWalletSession(...args) }));
jest.mock('../../libs/toast', () => ({
  toastError: jest.fn(), toastInfo: (...args: unknown[]) => mockToastInfo(...args), toastWarning: (...args: unknown[]) => mockToastWarning(...args),
}));
jest.mock('../../libs/audioFocus', () => ({ revokeAudioFocus: jest.fn() }));
jest.mock('../../libs/feedVideoFocus', () => ({ revokeAllFeedVideo: jest.fn() }));
jest.mock('../../services/supabase', () => ({
  walletScopedClient: () => jest.requireMock('../../services/supabase').supabase,
  fetchAgoraToken: (...args: unknown[]) => mockToken(...args),
  supabase: {
    from: () => ({
      insert: (rows: unknown) => ({ select: () => mockInsert(rows) }),
      update: (data: unknown) => { const c: any = { eq: () => c, in: (_f: string, ids: string[]) => { mockUpdate(data, ids); return c; }, then: (r: any) => Promise.resolve({ error: null }).then(r) }; return c; },
      select: () => { const q = { eq: () => q, order: () => q, limit: () => q, single: () => mockCheck() }; return q; },
    }),
    channel: () => { const c: any = {
      on: (type: string, _filter: unknown, cb: () => void) => { if (type === 'presence') c.sync = cb; return c; },
      subscribe: (handler?: (status: string) => void) => { handler?.('SUBSCRIBED'); c.sync?.(); return c; },
      presenceState: () => mockPresence, track: (...args: unknown[]) => mockTrack(...args), untrack: jest.fn(),
    }; return c; },
    removeChannel: jest.fn(),
  },
}));
jest.mock('react-native-agora', () => ({
  __esModule: true, default: () => mockCreate(),
  VideoSourceType: { VideoSourceRemote: 0, VideoSourceCameraPrimary: 1 },
  RenderModeType: { RenderModeFit: 1, RenderModeHidden: 2 },
  ChannelProfileType: { ChannelProfileCommunication: 0 }, ClientRoleType: { ClientRoleBroadcaster: 1 },
}));
import { useCall } from '../../hooks/useCall';
import { visualActivity } from '../../libs/visualActivity';
import { AppState } from 'react-native';
import { groupCallUid, GROUP_CALL_MAX_PEOPLE, GROUP_CALL_MAX_CAMERAS } from '../../libs/groupCall';


const GROUP = '11111111-2222-3333-4444-555555555555';
const flush = async () => { for (let i = 0; i < 15; i++) await Promise.resolve(); };
let handler: Record<string, (...args: any[]) => void>;
let engine: Record<string, jest.Mock>;
beforeEach(() => {
  jest.useFakeTimers(); jest.clearAllMocks(); mockPresence = {};
  mockCheck.mockResolvedValue({ data: null });
  mockWalletSession.mockResolvedValue({ token: 'signed' }); mockPush.mockResolvedValue({ success: true });
  Object.defineProperty(AppState, 'currentState', { configurable: true, writable: true, value: 'active' });
  engine = Object.fromEntries(['initialize', 'registerEventHandler', 'unregisterEventHandler', 'setChannelProfile', 'setClientRole', 'enableAudio', 'enableLocalAudio', 'muteLocalAudioStream', 'setDefaultAudioRouteToSpeakerphone', 'setEnableSpeakerphone', 'enableVideo', 'enableLocalVideo', 'startPreview', 'stopPreview', 'muteLocalVideoStream', 'joinChannel', 'leaveChannel', 'release', 'switchCamera', 'enableAudioVolumeIndication'].map(name => [name, jest.fn(() => 0)]));
  engine.registerEventHandler.mockImplementation(h => { handler = h; });
  mockCreate.mockReturnValue(engine);
  mockInsert.mockResolvedValue({ data: [{ id: 'ring-1' }, { id: 'ring-2' }], error: null });
  mockToken.mockResolvedValue({ token: 'token', uid: 0 });
});
afterEach(() => { cleanup(); visualActivity.setCall(false, false); jest.clearAllTimers(); jest.useRealTimers(); });

const join = async (result: { current: ReturnType<typeof useCall> }, type: 'audio' | 'video') => {
  await act(async () => { void result.current.joinGroupCall({ id: GROUP, name: 'Friends' }, type); await flush(); });
  // A video call waits for its preview surface before joining.
  if (type === 'video') await act(async () => { jest.advanceTimersByTime(400); await flush(); });
};
const room = (count: number, cam: boolean) => Object.fromEntries(Array.from({ length: count }, (_, i) =>
  [`k${i}`, [{ uid: i + 10, wallet: `0x${String(i).padStart(40, '0')}`, type: cam ? 'video' : 'audio', cam }]]));

it('opens the group room under the wallet uid without ringing or notifying anyone', async () => {
  const { result } = renderHook(useCall);
  await join(result, 'audio');
  expect(mockInsert).not.toHaveBeenCalled();
  expect(mockPush).not.toHaveBeenCalled();
  const uid = groupCallUid(mockWallet);
  expect(mockToken).toHaveBeenCalledWith(`group-call-${GROUP}`, 'publisher', uid, mockWallet);
  expect(engine.joinChannel.mock.calls[0][1]).toBe(`group-call-${GROUP}`);
  expect(engine.joinChannel.mock.calls[0][2]).toBe(uid);
  expect(mockTrack).toHaveBeenLastCalledWith({ uid, wallet: mockWallet, type: 'audio', cam: false });
});

it('stays up while others remain and ends when the last one leaves', async () => {
  const { result } = renderHook(useCall);
  await join(result, 'audio');
  act(() => { handler.onUserJoined({}, 7); handler.onUserJoined({}, 9); });
  expect(result.current.isCallActive).toBe(true);
  expect(result.current.groupParticipants.map(p => p.uid)).toEqual([7, 9]);
  act(() => { handler.onUserOffline({}, 7); });
  expect(result.current.currentCall).not.toBeNull();
  await act(async () => { handler.onUserOffline({}, 9); await flush(); });
  expect(result.current.currentCall).toBeNull();
  expect(result.current.callSummary).toMatchObject({ outcome: 'ended', groupName: 'Friends' });
});

it('keeps the room open while you wait, with no ring timeout', async () => {
  const { result } = renderHook(useCall);
  await join(result, 'video');
  expect(mockTrack).toHaveBeenLastCalledWith({ uid: groupCallUid(mockWallet), wallet: mockWallet, type: 'video', cam: true });
  await act(async () => { jest.advanceTimersByTime(120_000); await flush(); });
  expect(result.current.currentCall).not.toBeNull();
});

it('refuses a full room before any call screen opens', async () => {
  mockPresence = room(GROUP_CALL_MAX_PEOPLE, false);
  const { result } = renderHook(useCall);
  await join(result, 'audio');
  expect(result.current.currentCall).toBeNull();
  expect(engine.joinChannel).not.toHaveBeenCalled();
  expect(mockToastWarning).toHaveBeenCalledTimes(1);
});

it('joins with the camera off when every camera slot is taken, and will not turn it on', async () => {
  mockPresence = room(GROUP_CALL_MAX_CAMERAS, true);
  const { result } = renderHook(useCall);
  await join(result, 'video');
  expect(result.current.isCameraOff).toBe(true);
  expect(result.current.groupCamerasFull).toBe(true);
  expect(mockTrack).toHaveBeenLastCalledWith({ uid: groupCallUid(mockWallet), wallet: mockWallet, type: 'video', cam: false });
  act(() => { result.current.toggleCamera(); });
  expect(result.current.isCameraOff).toBe(true);
  // Once on joining, once for the refused tap.
  expect(mockToastInfo).toHaveBeenCalledTimes(2);
});
