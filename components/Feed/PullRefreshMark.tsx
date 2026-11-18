import React from "react";
import { ActivityIndicator, StyleSheet } from "react-native";
import Animated, { useAnimatedStyle, type SharedValue } from "react-native-reanimated";
import Icon from "../ui/Icon";
import { PULL_REFRESH_THRESHOLD } from "../../libs/pill-pull-motion";

/** How far a list stays lowered, spinner showing, while its pull refresh runs. */
export const PULL_HOLD = 52;
/** Longest a list stays lowered for one refresh. */
export const PULL_HOLD_MAX_MS = 12_000;

/**
 * What shows in the gap a pulled list leaves at its top: a refresh arrow that
 * turns with the pull and settles full size at the point a release refreshes,
 * then a spinner while the refresh runs. Sits absolutely at the top of the
 * list's box; the list itself is lowered by `pull`.
 */
export default function PullRefreshMark({ pull, holding, spinning, color = "#A1A1AA" }: {
  pull: SharedValue<number>;
  holding: SharedValue<boolean>;
  spinning: boolean;
  color?: string;
}) {
  const boxStyle = useAnimatedStyle(() => ({
    height: pull.value,
    opacity: holding.value ? 1 : Math.min(1, pull.value / 28),
  }));
  const turnStyle = useAnimatedStyle(() => {
    const p = Math.min(1, pull.value / PULL_REFRESH_THRESHOLD);
    return { transform: [{ rotate: `${p * 300}deg` }, { scale: 0.7 + p * 0.3 }] };
  });
  return (
    <Animated.View pointerEvents="none" style={[styles.box, boxStyle]}>
      {spinning ? (
        <ActivityIndicator size="small" color={color} />
      ) : (
        <Animated.View style={turnStyle}>
          <Icon name="RefreshCw" size={18} color={color} />
        </Animated.View>
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  box: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    zIndex: 1,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
});
