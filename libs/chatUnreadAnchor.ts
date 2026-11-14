/**
 * Where "Unread messages" starts in a chat you just opened (app twin of
 * riftn-web's chat-unread-anchor).
 *
 * The app marks lines read the moment they land in the store, so the read
 * flags can't be trusted by the time the list paints. The count is taken at
 * open instead (the conversation's unread count, or the flags on the very
 * first render, whichever is higher), together with the time of opening.
 * The marker then sits on the Nth line from the other side counted back from
 * the newest one that already existed at open. Lines that arrive while the
 * chat is open never move it, and a stale cached thread corrects itself once
 * the fresh page lands.
 */
export interface UnreadAnchorLine {
  id: string;
  mine: boolean;
  createdAt?: string;
  skip?: boolean;
}

export interface UnreadAnchor {
  id: string;
  ids: string[];
  count: number;
}

/** Lines dated up to this long after opening still count (device vs server clock). */
const CLOCK_SLACK_MS = 5_000;

/** @param newestFirst lines in inverted-list order (index 0 = newest) */
export function findUnreadAnchor(newestFirst: UnreadAnchorLine[], count: number, openedAt: number): UnreadAnchor | null {
  const n = Math.floor(count || 0);
  if (n <= 0) return null;
  const ids: string[] = [];
  for (const line of newestFirst) {
    if (line.mine || line.skip) continue;
    const at = line.createdAt ? new Date(line.createdAt).getTime() : 0;
    if (at > openedAt + CLOCK_SLACK_MS) continue;
    ids.push(line.id);
    if (ids.length >= n) break;
  }
  if (!ids.length) return null;
  return { id: ids[ids.length - 1], ids, count: n };
}
