import type { ShelfEntry, StoryAuthor, StoryItem } from "../../services/stories.service";
import { getAvatarUrl } from "../../libs/misc";
import i18n from "i18next";

/** The reader's word for "now" (şimdi, ahora...), straight from the phone's locale data. */
function nowWord(): string {
  const lang = (i18n.language || "en").replace("_", "-");
  if (lang !== "en") {
    try {
      return new Intl.RelativeTimeFormat(lang, { numeric: "auto" }).format(0, "second");
    } catch {
      // Hermes builds can omit RelativeTimeFormat; use the app's own copy.
    }
  }
  return i18n.t("stories.now", { defaultValue: "now" });
}

/**
 * "3m", "5h": how long ago, in the short form the shelf, viewer and comments
 * use, in the reader's language ("3 dk", "5 sa", "şimdi" in Turkish).
 */
export function ageLabel(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "";
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 60) return nowWord();
  const m = Math.floor(s / 60);
  if (m < 60) return i18n.t("comments.timeMinutes", { count: m, defaultValue: "{{count}}m" });
  return i18n.t("comments.timeHours", { count: Math.floor(m / 60), defaultValue: "{{count}}h" });
}

/** Moments that can be watched: ready and with a picture. */
export const playable = (items: StoryItem[]) => items.filter((i) => i.status === "ready" && (i.mediaUrl || i.posterUrl));

/** Where to start someone's moments: the first one not watched yet. */
export function startIndex(entry: ShelfEntry): number {
  const i = entry.items.findIndex((x) => !x.viewed);
  return i >= 0 ? i : 0;
}

export function coverOf(entry: ShelfEntry): string | null {
  const item = entry.items[startIndex(entry)];
  return item?.posterUrl || (item?.type === 'photo' ? item.mediaUrl : null);
}

export const nameOf = (a: StoryAuthor) => a.displayName || a.username || `${a.address.slice(0, 6)}…`;

export function avatarOf(a: StoryAuthor, size = 48): string | null {
  if (!a.avatarImageUrl) return null;
  return a.avatarImageUrl.startsWith("http") ? a.avatarImageUrl : getAvatarUrl(a.avatarImageUrl, size) ?? null;
}
