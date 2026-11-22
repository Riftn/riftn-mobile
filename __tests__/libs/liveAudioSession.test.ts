const mockSetMode = jest.fn((_mode: unknown) => Promise.resolve());
const mockListeners: ((s: string) => void)[] = [];
jest.mock('expo-audio', () => ({ setAudioModeAsync: (m: unknown) => mockSetMode(m) }));
jest.mock('react-native', () => ({
  Platform: { OS: 'ios' },
  AppState: {
    addEventListener: (_: string, fn: (s: string) => void) => {
      mockListeners.push(fn);
      return { remove: () => mockListeners.splice(mockListeners.indexOf(fn), 1) };
    },
  },
}));

import { holdLiveAudioSession, liveAudioHolders } from '../../libs/liveAudioSession';

beforeEach(() => { jest.useFakeTimers(); mockSetMode.mockClear(); });
afterEach(() => { jest.useRealTimers(); });

it('keeps the record category while held and puts playback back on release', () => {
  const release = holdLiveAudioSession();
  expect(liveAudioHolders()).toBe(1);
  expect(mockSetMode).toHaveBeenLastCalledWith(expect.objectContaining({ allowsRecording: true, allowsBackgroundRecording: true, interruptionMode: 'mixWithOthers' }));

  // A video pausing elsewhere flips the session; the heartbeat puts it back.
  mockSetMode.mockClear();
  jest.advanceTimersByTime(2000);
  expect(mockSetMode).toHaveBeenCalledTimes(1);

  // Leaving the app (a screen share does) re-asserts shortly after.
  mockSetMode.mockClear();
  mockListeners.forEach((fn) => fn('background'));
  jest.advanceTimersByTime(700);
  expect(mockSetMode.mock.calls.length).toBeGreaterThanOrEqual(2);

  // Nested holds: only the last release lets go.
  const second = holdLiveAudioSession();
  release();
  expect(liveAudioHolders()).toBe(1);
  mockSetMode.mockClear();
  second();
  second();
  expect(liveAudioHolders()).toBe(0);
  expect(mockSetMode).toHaveBeenCalledTimes(1);
  expect(mockSetMode).toHaveBeenLastCalledWith(expect.objectContaining({ allowsRecording: false, allowsBackgroundRecording: false }));
  expect(mockListeners).toHaveLength(0);

  mockSetMode.mockClear();
  jest.advanceTimersByTime(10000);
  expect(mockSetMode).not.toHaveBeenCalled();
});
