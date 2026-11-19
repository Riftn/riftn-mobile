/**
 * How a reaction moves when it lands in a chat (DMs, groups, live and public
 * chat, rooms). Same values and key as web (src/lib/chat-reaction-style.ts),
 * kept on this device (hooks/useAppPrefs).
 *
 *   fly   - the default: the emoji flies onto its chip (from above for your
 *           own, up from below for everyone else's)
 *   pop   - the chip springs in place
 *   burst - your own blooms big over the line with sparks
 *   off   - no motion, the count just changes
 */
export const CHAT_REACTION_STYLES = ['fly', 'pop', 'burst', 'off'] as const;
export type ChatReactionStyle = (typeof CHAT_REACTION_STYLES)[number];

export function isChatReactionStyle(value: unknown): value is ChatReactionStyle {
  return typeof value === 'string' && (CHAT_REACTION_STYLES as readonly string[]).includes(value);
}
