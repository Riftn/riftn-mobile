/**
 * Parse [soundtrack:tokenId:title:creator:audioPath?] tag from a post description.
 * Used by feed cards to extract soundtrack info and clean the display text.
 */
export interface ParsedSoundtrack {
  tokenId: string;
  title: string;
  creator: string;
  /** CDN URL to the audio file */
  url: string;
}

import { translateCopy as _translateCopy } from "../i18n/copy";

const CDN_BASE = "https://dehubcdn.ams3.cdn.digitaloceanspaces.com/";

// Supports old format (4 fields) and new format (5 fields with audioPath)
const SOUNDTRACK_RE = /\[soundtrack:(\d+):([^:]*):([^:\]]*):?([^\]]*)\]/;

export function parseSoundtrack(description?: string | null): ParsedSoundtrack | null {
  if (!description) return null;
  const match = description.match(SOUNDTRACK_RE);
  if (!match) return null;

  const tokenId = match[1];
  const decodeField = (value: string) => {
    try { return decodeURIComponent(value); } catch { return value; }
  };
  const title = decodeField(match[2]) || _translateCopy("copy.46124e023603", { defaultValue: "Sound" });
  const creator = decodeField(match[3]) || "";
  const audioPath = match[4]?.trim();
  let url: URL;
  try {
    url = new URL(audioPath || `feed-audio/${tokenId}-audio.mp3`, CDN_BASE);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  } catch { return null; }

  return {
    tokenId,
    title,
    creator,
    url: url.href,
  };
}

export function stripSoundtrackTag(description?: string | null): string {
  if (!description) return "";
  return description.replace(/\[soundtrack:[^\]]*\]/, "").trim();
}

export function buildSoundtrackTag(sound: {
  tokenId: string;
  title: string;
  creator: string;
  url?: string;
}): string {
  const relPath = sound.url?.startsWith(CDN_BASE)
    ? sound.url.slice(CDN_BASE.length)
    : sound.url;
  return `[soundtrack:${sound.tokenId}:${encodeURIComponent(sound.title)}:${encodeURIComponent(sound.creator)}${relPath ? `:${relPath.replace(/\]/g, "%5D")}` : ""}]`;
}

/** A post's song as the composer attaches it, for "use this sound". */
export function attachedSoundFrom(song: ParsedSoundtrack): { url: string; title: string; creator: string; tokenId: string; source: "audius" | "commons" | "riftn" } {
  const src = /#.*\bsrc=(audius|commons)\b/.exec(song.url)?.[1] as "audius" | "commons" | undefined;
  return { url: song.url, title: song.title, creator: song.creator, tokenId: src ? "0" : song.tokenId, source: src ?? "riftn" };
}
