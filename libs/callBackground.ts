import { storage } from "./storage";

/**
 * Call background
 * ===============
 * Blur the room behind you, or swap it for a scene or your own photo, during a
 * direct or group video call. Agora's own virtual background does the picture
 * work (it ships inside the call SDK this binary already has), so this file
 * only names the choices and remembers the last one: the next call starts the
 * way you left the last.
 *
 * Same ids and order as the website (riftn-web src/lib/calls/call-background.ts).
 */

export type CallBackgroundId = "none" | "blur" | "night" | "ocean" | "sunset" | "forest" | "photo";

export interface CallBackgroundChoice {
  id: CallBackgroundId;
  /** i18n key and its English fallback. */
  labelKey: string;
  label: string;
  /** Swatch colours for the picker; `color` is what Agora paints behind you. */
  swatch?: [string, string];
  color?: string;
}

export const CALL_BACKGROUNDS: readonly CallBackgroundChoice[] = [
  { id: "none", labelKey: "calls.backgroundOff", label: "Off" },
  { id: "blur", labelKey: "calls.backgroundBlur", label: "Blur" },
  { id: "night", labelKey: "calls.backgroundNight", label: "Night", swatch: ["#1b2140", "#2a1840"], color: "#141830" },
  { id: "ocean", labelKey: "calls.backgroundOcean", label: "Ocean", swatch: ["#5fc6d8", "#082a40"], color: "#0e5a78" },
  { id: "sunset", labelKey: "calls.backgroundSunset", label: "Sunset", swatch: ["#ffb36b", "#5b2a6e"], color: "#c8584f" },
  { id: "forest", labelKey: "calls.backgroundForest", label: "Forest", swatch: ["#9fd27a", "#122c22"], color: "#2f6b45" },
  { id: "photo", labelKey: "calls.backgroundPhoto", label: "Your photo" },
];

const CHOICE_KEY = "call-background";
const PHOTO_KEY = "call-background-photo";

export function isCallBackgroundId(value: unknown): value is CallBackgroundId {
  return CALL_BACKGROUNDS.some(choice => choice.id === value);
}

export function loadCallBackground(): CallBackgroundId {
  try {
    const saved = storage.getString(CHOICE_KEY);
    if (!isCallBackgroundId(saved)) return "none";
    if (saved === "photo" && !storage.getString(PHOTO_KEY)) return "none";
    return saved;
  } catch {
    return "none";
  }
}

export function saveCallBackground(id: CallBackgroundId): void {
  try { storage.set(CHOICE_KEY, id); } catch { /* this call only */ }
}

/** A local file:// uri of the picked photo, copied into the app's own folder. */
export function loadCallBackgroundPhoto(): string | null {
  try { return storage.getString(PHOTO_KEY) ?? null; } catch { return null; }
}

export function saveCallBackgroundPhoto(uri: string): void {
  try { storage.set(PHOTO_KEY, uri); } catch { /* this call only */ }
}

/** "#rrggbb" to the 0xRRGGBB number Agora takes. */
export function colorNumber(hex: string): number {
  const value = Number.parseInt(hex.replace("#", ""), 16);
  return Number.isFinite(value) ? value : 0x111318;
}

/** Agora wants a plain path on disk, not a file:// uri. */
export function pathFromUri(uri: string): string {
  return decodeURI(uri.replace(/^file:\/\//, ""));
}
