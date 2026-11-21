import type { TFunction } from "i18next";

export function formatCommentTime(date: Date | string | undefined, t: TFunction): string {
  if (!date) return "";
  const timestamp = new Date(date).getTime();
  if (!Number.isFinite(timestamp)) return "";
  const diffMs = Math.max(0, Date.now() - timestamp);
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);
  const diffWeek = Math.floor(diffDay / 7);
  const diffMonth = Math.floor(diffDay / 30);
  const diffYear = Math.floor(diffDay / 365);

  if (diffYear > 0) return t("communities.time.years", { count: diffYear });
  if (diffMonth > 0) return t("communities.time.months", { count: diffMonth });
  if (diffWeek > 0) return t("communities.time.weeks", { count: diffWeek });
  if (diffDay > 0) return t("communities.time.days", { count: diffDay });
  if (diffHour > 0) return t("comments.timeHours", { count: diffHour });
  if (diffMin > 0) return t("comments.timeMinutes", { count: diffMin });
  return t("comments.timeSeconds", { count: Math.max(1, diffSec) });
}
