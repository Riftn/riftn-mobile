import React, { memo, useCallback, useMemo } from "react";
import { View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";
import Icon from "../ui/Icon";
import { haptic } from "../../libs/haptics";

const THRESHOLD = 60;
const MAX = 80;

/**
 * Swipe a chat line left or right to reply to it, like the DM bubbles.
 * The arrow shows on the side the line moves away from.
 */
function SwipeToReply({
  onReply,
  enabled = true,
  children,
}: {
  onReply: () => void;
  enabled?: boolean;
  children: React.ReactNode;
}) {
  const x = useSharedValue(0);

  const fire = useCallback(() => {
    haptic.select();
    onReply();
  }, [onReply]);

  const pan = useMemo(
    () =>
      Gesture.Pan()
        .enabled(enabled)
        .activeOffsetX([-14, 14])
        .failOffsetY([-15, 15])
        .onUpdate((e) => {
          x.value = Math.min(Math.max(e.translationX, -MAX), MAX);
        })
        .onEnd(() => {
          if (Math.abs(x.value) >= THRESHOLD) runOnJS(fire)();
          x.value = withSpring(0, { damping: 20, stiffness: 200 });
        }),
    [enabled, fire, x],
  );

  const rowStyle = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));
  const leftIcon = useAnimatedStyle(() => ({
    opacity: interpolate(x.value, [0, THRESHOLD], [0, 1], Extrapolation.CLAMP),
    transform: [{ scale: interpolate(x.value, [0, THRESHOLD], [0.5, 1], Extrapolation.CLAMP) }],
  }));
  const rightIcon = useAnimatedStyle(() => ({
    opacity: interpolate(-x.value, [0, THRESHOLD], [0, 1], Extrapolation.CLAMP),
    transform: [{ scale: interpolate(-x.value, [0, THRESHOLD], [0.5, 1], Extrapolation.CLAMP) }],
  }));

  const arrow = (
    <View className="w-8 h-8 rounded-xl bg-theme-neutrals-800 items-center justify-center">
      <Icon name="Undo2" size={18} color="#F4F4F5" />
    </View>
  );

  return (
    <View>
      <Animated.View
        pointerEvents="none"
        style={[leftIcon, { position: "absolute", left: 8, top: 0, bottom: 0, justifyContent: "center" }]}
      >
        {arrow}
      </Animated.View>
      <Animated.View
        pointerEvents="none"
        style={[rightIcon, { position: "absolute", right: 8, top: 0, bottom: 0, justifyContent: "center" }]}
      >
        {arrow}
      </Animated.View>
      <GestureDetector gesture={pan}>
        <Animated.View style={rowStyle}>{children}</Animated.View>
      </GestureDetector>
    </View>
  );
}

export default memo(SwipeToReply);
