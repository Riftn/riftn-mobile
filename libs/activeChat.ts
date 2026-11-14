/**
 * Which DM is open on screen right now, so a push for that same chat stays
 * silent while the reader is already looking at it (no banner, no sound).
 */
let openConversationId: string | null = null;

export function setOpenConversation(id: string | null | undefined): void {
  openConversationId = id ? String(id) : null;
}

/** Clears only if `id` is still the open one (a newer chat may have taken over). */
export function clearOpenConversation(id: string | null | undefined): void {
  if (id && openConversationId === String(id)) openConversationId = null;
}

export function isConversationOpen(id: string | null | undefined): boolean {
  return !!id && openConversationId === String(id);
}
