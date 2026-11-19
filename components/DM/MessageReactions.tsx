import React, { memo } from "react";
import { View, Text, Pressable, ScrollView } from "react-native";
import Icon from "../ui/Icon";
import { ReactionGlyph, RollingCount } from "../ChatReactions/ReactionArrival";
import { useTranslation } from "react-i18next";

/** Same quick row the web DM, public and community chats use. */
export const DM_QUICK_REACTIONS = ["👍", "❤️", "😂", "🔥", "🚀", "👀", "💯", "🙏", "🫡"] as const;

/** Height of the quick-reaction strip inside the long-press menu card. */
export const REACTION_STRIP_HEIGHT = 48;

export const hasReacted = (
  reactions: Record<string, string[]> | undefined,
  emoji: string,
  myAddress: string,
): boolean =>
  !!myAddress &&
  !!reactions?.[emoji]?.some((a) => a.toLowerCase() === myAddress.toLowerCase());

/** The emoji row at the top of a message's long-press menu. */
export const ReactionStrip: React.FC<{
  reactions?: Record<string, string[]>;
  myAddress: string;
  onPick: (emoji: string) => void;
  /** The arrow at the end: every emoji. */
  onMore?: () => void;
}> = memo(({ reactions, myAddress, onPick, onMore }) => {
  const { t } = useTranslation();
  return (
  <View style={{ flexDirection: "row", alignItems: "center", height: REACTION_STRIP_HEIGHT }}>
  <ScrollView
    horizontal
    showsHorizontalScrollIndicator={false}
    keyboardShouldPersistTaps="handled"
    style={{ flex: 1, height: REACTION_STRIP_HEIGHT }}
    contentContainerStyle={{ alignItems: "center", paddingHorizontal: 6 }}
  >
    {DM_QUICK_REACTIONS.map((emoji) => {
      const mine = hasReacted(reactions, emoji, myAddress);
      return (
        <Pressable
          key={emoji}
          onPress={() => onPick(emoji)}
          accessibilityRole="button"
          accessibilityLabel={emoji}
          accessibilityState={{ selected: mine }}
          hitSlop={4}
          className={`w-10 h-10 rounded-full items-center justify-center ${mine ? "bg-theme-neutrals-700" : ""}`}
        >
          <Text style={{ fontSize: 22 }}>{emoji}</Text>
        </Pressable>
      );
    })}
  </ScrollView>
    {onMore && (
      <Pressable
        onPress={onMore}
        accessibilityRole="button"
        accessibilityLabel={t("emojiPicker.moreReactions")}
        hitSlop={4}
        className="w-9 h-9 mr-1.5 rounded-full items-center justify-center bg-theme-neutrals-800"
      >
        <Icon name="ChevronDown" size={18} color="#F9FBFF" />
      </Pressable>
    )}
  </View>
  );
});

/** Reaction chips under a bubble. Tapping one toggles your own. */
export const ReactionChips: React.FC<{
  messageId: string;
  reactions?: Record<string, string[]>;
  myAddress: string;
  isMine: boolean;
  onToggle: (emoji: string) => void;
}> = memo(({ messageId, reactions, myAddress, isMine, onToggle }) => {
  const entries = Object.entries(reactions || {}).filter(([, who]) => who?.length > 0);
  if (!entries.length) return null;
  return (
    <View
      className={`flex-row flex-wrap gap-1 px-3 -mt-0.5 mb-1 ${isMine ? "justify-end" : "justify-start ml-1"}`}
    >
      {entries.map(([emoji, who]) => {
        const mine = hasReacted(reactions, emoji, myAddress);
        return (
          <Pressable
            key={emoji}
            onPress={() => onToggle(emoji)}
            accessibilityRole="button"
            accessibilityLabel={`${emoji} ${who.length}`}
            accessibilityState={{ selected: mine }}
            hitSlop={4}
            className={`flex-row items-center rounded-full px-2 py-0.5 gap-1 border ${
              mine
                ? "bg-theme-neutrals-700 border-theme-neutrals-500"
                : "bg-theme-neutrals-800 border-theme-neutrals-700"
            }`}
          >
            <ReactionGlyph messageId={messageId} emoji={emoji} addresses={who} me={myAddress} size={14} />
            {who.length > 1 && (
              <RollingCount value={who.length} className="text-[11px] text-theme-neutrals-300" />
            )}
          </Pressable>
        );
      })}
    </View>
  );
});
