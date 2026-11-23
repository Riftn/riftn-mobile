import { buildSoundtrackTag, parseSoundtrack } from "../../libs/parseSoundtrack";
import { playableSoundUrl, soundCredit, soundMix, soundWindow, soundWindowCorrection, soundWindowProgress, suggestedSoundStart, withSoundMix, withSoundWindow } from "../../libs/soundWindow";

const AUDIUS = "https://api.audius.co/v1/tracks/ZlwB7/stream?app_name=Riftn";

describe("sound window", () => {
  it("round-trips the part and credit through a soundtrack tag", () => {
    const url = withSoundWindow(AUDIUS, { start: 42, end: 72 }, {
      source: "audius", license: "Audius Open Music License", page: "https://audius.co/arly/chill",
    });
    const parsed = parseSoundtrack(`hi\n${buildSoundtrackTag({ tokenId: "0", title: "Chill: remix", creator: "Arly", url })}`)!;
    expect(parsed.tokenId).toBe("0");
    expect(parsed.title).toBe("Chill: remix");
    expect(soundWindow(parsed.url)).toEqual({ start: 42, end: 72 });
    expect(soundCredit(parsed.url)).toMatchObject({ source: "audius", page: "https://audius.co/arly/chill" });
    expect(playableSoundUrl(parsed.url)).toBe(AUDIUS);
  });

  it("lets a listener who scrubbed play the whole song", () => {
    const url = withSoundWindow(AUDIUS, { start: 0, end: 30 }, null);
    expect(soundWindowCorrection(url, 600)).toBe(0);
    expect(soundWindowCorrection(url, 600, true)).toBeNull();
  });

  it("keeps a player inside the part", () => {
    const url = withSoundWindow(AUDIUS, { start: 30, end: 45 }, null);
    expect(soundWindowCorrection(url, 0)).toBe(30);
    expect(soundWindowCorrection(url, 35)).toBeNull();
    expect(soundWindowCorrection(url, 45.1)).toBe(30);
    expect(soundWindowCorrection(AUDIUS, 0)).toBeNull();
    expect(soundWindowProgress(url, 37.5, 200)).toBeCloseTo(0.5);
    expect(soundWindowProgress(AUDIUS, 50, 200)).toBeCloseTo(0.25);
  });
});

describe("sound mix links", () => {
  it("writes levels, drops them for the default, keeps the rest", () => {
    const url = withSoundMix("https://x/a.mp3#t=4&src=audius", { song: 0.8, video: 0.4 });
    expect(url).toBe("https://x/a.mp3#t=4&src=audius&sv=80&vv=40");
    expect(soundMix(url)).toEqual({ song: 0.8, video: 0.4 });
    expect(withSoundMix(url, { song: 1, video: 0 })).toBe("https://x/a.mp3#t=4&src=audius");
  });
  it("a new part keeps the levels", () => {
    expect(soundMix(withSoundWindow("https://x/a.mp3#sv=50&vv=50", { start: 10, end: 20 }))).toEqual({ song: 0.5, video: 0.5 });
  });
});

describe("suggestedSoundStart", () => {
  it("opens a long song about a third in, on its likely chorus", () => {
    expect(suggestedSoundStart(200, 30)).toBe(60);
  });
  it("never runs the part past the end", () => {
    expect(suggestedSoundStart(40, 30)).toBe(10);
  });
  it("starts short songs, unknown lengths and songs that fit whole at the top", () => {
    expect(suggestedSoundStart(20, 15)).toBe(0);
    expect(suggestedSoundStart(undefined, 30)).toBe(0);
    expect(suggestedSoundStart(30, 30)).toBe(0);
  });
});
