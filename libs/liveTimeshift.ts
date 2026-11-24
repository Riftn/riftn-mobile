/**
 * Watching a live behind its edge: paused, rewound along the timeline, or
 * left behind by a slow connection. The server keeps the last few minutes of
 * every broadcast, so the player can carry on from where it stopped instead
 * of throwing the viewer forward. Same rules as the web player.
 */

/** How far back the timeline reaches, in seconds. */
export const TIMESHIFT_WINDOW_SEC = 180;

/** Further back than this and the viewer is "behind": the LIVE tag turns white. */
export const BEHIND_LIVE_SEC = 3;

export interface TimeshiftSnap {
  /** Seconds behind live, 0 at the live edge. */
  behind: number;
  /** 0 (oldest kept) to 1 (live). */
  ratio: number;
  paused: boolean;
}

/** What the live player can do and say, for the tag and the timeline. */
export interface LiveTimeshift {
  snapshot: () => TimeshiftSnap | null;
  /** 0 (oldest kept) to 1 (live). */
  seek: (ratio: number) => void;
  goLive: () => void;
  togglePlay: () => void;
}

/** What the expo-video player behind a live answers to. */
export interface LiveControl {
  /** Seconds behind the live edge the player says it is, null when it can't tell. */
  offset: () => number | null;
  paused: () => boolean;
  pause: () => void;
  play: () => void;
  /** Negative goes back. */
  seekBy: (seconds: number) => void;
}

export function snapFor(behind: number, paused: boolean): TimeshiftSnap {
  const b = Math.min(TIMESHIFT_WINDOW_SEC, Math.max(0, behind));
  return { behind: b, ratio: 1 - b / TIMESHIFT_WINDOW_SEC, paused };
}

export function behindForRatio(ratio: number): number {
  return Math.max(0, (1 - Math.min(1, Math.max(0, ratio))) * TIMESHIFT_WINDOW_SEC);
}

export const isBehindLive = (snap: Pick<TimeshiftSnap, 'behind'> | null | undefined) =>
  !!snap && snap.behind > BEHIND_LIVE_SEC;

/** "−0:42", "−2:05": how far back, as the tag shows it. */
export function formatBehind(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `−${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * Seconds behind live from the player's own reading. A player's normal
 * distance from the edge (a few seconds of HLS latency) is not "behind":
 * the smallest offset seen while watching live is taken as that baseline.
 */
export function behindFromOffset(offset: number, baseline: number | null): number {
  return Math.max(0, offset - Math.max(0, Math.min(baseline ?? offset, offset)));
}
