/**
 * The launch logo's flight into the header, started while Home is still
 * building instead of after it.
 *
 * The flight needs to know where the header's logo sits, which used to be
 * measured once Home was on screen: so the app loaded behind a still logo and
 * only then played a one-second animation. The landing spot does not move
 * between launches, so it is remembered (launchLayoutMemo) and the flight
 * starts as the app begins to build Home, timed from the last launch so the
 * cover clears as Home is ready. If Home is late the cover stays black until
 * it is there; if the header logo is not where it was, the old path runs.
 *
 * Behind a switch for now: dehub://launch-early/on (and /off) on one phone.
 */
import { recallLayout, recalledSize, recalledText, rememberLayout } from "./launchLayoutMemo";
import { perfNote } from "./perfTrace";

const FLAG = "launch-early-dock";
const MEMO_KEY = "dock";
/** The flight keeps the cover black for its first 28%. */
export const DOCK_FLIGHT_MS = 950;
const BLACK_PHASE_MS = Math.round(DOCK_FLIGHT_MS * 0.28);

export type EarlyDock = { x: number; y: number; tint: string; delayMs: number };

type FlagFile = { exists: boolean; create(options?: { overwrite?: boolean }): void; delete(): void };
function flagFile(): FlagFile | null {
  try {
    const { File, Paths } = require("expo-file-system");
    return new File(Paths.cache, FLAG) as FlagFile;
  } catch {
    return null;
  }
}

let enabled: boolean | null = null;
export function earlyDockEnabled(): boolean {
  if (enabled === null) {
    try {
      enabled = !!flagFile()?.exists;
    } catch {
      enabled = false;
    }
  }
  return enabled;
}

/** dehub://launch-early/on or /off. Returns true when the link was this switch. */
export function handleEarlyDockLink(url: string | null | undefined): boolean {
  const match = /^dehub:\/\/launch-early\/(on|off)\b/i.exec(url ?? "");
  if (!match) return false;
  const on = match[1].toLowerCase() === "on";
  try {
    const file = flagFile();
    if (on) file?.create({ overwrite: true });
    else if (file?.exists) file.delete();
    enabled = on;
    // eslint-disable-next-line no-console
    console.warn(`[launch] early logo flight ${on ? "on" : "off"} from the next launch`);
  } catch {
    /* stays as it was */
  }
  return true;
}

/** Where the logo landed, in the cover's own coordinates, for the next launch. */
export function rememberDockLanding(landing: { x: number; y: number; tint: string }, width: number, height: number): void {
  rememberLayout(MEMO_KEY, { x: landing.x, y: landing.y, tint: landing.tint, width, height });
}

/** How long Home took to be ready after the app began building it. */
export function rememberHomeReadyAfter(ms: number): void {
  if (ms > 0 && ms < 5000) rememberLayout(MEMO_KEY, { readyAfter: Math.round(ms) });
}

/** The flight to start now, or null when there is nothing remembered that fits this screen. */
export function planEarlyDock(width: number, height: number): EarlyDock | null {
  if (!earlyDockEnabled()) return null;
  const memo = recallLayout(MEMO_KEY);
  const tint = recalledText(memo, "tint");
  const x = recalledSize(memo, "x", -1);
  const y = recalledSize(memo, "y", -1);
  const readyAfter = recalledSize(memo, "readyAfter", 0);
  if (!tint || x < 0 || y < 0 || readyAfter <= 0) return null;
  if (Math.round(recalledSize(memo, "width", 0)) !== Math.round(width) || Math.round(recalledSize(memo, "height", 0)) !== Math.round(height)) return null;
  // The cover starts to clear BLACK_PHASE_MS into the flight; aim that at the
  // moment Home was ready last time, a little late rather than early.
  const delayMs = Math.max(0, Math.min(1500, readyAfter - BLACK_PHASE_MS + 40));
  perfNote(`early dock planned: landing ${Math.round(x)},${Math.round(y)} delay ${delayMs}ms (ready after ${readyAfter}ms last time)`);
  return { x, y, tint, delayMs };
}
