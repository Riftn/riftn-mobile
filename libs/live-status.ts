interface StreamState {
  status?: string;
  isActive?: boolean;
  startedAt?: string;
  endedAt?: string;
  createdAt?: string;
  settings?: { status?: string };
  recording?: { status?: string };
}

export function hasStreamEnded(stream: unknown): boolean {
  const value = stream as StreamState | null | undefined;
  return ['ENDED', 'INACTIVE'].includes(value?.status?.toUpperCase() ?? '') ||
    value?.settings?.status?.toLowerCase() === 'ended';
}

export function isStreamLive(stream: unknown, fallback = false): boolean {
  const value = stream as StreamState | null | undefined;
  if (hasStreamEnded(value)) return false;
  const status = value?.status?.toUpperCase();
  if (['LIVE', 'ACTIVE', 'PAUSED'].includes(status ?? '')) return true;
  if (['SCHEDULED', 'OFFLINE'].includes(status ?? '') || value?.isActive === false) return false;
  return value?.isActive === true || fallback;
}

/** On-air broadcasts by newest start, followed by the latest replays. */
export function sortLiveThenReplays<T extends StreamState>(rows: T[]): T[] {
  const onAir = (row: T) => (isStreamLive(row) ? 0 : 1);
  const at = (row: T) =>
    Date.parse((onAir(row) === 0 ? row.startedAt : row.endedAt || row.startedAt) || row.createdAt || "") || 0;
  return [...rows].sort((a, b) => onAir(a) - onAir(b) || at(b) - at(a));
}

/**
 * A stream that is neither live nor ended is only "not live yet" as far as the
 * last answer knows: the post goes out before ingest connects, and a broadcaster
 * reconnecting flips status for a few seconds. Viewers keep asking quickly in
 * that window and only call it Offline once the answer has held this long.
 */
export const UNCONFIRMED_REFRESH_MS = 8_000;
export const OFFLINE_CONFIRM_MS = 20_000;

/** Refresh on-air state and briefly wait for a newly ended recording. */
export function streamRefreshInterval(stream: unknown, now = Date.now()): number | false {
  const value = stream as StreamState | null | undefined;
  if (isStreamLive(value)) return 30_000;
  if (value?.status && !hasStreamEnded(value)) {
    return value.status.toUpperCase() === 'SCHEDULED' ? 30_000 : UNCONFIRMED_REFRESH_MS;
  }
  if (!hasStreamEnded(value) || ['ready', 'failed', 'skipped'].includes(value?.recording?.status ?? '')) return false;
  const ended = Date.parse(value?.endedAt ?? '');
  return Number.isFinite(ended) && now - ended >= 0 && now - ended < 10 * 60_000 ? 10_000 : false;
}
