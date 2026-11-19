/**
 * Reactions to your messages that you haven't seen, in the Chat list. One
 * reaction shows the emoji itself where the unread number would be; several
 * show up to three emojis stacked with the total, like "❤️😂🔥 12".
 * Mirrors web ReactionAlertBadge.tsx.
 */
import React, { memo } from "react";
import { Text, View } from "react-native";
import type { ChatReactionSummary } from "../../services/dm/dm.api";

export default memo(function ReactionAlertBadge({ reactions }: { reactions?: ChatReactionSummary | null }) {
  if (!reactions || !(reactions.total > 0)) return null;
  const shown = reactions.emojis.slice(0, 3);
  return (
    <View
      testID="reaction-alert"
      accessibilityLabel={`${reactions.total} new reactions`}
      className="bg-white rounded-[6px] h-[20px] flex-row items-center px-1"
    >
      {shown.map((e, i) => (
        <Text key={e.emoji} style={{ fontSize: 12, lineHeight: 16, marginLeft: i > 0 ? -4 : 0, zIndex: shown.length - i }}>
          {e.emoji}
        </Text>
      ))}
      {reactions.total > 1 && (
        <Text className="text-[10px] text-black font-bold" style={{ marginLeft: 3, fontVariant: ["tabular-nums"] }}>
          {reactions.total > 99 ? "99+" : reactions.total}
        </Text>
      )}
    </View>
  );
});

/** The row's preview line while reactions are waiting. */
export function reactionAlertLine(
  t: (key: string, opts: Record<string, unknown>) => string,
  reactions: ChatReactionSummary,
  { named }: { named: boolean },
): string {
  if (reactions.total > 1 && reactions.emojis.length > 1) {
    return t("chatReactions.many", { defaultValue: "{{count}} reactions to your messages", count: reactions.total });
  }
  const emoji = reactions.last.emoji;
  if (reactions.total > 1) {
    return t("chatReactions.manySame", { defaultValue: "{{emoji}} × {{count}} on your messages", emoji, count: reactions.total });
  }
  if (named && reactions.last.name) {
    return t("chatReactions.oneNamed", { defaultValue: "{{name}} reacted {{emoji}} to your message", name: reactions.last.name, emoji });
  }
  return t("chatReactions.one", { defaultValue: "Reacted {{emoji}} to your message", emoji });
}
