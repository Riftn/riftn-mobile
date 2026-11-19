import React, { memo, useEffect } from "react";
import { Text, TouchableOpacity, View } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { useTranslation } from "react-i18next";
import Icon from "../ui/Icon";
import { useAppTheme } from "../../context/ThemeContext";

// Solid fills, written as hsla() so the System Light colour pass leaves them
// alone. A see-through fill with an Android elevation shadow drew the shadow
// inside the button (a grey square with a white block behind the arrow).
const JUMP_LIGHT = { fill: "hsla(0,0%,100%,1)", rim: "hsla(0,0%,0%,0.08)", well: "hsla(0,0%,0%,0.06)", ink: "hsla(240,6%,10%,1)" };
const JUMP_DARK = { fill: "hsla(240,6%,10%,1)", rim: "hsla(0,0%,100%,0.10)", well: "hsla(0,0%,100%,0.12)", ink: "hsla(240,5%,96%,1)" };

export const formatUnreadCount = (n: number) => (n > 99 ? "99+" : String(n));

/**
 * The line a chat opens on when you missed messages: two hairlines fading in
 * toward a frosted tag saying how many came in. Same frost as the day pill
 * (dark-surface keeps it dark on paper themes) so it fits every theme.
 * Twin of riftn-web's UnreadMarker.
 */
export const UnreadMarker = memo(function UnreadMarker({ count }: { count: number }) {
  const { t } = useTranslation();
  const label = count === 1
    ? t("messages.unreadMarkerOne", { defaultValue: "1 unread message" })
    : t("messages.unreadMarkerMany", { defaultValue: "{{value}} unread messages", value: formatUnreadCount(count) });
  return (
    <View className="flex-row items-center py-3 px-1" pointerEvents="none" accessibilityRole="text" accessibilityLabel={label}>
      <View className="h-px flex-1 bg-white/25" style={{ opacity: 0.9 }} />
      <View className="dark-surface mx-3 flex-row items-center rounded-full bg-black/55 px-3 py-1">
        <View className="mr-1.5 h-1.5 w-1.5 rounded-full bg-white/80" />
        <Text className="text-[11px] font-semibold text-white/90" style={{ letterSpacing: 0.3 }}>{label}</Text>
      </View>
      <View className="h-px flex-1 bg-white/25" style={{ opacity: 0.9 }} />
    </View>
  );
});

/**
 * Floating jump capsule: unread lines still below on the left, a round arrow
 * on the right that turns to point where a tap goes (up to the marker until
 * you've reached it, then down to the newest line). No count = just the circle.
 */
export const UnreadJumpButton = memo(function UnreadJumpButton({
  count,
  up,
  onPress,
}: {
  count: number;
  up: boolean;
  onPress: () => void;
}) {
  const { t } = useTranslation();
  const { isLight } = useAppTheme();
  const c = isLight ? JUMP_LIGHT : JUMP_DARK;
  const turn = useSharedValue(up ? 180 : 0);
  useEffect(() => {
    turn.value = withTiming(up ? 180 : 0, { duration: 280 });
  }, [up, turn]);
  const arrowStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${turn.value}deg` }] }));
  const label = up
    ? t("messages.jumpToUnread", { defaultValue: "Jump to first unread message" })
    : t("messages.jumpToLatest", { defaultValue: "Jump to latest message" });
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.8}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={count > 0 ? `${label} (${formatUnreadCount(count)})` : label}
      className="dark-surface h-11 flex-row items-center rounded-full"
      style={{
        backgroundColor: c.fill,
        borderRadius: 22,
        borderWidth: 1,
        borderColor: c.rim,
        shadowColor: "#000",
        shadowOpacity: isLight ? 0.12 : 0.3,
        shadowRadius: 10,
        shadowOffset: { width: 0, height: 4 },
        elevation: 6,
      }}
    >
      {count > 0 ? (
        <Text className="pl-3.5 pr-1 text-sm font-semibold" style={{ color: c.ink, fontVariant: ["tabular-nums"] }}>
          {formatUnreadCount(count)}
        </Text>
      ) : null}
      <View className="m-1 h-9 w-9 items-center justify-center rounded-full" style={{ backgroundColor: c.well, borderRadius: 18 }}>
        <Animated.View style={arrowStyle}>
          <Icon name="ArrowDown" size={16} color={c.ink} />
        </Animated.View>
      </View>
    </TouchableOpacity>
  );
});

/**
 * Telegram's "@" bubble: lines that reply to you or tag you, which arrived
 * since you last read the room. A tap goes to the oldest one; the count says
 * how many are left.
 */
export const MentionJumpButton = memo(function MentionJumpButton({
  count,
  onPress,
}: {
  count: number;
  onPress: () => void;
}) {
  const { t } = useTranslation();
  const { isLight } = useAppTheme();
  const c = isLight ? JUMP_LIGHT : JUMP_DARK;
  const label = t("liveChat.jumpToMentions", { defaultValue: "Jump to replies and mentions" });
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.8}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={`${label} (${formatUnreadCount(count)})`}
      className="dark-surface h-11 w-11 items-center justify-center rounded-full"
      style={{
        backgroundColor: c.fill,
        borderRadius: 22,
        borderWidth: 1,
        borderColor: c.rim,
        shadowColor: "#000",
        shadowOpacity: isLight ? 0.12 : 0.3,
        shadowRadius: 10,
        shadowOffset: { width: 0, height: 4 },
        elevation: 6,
      }}
    >
      <Text className="text-base font-bold" style={{ color: c.ink }}>@</Text>
      <View
        pointerEvents="none"
        style={{
          position: "absolute", top: -4, right: -4, minWidth: 18, height: 18, borderRadius: 9,
          paddingHorizontal: 4, alignItems: "center", justifyContent: "center", backgroundColor: "hsla(217,91%,60%,1)",
        }}
      >
        <Text style={{ color: "hsla(0,0%,100%,1)", fontSize: 10, fontWeight: "700", fontVariant: ["tabular-nums"] }}>
          {formatUnreadCount(count)}
        </Text>
      </View>
    </TouchableOpacity>
  );
});
