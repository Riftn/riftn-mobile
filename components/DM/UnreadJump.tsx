import React, { memo, useEffect, useRef } from "react";
import { Pressable, Text, TouchableOpacity, View } from "react-native";
import Animated, { LinearTransition, useAnimatedStyle, useReducedMotion, useSharedValue, withSpring, withTiming } from "react-native-reanimated";
import { formatCount } from "../../libs/format-count";
import { useTranslation } from "react-i18next";
import Icon from "../ui/Icon";
import { useAppTheme } from "../../context/ThemeContext";

// Solid fills, written as hsla() so the System Light colour pass leaves them
// alone. A see-through fill with an Android elevation shadow drew the shadow
// inside the button (a grey square with a white block behind the arrow).
const JUMP_LIGHT = { fill: "hsla(0,0%,100%,1)", rim: "hsla(0,0%,0%,0.08)", well: "hsla(0,0%,0%,0.06)", ink: "hsla(240,6%,10%,1)" };
const JUMP_DARK = { fill: "hsla(240,6%,10%,1)", rim: "hsla(0,0%,100%,0.10)", well: "hsla(0,0%,100%,0.12)", ink: "hsla(240,5%,96%,1)" };

/** Same short style as every other counter (999, 1.2K, 3.4M), never capped. */
export const formatUnreadCount = (n: number) => formatCount(Math.max(0, Math.round(n)));

// Soft glassy spring for the capsule showing / hiding and for the press dip.
const GLIDE = { damping: 18, stiffness: 220, mass: 0.7 };
const PRESS = { damping: 14, stiffness: 420, mass: 0.5 };
const COUNT_SLIDE = LinearTransition.springify().damping(20).stiffness(240);

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
 * Floating jump capsule: how many lines sit below you on the left, a round
 * arrow on the right that turns to point where a tap goes (up to the marker
 * until you've reached it, then down to the newest line). No count = just the
 * circle. It stays mounted and glides in and out on a spring (fade, lift,
 * scale) when `show` flips, instead of popping, and dips softly when pressed.
 */
export const UnreadJumpButton = memo(function UnreadJumpButton({
  count,
  up,
  onPress,
  show = true,
}: {
  count: number;
  up: boolean;
  onPress: () => void;
  show?: boolean;
}) {
  const { t } = useTranslation();
  const { isLight } = useAppTheme();
  const reduce = useReducedMotion();
  const c = isLight ? JUMP_LIGHT : JUMP_DARK;
  const turn = useSharedValue(up ? 180 : 0);
  const shown = useSharedValue(show ? 1 : 0);
  const press = useSharedValue(1);
  // Keep the last figure while gliding out so the capsule doesn't snap shut mid-fade.
  const lastCount = useRef(count);
  if (show) lastCount.current = count;
  const figure = show ? count : lastCount.current;
  useEffect(() => {
    turn.value = withTiming(up ? 180 : 0, { duration: 280 });
  }, [up, turn]);
  useEffect(() => {
    shown.value = reduce ? (show ? 1 : 0) : withSpring(show ? 1 : 0, GLIDE);
  }, [show, shown, reduce]);
  const arrowStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${turn.value}deg` }] }));
  const glideStyle = useAnimatedStyle(() => ({
    opacity: Math.min(1, Math.max(0, shown.value)),
    transform: [
      { translateY: (1 - shown.value) * 14 },
      { scale: (0.86 + 0.14 * shown.value) * press.value },
    ],
  }));
  const label = up
    ? t("messages.jumpToUnread", { defaultValue: "Jump to first unread message" })
    : t("messages.jumpToLatest", { defaultValue: "Jump to latest message" });
  return (
    <Animated.View style={glideStyle} pointerEvents={show ? "auto" : "none"}>
      <Pressable
        onPress={onPress}
        onPressIn={() => { press.value = withSpring(0.92, PRESS); }}
        onPressOut={() => { press.value = withSpring(1, PRESS); }}
        hitSlop={8}
        disabled={!show}
        accessibilityRole="button"
        accessibilityElementsHidden={!show}
        importantForAccessibility={show ? "auto" : "no-hide-descendants"}
        accessibilityLabel={figure > 0 ? `${label} (${formatUnreadCount(figure)})` : label}
      >
        <Animated.View
          layout={reduce ? undefined : COUNT_SLIDE}
          className="dark-surface"
          style={{
            height: 44,
            flexDirection: "row",
            alignItems: "center",
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
          {figure > 0 ? (
            <Text className="pl-3.5 pr-1 text-sm font-semibold" style={{ color: c.ink, fontVariant: ["tabular-nums"] }}>
              {formatUnreadCount(figure)}
            </Text>
          ) : null}
          <View className="m-1 h-9 w-9 items-center justify-center rounded-full" style={{ backgroundColor: c.well, borderRadius: 18 }}>
            <Animated.View style={arrowStyle}>
              <Icon name="ArrowDown" size={16} color={c.ink} />
            </Animated.View>
          </View>
        </Animated.View>
      </Pressable>
    </Animated.View>
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
