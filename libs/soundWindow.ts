/**
 * The part of a song a post plays, and who to credit for it.
 *
 * Both ride in the soundtrack link"s #fragment, so the existing
 * `[soundtrack:…]` tag carries them without a new field:
 *
 *   https://api.audius.co/v1/tracks/X/stream?app_name=Riftn#t=42&end=72&src=audius&lic=…&licUrl=…&page=…
 *
 * `t` is the standard media-fragment start, so even a player that knows
 * nothing about this starts in the right place. The end is a separate `end`
 * key, not `t=start,end`, because browsers PAUSE at a media-fragment end and
 * a soundtrack has to loop its part instead.
 */

export type SoundSourceId = "audius" | "commons" | "riftn";

export interface SoundWindow {
  start: number;
  end?: number;
}

export interface SoundCredit {
  source: SoundSourceId;
  /** The song"s own page. */
  page?: string;
  license?: string;
  licenseUrl?: string;
}

function fragment(url?: string | null): URLSearchParams | null {
  if (!url) return null;
  const hash = url.indexOf("#");
  if (hash < 0) return null;
  return new URLSearchParams(url.slice(hash + 1));
}

const seconds = (raw: string | null): number | undefined => {
  if (raw == null || raw === "") return undefined;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
};

/** The part of the song to play; null when the whole song plays. */
export function soundWindow(url?: string | null): SoundWindow | null {
  const params = fragment(url);
  if (!params) return null;
  const start = seconds(params.get("t")?.split(",")[0] ?? null) ?? 0;
  const end = seconds(params.get("end"));
  if (!start && end == null) return null;
  return end != null && end > start + 1 ? { start, end } : { start };
}

const httpsOnly = (raw: string | null) => (raw && /^https:\/\//i.test(raw) ? raw : undefined);

/** Who made the song and under what licence; null for a plain Riftn sound. */
export function soundCredit(url?: string | null): SoundCredit | null {
  const params = fragment(url);
  const src = params?.get("src");
  if (src !== "audius" && src !== "commons") return null;
  return {
    source: src,
    page: httpsOnly(params!.get("page")),
    license: params!.get("lic")?.slice(0, 80) || undefined,
    licenseUrl: httpsOnly(params!.get("licUrl")),
  };
}

/** `url` carrying the part to play and the credit, replacing any it had. */
export function withSoundWindow(
  url: string,
  window: SoundWindow | null,
  credit?: Partial<SoundCredit> | null,
): string {
  const base = url.split("#")[0];
  const params = new URLSearchParams();
  const round = (n: number) => String(Math.round(n * 10) / 10);
  if (window && (window.start > 0 || window.end != null)) {
    params.set("t", round(window.start));
    if (window.end != null) params.set("end", round(window.end));
  }
  if (credit?.source && credit.source !== "riftn") {
    params.set("src", credit.source);
    if (credit.license) params.set("lic", credit.license);
    if (credit.licenseUrl) params.set("licUrl", credit.licenseUrl);
    if (credit.page) params.set("page", credit.page);
  }
  // The poster's song / video sound levels outlive a new part or credit.
  const old = fragment(url);
  for (const key of ["sv", "vv"]) {
    const value = old?.get(key);
    if (value) params.set(key, value);
  }
  const hash = params.toString();
  return hash ? `${base}#${hash}` : base;
}

/** Where the song should be when the video it plays under is at `mediaTime`. */
export function soundTimeFor(url: string | null | undefined, mediaTime: number): number {
  const window = soundWindow(url);
  if (!window) return mediaTime;
  const length = window.end != null ? window.end - window.start : 0;
  return window.start + (length > 0 ? mediaTime % length : mediaTime);
}

/**
 * How loud the song and the video's own sound play under a video post, each
 * 0-1. Old posts carry neither key: the song replaces the video's sound.
 * Stored as whole percents (`sv=80&vv=40`) in the same #fragment.
 */
export interface SoundMix {
  song: number;
  video: number;
}

export const DEFAULT_SOUND_MIX: SoundMix = { song: 1, video: 0 };

const percent = (raw: string | null, fallback: number): number => {
  if (raw == null || raw === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) / 100 : fallback;
};

export function soundMix(url?: string | null): SoundMix {
  const params = fragment(url);
  if (!params) return { ...DEFAULT_SOUND_MIX };
  return { song: percent(params.get("sv"), DEFAULT_SOUND_MIX.song), video: percent(params.get("vv"), DEFAULT_SOUND_MIX.video) };
}

/** The quick picks under the two sliders. */
export const SOUND_MIX_PRESETS = {
  songOnly: { song: 1, video: 0 },
  mix: { song: 0.8, video: 0.4 },
  videoOnly: { song: 0, video: 1 },
} as const satisfies Record<string, SoundMix>;

/** `url` carrying `mix`; the default mix leaves the link as old posts had it. */
export function withSoundMix(url: string, mix: SoundMix): string {
  const hash = url.indexOf("#");
  const base = hash < 0 ? url : url.slice(0, hash);
  const params = new URLSearchParams(hash < 0 ? "" : url.slice(hash + 1));
  const whole = (n: number) => String(Math.round(Math.max(0, Math.min(1, n)) * 100));
  params.delete("sv");
  params.delete("vv");
  if (whole(mix.song) !== whole(DEFAULT_SOUND_MIX.song) || whole(mix.video) !== whole(DEFAULT_SOUND_MIX.video)) {
    params.set("sv", whole(mix.song));
    params.set("vv", whole(mix.video));
  }
  const next = params.toString();
  return next ? `${base}#${next}` : base;
}

/** A level slider is linear to the finger; loudness is not. */
export const mixGain = (level: number): number => Math.max(0, Math.min(1, level)) ** 2;

/**
 * Where the song should be when the video is at `mediaTime`, looping the
 * picked part, or the whole song once `duration` is known.
 */
export function songTimeFor(url: string | null | undefined, mediaTime: number, duration?: number): number {
  if (soundWindow(url)) return soundTimeFor(url, mediaTime);
  return duration && duration > 1 ? mediaTime % duration : mediaTime;
}

/** The link a player should load: the part and credit are ours, not the server"s. */
export function playableSoundUrl(url: string): string {
  return url.split("#")[0];
}

/**
 * Where a player at `currentTime` should jump to stay inside the part, or
 * null when it is fine: before the start (a fresh load or a loop back to 0)
 * or past the end. `wholeSong`: the listener scrubbed through the song
 * themselves, so it plays in full and is never pulled back.
 */
export function soundWindowCorrection(url: string | null | undefined, currentTime: number, wholeSong = false): number | null {
  if (wholeSong) return null;
  const window = soundWindow(url);
  if (!window) return null;
  if (currentTime < window.start - 0.75) return window.start;
  if (window.end != null && currentTime >= window.end) return window.start;
  return null;
}

/** 0-1 progress through the part (or the whole song). */
export function soundWindowProgress(url: string | null | undefined, currentTime: number, duration: number): number {
  const window = soundWindow(url);
  const start = window?.start ?? 0;
  const end = window?.end ?? duration;
  const length = end - start;
  return length > 0 ? Math.max(0, Math.min(1, (currentTime - start) / length)) : 0;
}

/** "2:05" */
export function clock(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export const SOUND_SOURCE_NAMES: Record<Exclude<SoundSourceId, "riftn">, string> = {
  audius: "Audius",
  commons: "Wikimedia Commons",
};
