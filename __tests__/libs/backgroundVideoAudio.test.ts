jest.mock("../../libs/audioSession", () => ({
  configureForBackgroundPlayback: jest.fn(() => Promise.resolve()),
  releaseBackgroundPlayback: jest.fn(() => Promise.resolve()),
}));

import { followSoundInBackground, videoSoundPlaying } from "../../libs/backgroundVideoAudio";

function fakePlayer(init: { playing?: boolean; muted?: boolean; volume?: number }) {
  const listeners: Record<string, Array<() => void>> = {};
  return {
    playing: false,
    muted: false,
    volume: 1,
    staysActiveInBackground: false,
    showNowPlayingNotification: false,
    ...init,
    addListener(name: string, fn: () => void) {
      (listeners[name] ||= []).push(fn);
      return { remove() {} };
    },
    emit(name: string) {
      (listeners[name] || []).forEach((fn) => fn());
    },
  };
}

describe("video sound keeps playing when the app is minimised", () => {
  it("keeps an audible player alive in the background and lets a silent one pause", () => {
    const p = fakePlayer({ playing: true });
    followSoundInBackground(p as any);
    expect(p.staysActiveInBackground).toBe(true);
    expect(videoSoundPlaying()).toBe(true);

    p.muted = true;
    p.emit("mutedChange");
    expect(p.staysActiveInBackground).toBe(false);
    expect(videoSoundPlaying()).toBe(false);

    p.muted = false;
    p.playing = false;
    p.emit("playingChange");
    expect(p.staysActiveInBackground).toBe(false);

    p.playing = true;
    p.emit("playingChange");
    expect(p.staysActiveInBackground).toBe(true);
  });

  it("stays the now-playing video through a stall or a swipe, and lets go once it is quiet", () => {
    jest.useFakeTimers();
    try {
      const p = fakePlayer({ playing: true });
      followSoundInBackground(p as any);
      expect(p.showNowPlayingNotification).toBe(true);

      // A stall: the player stops for a moment and carries on.
      p.playing = false;
      p.emit("playingChange");
      expect(p.showNowPlayingNotification).toBe(true);
      jest.advanceTimersByTime(1000);
      p.playing = true;
      p.emit("playingChange");
      jest.advanceTimersByTime(10_000);
      expect(p.showNowPlayingNotification).toBe(true);

      // Paused for good: handed back after the hold, not before.
      p.playing = false;
      p.emit("playingChange");
      jest.advanceTimersByTime(3900);
      expect(p.showNowPlayingNotification).toBe(true);
      jest.advanceTimersByTime(200);
      expect(p.showNowPlayingNotification).toBe(false);
    } finally {
      jest.useRealTimers();
    }
  });

  it("never keeps a muted autoplay preview alive", () => {
    const p = fakePlayer({ playing: true, muted: true });
    followSoundInBackground(p as any);
    expect(p.staysActiveInBackground).toBe(false);
    expect(p.showNowPlayingNotification).toBe(false);
  });
});
