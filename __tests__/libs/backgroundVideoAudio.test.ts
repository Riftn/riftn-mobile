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

  it("never keeps a muted autoplay preview alive", () => {
    const p = fakePlayer({ playing: true, muted: true });
    followSoundInBackground(p as any);
    expect(p.staysActiveInBackground).toBe(false);
  });
});
