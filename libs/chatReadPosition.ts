/**
 * Telegram-style "where you left off" for chats (app twin of riftn-web's
 * chat-read-position).
 *
 * The server keeps one spot per chat: the newest line that has been on your
 * screen. Opening a chat lands on the first line after it, under an
 * "Unread messages" line, instead of at the newest message.
 */
import type { UnreadAnchor } from "./chatUnreadAnchor";

export interface ReadSpot {
  messageId: string;
  /** The line's own time (ISO). */
  at: string;
}

export interface ReadLine {
  id: string;
  mine: boolean;
  /** The line's own time (ISO or ms). */
  at: string | number | null | undefined;
  /** Deleted, unopenable or still-sending lines: never landed on, never counted. */
  skip?: boolean;
}

export type ReadAnchorResult =
  | { kind: "none" }
  /** The spot is older than every loaded line and there is more history: load it first. */
  | { kind: "older" }
  | { kind: "anchor"; anchor: UnreadAnchor };

const ms = (at: ReadLine["at"]): number => {
  if (typeof at === "number") return at;
  const t = at ? Date.parse(at) : NaN;
  return Number.isFinite(t) ? t : NaN;
};

/** Lines dated up to this long after opening still count (device vs server clock). */
const CLOCK_SLACK_MS = 5_000;

/**
 * @param oldestFirst lines oldest first
 * @param hasOlder there is history above the loaded lines
 * @param openedAt lines that arrive after the chat opened never join the count
 */
export function anchorFromReadSpot(
  oldestFirst: ReadLine[],
  spot: ReadSpot,
  hasOlder: boolean,
  openedAt = Infinity,
): ReadAnchorResult {
  const lines = oldestFirst;
  if (!lines.length) return { kind: "none" };
  let index = lines.findIndex((l) => l.id === spot.messageId);
  if (index === -1) {
    const spotMs = ms(spot.at);
    if (!Number.isFinite(spotMs)) return { kind: "none" };
    const oldest = ms(lines[0].at);
    if (Number.isFinite(oldest) && spotMs < oldest) {
      if (hasOlder) return { kind: "older" };
    } else {
      // The line itself is gone (deleted): everything up to its time was read.
      for (let i = 0; i < lines.length; i++) {
        const t = ms(lines[i].at);
        if (Number.isFinite(t) && t <= spotMs) index = i;
      }
    }
  }
  let after = lines.slice(index + 1);
  // Writing in the chat means you were at the bottom of it.
  let lastMine = -1;
  after.forEach((l, i) => { if (l.mine && !l.skip) lastMine = i; });
  if (lastMine >= 0) after = after.slice(lastMine + 1);
  const theirs = after.filter((l) => {
    if (l.mine || l.skip) return false;
    const t = ms(l.at);
    return !Number.isFinite(t) || t <= openedAt + CLOCK_SLACK_MS;
  });
  if (!theirs.length) return { kind: "none" };
  return { kind: "anchor", anchor: { id: theirs[0].id, ids: theirs.map((l) => l.id), count: theirs.length } };
}

/** True when `a` is a later spot than `b` (or `b` is missing). */
export function isLaterSpot(a: ReadSpot, b: ReadSpot | null | undefined): boolean {
  if (!b) return true;
  if (a.messageId === b.messageId) return false;
  const x = ms(a.at);
  const y = ms(b.at);
  if (!Number.isFinite(x)) return false;
  if (!Number.isFinite(y)) return true;
  return x >= y;
}
