import { act, renderHook } from '@testing-library/react-native';
import type { VideoPlayer } from 'expo-video';
import { usePlaybackRecovery } from '../../hooks/usePlaybackRecovery';
jest.mock('../../libs/errorReporter', () => ({ reportError: jest.fn() }));

describe('native playback recovery', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => { jest.clearAllTimers(); jest.useRealTimers(); });
  const setup = () => {
    const events = new Map<string, (event: any) => void>();
    const player = {
      currentTime: 0, duration: 60, status: 'readyToPlay', playing: false,
      play: jest.fn(), pause: jest.fn(), replaceAsync: jest.fn().mockResolvedValue(undefined),
      addListener: jest.fn((name: string, listener: (event: any) => void) => { events.set(name, listener); return { remove: () => events.delete(name) }; }),
    };
    return { player, events };
  };
  it('reloads source errors and clears failure after a manual retry produces progress', async () => {
    const { player, events } = setup();
    const { result } = renderHook(() => usePlaybackRecovery(player as unknown as VideoPlayer, 'clip', { component: 'Test', allowed: () => true }));
    await act(async () => result.current.recovery.start());
    await act(async () => events.get('statusChange')?.({ status: 'error' }));
    expect(player.replaceAsync).toHaveBeenCalledWith('clip');
    await act(async () => events.get('statusChange')?.({ status: 'error' }));
    expect(result.current.phase).toBe('failed');
    await act(async () => result.current.recovery.start());
    player.playing = true;
    act(() => events.get('timeUpdate')?.({ currentTime: 0.25 }));
    expect(result.current.phase).toBe('playing');
  });
  it('cannot restart from a late replacement after the user pauses', async () => {
    const { player } = setup();
    let finish!: () => void;
    player.replaceAsync.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
    const { result } = renderHook(() => usePlaybackRecovery(player as unknown as VideoPlayer, 'clip', { component: 'Test', allowed: () => true }));
    act(() => { result.current.recovery.start(); result.current.recovery.fail(); result.current.recovery.stop(); });
    await act(async () => finish());
    expect(player.play).toHaveBeenCalledTimes(1);
    expect(result.current.phase).toBe('idle');
  });
  it('lets an iPhone player wait through stalls once it has started', () => {
    const { Platform } = require('react-native');
    const os = Platform.OS;
    Platform.OS = 'ios';
    try {
      const { player, events } = setup();
      (player as any).bufferOptions = { preferredForwardBufferDuration: 10, waitsToMinimizeStalling: false };
      renderHook(() => usePlaybackRecovery(player as unknown as VideoPlayer, 'clip', { component: 'Test', allowed: () => true }));
      expect((player as any).bufferOptions.waitsToMinimizeStalling).toBe(false);
      act(() => events.get('playingChange')?.({ isPlaying: true }));
      expect((player as any).bufferOptions).toEqual({ preferredForwardBufferDuration: 10, waitsToMinimizeStalling: true });
    } finally {
      Platform.OS = os;
    }
  });
  describe('late stall hand-over on iPhone', () => {
    const { Platform } = require('react-native');
    let os: string;
    beforeEach(() => { os = Platform.OS; Platform.OS = 'ios'; });
    afterEach(() => { Platform.OS = os; });
    const start = () => {
      const { player, events } = setup();
      Object.assign(player, { bufferOptions: { preferredForwardBufferDuration: 10, waitsToMinimizeStalling: false }, bufferedPosition: 0.8 });
      const hook = renderHook(() => usePlaybackRecovery(player as unknown as VideoPlayer, 'clip', { component: 'Test', allowed: () => true, lateStallHandover: true }));
      return { player: player as typeof player & { bufferOptions: { waitsToMinimizeStalling: boolean }; bufferedPosition: number }, events, hook };
    };
    it('leaves a clip that has only just started alone, then hands over once a few seconds are banked', () => {
      const { player, events } = start();
      player.playing = true;
      act(() => events.get('playingChange')?.({ isPlaying: true }));
      act(() => { jest.advanceTimersByTime(1200); });
      expect(player.bufferOptions.waitsToMinimizeStalling).toBe(false);
      player.currentTime = 1.2;
      player.bufferedPosition = 4.5;
      act(() => { jest.advanceTimersByTime(400); });
      expect(player.bufferOptions.waitsToMinimizeStalling).toBe(true);
    });
    it('hands over at once when the whole clip is already banked', () => {
      const { player, events } = start();
      player.duration = 2;
      player.bufferedPosition = 2;
      act(() => events.get('playingChange')?.({ isPlaying: true }));
      expect(player.bufferOptions.waitsToMinimizeStalling).toBe(true);
    });
    it('carries on a clip that runs dry before the hand-over, and still respects a real pause', () => {
      const { player, events, hook } = start();
      act(() => { hook.result.current.recovery.start(); });
      player.play.mockClear();
      act(() => events.get('playingChange')?.({ isPlaying: true }));
      player.currentTime = 0.7;
      act(() => events.get('playingChange')?.({ isPlaying: false }));
      expect(player.bufferOptions.waitsToMinimizeStalling).toBe(true);
      expect(player.play).toHaveBeenCalledTimes(1);
      expect(hook.result.current.recovery.wanted).toBe(true);
      // A pause the screen asked for stops the recovery first; nothing restarts it.
      act(() => { hook.result.current.recovery.stop(); });
      act(() => events.get('playingChange')?.({ isPlaying: false }));
      expect(player.play).toHaveBeenCalledTimes(1);
    });
  });
  it('picks a live back up when AVPlayer drops it on an empty buffer, and lets a real pause stand', async () => {
    const { player, events } = setup();
    Object.assign(player, { duration: 0, currentTime: 40, bufferedPosition: 40.4 });
    const { result } = renderHook(() => usePlaybackRecovery(player as unknown as VideoPlayer, 'live', { component: 'Test', allowed: () => true, live: true }));
    await act(async () => result.current.recovery.start());
    player.playing = true;
    act(() => events.get('playingChange')?.({ isPlaying: true }));
    act(() => events.get('timeUpdate')?.({ currentTime: 40.25 }));
    expect(result.current.phase).toBe('playing');
    const plays = player.play.mock.calls.length;
    player.playing = false;
    act(() => events.get('playingChange')?.({ isPlaying: false }));
    expect(player.play).toHaveBeenCalledTimes(plays + 1);
    expect(result.current.phase).toBe('loading');
    expect(result.current.recovery.wanted).toBe(true);
    // Still stuck ten seconds on: reloaded, not left frozen.
    await act(async () => { jest.advanceTimersByTime(10_000); });
    expect(player.replaceAsync).toHaveBeenCalledWith('live');
    // A pause with seconds banked is someone pausing.
    player.playing = true;
    act(() => events.get('playingChange')?.({ isPlaying: true }));
    act(() => events.get('timeUpdate')?.({ currentTime: 41 }));
    Object.assign(player, { currentTime: 41, bufferedPosition: 44 });
    player.playing = false;
    act(() => events.get('playingChange')?.({ isPlaying: false }));
    expect(result.current.recovery.wanted).toBe(false);
  });
});
