/**
 * Last seen — "Last seen 5 min ago" under a name in chat
 * ======================================================
 * Off by default, like "Show when I'm online". Only someone who turned on
 * Privacy > "Show when I was last seen" (`customs.showLastSeen`, same key as
 * web's src/lib/last-seen.ts) has their time handed out; the API checks the
 * switch and blocks before it answers, and rounds to the minute.
 *
 * While the switch is on, the open app tells the API "I'm here" every few
 * minutes and once more as it goes to the background (hooks/useOnlinePresence).
 *
 * @module libs/last-seen
 */
import { useQuery } from "@tanstack/react-query";

import { apiClient } from "./api.client";

export const SHOW_LAST_SEEN_CUSTOMS_KEY = "showLastSeen";

/** How often an open, opted-in app says "I'm here". */
export const SEEN_PING_MS = 4 * 60 * 1000;

export function getShowLastSeen(customs: Record<string, unknown> | null | undefined): boolean {
  const v = customs?.[SHOW_LAST_SEEN_CUSTOMS_KEY];
  return v === "on" || v === true;
}

export async function pingSeen(): Promise<void> {
  await apiClient.post("/users/seen", {}).catch(() => undefined);
}

export async function fetchLastSeen(address: string): Promise<string | null> {
  const res = await apiClient.get<{ result?: { lastSeenAt?: string | null } }>(
    `/users/last_seen/${encodeURIComponent(address.toLowerCase())}`,
  );
  return res?.result?.lastSeenAt ?? null;
}

/** When an opted-in person was last on Riftn; null when they keep it private. */
export function useLastSeen(address: string | null | undefined, enabled: boolean): string | null {
  const { data } = useQuery({
    queryKey: ["last-seen", address?.toLowerCase()],
    queryFn: () => fetchLastSeen(address as string),
    enabled: enabled && !!address,
    staleTime: 60_000,
    refetchInterval: enabled ? 120_000 : false,
  });
  return data ?? null;
}

/**
 * "5 min ago" / "3 hr ago" up to a day, then a short date. Null under a
 * minute, so callers say "just now" in their own words.
 */
export function lastSeenWhen(at: string | number | Date, language: string | undefined, now = Date.now()): string | null {
  const ms = new Date(at).getTime();
  if (!Number.isFinite(ms)) return null;
  const diff = Math.max(0, now - ms);
  if (diff < 60_000) return null;
  try {
    if (diff < 24 * 3600_000) {
      const rtf = new Intl.RelativeTimeFormat(language || undefined, { numeric: "always", style: "short" });
      return diff < 3600_000
        ? rtf.format(-Math.floor(diff / 60_000), "minute")
        : rtf.format(-Math.floor(diff / 3600_000), "hour");
    }
    const sameYear = new Date(ms).getFullYear() === new Date(now).getFullYear();
    return new Intl.DateTimeFormat(language || undefined, sameYear ? { day: "numeric", month: "short" } : { day: "numeric", month: "short", year: "numeric" }).format(ms);
  } catch {
    return new Date(ms).toLocaleDateString();
  }
}
