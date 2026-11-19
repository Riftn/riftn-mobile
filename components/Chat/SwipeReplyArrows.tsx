import React, { memo } from "react";
import { View } from "react-native";
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedStyle,
  type SharedValue,
} from "react-native-reanimated";
import Icon from "../ui/Icon";

const ARROW_LEFT = { position: "absolute", left: 8, top: 0, bottom: 0, justifyContent: "center", alignItems: "center" } as const;
const ARROW_RIGHT = { position: "absolute", right: 8, top: 0, bottom: 0, justifyContent: "center", alignItems: "center" } as const;

/**
 * The reply arrows behind a swiped chat line. Mounted only once a swipe has
 * started on that line, so a scrolling list doesn't build two icons and their
 * animations for every row it shows.
 */
function SwipeReplyArrows({ x, threshold }: { x: SharedValue<number>; threshold: number }) {
  const left = useAnimatedStyle(() => ({
    opacity: interpolate(x.value, [0, threshold], [0, 1], Extrapolation.CLAMP),
    transform: [{ scale: interpolate(x.value, [0, threshold], [0.5, 1], Extrapolation.CLAMP) }],
  }));
  const right = useAnimatedStyle(() => ({
    opacity: interpolate(-x.value, [0, threshold], [0, 1], Extrapolation.CLAMP),
    transform: [{ scale: interpolate(-x.value, [0, threshold], [0.5, 1], Extrapolation.CLAMP) }],
  }));
  const arrow = (
    <View className="w-8 h-8 rounded-xl bg-theme-neutrals-800 items-center justify-center">
      <Icon name="Undo2" size={18} color="#F4F4F5" />
    </View>
  );
  return (
    <>
      <Animated.View pointerEvents="none" style={[left, ARROW_LEFT]}>{arrow}</Animated.View>
      <Animated.View pointerEvents="none" style={[right, ARROW_RIGHT]}>{arrow}</Animated.View>
    </>
  );
}

export default memo(SwipeReplyArrows);
