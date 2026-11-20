/**
 * Reactions to your messages that you haven't seen, in the Chat list. No
 * pill: the emojis sit bare where the unread number would be, up to three
 * stacked (newest first), with the total when there are several ("❤️😂🔥 12").
 *
 * They move like reactions inside a chat (Settings > Appearance > "Reactions
 * in chat"): the Noto animated emoji keeps playing while the reaction is
 * unread, and a new one landing while the list is open arrives with the
 * picked motion (fly in by default, pop, burst). Off, or reduced motion,
 * shows still emojis. Mirrors web ReactionAlertBadge.tsx.
 */
import React, { memo, useEffect, useRef, useState } from "react";
import { Animated, Easing, Text, View } from "react-native";
import { useReducedMotion } from "react-native-reanimated";
import SmartImage from "../common/SmartImage";
import { useAppPrefs } from "../../hooks/useAppPrefs";
import { animatedChatEmoji } from "../../libs/chatReactionEmoji";
import { useReactionArrivalScope } from "../ChatReactions/ReactionArrival";
import type { ChatReactionSummary } from "../../services/dm/dm.api";

/** A badge that shows up this soon after its row did is what was already waiting, not news. */
const ROW_SETTLE_MS = 700;
const rowSeenAt = new Map<string, number>();
const totalSeen = new Map<string, number>();

/** Call on every render of a Messages row, so a badge that appears later counts as news. */
export function markChatRow(rowKey: string | undefined | null) {
  if (rowKey && !rowSeenAt.has(rowKey)) rowSeenAt.set(rowKey, Date.now());
}

const SIZE = 20;

/** The animated file, looping, once it has loaded; the plain emoji until then (and when motion is off). */
const MovingEmoji = memo(function MovingEmoji({ emoji, uri }: { emoji: string; uri: string | null }) {
  const [loaded, setLoaded] = useState(false);
  return (
    <>
      {(!uri || !loaded) && <Text style={{ fontSize: 15, lineHeight: 19, includeFontPadding: false }}>{emoji}</Text>}
      {uri ? (
        <SmartImage
          source={{ uri }}
          style={{ position: "absolute", width: SIZE, height: SIZE, opacity: loaded ? 1 : 0 }}
          contentFit="contain"
          onLoad={() => setLoaded(true)}
        />
      ) : null}
    </>
  );
});

export default memo(function ReactionAlertBadge({ reactions, rowKey }: { reactions?: ChatReactionSummary | null; rowKey?: string }) {
  const style = useAppPrefs().chatReactionStyle;
  const reduceMotion = useReducedMotion();
  const scope = useReactionArrivalScope();
  const lead = useRef<View>(null);
  const scale = useRef(new Animated.Value(1)).current;
  const shown = useRef(new Animated.Value(1)).current;
  markChatRow(rowKey);
  const total = reactions?.total ?? 0;
  const lastEmoji = reactions?.last?.emoji ?? reactions?.emojis[0]?.emoji ?? "";
  const moving = style !== "off" && !reduceMotion;

  useEffect(() => {
    if (!rowKey || !(total > 0)) return;
    const seen = totalSeen.get(rowKey);
    totalSeen.set(rowKey, total);
    const settled = Date.now() - (rowSeenAt.get(rowKey) ?? Date.now()) > ROW_SETTLE_MS;
    const arrived = seen === undefined ? settled : total > seen;
    if (!arrived || !moving) return;
    const bump = (strength: number) => {
      Animated.sequence([
        Animated.timing(scale, { toValue: 1 + 0.24 * strength, duration: 150, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.spring(scale, { toValue: 1, friction: 4, tension: 160, useNativeDriver: true }),
      ]).start();
    };
    if (style === "pop" || !scope) {
      scale.setValue(0.35);
      Animated.spring(scale, { toValue: 1, friction: 4, tension: 140, useNativeDriver: true }).start();
      return;
    }
    if (style === "burst") {
      // Someone else's reaction: a small ring and sparks round the badge.
      lead.current?.measureInWindow((x, y, w, h) => {
        scope.launch({ kind: "ring", emoji: lastEmoji, uri: null, mine: false, toWindow: { x: x + w / 2, y: y + h / 2 } });
      });
      bump(0.9);
      return;
    }
    shown.setValue(0);
    lead.current?.measureInWindow((x, y, w, h) => {
      scope.launch({
        kind: "fly",
        emoji: lastEmoji,
        uri: animatedChatEmoji(lastEmoji)?.uri ?? null,
        mine: false,
        toWindow: { x: x + w / 2, y: y + h / 2 },
        onLand: () => { shown.setValue(1); bump(0.7); },
      });
    });
    // A lost flight must never leave the badge blank.
    const t = setTimeout(() => shown.setValue(1), 1600);
    return () => clearTimeout(t);
    // Only a change in the waiting total can be an arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rowKey, total]);

  if (!reactions || !(reactions.total > 0)) return null;
  const ordered = [...reactions.emojis].sort((a, b) => (a.emoji === lastEmoji ? -1 : b.emoji === lastEmoji ? 1 : 0));
  const list = ordered.slice(0, 3);
  return (
    <Animated.View
      testID="reaction-alert"
      accessibilityLabel={`${reactions.total} new reactions`}
      style={{ height: 22, flexDirection: "row", alignItems: "center", opacity: shown, transform: [{ scale }] }}
    >
      {list.map((e, i) => {
        const art = moving ? animatedChatEmoji(e.emoji) : null;
        return (
          <View
            key={e.emoji}
            ref={i === 0 ? lead : undefined}
            collapsable={false}
            testID={`reaction-alert-emoji-${i}`}
            style={{ width: SIZE, height: SIZE, alignItems: "center", justifyContent: "center", marginLeft: i > 0 ? -4 : 0, zIndex: list.length - i }}
          >
            <MovingEmoji emoji={e.emoji} uri={art?.uri ?? null} />
          </View>
        );
      })}
      {reactions.total > 1 && (
        <Text className="text-[12px] text-white font-bold" style={{ marginLeft: 4, fontVariant: ["tabular-nums"] }}>
          {reactions.total > 99 ? "99+" : reactions.total}
        </Text>
      )}
    </Animated.View>
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
