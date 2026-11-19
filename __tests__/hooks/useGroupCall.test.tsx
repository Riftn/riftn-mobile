import { act, cleanup, renderHook } from '@testing-library/react-native';

jest.mock('react-native-css-interop', () => ({ createInteropElement: require('react').createElement }));
const mockInsert = jest.fn(); const mockToken = jest.fn(); const mockUpdate = jest.fn();
const mockCreate = jest.fn();
const mockWalletSession = jest.fn(); const mockPush = jest.fn();
const mockCheck = jest.fn(); const mockTrack = jest.fn();
let mockWallet = '0xabcdef0123456789abcdef0123456789abcdef01';
jest.mock('../../context/AuthContext', () => ({ useAuth: () => ({ user: { walletAddress: mockWallet } }) }));
jest.mock('../../config/agora.config', () => ({ AGORA_APP_ID: 'app' }));
jest.mock('../../libs/call-ringtone', () => ({ startCallRingtone: jest.fn(), stopCallRingtone: jest.fn() }));
jest.mock('../../libs/logger', () => ({ createLogger: () => ({ warn: jest.fn(), error: jest.fn() }) }));
jest.mock('../../libs/api.client', () => ({ apiClient: { post: (...args: unknown[]) => mockPush(...args) } }));
jest.mock('../../libs/wallet-session', () => ({ ensureWalletSession: (...args: unknown[]) => mockWalletSession(...args) }));
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
      on: () => c,
      subscribe: (handler?: (status: string) => void) => { handler?.('SUBSCRIBED'); return c; },
      presenceState: () => ({}), track: (...args: unknown[]) => mockTrack(...args), untrack: jest.fn(),
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
import { groupCallUid } from '../../libs/groupCall';


const GROUP = '11111111-2222-3333-4444-555555555555';
const flush = async () => { for (let i = 0; i < 15; i++) await Promise.resolve(); };
let handler: Record<string, (...args: any[]) => void>;
let engine: Record<string, jest.Mock>;
beforeEach(() => {
  jest.useFakeTimers(); jest.clearAllMocks();
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

it('rings the other members and joins the group room under the wallet uid', async () => {
  const { result } = renderHook(useCall);
  await act(async () => { void result.current.startGroupCall({ id: GROUP, name: 'Friends' }, [mockWallet, '0xB', '0xc'], 'audio'); await flush(); });
  const rows = mockInsert.mock.calls[0][0] as Array<Record<string, string>>;
  expect(rows.map(row => row.recipient_address)).toEqual(['0xb', '0xc']);
  const uid = groupCallUid(mockWallet);
  expect(mockToken).toHaveBeenCalledWith(`group-call-${GROUP}`, 'publisher', uid, mockWallet);
  expect(engine.joinChannel.mock.calls[0][1]).toBe(`group-call-${GROUP}`);
  expect(engine.joinChannel.mock.calls[0][2]).toBe(uid);
  expect(mockTrack).toHaveBeenCalledWith({ uid, wallet: mockWallet, type: 'audio' });
  expect(mockPush).toHaveBeenCalledTimes(2);
});

it('stays up while others remain and ends when the last one leaves', async () => {
  const { result } = renderHook(useCall);
  await act(async () => { void result.current.startGroupCall({ id: GROUP, name: 'Friends' }, [mockWallet, '0xb', '0xc'], 'audio'); await flush(); });
  act(() => { handler.onUserJoined({}, 7); handler.onUserJoined({}, 9); });
  expect(result.current.isCallActive).toBe(true);
  expect(result.current.groupParticipants.map(p => p.uid)).toEqual([7, 9]);
  act(() => { handler.onUserOffline({}, 7); });
  expect(result.current.currentCall).not.toBeNull();
  await act(async () => { handler.onUserOffline({}, 9); await flush(); });
  expect(result.current.currentCall).toBeNull();
  expect(result.current.callSummary).toMatchObject({ outcome: 'ended', groupName: 'Friends' });
  expect(mockUpdate).not.toHaveBeenCalled();
});

it('stops every ringing phone when nobody answers', async () => {
  const { result } = renderHook(useCall);
  await act(async () => { void result.current.startGroupCall({ id: GROUP, name: 'Friends' }, [mockWallet, '0xb', '0xc'], 'video'); await flush(); });
  // A video call waits for its preview surface before joining.
  await act(async () => { jest.advanceTimersByTime(400); await flush(); });
  await act(async () => { jest.advanceTimersByTime(45_000); await flush(); });
  expect(result.current.currentCall).toBeNull();
  expect(mockUpdate).toHaveBeenCalledWith({ status: 'ended' }, ['ring-1', 'ring-2']);
});
