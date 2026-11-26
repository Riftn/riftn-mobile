import { act, renderHook } from '@testing-library/react-native';
import { AppState, Platform, type AppStateStatus } from 'react-native';
import { useWhepStream } from '../../hooks/useWhepStream';
import { subscribeToWhep } from '../../libs/whep';
import { rememberWhepSilent } from '../../libs/whep-memory';

let appStateListener: (state: AppStateStatus) => void;
jest.mock('../../libs/live-ingest', () => ({ whepEndpointFor: () => 'https://example.test/live/whep' }));
jest.mock('../../libs/whep', () => ({ subscribeToWhep: jest.fn() }));
jest.mock('../../libs/whep-memory', () => ({
  forgetWhepSilent: jest.fn(),
  isRealPicture: () => true,
  rememberWebRtcBlocked: jest.fn(),
  rememberWhepSilent: jest.fn(),
  webRtcRecentlyBlocked: () => false,
  whepRecentlySilent: () => false,
}));

const subscribe = jest.mocked(subscribeToWhep);
const broadcast = { playbackId: 'live', provider: 'mediamtx' } as const;
const session = (): Awaited<ReturnType<typeof subscribeToWhep>> => ({
  stream: { getAudioTracks: () => [] } as unknown as Awaited<ReturnType<typeof subscribeToWhep>>['stream'],
  stop: jest.fn().mockResolvedValue(undefined),
  framesDecoded: jest.fn().mockResolvedValue(1),
});

beforeEach(() => {
  subscribe.mockReset();
  jest.mocked(rememberWhepSilent).mockClear();
  jest.replaceProperty(Platform, 'OS', 'ios');
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, listener) => {
    appStateListener = listener as typeof appStateListener;
    return { remove: jest.fn() };
  });
});
afterEach(() => jest.restoreAllMocks());

it('cancels a pending attempt on blur and keeps its late answer out of the next visit', async () => {
  const old = session();
  const current = session();
  let finishOld!: (value: typeof old) => void;
  subscribe
    .mockImplementationOnce(() => new Promise((resolve) => { finishOld = resolve; }))
    .mockResolvedValueOnce(current);
  const viewer = renderHook<ReturnType<typeof useWhepStream>, { focused: boolean }>(
    ({ focused }) => useWhepStream({ enabled: true, focused, stream: broadcast }),
    { initialProps: { focused: true } },
  );
  await act(async () => {});
  expect(subscribe).toHaveBeenCalledTimes(1);
  viewer.rerender({ focused: false });
  expect(subscribe.mock.calls[0][0].signal?.aborted).toBe(true);
  expect(viewer.result.current.suspended).toBe(true);
  await act(async () => viewer.rerender({ focused: true }));
  expect(viewer.result.current.stream).toBe(current.stream);
  await act(async () => finishOld(old));
  expect(old.stop).toHaveBeenCalledTimes(1);
  expect(viewer.result.current.stream).toBe(current.stream);
  expect(rememberWhepSilent).not.toHaveBeenCalled();
});

it('starts fresh when iOS returns from the background and ignores brief inactivity', async () => {
  const first = session();
  const resumed = session();
  subscribe.mockResolvedValueOnce(first).mockResolvedValueOnce(resumed);
  const viewer = renderHook(() => useWhepStream({ enabled: true, stream: broadcast }));
  await act(async () => {});
  expect(viewer.result.current.stream).toBe(first.stream);
  act(() => appStateListener('inactive'));
  expect(viewer.result.current.stream).toBe(first.stream);
  act(() => appStateListener('background'));
  expect(viewer.result.current.stream).toBeNull();
  expect(subscribe.mock.calls[0][0].signal?.aborted).toBe(true);
  await act(async () => appStateListener('active'));
  expect(viewer.result.current.stream).toBe(resumed.stream);
  expect(subscribe).toHaveBeenCalledTimes(2);
});
