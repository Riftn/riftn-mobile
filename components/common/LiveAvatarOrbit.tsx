import React, { useEffect } from "react";
import { StyleSheet, View } from "react-native";
import { Canvas, RoundedRect, SweepGradient, vec } from "@shopify/react-native-skia";
import {
  cancelAnimation,
  Easing,
  useDerivedValue,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import { useAmbientMotion } from "../../hooks/useAmbientMotion";

const OUTSET = 3.5;
const STROKE = 1.5;
const BASE = "#e7354a";
// Match the web orbit's conic gradient, starting at the top of the avatar.
const COLORS = [BASE, BASE, "#ff4e61", "#ff9aa3", "#ff576a", BASE];
const STOPS = [0, 268 / 360, 301 / 360, 326 / 360, 339 / 360, 1];

/** Draw the live outline at a fixed distance from the avatar's own corners. */
export function LiveAvatarOrbit({ size, radius }: { size: number; radius: number }) {
  const ambient = useAmbientMotion();
  const reduced = useReducedMotion();
  const running = ambient && !reduced;
  const progress = useSharedValue(0);
  const box = size + 2 * OUTSET;
  const outerRadius = radius + OUTSET;
  const center = vec(box / 2, box / 2);
  const rotation = useDerivedValue(() => [
    { rotate: (progress.value * 2 - 0.5) * Math.PI },
  ]);

  useEffect(() => {
    if (!running) return;
    progress.value = 0;
    progress.value = withRepeat(withTiming(1, { duration: 3000, easing: Easing.linear }), -1);
    return () => cancelAnimation(progress);
  }, [progress, running]);

  return (
    <View pointerEvents="none" style={{ position: "absolute", top: -OUTSET, left: -OUTSET, width: box, height: box }}>
      {running ? (
        <Canvas style={StyleSheet.absoluteFill}>
          <RoundedRect
            x={STROKE / 2}
            y={STROKE / 2}
            width={box - STROKE}
            height={box - STROKE}
            r={outerRadius - STROKE / 2}
            style="stroke"
            strokeWidth={STROKE}
          >
            <SweepGradient c={center} origin={center} colors={COLORS} positions={STOPS} transform={rotation} />
          </RoundedRect>
        </Canvas>
      ) : (
        <View style={[StyleSheet.absoluteFill, { borderRadius: outerRadius, borderWidth: STROKE, borderColor: BASE }]} />
      )}
    </View>
  );
}
