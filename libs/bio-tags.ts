/** Same handle shape the bio links and the server reads (riftn-backend src/user/bio-tags). */
const TAG = /(^|[^\w@./])@([a-z0-9_]{2,30})(?![\w])/gi;

/** True when `bio` @tags `username` (any case). */
export function bioTagsUser(bio: string | null | undefined, username: string | null | undefined): boolean {
  const handle = String(username || "").replace(/^@/, "").toLowerCase();
  if (!bio || !handle) return false;
  for (const m of String(bio).matchAll(TAG)) if (m[2].toLowerCase() === handle) return true;
  return false;
}
