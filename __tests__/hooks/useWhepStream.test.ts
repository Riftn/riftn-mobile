import { act, renderHook } from '@testing-library/react-native';
import { useWhepStream } from '../../hooks/useWhepStream';
import { subscribeToWhep, type SubscribeOptions, type WhepSubscription } from '../../libs/whep';
import { isRealPicture } from '../../libs/whep-memory';

jest.mock('../../libs/live-ingest', () => ({
  whepEndpointFor: ({ playbackId }: { playbackId: string }) => `https://live.example/${playbackId}/whep`,
}));
jest.mock('../../libs/whep', () => ({ subscribeToWhep: jest.fn() }));
jest.mock('../../libs/whep-memory', () => ({
  forgetWhepSilent: jest.fn(),
  isRealPicture: jest.fn(),
  rememberWebRtcBlocked: jest.fn(),
  rememberWhepSilent: jest.fn(),
  webRtcRecentlyBlocked: () => false,
  whepRecentlySilent: () => false,
}));

function fakeSession(): WhepSubscription {
  return {
    stream: { getAudioTracks: () => [] } as unknown as WhepSubscription['stream'],
    stop: jest.fn(async () => {}),
    framesDecoded: jest.fn(async () => 0),
  };
}

const subscribe = jest.mocked(subscribeToWhep);

afterEach(() => {
  subscribe.mockReset();
  jest.useRealTimers();
});

it('closes a connection that resolves after failure without attaching its picture', async () => {
  let finish!: (session: WhepSubscription) => void;
  let changeState: SubscribeOptions['onStateChange'];
  subscribe.mockImplementation(({ onStateChange }) => {
    changeState = onStateChange;
    return new Promise(resolve => { finish = resolve; });
  });
  const hook = renderHook(() => useWhepStream({ enabled: true, stream: { playbackId: 'late' } }));
  await act(async () => {});
  expect(hook.result.current.pending).toBe(true);
  const session = fakeSession();
  await act(async () => {
    changeState?.('failed');
    finish(session);
  });
  expect(hook.result.current).toMatchObject({ failed: true, stream: null, pending: false });
  expect(session.stop).toHaveBeenCalledTimes(1);
  hook.unmount();
});

it('keeps the fallback for the failed broadcast and still tries WebRTC for the next one', async () => {
  jest.useFakeTimers();
  const first = fakeSession();
  const next = fakeSession();
  subscribe.mockResolvedValueOnce(first).mockResolvedValueOnce(next);
  const hook = renderHook(
    ({ playbackId }: { playbackId: string }) => useWhepStream({ enabled: true, stream: { playbackId } }),
    { initialProps: { playbackId: 'first' } },
  );
  await act(async () => {});
  expect(hook.result.current.stream).toBe(first.stream);
  act(() => jest.advanceTimersByTime(3500));
  expect(hook.result.current).toMatchObject({ failed: true, stream: null });
  expect(first.stop).toHaveBeenCalledTimes(1);
  act(() => hook.rerender({ playbackId: 'next' }));
  await act(async () => {});
  expect(hook.result.current.stream).toBe(next.stream);
  hook.unmount();
});

it('keeps the fallback warm until this attempt renders a picture', async () => {
  const first = fakeSession();
  const next = fakeSession();
  subscribe.mockResolvedValueOnce(first).mockResolvedValueOnce(next);
  jest.mocked(isRealPicture).mockImplementation(({ width, height }) => width > 0 && height > 0);
  const hook = renderHook(
    ({ playbackId }: { playbackId: string }) => useWhepStream({ enabled: true, stream: { playbackId } }),
    { initialProps: { playbackId: 'first-picture' } },
  );
  await act(async () => {});
  expect(hook.result.current).toMatchObject({ stream: first.stream, hasPicture: false });
  const onFirstPicture = hook.result.current.onPicture;
  act(() => onFirstPicture({ width: 0, height: 0 }));
  expect(hook.result.current.hasPicture).toBe(false);
  act(() => onFirstPicture({ width: 640, height: 360 }));
  expect(hook.result.current.hasPicture).toBe(true);

  act(() => hook.rerender({ playbackId: 'second-picture' }));
  await act(async () => {});
  act(() => onFirstPicture({ width: 640, height: 360 }));
  expect(hook.result.current).toMatchObject({ stream: next.stream, hasPicture: false });
  hook.unmount();
});
