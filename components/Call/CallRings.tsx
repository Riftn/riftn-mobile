import React, { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Animated, Easing, type ViewStyle } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import Svg, { Circle, Defs, Path, RadialGradient, Stop } from "react-native-svg";
import type { AppThemeName } from "../../theme/colors";
import { withAlpha, type StagePalette } from "./callStage";

/**
 * The ringing effect behind the avatar while a call is waiting to be answered.
 * Every theme draws its own: System pulses a squared outline, Hazy lets haze
 * drift off the picture, War sweeps a radar, and so on. Web has the same set in
 * call-stage.css; this is its twin, drawn with views and SVG because there is
 * no blur or conic gradient to lean on here.
 *
 * Only transforms and opacity move, so every loop runs on the native driver.
 */

type Loop = { alternate?: boolean; delay?: number; easing?: (value: number) => number };

function useReduceMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled().then((value) => { if (alive) setReduced(!!value); }).catch(() => {});
    const sub = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduced);
    return () => { alive = false; sub.remove(); };
  }, []);
  return reduced;
}

function useLoop(duration: number, still: boolean, { alternate, delay = 0, easing = Easing.linear }: Loop = {}) {
  const value = useRef(new Animated.Value(0)).current;
  // The easing is read once: callers build theirs inline, and a new function
  // each render must not restart the loop.
  const ease = useRef(easing).current;
  useEffect(() => {
    if (still) { value.setValue(alternate ? 0.5 : 0); return; }
    value.setValue(0);
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(value, { toValue: 1, duration, easing: ease, useNativeDriver: true }),
      // Back to the start: eased the other way for a breathing loop, at once for a one-way one.
      Animated.timing(value, { toValue: 0, duration: alternate ? duration : 0, easing: ease, useNativeDriver: true }),
    ]));
    const timer = setTimeout(() => loop.start(), delay);
    return () => { clearTimeout(timer); loop.stop(); };
  }, [value, duration, still, alternate, delay, ease]);
  return value;
}

const range = (value: Animated.Value, output: number[] | string[], input: number[] = [0, 1]) =>
  value.interpolate({ inputRange: input, outputRange: output as number[] });

/** One absolutely placed layer, `out` pixels larger than the avatar on every side. */
const Layer: React.FC<{
  out?: number;
  scale?: Animated.AnimatedInterpolation<number>;
  opacity?: Animated.AnimatedInterpolation<number> | number;
  rotate?: Animated.AnimatedInterpolation<string | number>;
  style?: ViewStyle;
  children?: React.ReactNode;
}> = ({ out = 0, scale, opacity, rotate, style, children }) => {
  const transform: any[] = [];
  if (scale) transform.push({ scale });
  if (rotate) transform.push({ rotate });
  return (
    <Animated.View
      pointerEvents="none"
      style={[{ position: "absolute", top: -out, left: -out, right: -out, bottom: -out, opacity: opacity ?? 1, transform }, style]}
    >
      {children}
    </Animated.View>
  );
};

const SPIN = ["0deg", "360deg"];
const SPIN_BACK = ["360deg", "0deg"];
const BLINK_IN = [0, 0.49, 0.5, 1];
const BLINK_OUT = [1, 1, 0.25, 0.25];
const BEAT_IN = [0, 0.12, 0.24, 0.36, 0.6, 1];

function Glow({ id, color, strength = 0.85 }: { id: string; color: string; strength?: number }) {
  return (
    <Svg width="100%" height="100%" viewBox="0 0 100 100">
      <Defs>
        <RadialGradient id={id} cx="50" cy="50" r="50" gradientUnits="userSpaceOnUse">
          <Stop offset="0" stopColor={color} stopOpacity={strength} />
          <Stop offset="0.55" stopColor={color} stopOpacity={strength * 0.45} />
          <Stop offset="1" stopColor={color} stopOpacity={0} />
        </RadialGradient>
      </Defs>
      <Circle cx="50" cy="50" r="50" fill={`url(#${id})`} />
    </Svg>
  );
}

type Dot = [x: number, y: number, size: number, color: string];
function Dots({ dots }: { dots: Dot[] }) {
  return (
    <Svg width="100%" height="100%" viewBox="0 0 100 100">
      {dots.map(([x, y, size, color], index) => <Circle key={index} cx={x} cy={y} r={size} fill={color} />)}
    </Svg>
  );
}

function DashedCircle({ color, dash = "3 3" }: { color: string; dash?: string }) {
  return (
    <Svg width="100%" height="100%" viewBox="0 0 100 100">
      <Circle cx="50" cy="50" r="49.4" fill="none" stroke={color} strokeWidth={0.7} strokeDasharray={dash} />
    </Svg>
  );
}

/** A radar sweep: a wedge that fades behind its leading edge, inside a range ring. */
function Sweep({ color }: { color: string }) {
  const point = (degrees: number) => {
    const angle = ((degrees - 90) * Math.PI) / 180;
    return `${50 + 49 * Math.cos(angle)} ${50 + 49 * Math.sin(angle)}`;
  };
  const slices = [0, 1, 2, 3, 4, 5];
  return (
    <Svg width="100%" height="100%" viewBox="0 0 100 100">
      <Circle cx="50" cy="50" r="49.4" fill="none" stroke={color} strokeOpacity={0.55} strokeWidth={0.7} />
      {slices.map((slice) => (
        <Path
          key={slice}
          d={`M50 50 L${point(slice * 16)} A49 49 0 0 1 ${point(slice * 16 + 16.5)} Z`}
          fill={color}
          fillOpacity={0.08 + slice * 0.085}
        />
      ))}
    </Svg>
  );
}

/** A rim whose colours travel round it: a spinning gradient clipped to the rim's shape. */
function TravellingRim({ out, radius, colors, spin, opacity = 1 }: {
  out: number; radius: number; colors: string[]; spin: Animated.AnimatedInterpolation<string | number>; opacity?: number;
}) {
  return (
    <Layer out={out} opacity={opacity} style={{ borderRadius: radius + out, overflow: "hidden", alignItems: "center", justifyContent: "center" }}>
      <Animated.View style={{ width: "150%", aspectRatio: 1, transform: [{ rotate: spin }] }}>
        <LinearGradient colors={colors as [string, string, ...string[]]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ flex: 1 }} />
      </Animated.View>
    </Layer>
  );
}

interface EffectProps { size: number; radius: number; palette: StagePalette; still: boolean }

/** System: a squared outline pulsing out from the picture. Also the fallback. */
function Outline({ radius, palette, still, filled, round, period = 1900 }: EffectProps & { filled?: boolean; round?: boolean; period?: number }) {
  const first = useLoop(period, still, { easing: Easing.out(Easing.quad) });
  const second = useLoop(period, still, { easing: Easing.out(Easing.quad), delay: period / 2 });
  const shape = (color: string): ViewStyle => ({
    borderRadius: round ? 9999 : radius,
    ...(filled ? { backgroundColor: withAlpha(color, 0.1) } : { borderWidth: round ? 2 : 1.5, borderColor: color }),
  });
  return (
    <>
      <Layer scale={range(first, [1, 1.75])} opacity={range(first, [0.55, 0])} style={shape(palette.ring)} />
      <Layer scale={range(second, [1, 1.75])} opacity={range(second, [0.55, 0])} style={shape(palette.ring2)} />
    </>
  );
}

function Immersive({ size, radius, palette, still }: EffectProps) {
  const breathe = useLoop(2200, still, { alternate: true, easing: Easing.inOut(Easing.quad) });
  const pulse = useLoop(2400, still, { easing: Easing.out(Easing.quad) });
  return (
    <>
      <Layer out={size * 0.34} scale={range(breathe, [0.86, 1.12])} opacity={range(breathe, [0.35, 0.8])}>
        <Glow id="call-immersive" color={palette.ring} strength={0.5} />
      </Layer>
      <Layer scale={range(pulse, [1, 1.6])} opacity={range(pulse, [0.5, 0])} style={{ borderRadius: radius, borderWidth: 1, borderColor: palette.ring }} />
    </>
  );
}

function Minimal({ palette, still }: EffectProps) {
  const breathe = useLoop(1800, still, { alternate: true, easing: Easing.inOut(Easing.quad) });
  return <Layer scale={range(breathe, [1.06, 1.14])} opacity={range(breathe, [0.35, 0.9])} style={{ borderWidth: 1, borderColor: palette.ring }} />;
}

function Glass({ radius, palette, still }: EffectProps) {
  const spin = useLoop(4000, still);
  const breathe = useLoop(2200, still, { alternate: true, easing: Easing.inOut(Easing.quad) });
  return (
    <>
      <TravellingRim
        out={14}
        radius={radius}
        spin={range(spin, SPIN)}
        opacity={0.75}
        colors={["rgba(255,255,255,0.05)", "rgba(255,255,255,0.75)", "rgba(255,255,255,0.05)", palette.ring, "rgba(255,255,255,0.05)"]}
      />
      <Layer
        out={14}
        scale={range(breathe, [1, 1.05])}
        opacity={range(breathe, [0.45, 1])}
        style={{ borderRadius: radius + 14, borderWidth: 1, borderColor: "rgba(255,255,255,0.45)", backgroundColor: "rgba(255,255,255,0.10)" }}
      />
    </>
  );
}

function Cosmic({ size, still }: EffectProps) {
  const orbit = useLoop(9000, still);
  const stars = useLoop(14000, still);
  return (
    <>
      <Layer out={size * 0.52} rotate={range(stars, SPIN_BACK)}>
        <Dots dots={[[18, 30, 1.1, "#FFFFFF"], [84, 62, 0.9, "#FFFFFF"], [60, 6, 1.2, "#9CD3FF"], [30, 92, 1, "#D9B8FF"], [92, 22, 0.7, "#FFFFFF"]]} />
      </Layer>
      <Layer out={size * 0.26} rotate={range(orbit, SPIN)}>
        <DashedCircle color="rgba(255,255,255,0.6)" />
        <Svg width="100%" height="100%" viewBox="0 0 100 100" style={{ position: "absolute" }}>
          <Circle cx="50" cy="0.8" r="1.8" fill="#FFFFFF" />
        </Svg>
      </Layer>
    </>
  );
}

/** Hazy: haze coming off the picture in the member's own theme colour. */
function Hazy({ size, palette, still }: EffectProps) {
  const near = useLoop(2600, still, { alternate: true, easing: Easing.inOut(Easing.quad) });
  const far = useLoop(3600, still, { alternate: true, easing: Easing.inOut(Easing.quad) });
  const drift = useLoop(11000, still);
  const wisp = (left: string, top: string, color: string, id: string): React.ReactNode => (
    <Animated.View style={{ position: "absolute", left: left as any, top: top as any, width: "58%", height: "58%" }}>
      <Glow id={id} color={color} strength={0.6} />
    </Animated.View>
  );
  return (
    <>
      <Layer out={size * 0.72} scale={range(far, [1.22, 0.8])} opacity={range(far, [1, 0.45])}>
        <Glow id="call-haze-far" color={palette.ring2} strength={0.42} />
      </Layer>
      <Layer out={size * 0.62} rotate={range(drift, SPIN)} opacity={range(near, [0.55, 1])}>
        {wisp("2%", "8%", palette.ring, "call-haze-a")}
        {wisp("40%", "0%", palette.ring2, "call-haze-b")}
        {wisp("34%", "42%", palette.ring, "call-haze-c")}
      </Layer>
      <Layer out={size * 0.38} scale={range(near, [0.8, 1.2])} opacity={range(near, [0.55, 1])}>
        <Glow id="call-haze-near" color={palette.ring} strength={0.9} />
      </Layer>
    </>
  );
}

function Swarms({ size, palette, still }: EffectProps) {
  const inner = useLoop(3400, still);
  const outer = useLoop(6000, still);
  const a = palette.ring;
  const b = "#FFFFFF";
  return (
    <>
      <Layer out={size * 0.44} rotate={range(outer, SPIN_BACK)}>
        <Dots dots={[[8, 40, 1.1, b], [60, 98, 0.9, a], [92, 28, 1.2, a], [34, 4, 0.8, b], [70, 70, 0.7, a], [16, 78, 0.9, a]]} />
      </Layer>
      <Layer out={size * 0.24} rotate={range(inner, SPIN)}>
        <Dots dots={[[50, 2, 1.7, a], [96, 60, 1.4, a], [12, 78, 1.6, a], [78, 10, 1.2, b]]} />
      </Layer>
    </>
  );
}

function LavaLamp({ size, palette, still }: EffectProps) {
  const slow = useLoop(11000, still);
  const fast = useLoop(7000, still);
  const swell = useLoop(3500, still, { alternate: true, easing: Easing.inOut(Easing.quad) });
  const blob = (flip: boolean): ViewStyle => ({
    flex: 1,
    borderTopLeftRadius: size * (flip ? 0.58 : 0.42),
    borderTopRightRadius: size * (flip ? 0.42 : 0.58),
    borderBottomRightRadius: size * (flip ? 0.6 : 0.45),
    borderBottomLeftRadius: size * (flip ? 0.4 : 0.55),
    overflow: "hidden",
  });
  return (
    <>
      <Layer out={size * 0.16} rotate={range(slow, SPIN_BACK)} scale={range(swell, [1.16, 1.02])} opacity={0.5}>
        <LinearGradient colors={[palette.ring2, palette.ring]} start={{ x: 1, y: 0 }} end={{ x: 0, y: 1 }} style={blob(true)} />
      </Layer>
      <Layer out={size * 0.02} rotate={range(fast, SPIN)} scale={range(swell, [1.12, 1.26])} opacity={0.88}>
        <LinearGradient colors={[palette.ring, palette.ring2]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={blob(false)} />
      </Layer>
    </>
  );
}

function Winter({ size, radius, palette, still }: EffectProps) {
  const frost = useLoop(2400, still, { alternate: true, easing: Easing.inOut(Easing.quad) });
  const snow = useLoop(4000, still, { alternate: true, easing: Easing.inOut(Easing.quad) });
  return (
    <>
      <Layer out={size * 0.3} opacity={range(frost, [0.3, 0.75])}>
        <Glow id="call-frost" color="#A0D7FF" strength={0.6} />
      </Layer>
      <Layer out={size * 0.48} scale={range(snow, [0.8, 1.2])} opacity={range(snow, [0.5, 1])}>
        <Dots dots={[[20, 20, 1, "#FFFFFF"], [78, 34, 0.8, "#FFFFFF"], [40, 88, 1.1, "#FFFFFF"], [90, 80, 0.7, "#FFFFFF"], [8, 62, 0.8, "#FFFFFF"], [62, 8, 0.9, "#FFFFFF"]]} />
      </Layer>
      <Layer
        out={9}
        opacity={range(frost, [0.55, 1])}
        style={{ borderRadius: radius + 9, borderWidth: 1.5, borderColor: withAlpha(palette.ring, 0.9), backgroundColor: "rgba(205,236,255,0.10)" }}
      />
    </>
  );
}

function War({ size, palette, still }: EffectProps) {
  const sweep = useLoop(2400, still);
  const blink = useLoop(1200, still);
  return (
    <>
      <Layer out={size * 0.34} rotate={range(sweep, SPIN)}>
        <Sweep color={palette.ring} />
      </Layer>
      <Layer out={size * 0.16} opacity={range(blink, BLINK_OUT, BLINK_IN)}>
        <DashedCircle color={withAlpha(palette.ring, 0.7)} dash="2.4 2.4" />
      </Layer>
    </>
  );
}

const NEON = ["#FF3D81", "#FFB300", "#00E5FF", "#7C4DFF", "#FF3D81"];
function Osaka({ radius, still }: EffectProps) {
  const spin = useLoop(3200, still);
  const flicker = useLoop(1600, still, { alternate: true, easing: Easing.inOut(Easing.quad) });
  return (
    <>
      <Layer out={0} opacity={range(flicker, [0.3, 0.6])}>
        <TravellingRim out={13} radius={radius} colors={NEON} spin={range(spin, SPIN)} />
      </Layer>
      <TravellingRim out={4} radius={radius} colors={NEON} spin={range(spin, SPIN)} />
    </>
  );
}

function Jungle({ size, palette, still }: EffectProps) {
  const glow = useLoop(3000, still, { alternate: true, easing: Easing.inOut(Easing.quad) });
  const fly = useLoop(11000, still);
  const blink = useLoop(1400, still, { alternate: true, easing: Easing.inOut(Easing.quad) });
  return (
    <>
      <Layer out={size * 0.34} scale={range(glow, [0.8, 1.2])} opacity={range(glow, [0.5, 1])}>
        <Glow id="call-jungle" color={palette.ring} strength={0.6} />
      </Layer>
      <Layer out={size * 0.48} rotate={range(fly, SPIN)} opacity={range(blink, [0.45, 1])}>
        <Dots dots={[[14, 40, 1.5, palette.ring2], [86, 26, 1.2, palette.ring2], [66, 92, 1.5, "#C6FF5E"], [30, 8, 1, palette.ring2], [94, 70, 0.9, "#C6FF5E"]]} />
      </Layer>
    </>
  );
}

function Hacker({ palette, still }: EffectProps) {
  const blink = useLoop(1000, still);
  const step = useLoop(1600, still);
  const stepped = [0, 0.166, 0.167, 0.333, 0.334, 0.5, 0.501, 0.666, 0.667, 0.833, 0.834, 1];
  return (
    <>
      <Layer
        out={9}
        scale={range(step, [1, 1, 1.15, 1.15, 1.3, 1.3, 1.45, 1.45, 1.6, 1.6, 1.75, 1.75], stepped)}
        opacity={range(step, [0.55, 0.55, 0.44, 0.44, 0.33, 0.33, 0.22, 0.22, 0.11, 0.11, 0, 0], stepped)}
        style={{ borderRadius: 2, borderWidth: 1, borderStyle: "dashed", borderColor: withAlpha(palette.ring, 0.6) }}
      />
      <Layer out={9} opacity={range(blink, BLINK_OUT, BLINK_IN)} style={{ borderRadius: 2, borderWidth: 1.5, borderColor: palette.ring }} />
    </>
  );
}

function Horror({ size, radius, palette, still }: EffectProps) {
  const beat = useLoop(1500, still, { easing: Easing.inOut(Easing.quad) });
  const scale = range(beat, [1, 1.3, 1.08, 1.24, 1, 1], BEAT_IN);
  const opacity = range(beat, [0.45, 0.95, 0.6, 0.85, 0.45, 0.45], BEAT_IN);
  return (
    <>
      <Layer out={size * 0.3} scale={scale} opacity={opacity}>
        <Glow id="call-horror" color={palette.ring} strength={0.85} />
      </Layer>
      <Layer scale={scale} opacity={opacity} style={{ borderRadius: radius, borderWidth: 1.5, borderColor: withAlpha(palette.ring, 0.75) }} />
    </>
  );
}

const EFFECTS: Partial<Record<AppThemeName, React.ComponentType<EffectProps>>> = {
  immersive: Immersive,
  minimal: Minimal,
  glass: Glass,
  cosmic: Cosmic,
  hazy: Hazy,
  swarms: Swarms,
  lavalamp: LavaLamp,
  winter: Winter,
  war: War,
  osaka: Osaka,
  jungle: Jungle,
  hacker: Hacker,
  horror: Horror,
};

const CallRings: React.FC<{ theme: AppThemeName; size: number; radius: number; palette: StagePalette }> = ({ theme, size, radius, palette }) => {
  const still = useReduceMotion();
  const props: EffectProps = { size, radius, palette, still };
  if (theme === "system-light") return <Outline {...props} filled />;
  if (theme === "island") return <Outline {...props} round period={2600} />;
  const Effect = EFFECTS[theme];
  return Effect ? <Effect {...props} /> : <Outline {...props} />;
};

export default React.memo(CallRings);
