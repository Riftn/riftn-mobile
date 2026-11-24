/**
 * The live you minimised.
 *
 * A live keeps playing after you leave its screen: as a small window you can
 * drag to any corner, as a listen bar above the menu (sound only), or
 * unseen while the app is in the background. One live at a time; opening
 * another live, or any other sound, closes it.
 *
 * The full viewer hands over its audience seat (`release`), so minimising
 * never shows the creator a leave and a join.
 */

export type LiveMiniMode = 'video' | 'listen' | 'away';

export interface LiveMini {
  streamId: string;
  /** HLS ladder for this phone (AAC copy on iPhone). */
  url: string;
  title: string;
  host: string;
  avatar?: string;
  /** What opens the full viewer again. */
  params: Record<string, any>;
  mode: LiveMiniMode;
  /** Go straight to the phone's floating window once the picture is up. */
  float: boolean;
  /** The audience seat handed over by the viewer, if any. */
  release?: (() => void) | null;
  /** Counts the viewer as watching (signed in, not the creator). */
  countsAsViewer: boolean;
}

let current: LiveMini | null = null;
let version = 0;
const listeners = new Set<() => void>();
const notify = () => { version++; listeners.forEach(listener => listener()); };

export const getLiveMini = () => current;
export const getLiveMiniVersion = () => version;
export const subscribeLiveMini = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};

export function openLiveMini(next: Omit<LiveMini, 'float' | 'release'> & { float?: boolean; release?: (() => void) | null }): void {
  if (current && current.streamId !== next.streamId) closeLiveMini();
  if (current) {
    // Same live again (the viewer went away a second time): keep the seat.
    const keep = current.release;
    if (next.release && next.release !== keep) next.release();
    current = { ...current, ...next, float: !!next.float, release: keep };
  } else {
    current = { ...next, float: !!next.float, release: next.release ?? null };
  }
  notify();
}

export function setLiveMiniMode(mode: LiveMiniMode, float = false): void {
  if (!current || (current.mode === mode && current.float === float)) return;
  current = { ...current, mode, float };
  notify();
}

/** Hands the audience seat back to a viewer that is taking over again. */
export function takeLiveMiniSeat(streamId: string): (() => void) | null {
  if (!current || current.streamId !== streamId) return null;
  const seat = current.release ?? null;
  current = { ...current, release: null };
  return seat;
}

/** Swaps in a fresh seat (after a reconnect) and gives up the old one. */
export function setLiveMiniSeat(streamId: string, seat: (() => void) | null): void {
  if (!current || current.streamId !== streamId) { try { seat?.(); } catch {} return; }
  const old = current.release;
  current = { ...current, release: seat };
  if (old && old !== seat) { try { old(); } catch {} }
}

export function closeLiveMini(): void {
  if (!current) return;
  const closing = current;
  current = null;
  try { closing.release?.(); } catch {}
  notify();
}

/** Closes it unless it is this stream (a viewer for the same live hands over itself). */
export function closeOtherLiveMini(streamId: string | null | undefined): void {
  if (current && current.streamId !== streamId) closeLiveMini();
}
