/**
 * Profile song: one song on a profile, under the bio.
 *
 * It lives in the account's `customs` bag under one key, as a small JSON
 * string (the bag only holds strings, numbers and booleans, each value at most
 * 500 characters). Web reads the same key (src/lib/profile-song.ts), so keep
 * the two in step.
 *
 *   customs.profileSong = '{"u":"https://…/stream","t":"Title","a":"Artist","i":"https://…/art.jpg","s":48,"e":78,"p":1}'
 *
 * u = stream link (no #fragment), t = title, a = artist, i = artwork,
 * s / e = the part to play in seconds, p = 1 when it plays by itself for
 * people who open the profile.
 */
import { playableSoundUrl, soundWindow } from "./soundWindow";
import { storage } from "./storage";

export const PROFILE_SONG_KEY = "profileSong";

const MAX_PART = 60;
const DEFAULT_PART = 30;
const MAX_VALUE = 490;

export interface ProfileSong {
  url: string;
  title: string;
  artist: string;
  artwork?: string;
  start: number;
  end: number;
  /** Plays by itself (softly fading in) when someone opens the profile. */
  autoplay: boolean;
}

type CustomsValue = string | number | boolean;

const https = (v: unknown): string | undefined =>
  typeof v === "string" && /^https:\/\/[^\s]+$/i.test(v) ? v : undefined;
const text = (v: unknown, max: number): string => (typeof v === "string" ? v.trim().slice(0, max) : "");
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : undefined);

/** The song saved on a profile, or null when there is none (or it is broken). */
export function readProfileSong(customs: Record<string, unknown> | null | undefined): ProfileSong | null {
  const raw = customs?.[PROFILE_SONG_KEY];
  if (typeof raw !== "string" || !raw.startsWith("{")) return null;
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
  const url = https(data.u);
  const title = text(data.t, 120);
  if (!url || !title) return null;
  const start = num(data.s) ?? 0;
  let end = num(data.e) ?? start + DEFAULT_PART;
  if (end <= start + 1 || end - start > MAX_PART) end = start + DEFAULT_PART;
  return {
    url,
    title,
    artist: text(data.a, 120),
    artwork: https(data.i),
    start,
    end,
    autoplay: data.p === 1 || data.p === true,
  };
}

/** The string saved in `customs`. Drops the artwork, then shortens names, to fit. */
export function encodeProfileSong(song: ProfileSong): string {
  const round = (n: number) => Math.round(n * 10) / 10;
  const base = { u: song.url, t: song.title.slice(0, 120), a: song.artist.slice(0, 120), s: round(song.start), e: round(song.end), p: song.autoplay ? 1 : 0 };
  let out = JSON.stringify(song.artwork ? { ...base, i: song.artwork } : base);
  if (out.length <= MAX_VALUE) return out;
  out = JSON.stringify(base);
  if (out.length <= MAX_VALUE) return out;
  return JSON.stringify({ ...base, t: base.t.slice(0, 40), a: base.a.slice(0, 30) });
}

/** A profile song from what the song picker returned. */
export function profileSongFromSound(
  sound: { url: string; title: string; creator: string; creatorAvatar?: string },
  autoplay: boolean,
): ProfileSong | null {
  const url = playableSoundUrl(sound.url);
  if (!/^https:\/\//i.test(url)) return null;
  const part = soundWindow(sound.url);
  const start = part?.start ?? 0;
  const end = part?.end != null && part.end > start + 1 ? Math.min(part.end, start + MAX_PART) : start + DEFAULT_PART;
  const song: ProfileSong = {
    url,
    title: sound.title || "Song",
    artist: sound.creator || "",
    artwork: https(sound.creatorAvatar),
    start,
    end,
    autoplay,
  };
  return encodeProfileSong(song).length <= 500 ? song : null;
}

/**
 * `customs` with the song set (or removed). The song key goes first: the server
 * keeps only the first 32 keys, so a full bag cannot silently drop it.
 */
export function withProfileSong(customs: Record<string, unknown> | null | undefined, song: ProfileSong | null): Record<string, CustomsValue> {
  const out: Record<string, CustomsValue> = {};
  if (song) out[PROFILE_SONG_KEY] = encodeProfileSong(song);
  for (const [key, value] of Object.entries(customs ?? {})) {
    if (key === PROFILE_SONG_KEY) continue;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") out[key] = value;
  }
  return out;
}

/** "0:48 - 1:18" */
export function profileSongPartLabel(song: Pick<ProfileSong, "start" | "end">): string {
  const t = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
  return `${t(song.start)} - ${t(song.end)}`;
}

// Stopping a song that started by itself means "don't do that": no profile
// song starts by itself for this person again, until they play one themselves.
const AUTOPLAY_OFF_KEY = "profileSong.autoplayOff";

export function profileSongAutoplayAllowed(): boolean {
  try { return storage.getString(AUTOPLAY_OFF_KEY) !== "1"; } catch { return true; }
}

export function setProfileSongAutoplayAllowed(allowed: boolean): void {
  try {
    if (allowed) storage.delete(AUTOPLAY_OFF_KEY);
    else storage.set(AUTOPLAY_OFF_KEY, "1");
  } catch { /* storage unavailable */ }
}
