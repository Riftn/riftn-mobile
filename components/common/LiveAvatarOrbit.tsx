import React, { useEffect } from "react";
import { StyleSheet, View } from "react-native";
import Animated, {
  cancelAnimation,
  Easing,
  type SharedValue,
  useAnimatedProps,
  useDerivedValue,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import Svg, { Rect } from "react-native-svg";
import { useAmbientMotion } from "../../hooks/useAmbientMotion";
import { optionalSkia } from "../../libs/skia";

const skia = optionalSkia(() => require("@shopify/react-native-skia") as typeof import("@shopify/react-native-skia"));
const AnimatedRect = Animated.createAnimatedComponent(Rect);
const OUTSET = 3.5;
const STROKE = 1.5;
const BASE = "#e7354a";
// Match the web orbit's conic gradient, starting at the top of the avatar.
const COLORS = [BASE, BASE, "#ff4e61", "#ff9aa3", "#ff576a", BASE];
const STOPS = [0, 268 / 360, 301 / 360, 326 / 360, 339 / 360, 1];

/** Keep playback decoration animated on binaries without the Skia module. */
function DashOrbit({ box, corner, progress }: { box: number; corner: number; progress: SharedValue<number> }) {
  const side = box - STROKE;
  const perimeter = 4 * (side - 2 * corner) + 2 * Math.PI * corner;
  const trail = useAnimatedProps(() => ({ strokeDashoffset: -progress.value * perimeter }));
  const highlight = useAnimatedProps(() => ({ strokeDashoffset: -(progress.value + 0.14) * perimeter }));
  const outline = {
    x: STROKE / 2, y: STROKE / 2, width: side, height: side,
    rx: corner, ry: corner, fill: "none", strokeWidth: STROKE,
  };

  return (
    <Svg width={box} height={box}>
      <AnimatedRect {...outline} stroke="#ff576a" strokeLinecap="round"
        strokeDasharray={[perimeter * 0.22, perimeter * 0.78]} animatedProps={trail} />
      <AnimatedRect {...outline} stroke="#ff9aa3" strokeLinecap="round"
        strokeDasharray={[perimeter * 0.08, perimeter * 0.92]} animatedProps={highlight} />
    </Svg>
  );
}

/** Draw the live outline at a fixed distance from the avatar's own corners. */
export function LiveAvatarOrbit({ size, radius }: { size: number; radius: number }) {
  const ambient = useAmbientMotion();
  const reduced = useReducedMotion();
  const running = ambient && !reduced;
  const progress = useSharedValue(0);
  const box = size + 2 * OUTSET;
  const outerRadius = radius + OUTSET;
  const corner = outerRadius - STROKE / 2;
  const center = { x: box / 2, y: box / 2 };
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
      {running && skia ? (
        <skia.Canvas style={StyleSheet.absoluteFill}>
          <skia.RoundedRect
            x={STROKE / 2}
            y={STROKE / 2}
            width={box - STROKE}
            height={box - STROKE}
            r={corner}
            style="stroke"
            strokeWidth={STROKE}
          >
            <skia.SweepGradient c={center} origin={center} colors={COLORS} positions={STOPS} transform={rotation} />
          </skia.RoundedRect>
        </skia.Canvas>
      ) : (
        <>
          <View style={[StyleSheet.absoluteFill, { borderRadius: outerRadius, borderWidth: STROKE, borderColor: BASE }]} />
          {running && <DashOrbit box={box} corner={corner} progress={progress} />}
        </>
      )}
    </View>
  );
}
