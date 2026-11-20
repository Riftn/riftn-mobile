import React, { memo, useCallback, useMemo, useState } from "react";
import { Platform, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";
import SwipeReplyArrows from "./SwipeReplyArrows";
import { haptic } from "../../libs/haptics";

const THRESHOLD = 60;
const MAX = 80;

/**
 * Swipe a chat line to reply, like the DM bubbles. iOS reserves rightward
 * swipes for native back navigation.
 * The arrow shows on the side the line moves away from.
 *
 * `onReply` gets `payload` back, so a list can pass one stable handler and
 * the line itself instead of a new closure per row.
 */
function SwipeToReply<T>({
  onReply,
  payload,
  enabled = true,
  children,
}: {
  onReply: (payload: T) => void;
  payload: T;
  enabled?: boolean;
  children: React.ReactNode;
}) {
  const x = useSharedValue(0);
  // The arrows are built on the first swipe, not for every row on screen.
  const [armed, setArmed] = useState(false);

  const fire = useCallback(() => {
    haptic.select();
    onReply(payload);
  }, [onReply, payload]);

  const pan = useMemo(
    () =>
      Gesture.Pan()
        .enabled(enabled)
        .activeOffsetX(Platform.OS === "ios" ? -14 : [-14, 14])
        .failOffsetY([-15, 15])
        .onStart(() => {
          runOnJS(setArmed)(true);
        })
        .onUpdate((e) => {
          x.value = Math.min(Math.max(e.translationX, -MAX), MAX);
        })
        .onEnd((_event, success) => {
          if (success && Math.abs(x.value) >= THRESHOLD) runOnJS(fire)();
        })
        .onFinalize(() => {
          x.value = withSpring(0, { damping: 20, stiffness: 200 });
        }),
    [enabled, fire, x],
  );

  const rowStyle = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));

  return (
    <View>
      {armed ? <SwipeReplyArrows x={x} threshold={THRESHOLD} /> : null}
      <GestureDetector gesture={pan}>
        <Animated.View style={rowStyle}>{children}</Animated.View>
      </GestureDetector>
    </View>
  );
}

export default memo(SwipeToReply) as typeof SwipeToReply;
