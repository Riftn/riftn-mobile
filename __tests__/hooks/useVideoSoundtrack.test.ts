import { act, cleanup, renderHook } from '@testing-library/react-native';
import type { VideoPlayer } from 'expo-video';
import { createAudioPlayer } from 'expo-audio';
import { useVideoSoundtrack } from '../../hooks/useVideoSoundtrack';
import { setVolume } from '../../libs/video-preferences';
import { mixGain, songTimeFor, soundMix } from '../../libs/soundWindow';

jest.mock('expo-audio', () => ({ createAudioPlayer: jest.fn() }));

const SONG = 'https://api.audius.co/v1/tracks/X/stream?app_name=Riftn#t=10&end=40&src=audius';

function emitter() {
  const listeners = new Map<string, Set<() => void>>();
  return {
    addListener(event: string, callback: () => void) {
      const set = listeners.get(event) ?? new Set();
      listeners.set(event, set);
      set.add(callback);
      return { remove: () => set.delete(callback) };
    },
    emit(event: string) { listeners.get(event)?.forEach((callback) => callback()); },
  };
}
function setup(url = SONG, muted = false) {
  const audio = {
    ...emitter(), isLoaded: true, currentTime: 0, duration: 200, playbackRate: 1, volume: 1, playing: false, loop: false,
    play: jest.fn(() => { audio.playing = true; }),
    pause: jest.fn(() => { audio.playing = false; }),
    seekTo: jest.fn(async (time: number) => { audio.currentTime = time; }),
    setPlaybackRate: jest.fn((rate: number) => { audio.playbackRate = rate; }), remove: jest.fn(),
  };
  (createAudioPlayer as jest.Mock).mockClear().mockReturnValue(audio);
  const player = { ...emitter(), playing: true, muted, currentTime: 0, playbackRate: 1, volume: 0.8, status: 'readyToPlay', audioMixingMode: 'auto' };
  const hook = renderHook(() => useVideoSoundtrack(player as unknown as VideoPlayer, url));
  return { audio, player, ...hook };
}
beforeEach(() => setVolume(0.8));
afterEach(cleanup);

it('plays the picked part with the video and hands the speaker back on unmount', async () => {
  const { audio, player, unmount } = setup();
  // The song owns the speaker; the video mixes under it, its own sound off.
  expect(player.audioMixingMode).toBe('mixWithOthers');
  expect(player.volume).toBe(0);
  await act(async () => {});
  expect(audio.seekTo).toHaveBeenCalledWith(10);
  expect(audio.playing).toBe(true);
  expect(audio.volume).toBeCloseTo(0.8);
  // 35s into the video is 5s into the second loop of the 30s part.
  await act(async () => { player.currentTime = 35; player.emit('timeUpdate'); });
  expect(audio.seekTo).toHaveBeenLastCalledWith(15);
  act(() => { player.playing = false; player.emit('playingChange'); });
  expect(audio.playing).toBe(false);
  unmount();
  expect(audio.remove).toHaveBeenCalled();
  expect(player.volume).toBe(0.8);
  expect(player.audioMixingMode).toBe('auto');
});

it('does not load the song while the video is muted', () => {
  const { player } = setup(SONG, true);
  expect(createAudioPlayer).not.toHaveBeenCalled();
  act(() => { player.muted = false; player.emit('mutedChange'); });
  expect(createAudioPlayer).toHaveBeenCalledWith({ uri: SONG.split('#')[0] }, { updateInterval: 250 });
});

it('keeps the video sound a post asks for', () => {
  const { player, audio } = setup(`${SONG}&sv=50&vv=60`);
  expect(player.volume).toBeCloseTo(0.8 * 0.36);
  expect(audio.volume).toBeCloseTo(0.8 * 0.25);
});

it('reads the mix and loops a whole song once its length is known', () => {
  expect(soundMix(SONG)).toEqual({ song: 1, video: 0 });
  expect(soundMix(`${SONG}&sv=80&vv=40`)).toEqual({ song: 0.8, video: 0.4 });
  expect(mixGain(0.5)).toBe(0.25);
  expect(songTimeFor('https://x.test/a.mp3', 130, 100)).toBe(30);
  expect(songTimeFor('https://x.test/a.mp3', 130)).toBe(130);
});
