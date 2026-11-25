import React, { useEffect } from "react";
import { View } from "react-native";
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedProps,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import Svg, { Rect } from "react-native-svg";
import { useAmbientMotion } from "../../hooks/useAmbientMotion";

const AnimatedRect = Animated.createAnimatedComponent(Rect);
const OUTSET = 3.5;
const STROKE = 1.5;

/** Draw the live outline at a fixed distance from the avatar's own corners. */
export function LiveAvatarOrbit({ size, radius }: { size: number; radius: number }) {
  const ambient = useAmbientMotion();
  const reduced = useReducedMotion();
  const running = ambient && !reduced;
  const progress = useSharedValue(0);
  const box = size + 2 * OUTSET;
  const side = box - STROKE;
  const corner = radius + OUTSET - STROKE / 2;
  const perimeter = 4 * (side - 2 * corner) + 2 * Math.PI * corner;

  useEffect(() => {
    if (!running) return;
    progress.value = 0;
    progress.value = withRepeat(withTiming(1, { duration: 3000, easing: Easing.linear }), -1);
    return () => cancelAnimation(progress);
  }, [progress, running]);

  const trail = useAnimatedProps(() => ({ strokeDashoffset: -progress.value * perimeter }));
  const highlight = useAnimatedProps(() => ({ strokeDashoffset: -(progress.value + 0.14) * perimeter }));
  const outline = {
    x: STROKE / 2,
    y: STROKE / 2,
    width: side,
    height: side,
    rx: corner,
    ry: corner,
    fill: "none",
    strokeWidth: STROKE,
  };

  return (
    <View pointerEvents="none" style={{ position: "absolute", top: -OUTSET, left: -OUTSET }}>
      <Svg width={box} height={box}>
        <Rect {...outline} stroke="#e7354a" />
        {running && (
          <>
            <AnimatedRect {...outline} stroke="#ff576a" strokeLinecap="round"
              strokeDasharray={[perimeter * 0.22, perimeter * 0.78]} animatedProps={trail} />
            <AnimatedRect {...outline} stroke="#ff9aa3" strokeLinecap="round"
              strokeDasharray={[perimeter * 0.08, perimeter * 0.92]} animatedProps={highlight} />
          </>
        )}
      </Svg>
    </View>
  );
}
