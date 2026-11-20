import type { ShelfEntry, StoryAuthor, StoryItem } from "../../services/stories.service";
import { getAvatarUrl } from "../../libs/misc";

/** "3m", "5h": how long ago, in the short form the shelf and viewer use. */
export function ageLabel(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "";
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 60) return "now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h`;
}

/** Moments that can be watched: ready and with a picture. */
export const playable = (items: StoryItem[]) => items.filter((i) => i.status === "ready" && (i.mediaUrl || i.posterUrl));

/** Where to start someone's moments: the first one not watched yet. */
export function startIndex(entry: ShelfEntry): number {
  const i = entry.items.findIndex((x) => !x.viewed);
  return i >= 0 ? i : 0;
}

export function coverOf(entry: ShelfEntry): string | null {
  const items = playable(entry.items);
  const last = items[items.length - 1];
  return last ? last.posterUrl || last.mediaUrl : null;
}

export const nameOf = (a: StoryAuthor) => a.displayName || a.username || `${a.address.slice(0, 6)}…`;

export function avatarOf(a: StoryAuthor, size = 48): string | null {
  if (!a.avatarImageUrl) return null;
  return a.avatarImageUrl.startsWith("http") ? a.avatarImageUrl : getAvatarUrl(a.avatarImageUrl, size) ?? null;
}
