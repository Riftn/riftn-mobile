import React, { createContext, memo, useContext, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useAmbientMotion } from "../../hooks/useAmbientMotion";
import { StyleSheet, View, type LayoutChangeEvent } from "react-native";
import { Image } from "expo-image";
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";
import Svg, {
  Circle,
  ClipPath,
  Defs,
  Ellipse,
  G,
  Line,
  LinearGradient,
  Mask,
  Path,
  Pattern,
  RadialGradient,
  Rect,
  Stop,
} from "react-native-svg";
import { isLowEndDevice } from "../../libs/deviceTier";
import { parsePostBg, postBgVariant, type PostBg, type PostBgPalette } from "../../libs/postBackgrounds";
import BlurSafeImage from "../common/BlurSafeImage";

/**
 * Profile post backgrounds (libs/postBackgrounds.ts), drawn natively: the same
 * backdrops web draws in CSS, in whatever colours the owner picked. Still ones
 * are one SVG. Moving ones move a few layers on the UI thread (transform and
 * opacity only), loop without a visible seam, hold a still frame under Reduce
 * motion and on low-end phones, and stop when the list unmounts the cell.
 * Nothing flashes: every brightness change takes 2s or longer.
 */

/** Text colours on each tone of backdrop. */
export const POST_BG_INK = {
  dark: { ink: "#FFFFFF", sub: "rgba(255,255,255,0.72)" },
  light: { ink: "#17161B", sub: "rgba(23,22,27,0.66)" },
} as const;

// ---- which backdrop a profile shows -------------------------------------------------

/** A save shows at once everywhere that profile is open, before any refetch. */
const overrides = new Map<string, PostBg | null>();
const listeners = new Set<() => void>();
let version = 0;
export function setPostBgOverride(address: string, bg: PostBg | null) {
  overrides.set(address.toLowerCase(), bg);
  version++;
  listeners.forEach((l) => l());
}
const subscribe = (l: () => void) => { listeners.add(l); return () => listeners.delete(l); };
const snapshot = () => version;

/** The backdrop for one profile: a fresh save wins, else the account's customs. */
export function useResolvedPostBg(address: string | undefined, customs: Record<string, unknown> | null | undefined): PostBg | null {
  useSyncExternalStore(subscribe, snapshot, snapshot);
  const key = address?.toLowerCase();
  if (key && overrides.has(key)) return overrides.get(key) ?? null;
  return parsePostBg(customs);
}

export const ProfilePostBgContext = createContext<PostBg | null>(null);
export const useProfilePostBg = () => useContext(ProfilePostBgContext);

/** The profile picture of the profile on screen, for the backdrop that blurs it (Profile Echo). */
export const ProfilePostBgArtContext = createContext<string | null>(null);

// ---- helpers ---------------------------------------------------------------------

const still = isLowEndDevice();

function useLoop(duration: number, mode: "loop" | "alternate", active: boolean) {
  const reduce = useReducedMotion();
  const p = useSharedValue(0);
  const started = useRef(false);
  const run = active && !reduce && !still;
  useEffect(() => {
    if (!run) {
      cancelAnimation(p);
      // Paused (scrolling, another screen): hold the frame it is on. Never
      // moving at all (reduced motion, low-end phone): a resting frame.
      if (!started.current) p.value = 0.35;
      return;
    }
    const easing = mode === "loop" ? Easing.linear : Easing.inOut(Easing.sin);
    // Pick up from the held frame instead of jumping back to the start.
    const from = started.current ? Math.min(1, Math.max(0, p.value)) : 0;
    started.current = true;
    const rest = withTiming(1, { duration: Math.max(1, (1 - from) * duration), easing });
    p.value = from;
    p.value = mode === "loop"
      ? withSequence(rest, withTiming(0, { duration: 0 }), withRepeat(withTiming(1, { duration, easing }), -1, false))
      : withSequence(rest, withRepeat(withTiming(0, { duration, easing }), -1, true));
    return () => cancelAnimation(p);
  }, [run, duration, mode, p]);
  return p;
}

const fill = StyleSheet.absoluteFillObject;
// An svg with a viewBox keeps its own shape unless it is told both sizes.
const svgFill = { ...fill, width: "100%", height: "100%" } as const;
const box = (left: number, top: number, width: number, height: number) => ({ position: "absolute" as const, left, top, width, height });
const useUid = () => useId().replace(/[^a-zA-Z0-9]/g, "");

/** Blend two #rrggbb colours (t = share of b). */
export function mix(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const ch = (s: number) => Math.round(((pa >> s) & 255) * (1 - t) + ((pb >> s) & 255) * t);
  return "#" + ((1 << 24) | (ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).slice(1);
}

/** A full-size radial glow. */
function Rad({ c, o = 1, cx = "50%", cy = "50%", rx = "50%", ry = "50%", end = 1, base }: { c: string; o?: number; cx?: string; cy?: string; rx?: string; ry?: string; end?: number; base?: string }) {
  const u = useUid();
  return (
    <Svg style={svgFill} preserveAspectRatio="none" viewBox="0 0 100 100">
      <Defs><RadialGradient id={u} cx={cx} cy={cy} rx={rx} ry={ry}><Stop offset="0" stopColor={c} stopOpacity={o} /><Stop offset={end} stopColor={c} stopOpacity="0" /></RadialGradient></Defs>
      {base && <Rect width="100" height="100" fill={base} />}
      <Rect width="100" height="100" fill={`url(#${u})`} />
    </Svg>
  );
}

/** A full-size linear gradient: stops are [offset, colour, opacity]. */
function Lin({ stops, x1 = "0", y1 = "0", x2 = "0", y2 = "1" }: { stops: [number, string, number?][]; x1?: string; y1?: string; x2?: string; y2?: string }) {
  const u = useUid();
  return (
    <Svg style={svgFill} preserveAspectRatio="none" viewBox="0 0 100 100">
      <Defs><LinearGradient id={u} x1={x1} y1={y1} x2={x2} y2={y2}>{stops.map(([o, c, a], i) => <Stop key={i} offset={o} stopColor={c} stopOpacity={a ?? 1} />)}</LinearGradient></Defs>
      <Rect width="100" height="100" fill={`url(#${u})`} />
    </Svg>
  );
}

/** Soft round glow that fills its box. */
function Glow({ color, opacity = 0.55, end = 1 }: { color: string; opacity?: number; end?: number }) {
  const u = useUid();
  return (
    <Svg style={svgFill} viewBox="0 0 100 100">
      <Defs><RadialGradient id={u} cx="50%" cy="50%" r="50%"><Stop offset="0" stopColor={color} stopOpacity={opacity} /><Stop offset={end} stopColor={color} stopOpacity="0" /></RadialGradient></Defs>
      <Circle cx="50" cy="50" r="50" fill={`url(#${u})`} />
    </Svg>
  );
}

/** A tile repeated over the whole box. */
function Tile({ w, h, children }: { w: number; h: number; children: React.ReactNode }) {
  const u = useUid();
  return (
    <Svg style={svgFill}>
      <Defs><Pattern id={u} width={w} height={h} patternUnits="userSpaceOnUse">{children}</Pattern></Defs>
      <Rect width="100%" height="100%" fill={`url(#${u})`} />
    </Svg>
  );
}

function Dots({ color, size, dots, opacity = 1 }: { color: string; size: number; dots: [number, number, number][]; opacity?: number }) {
  return <Tile w={size} h={size}>{dots.map(([x, y, r], i) => <Circle key={i} cx={x} cy={y} r={r} fill={color} opacity={opacity} />)}</Tile>;
}

/** Soft elliptical pools of colour, in % of the box. */
function Pools({ items }: { items: { cx: number; cy: number; rx: number; ry: number; c: string; o: number }[] }) {
  const u = useUid();
  return (
    <Svg style={svgFill} preserveAspectRatio="none" viewBox="0 0 100 100">
      <Defs>
        {items.map((it, i) => (
          <RadialGradient key={i} id={`${u}${i}`} cx="50%" cy="50%" r="50%"><Stop offset="0" stopColor={it.c} stopOpacity={it.o} /><Stop offset="1" stopColor={it.c} stopOpacity="0" /></RadialGradient>
        ))}
      </Defs>
      {items.map((it, i) => <Ellipse key={i} cx={it.cx} cy={it.cy} rx={it.rx} ry={it.ry} fill={`url(#${u}${i})`} />)}
    </Svg>
  );
}

const TAU = Math.PI * 2;

// ---- still ---------------------------------------------------------------------

const CARD_COLORS = [["#ff5f6d", "#ffb157"], ["#4b5bff", "#b56bff"], ["#00b894", "#0a6cff"], ["#f7367b", "#7a3cff"], ["#0e9f6e", "#b6d94c"], ["#ff7a18", "#d6336c"], ["#1f6feb", "#22c1c3"], ["#6d3bd2", "#e0508f"]] as const;
const ECHO_TURN = ["0deg", "120deg", "240deg", "0deg"] as const;

function Still({ id, c, n = 0, art }: { id: string; c: PostBgPalette; n?: number; art?: string | null }) {
  const u = useUid();
  const [c1, c2, c3] = c;
  switch (id) {
    case "echo":
      return (
        <View style={[fill, { backgroundColor: "#1c2028" }]}>
          {art ? (
            <BlurSafeImage source={{ uri: art }} contentFit="cover" blurRadius={24} cachePolicy="memory-disk"
              style={[fill, { width: "100%", height: "100%", transform: [{ rotate: ECHO_TURN[n % 4] }, { scaleX: n % 4 === 3 ? -1.7 : 1.7 }, { scaleY: 1.7 }] }]} />
          ) : (
            <Svg style={svgFill} preserveAspectRatio="none" viewBox="0 0 100 100">
              <Defs>
                <RadialGradient id={u + "a"} cx="30%" cy="30%" rx="45%" ry="45%"><Stop offset="0" stopColor="#e9b36b" /><Stop offset="1" stopColor="#e9b36b" stopOpacity="0" /></RadialGradient>
                <RadialGradient id={u + "b"} cx="75%" cy="35%" rx="50%" ry="50%"><Stop offset="0" stopColor="#3fb6a8" /><Stop offset="1" stopColor="#3fb6a8" stopOpacity="0" /></RadialGradient>
                <RadialGradient id={u + "c"} cx="55%" cy="80%" rx="55%" ry="55%"><Stop offset="0" stopColor="#b0486e" /><Stop offset="1" stopColor="#b0486e" stopOpacity="0" /></RadialGradient>
              </Defs>
              <G rotation={n * 120} origin="50, 50"><Rect x="-30" y="-30" width="160" height="160" fill="#2a2f3a" /><Rect x="-30" y="-30" width="160" height="160" fill={`url(#${u}a)`} /><Rect x="-30" y="-30" width="160" height="160" fill={`url(#${u}b)`} /><Rect x="-30" y="-30" width="160" height="160" fill={`url(#${u}c)`} /></G>
            </Svg>
          )}
          <Lin stops={[[0, "#06070a", 0.38], [1, "#06070a", 0.72]]} />
        </View>
      );
    case "cards": {
      const [from, to] = CARD_COLORS[n % CARD_COLORS.length];
      return <Lin x2="0.6" stops={[[0, from], [1, to]]} />;
    }
    case "deck": {
      const look = n % 3;
      return (
        <Svg style={svgFill}>
          <Defs>
            <Pattern id={u + "p"} width="9" height="9" patternUnits="userSpaceOnUse">
              {look === 0 ? <Circle cx="4.5" cy="4.5" r="1" fill={c2} /> : look === 1 ? <Path d="M-1 10 L10 -1" stroke={c2} strokeWidth="1" /> : <Path d="M0 4.5 H9" stroke={c2} strokeWidth="1" />}
            </Pattern>
            <LinearGradient id={u + "f"} x1={look === 1 ? "0" : "1"} y1="0" x2={look === 1 ? "1" : "0"} y2="1"><Stop offset="0" stopColor={c1} stopOpacity={look === 1 ? "1" : "0"} /><Stop offset="0.75" stopColor={c1} stopOpacity={look === 1 ? "0" : "1"} /></LinearGradient>
          </Defs>
          <Rect width="100%" height="100%" fill={c1} /><Rect width="100%" height="100%" fill={`url(#${u}p)`} opacity="0.2" /><Rect width="100%" height="100%" fill={`url(#${u}f)`} />
          <Rect width="100%" height="2" fill={c2} opacity="0.7" />
        </Svg>
      );
    }
    case "ink":
      return (
        <View style={[fill, { backgroundColor: c1 }]}>
          <Rad c={c2} cx="8%" cy="0%" rx="80%" ry="70%" />
          <Rad c={c3} cx="100%" cy="100%" rx="70%" ry="70%" />
        </View>
      );
    case "news":
      return (
        <Svg style={svgFill}>
          <Defs>
            <Pattern id={u + "g"} width="9" height="9" patternUnits="userSpaceOnUse">
              <Rect x="1" y="2" width="1" height="1" fill={c2} opacity="0.1" /><Rect x="6" y="5" width="1" height="1" fill={c2} opacity="0.12" /><Rect x="3" y="7" width="1" height="1" fill={c2} opacity="0.08" />
            </Pattern>
            <Pattern id={u + "l"} width="22" height="22" patternUnits="userSpaceOnUse"><Rect width="22" height="1" fill={c2} opacity="0.05" /></Pattern>
          </Defs>
          <Rect width="100%" height="100%" fill={c1} /><Rect width="100%" height="100%" fill={`url(#${u}g)`} /><Rect width="100%" height="100%" fill={`url(#${u}l)`} />
        </Svg>
      );
    case "split":
      return (
        <Svg style={svgFill} preserveAspectRatio="none" viewBox="0 0 100 100">
          <Rect width="100" height="100" fill={c2} /><Path d="M0 0 H62 L38 100 H0 Z" fill={c1} />
        </Svg>
      );
    case "blue":
      return (
        <Svg style={svgFill}>
          <Defs>
            <Pattern id={u + "s"} width="12" height="12" patternUnits="userSpaceOnUse"><Path d="M12 0V12H0" stroke={c2} strokeOpacity="0.05" fill="none" /></Pattern>
            <Pattern id={u + "l"} width="48" height="48" patternUnits="userSpaceOnUse"><Path d="M48 0V48H0" stroke={c2} strokeOpacity="0.14" fill="none" /></Pattern>
          </Defs>
          <Rect width="100%" height="100%" fill={c1} /><Rect width="100%" height="100%" fill={`url(#${u}s)`} /><Rect width="100%" height="100%" fill={`url(#${u}l)`} />
        </Svg>
      );
    case "terra":
      return (
        <Svg style={svgFill}>
          <Defs>
            <Pattern id={u + "t"} width="60" height="56" patternUnits="userSpaceOnUse">
              <Circle cx="10" cy="12" r="3" fill={c2} /><Circle cx="42" cy="34" r="2.5" fill={c3} /><Circle cx="28" cy="50" r="4" fill={mix(c2, c3, 0.5)} /><Circle cx="52" cy="8" r="2" fill={mix(c1, "#2c2c34", 0.7)} /><Circle cx="6" cy="40" r="5" fill={mix(c3, c1, 0.55)} />
            </Pattern>
            <LinearGradient id={u + "band"} x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={c1} stopOpacity="0" /><Stop offset="0.25" stopColor={c1} stopOpacity="0.78" /><Stop offset="0.78" stopColor={c1} stopOpacity="0.78" /><Stop offset="1" stopColor={c1} stopOpacity="0" />
            </LinearGradient>
          </Defs>
          <Rect width="100%" height="100%" fill={c1} /><Rect width="100%" height="100%" fill={`url(#${u}t)`} /><Rect width="100%" height="100%" fill={`url(#${u}band)`} />
        </Svg>
      );
    case "half":
      return (
        <Svg style={svgFill}>
          <Defs>
            <Pattern id={u + "d"} width="10" height="10" patternUnits="userSpaceOnUse"><Circle cx="5" cy="5" r="1.8" fill={c2} /></Pattern>
            <LinearGradient id={u + "f"} x1="1" y1="0" x2="0.3" y2="0.9"><Stop offset="0" stopColor="#fff" /><Stop offset="1" stopColor="#fff" stopOpacity="0" /></LinearGradient>
            <Mask id={u + "m"}><Rect width="100%" height="100%" fill={`url(#${u}f)`} /></Mask>
          </Defs>
          <Rect width="100%" height="100%" fill={c1} /><Rect width="100%" height="100%" fill={`url(#${u}d)`} mask={`url(#${u}m)`} />
        </Svg>
      );
    case "topo":
      return (
        <Svg style={svgFill}>
          <Rect width="100%" height="100%" fill={c1} />
          <G stroke={c2} strokeOpacity="0.11" fill="none">
            {Array.from({ length: 22 }, (_, i) => <Circle key={i} cx="18%" cy="120%" r={(i + 1) * 17} />)}
          </G>
          <G stroke={c2} strokeOpacity="0.07" fill="none">
            {Array.from({ length: 14 }, (_, i) => <Circle key={i} cx="110%" cy="-10%" r={(i + 1) * 23} />)}
          </G>
        </Svg>
      );
    case "velvet":
      return (
        <Svg style={svgFill} preserveAspectRatio="none" viewBox="0 0 100 100">
          <Defs>
            <RadialGradient id={u + "v"} cx="50%" cy="0%" rx="100%" ry="100%"><Stop offset="0" stopColor={c2} /><Stop offset="0.72" stopColor={c1} /></RadialGradient>
            <LinearGradient id={u + "sh"} x1="0" y1="0" x2="1" y2="0.5"><Stop offset="0.3" stopColor="#fff" stopOpacity="0" /><Stop offset="0.45" stopColor="#fff" stopOpacity="0.07" /><Stop offset="0.6" stopColor="#fff" stopOpacity="0" /></LinearGradient>
          </Defs>
          <Rect width="100" height="100" fill={`url(#${u}v)`} /><Rect width="100" height="100" fill={`url(#${u}sh)`} />
        </Svg>
      );
    case "sorbet":
      return <Lin x2="0.8" stops={[[0, c1], [0.52, c2], [1, c3]]} />;
    case "carbon":
      return (
        <Svg style={svgFill}>
          <Defs>
            <Pattern id={u + "c"} width="10" height="10" patternUnits="userSpaceOnUse">
              <Rect width="5" height="5" fill={c2} /><Rect x="5" y="5" width="5" height="5" fill={c2} /><Rect x="5" width="5" height="5" fill={c3} /><Rect y="5" width="5" height="5" fill={c3} />
            </Pattern>
            <LinearGradient id={u + "sh"} x1="0" y1="0" x2="0.4" y2="1"><Stop offset="0" stopColor="#fff" stopOpacity="0.1" /><Stop offset="0.4" stopColor="#fff" stopOpacity="0" /></LinearGradient>
          </Defs>
          <Rect width="100%" height="100%" fill={c1} /><Rect width="100%" height="100%" fill={`url(#${u}c)`} /><Rect width="100%" height="100%" fill={`url(#${u}sh)`} />
        </Svg>
      );
    default:
      return null;
  }
}

/** Your own picture or GIF, under a scrim so the words always read. */
function Photo({ uri }: { uri: string }) {
  return (
    <View style={[fill, { backgroundColor: "#111" }]}>
      <Image source={{ uri }} contentFit="cover" cachePolicy="memory-disk" style={svgFill} autoplay />
      <Lin stops={[[0, "#000", 0.42], [0.4, "#000", 0.22], [1, "#000", 0.5]]} />
    </View>
  );
}

// ---- moving --------------------------------------------------------------------

/** Darker edges: clear (or `base`) inside `start`, `to` at the corners. */
function Vignette({ color, start, to, base = 0 }: { color: string; start: number; to: number; base?: number }) {
  const u = useUid();
  return (
    <Svg style={svgFill} preserveAspectRatio="none" viewBox="0 0 100 100">
      <Defs><RadialGradient id={u} cx="50%" cy="50%" r="71%"><Stop offset={start} stopColor={color} stopOpacity={base} /><Stop offset="1" stopColor={color} stopOpacity={to} /></RadialGradient></Defs>
      <Rect width="100" height="100" fill={`url(#${u})`} />
    </Svg>
  );
}

type MP = { c: PostBgPalette; w: number; h: number; active: boolean };
const A = Animated.View;

function Aurora({ c: [c1, c2, c3], w, h, active }: MP) {
  const p = useLoop(19000, "alternate", active);
  const q = useLoop(27000, "alternate", active);
  const r = useLoop(23000, "alternate", active);
  const a = useAnimatedStyle(() => ({ transform: [{ translateX: (-0.09 + 0.19 * p.value) * w }, { translateY: -0.04 * h * Math.sin(p.value * Math.PI) }, { skewX: `${-14 + 22 * p.value}deg` }, { scaleY: 0.88 + 0.16 * Math.sin(p.value * Math.PI) }] }));
  const b = useAnimatedStyle(() => ({ transform: [{ translateX: (0.08 - 0.18 * q.value) * w }, { skewX: `${10 - 18 * q.value}deg` }, { scaleY: 1.04 - 0.12 * Math.sin(q.value * Math.PI) }] }));
  const d = useAnimatedStyle(() => ({ transform: [{ translateX: (-0.06 + 0.13 * r.value) * w }, { translateY: (0.03 - 0.07 * r.value) * h }, { scale: 0.9 + 0.25 * r.value }] }));
  const big = box(-0.45 * w, -0.25 * h, 1.9 * w, 1.5 * h);
  return (
    <>
      <View style={[fill, { backgroundColor: c1 }]}><Rad c={mix(c1, c2, 0.22)} cy="115%" rx="65%" ry="70%" end={1} /></View>
      <Dots color="#ffffff" size={90} opacity={0.5} dots={[[10, 16, 0.8], [60, 10, 0.7], [76, 28, 0.9], [30, 6, 0.7], [44, 24, 0.7]]} />
      <A style={[big, a]}><Pools items={[{ cx: 32, cy: 46, rx: 9, ry: 52, c: c2, o: 0.75 }, { cx: 47, cy: 38, rx: 6, ry: 42, c: c2, o: 0.55 }, { cx: 70, cy: 50, rx: 11, ry: 58, c: c2, o: 0.45 }]} /></A>
      <A style={[big, b]}><Pools items={[{ cx: 40, cy: 40, rx: 8, ry: 48, c: c3, o: 0.7 }, { cx: 62, cy: 44, rx: 12, ry: 55, c: c3, o: 0.5 }]} /></A>
      <A style={[big, d]}><Pools items={[{ cx: 50, cy: 62, rx: 22, ry: 30, c: mix(c2, c3, 0.5), o: 0.4 }]} /></A>
      <Lin stops={[[0.4, c1, 0], [1, c1, 0.55]]} />
    </>
  );
}

function Blob({ color, size }: { color: string; size: number }) {
  const u = useUid();
  return (
    <Svg style={{ width: size, height: size }} viewBox="0 0 100 100">
      <Defs><RadialGradient id={u} cx="50%" cy="50%" r="50%" fx="38%" fy="34%"><Stop offset="0" stopColor={mix(color, "#ffffff", 0.6)} /><Stop offset="0.46" stopColor={color} /><Stop offset="0.82" stopColor={color} stopOpacity="0.45" /><Stop offset="1" stopColor={color} stopOpacity="0" /></RadialGradient></Defs>
      <Circle cx="50" cy="50" r="50" fill={`url(#${u})`} />
    </Svg>
  );
}

function Lava({ c: [c1, c2, c3], w, h, active }: MP) {
  const m = Math.min(w, h);
  const p1 = useLoop(17000, "alternate", active);
  const p2 = useLoop(23000, "alternate", active);
  const p3 = useLoop(13000, "alternate", active);
  const p4 = useLoop(29000, "alternate", active);
  const s1 = useAnimatedStyle(() => ({ transform: [{ translateX: 0.12 * Math.sin(p1.value * Math.PI) * m * 0.62 }, { translateY: -0.92 * p1.value * m * 0.62 }, { scaleX: 1 - 0.08 * Math.sin(p1.value * Math.PI) }, { scaleY: 0.94 + 0.14 * Math.sin(p1.value * Math.PI) }] }));
  const s2 = useAnimatedStyle(() => ({ transform: [{ translateX: -0.18 * Math.sin(p2.value * Math.PI) * m * 0.52 }, { translateY: 1.18 * p2.value * m * 0.52 }, { scale: 1 + 0.1 * Math.sin(p2.value * Math.PI) }] }));
  const s3 = useAnimatedStyle(() => ({ transform: [{ translateX: -0.4 * p3.value * m * 0.3 }, { translateY: -1.9 * p3.value * m * 0.3 }, { scale: 1 + 0.2 * p3.value }] }));
  const s4 = useAnimatedStyle(() => ({ transform: [{ translateX: 1.2 * p4.value * m * 0.24 }, { translateY: 2.6 * p4.value * m * 0.24 }, { scale: 1 - 0.15 * p4.value }] }));
  return (
    <>
      <View style={[fill, { backgroundColor: c1 }]}><Rad c={mix(c1, c2, 0.35)} cy="110%" rx="90%" ry="60%" /></View>
      <A style={[box(0.06 * w, 0.55 * h, 0.62 * m, 0.62 * m), s1]}><Blob color={c2} size={0.62 * m} /></A>
      <A style={[box(w - 0.02 * w - 0.52 * m, -0.12 * h, 0.52 * m, 0.52 * m), s2]}><Blob color={c3} size={0.52 * m} /></A>
      <A style={[box(0.52 * w, 0.7 * h, 0.3 * m, 0.3 * m), s3]}><Blob color={c2} size={0.3 * m} /></A>
      <A style={[box(0.18 * w, 0.04 * h, 0.24 * m, 0.24 * m), s4]}><Blob color={c3} size={0.24 * m} /></A>
      <Lin x2="1" y2="0" stops={[[0.08, "#fff", 0], [0.14, "#fff", 0.08], [0.22, "#fff", 0], [0.78, "#fff", 0], [0.86, "#fff", 0.05], [0.92, "#fff", 0]]} />
    </>
  );
}

function Stars({ c: [c1, c2, c3], w, h, active }: MP) {
  const p = useLoop(30000, "loop", active);
  const q = useLoop(34000, "loop", active);
  const t = useLoop(4500, "alternate", active);
  const s = useLoop(11000, "loop", active);
  const a = useAnimatedStyle(() => ({ transform: [{ translateY: -p.value * 110 }] }));
  const b = useAnimatedStyle(() => ({ opacity: 0.55 + 0.45 * t.value, transform: [{ translateY: -q.value * 240 }] }));
  const shoot = useAnimatedStyle(() => {
    const v = s.value;
    const k = Math.min(1, v / 0.08);
    return { opacity: v < 0.02 ? v / 0.02 * 0.9 : v < 0.08 ? 0.9 * (1 - (v - 0.02) / 0.06) : 0, transform: [{ rotate: "-24deg" }, { translateX: -k * 0.9 * Math.min(w, h) }, { scaleX: 0.2 + 0.8 * k }] };
  });
  const len = 0.32 * Math.min(w, h);
  return (
    <>
      <View style={[fill, { backgroundColor: c1 }]}><Rad c={c2} cy="120%" rx="120%" ry="80%" end={0.7} /></View>
      <A style={[box(0, 0, w, h + 110), a]}><Dots color={c3} size={110} opacity={0.8} dots={[[14, 22, 0.8], [76, 94, 0.7], [92, 40, 0.9], [40, 78, 0.7], [104, 6, 0.6], [58, 52, 0.7], [26, 100, 0.6]]} /></A>
      <A style={[box(0, 0, w, h + 240), b]}><Dots color={c3} size={240} dots={[[30, 50, 1.2], [170, 150, 1.1], [110, 210, 1.4], [200, 30, 1]]} /></A>
      <A style={[box(w - 0.08 * w - len, 0.14 * h, len, 1.5), { transformOrigin: "right" } as any, shoot]}><Lin x2="1" y2="0" stops={[[0, c3, 0], [1, c3, 1]]} /></A>
    </>
  );
}

function Rain({ c: [c1, c2, c3], w, h, active }: MP) {
  const p = useLoop(1100, "loop", active);
  const q = useLoop(1700, "loop", active);
  const g = useLoop(6000, "alternate", active);
  const a = useAnimatedStyle(() => ({ transform: [{ rotate: "10deg" }, { translateY: -120 + p.value * 120 }] }));
  const b = useAnimatedStyle(() => ({ transform: [{ rotate: "10deg" }, { translateY: -80 + q.value * 80 }] }));
  const glow = useAnimatedStyle(() => ({ opacity: 0.65 + 0.35 * g.value }));
  const big = box(-0.3 * w, -0.4 * h - 120, 1.6 * w, 1.8 * h + 240);
  return (
    <>
      <Lin stops={[[0, mix(c1, c3, 0.12)], [1, c1]]} />
      <A style={[fill, glow]}><Pools items={[{ cx: 22, cy: 70, rx: 16, ry: 16 * w / h, c: c2, o: 0.4 }, { cx: 70, cy: 24, rx: 11, ry: 11 * w / h, c: c2, o: 0.45 }, { cx: 84, cy: 76, rx: 20, ry: 20 * w / h, c: c3, o: 0.25 }, { cx: 44, cy: 40, rx: 9, ry: 9 * w / h, c: c2, o: 0.3 }]} /></A>
      <A style={[big, a]}><Tile w={90} h={120}><Line x1="10" y1="2" x2="10" y2="38" stroke={c3} strokeOpacity="0.45" strokeWidth="1" /><Line x1="34" y1="56" x2="34" y2="84" stroke={c3} strokeOpacity="0.4" strokeWidth="1" /><Line x1="58" y1="20" x2="58" y2="60" stroke={c3} strokeOpacity="0.35" strokeWidth="1" /><Line x1="76" y1="84" x2="76" y2="108" stroke={c3} strokeOpacity="0.4" strokeWidth="1" /></Tile></A>
      <A style={[big, { opacity: 0.6 }, b]}><Tile w={60} h={80}><Line x1="14" y1="0" x2="14" y2="20" stroke={c3} strokeOpacity="0.4" strokeWidth="0.8" /><Line x1="44" y1="40" x2="44" y2="58" stroke={c3} strokeOpacity="0.35" strokeWidth="0.8" /></Tile></A>
      <Tile w={53} h={61}><Circle cx="17" cy="30" r="2.6" fill="none" stroke="#fff" strokeOpacity="0.14" /><Circle cx="16" cy="29" r="0.8" fill="#fff" opacity="0.35" /><Circle cx="40" cy="8" r="0.7" fill="#fff" opacity="0.28" /></Tile>
      <Lin stops={[[0.55, c1, 0], [1, c1, 0.6]]} />
    </>
  );
}

function Drive({ c: [c1, c2, c3], w, h, active }: MP) {
  const u = useUid();
  const p = useLoop(1600, "loop", active);
  const a = useAnimatedStyle(() => ({ transform: [{ perspective: 160 }, { rotateX: "62deg" }, { translateY: p.value * 44 }] }));
  const sun = 0.46 * Math.min(w, h);
  const horizon = 0.58 * h;
  return (
    <>
      <Lin stops={[[0, c1], [0.999, mix(c1, c2, 0.3)]]} />
      <View style={box(0, 0, w, horizon)}><Dots color="#ffffff" size={120} opacity={0.5} dots={[[24, 20, 0.6], [84, 12, 0.6], [100, 40, 0.6], [48, 8, 0.6]]} /></View>
      <View style={box(w / 2 - sun / 2, horizon - sun / 2, sun, sun / 2)}>
        <Svg width={sun} height={sun / 2} viewBox="0 0 100 50">
          <Defs>
            <LinearGradient id={u + "s"} x1="0" y1="0" x2="0" y2="1"><Stop offset="0" stopColor={c3} /><Stop offset="1" stopColor={c2} /></LinearGradient>
            <ClipPath id={u + "c"}><Rect x="0" y="0" width="100" height="24" /><Rect x="0" y="26" width="100" height="6" /><Rect x="0" y="34.5" width="100" height="5" /><Rect x="0" y="42" width="100" height="4" /><Rect x="0" y="48" width="100" height="2" /></ClipPath>
          </Defs>
          <Circle cx="50" cy="50" r="50" fill={`url(#${u}s)`} clipPath={`url(#${u}c)`} />
        </Svg>
      </View>
      <Svg style={box(0, horizon - 0.16 * h, w, 0.16 * h)} viewBox="0 0 100 100" preserveAspectRatio="none">
        <Path d="M0 100 L0 60 L9 30 L17 62 L26 18 L35 55 L42 40 L50 70 L58 36 L66 58 L76 10 L86 50 L93 34 L100 56 L100 100 Z" fill={mix(c1, "#000000", 0.15)} opacity="0.9" />
      </Svg>
      <View style={box(0, horizon, w, h - horizon)}>
        <View style={[fill, { backgroundColor: c1 }]} />
        <View style={[fill, { overflow: "hidden" }]}>
          <A style={[box(-w, -44, 3 * w, 1.2 * h), a]}>
            <Tile w={44} h={44}><Path d="M0 0H44M0 0V44" stroke={c2} strokeOpacity="0.65" strokeWidth="2" /></Tile>
          </A>
        </View>
        <Lin stops={[[0, c1, 1], [0.3, c1, 0]]} />
      </View>
      <View style={[box(0, horizon - 1, w, 2), { backgroundColor: c2, shadowColor: c2, shadowOpacity: 1, shadowRadius: 8 }]} />
    </>
  );
}

function Breathe({ c: [c1, c2, c3], w, h, active }: MP) {
  const p = useLoop(4500, "alternate", active);
  const s = Math.min(w, h) * 1.2;
  const a = useAnimatedStyle(() => ({ opacity: 0.5 + 0.5 * p.value, transform: [{ scale: 0.78 + 0.34 * p.value }] }));
  const b = useAnimatedStyle(() => ({ opacity: 1 - 0.5 * p.value, transform: [{ scale: 1.12 - 0.34 * p.value }] }));
  const ring = Math.min(w, h) * 1.4;
  return (
    <>
      <View style={[fill, { backgroundColor: c1 }]} />
      <A style={[box(w / 2 - s / 2, h / 2 - s / 2, s, s), a]}><Glow color={c2} opacity={0.6} end={0.85} /></A>
      <A style={[box(w / 2 - s / 2 + 0.1 * s, h / 2 - s / 2 - 0.1 * s, s, s), b]}><Glow color={c3} opacity={0.45} end={0.55} /></A>
      <A style={[box(w / 2 - ring / 2, h / 2 - ring / 2, ring, ring), a]}>
        <Svg width={ring} height={ring} viewBox="0 0 100 100">
          {Array.from({ length: 6 }, (_, i) => <Circle key={i} cx="50" cy="50" r={5 + i * 5} fill="none" stroke={c2} strokeOpacity={0.16 - i * 0.022} strokeWidth="0.4" />)}
        </Svg>
      </A>
    </>
  );
}

function Wheel({ colors, d }: { colors: string[]; d: number }) {
  const n = 48;
  return (
    <Svg width={d} height={d} viewBox="-1 -1 2 2">
      {Array.from({ length: n }, (_, i) => {
        const t = (i / n) * colors.length;
        const k = Math.floor(t);
        const col = mix(colors[k % colors.length], colors[(k + 1) % colors.length], t - k);
        const a0 = (i / n) * TAU;
        const a1 = ((i + 1) / n) * TAU + 0.01;
        return <Path key={i} d={`M0 0 L${Math.cos(a0)} ${Math.sin(a0)} A1 1 0 0 1 ${Math.cos(a1)} ${Math.sin(a1)} Z`} fill={col} />;
      })}
    </Svg>
  );
}

function Spin({ c: [c1, c2, c3], w, h, active }: MP) {
  const p = useLoop(40000, "loop", active);
  const q = useLoop(26000, "loop", active);
  const g = useLoop(6000, "alternate", active);
  const sw = useLoop(8000, "loop", active);
  const d = Math.ceil(Math.hypot(w, h)) + 8;
  const a = useAnimatedStyle(() => ({ transform: [{ rotate: `${360 * p.value}deg` }] }));
  const b = useAnimatedStyle(() => ({ transform: [{ rotate: `${-360 * q.value}deg` }] }));
  const glow = useAnimatedStyle(() => ({ opacity: 0.7 + 0.3 * g.value }));
  const sweep = useAnimatedStyle(() => ({ transform: [{ translateX: (-0.7 + 1.4 * Math.min(1, sw.value / 0.6)) * 1.4 * w }] }));
  const wheel = useMemo(() => [c2, mix(c2, c3, 0.5), c3, mix(c3, "#ffffff", 0.4), mix(c2, c1, 0.3)], [c1, c2, c3]);
  const wheel2 = useMemo(() => [c1, c3, c1, c2, c1, mix(c3, "#ffffff", 0.5)], [c1, c2, c3]);
  return (
    <>
      <View style={[fill, { backgroundColor: c1 }]} />
      <A style={[box(w / 2 - d / 2, h / 2 - d / 2, d, d), a]}><Wheel colors={wheel} d={d} /></A>
      <A style={[box(w / 2 - d / 2, h / 2 - d / 2, d, d), { opacity: 0.35 }, b]}><Wheel colors={wheel2} d={d} /></A>
      <Vignette color={c1} start={0} base={0.2} to={0.65} />
      <A style={[fill, glow]}><Rad c={mix(mix(c2, "#ffffff", 0.6), c1, 0)} o={0.6} rx="40%" ry={`${40 * w / h}%`} end={0.7} /></A>
      <A style={[box(-0.2 * w, -0.2 * h, 1.4 * w, 1.4 * h), sweep]}><Lin x2="1" y2="0.3" stops={[[0.4, "#fff", 0], [0.5, "#fff", 0.12], [0.6, "#fff", 0]]} /></A>
    </>
  );
}

function Tide({ c: [c1, c2, c3], w, h, active }: MP) {
  const p = useLoop(13000, "loop", active);
  const q = useLoop(9000, "loop", active);
  const r = useLoop(6500, "loop", active);
  const g = useLoop(3400, "alternate", active);
  // Each wave is 240pt long whatever the card size, so moving one wave length loops seamlessly.
  const a = useAnimatedStyle(() => ({ transform: [{ translateX: -p.value * 240 }] }));
  const b = useAnimatedStyle(() => ({ transform: [{ translateX: -240 + q.value * 240 }] }));
  const d = useAnimatedStyle(() => ({ transform: [{ translateX: -r.value * 240 }] }));
  const glow = useAnimatedStyle(() => ({ opacity: 0.6 + 0.4 * g.value }));
  const moon = 0.26 * Math.min(w, h);
  return (
    <>
      <Lin stops={[[0, mix(c1, c2, 0.2)], [0.65, c1]]} />
      <View style={box(w - 0.14 * w - moon, 0.1 * h, moon, moon)}><Svg width={moon} height={moon} viewBox="0 0 100 100"><Defs><RadialGradient id="m" cx="50%" cy="50%" r="50%"><Stop offset="0" stopColor={c3} /><Stop offset="0.6" stopColor={c3} /><Stop offset="0.68" stopColor={c3} stopOpacity="0.3" /><Stop offset="1" stopColor={c3} stopOpacity="0" /></RadialGradient></Defs><Circle cx="50" cy="50" r="50" fill="url(#m)" /></Svg></View>
      <A style={[box(w - 0.14 * w - moon / 2 - 0.05 * Math.min(w, h), 0.3 * h, 0.1 * Math.min(w, h), 0.7 * h), glow]}>
        <Tile w={20} h={6}><Rect width="20" height="1.5" fill={c3} opacity="0.22" /></Tile>
      </A>
      <A style={[box(0, 0.48 * h, w + 240, 0.52 * h), a]}><WaveStrip color={c2} o1={0.26} o2={0.08} /></A>
      <A style={[box(0, 0.6 * h, w + 240, 0.4 * h), b]}><WaveStrip color={c2} bottom={c1} o1={0.34} o2={0.6} /></A>
      <A style={[box(0, 0.74 * h, w + 240, 0.26 * h), d]}><WaveStrip color={mix(c2, c1, 0.6)} top={c3} o1={0.5} o2={1} /></A>
    </>
  );
}

/** Waves exactly 240pt long, as many as fit. */
function WaveStrip({ color, top, bottom, o1, o2 }: { color: string; top?: string; bottom?: string; o1: number; o2: number }) {
  const u = useUid();
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const n = size ? Math.ceil(size.w / 240) + 1 : 0;
  const d = size ? `M0 ${size.h * 0.37} ` + Array.from({ length: n }, (_, i) => `C${i * 240 + 40} ${size.h * 0.07} ${i * 240 + 80} ${size.h * 0.07} ${i * 240 + 120} ${size.h * 0.37} S${i * 240 + 200} ${size.h * 0.67} ${i * 240 + 240} ${size.h * 0.37}`).join(" ") + ` V${size.h} H0Z` : "";
  return (
    <View style={fill} onLayout={(e) => setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
      {size && (
        <Svg width={size.w} height={size.h}>
          <Defs><LinearGradient id={u} x1="0" y1="0" x2="0" y2="1"><Stop offset="0" stopColor={top ?? color} stopOpacity={o1} /><Stop offset="1" stopColor={bottom ?? color} stopOpacity={o2} /></LinearGradient></Defs>
          <Path d={d} fill={`url(#${u})`} />
        </Svg>
      )}
    </View>
  );
}

function Ember({ c: [c1, c2, c3], w, h, active }: MP) {
  const p = useLoop(8000, "loop", active);
  const q = useLoop(12000, "loop", active);
  const g = useLoop(2800, "alternate", active);
  const a = useAnimatedStyle(() => ({ transform: [{ translateX: 5 * Math.sin(p.value * TAU * 2) }, { translateY: -p.value * 160 }] }));
  const b = useAnimatedStyle(() => ({ transform: [{ translateX: -7 * Math.sin(q.value * TAU * 1.5) }, { translateY: -q.value * 230 }] }));
  const glow = useAnimatedStyle(() => ({ opacity: 0.7 + 0.3 * g.value }));
  return (
    <>
      <View style={[fill, { backgroundColor: c1 }]}><Rad c={mix(c1, c2, 0.6)} cy="125%" rx="130%" ry="80%" end={0.72} /></View>
      <A style={[box(-0.1 * w, 0.6 * h, 1.2 * w, 0.6 * h), glow]}><Rad c={c2} o={0.55} cy="100%" rx="50%" ry="60%" end={0.75} /></A>
      <A style={[box(0, 0, w, h + 160), a]}><Dots color={c3} size={160} dots={[[20, 30, 1.3], [140, 60, 1.5], [110, 20, 1], [150, 130, 0.9]]} /></A>
      <A style={[box(0, 0, w, h + 160), a]}><Dots color={c2} size={160} dots={[[90, 110, 1.1], [60, 140, 1], [40, 90, 1.2]]} /></A>
      <A style={[box(0, 0, w, h + 230), b]}><Dots color={c3} size={230} dots={[[40, 50, 1.7], [120, 100, 1.5], [170, 170, 1.4]]} /></A>
      <Lin stops={[[0, c1, 0.95], [0.6, c1, 0]]} />
    </>
  );
}

const HOLO_DEFAULT = ["#ffd6e8", "#d6f0ff", "#e6ffd6", "#fff2c7", "#e9d6ff"];

function Holo({ c: [c1, c2, c3], w, h, active }: MP) {
  const u = useUid();
  const p = useLoop(14000, "alternate", active);
  const t = useLoop(3000, "alternate", active);
  const sw = useLoop(7000, "loop", active);
  const a = useAnimatedStyle(() => ({ transform: [{ translateX: -p.value * w * 2 }] }));
  const sparkle = useAnimatedStyle(() => ({ opacity: 0.25 + 0.5 * t.value }));
  const sweep = useAnimatedStyle(() => ({ transform: [{ translateX: (-0.7 + 1.4 * Math.min(1, sw.value / 0.6)) * 1.6 * w }] }));
  const five = c1 === HOLO_DEFAULT[0] && c2 === HOLO_DEFAULT[1] && c3 === HOLO_DEFAULT[2] ? HOLO_DEFAULT : [c1, c2, c3, mix(c1, "#fff2c7", 0.5), mix(c3, "#e9d6ff", 0.6)];
  const stops = [...five, ...five, five[0]];
  return (
    <>
      <View style={[fill, { backgroundColor: c1 }]} />
      <A style={[{ position: "absolute", left: 0, top: 0, bottom: 0, width: 3 * w }, a]}>
        <Svg style={svgFill} preserveAspectRatio="none" viewBox="0 0 100 100">
          <Defs><LinearGradient id={u + "h"} x1="0" y1="0" x2="1" y2="0.2">{stops.map((col, i) => <Stop key={i} offset={i / (stops.length - 1)} stopColor={col} />)}</LinearGradient></Defs>
          <Rect width="100" height="100" fill={`url(#${u}h)`} />
        </Svg>
      </A>
      <Lin x2="1" y2="1" stops={[[0, "#fff", 0.55], [0.4, "#fff", 0], [0.7, "#fff", 0.35], [1, "#fff", 0]]} />
      <A style={[fill, sparkle]}><Dots color="#ffffff" size={52} dots={[[12, 14, 0.6], [44, 38, 0.8], [30, 4, 0.5]]} /></A>
      <A style={[box(-0.3 * w, -0.3 * h, 1.6 * w, 1.6 * h), sweep]}><Lin x2="1" y2="0.5" stops={[[0.42, "#fff", 0], [0.5, "#fff", 0.4], [0.58, "#fff", 0]]} /></A>
    </>
  );
}

const CRACK = "M48 0 L62 12 L44 26 L64 41 L40 57 L60 72 L46 86 L56 100 L50 100 L38 86 L52 72 L32 57 L56 41 L36 26 L54 12 L42 0 Z";

function Rift({ c: [c1, c2, c3], w, h, active }: MP) {
  const p = useLoop(6000, "alternate", active);
  const q = useLoop(3000, "alternate", active);
  const r = useLoop(9000, "loop", active);
  const m = Math.min(w, h);
  const glow = useAnimatedStyle(() => ({ opacity: 0.7 + 0.3 * p.value, transform: [{ scaleX: 0.8 + 0.4 * p.value }] }));
  const core = useAnimatedStyle(() => ({ opacity: 0.7 + 0.3 * q.value }));
  const rise = useAnimatedStyle(() => ({ transform: [{ translateY: -r.value * 140 }] }));
  const crackBox = { ...box(w / 2 - 0.045 * m, -0.06 * h, 0.09 * m, 1.12 * h), transform: [{ rotate: "6deg" }] };
  return (
    <>
      <View style={[fill, { backgroundColor: c1 }]}><Rad c={mix(c1, c3, 0.16)} rx="60%" ry="80%" end={0.7} /></View>
      <A style={[box(w / 2 - 0.45 * m, -0.1 * h, 0.9 * m, 1.2 * h), glow]}><Pools items={[{ cx: 50, cy: 50, rx: 28, ry: 50, c: c3, o: 0.75 }]} /></A>
      <View style={[box(w / 2 - 0.25 * m, 0, 0.5 * m, h), { overflow: "hidden" }]}>
        <A style={[box(0, 0, 0.5 * m, h + 140), rise]}><Dots color={c2} size={140} dots={[[20, 30, 0.8], [90, 100, 0.7], [60, 70, 0.9]]} /></A>
      </View>
      <View style={crackBox}>
        <Svg style={svgFill} viewBox="0 0 100 100" preserveAspectRatio="none"><Path d={CRACK} fill={c3} opacity="0.85" /></Svg>
      </View>
      <A style={[{ ...crackBox, left: w / 2 - 0.015 * m, width: 0.03 * m }, core]}>
        <Svg style={svgFill} viewBox="0 0 100 100" preserveAspectRatio="none"><Path d={CRACK} fill={c2} /></Svg>
      </A>
    </>
  );
}

function Stripes({ angle, stops, count }: { angle: number; stops: [number, string, number][]; count: number }) {
  const u = useUid();
  return (
    <Svg style={[svgFill, { transform: [{ rotate: `${angle}deg` }] }]} viewBox="0 0 100 100" preserveAspectRatio="none">
      <Defs><LinearGradient id={u} x1="0" y1="0" x2="1" y2="0">{stops.map(([o, col, a], i) => <Stop key={i} offset={o} stopColor={col} stopOpacity={a} />)}</LinearGradient></Defs>
      {Array.from({ length: count }, (_, i) => <Rect key={i} x={(i * 100) / count} y="-50" width={100 / count} height="200" fill={`url(#${u})`} />)}
    </Svg>
  );
}

function Chrome({ c: [c1, c2, c3], w, h, active }: MP) {
  const p = useLoop(16000, "alternate", active);
  const q = useLoop(21000, "alternate", active);
  const r = useLoop(12000, "alternate", active);
  const big = box(-0.6 * w, -0.6 * h, 2.2 * w, 2.2 * h);
  const a = useAnimatedStyle(() => ({ transform: [{ translateX: (-0.08 + 0.16 * p.value) * w }, { translateY: (-0.04 + 0.09 * p.value) * h }, { rotate: `${-4 + 9 * p.value}deg` }, { skewX: `${-10 + 22 * p.value}deg` }] }));
  const b = useAnimatedStyle(() => ({ transform: [{ translateX: (0.06 - 0.13 * q.value) * w }, { translateY: (0.04 - 0.09 * q.value) * h }, { rotate: `${3 - 9 * q.value}deg` }, { skewY: `${8 - 18 * q.value}deg` }] }));
  const d = useAnimatedStyle(() => ({ transform: [{ translateX: (-0.06 + 0.13 * r.value) * w }, { translateY: (0.03 - 0.07 * r.value) * h }, { scale: 0.9 + 0.25 * r.value }] }));
  return (
    <>
      <View style={[fill, { backgroundColor: c1 }]} />
      <A style={[big, a]}><Stripes angle={28} count={6} stops={[[0, c1, 1], [0.3, c3, 1], [0.48, c2, 1], [0.65, mix(c3, c1, 0.4), 1], [1, c1, 1]]} /></A>
      <A style={[big, { opacity: 0.5 }, b]}><Stripes angle={-28} count={5} stops={[[0, c2, 0], [0.2, c2, 0.7], [0.45, c2, 0], [1, c2, 0]]} /></A>
      <A style={[box(-0.3 * w, -0.3 * h, 1.6 * w, 1.6 * h), d]}><Rad c="#ffffff" o={0.22} rx="40%" ry="30%" end={0.7} /></A>
      <Vignette color={c1} start={0.5} to={0.7} />
    </>
  );
}

function Mesh({ c: [c1, c2, c3], w, h, active }: MP) {
  const p = useLoop(21000, "loop", active);
  const q = useLoop(27000, "loop", active);
  const r = useLoop(33000, "alternate", active);
  const s = useLoop(17000, "loop", active);
  const M = Math.max(w, h);
  const d = 1.2 * M;
  const at = (dd: number) => box(w / 2 - dd / 2, h / 2 - dd / 2, dd, dd);
  const a = useAnimatedStyle(() => ({ transform: [{ translateX: -0.28 * d * Math.cos(p.value * TAU) }, { translateY: -0.24 * d * Math.cos(p.value * TAU + Math.PI / 2) }] }));
  const b = useAnimatedStyle(() => ({ transform: [{ translateX: 0.26 * d * Math.cos(q.value * TAU) }, { translateY: 0.24 * d * Math.cos(q.value * TAU + Math.PI / 2) }] }));
  const e = useAnimatedStyle(() => ({ transform: [{ translateY: (0.3 - 0.6 * r.value) * d }, { scale: 0.9 + 0.2 * r.value }] }));
  const f = useAnimatedStyle(() => ({ transform: [{ translateX: 0.28 * 0.7 * M * Math.sin(s.value * TAU) }, { translateY: 0.24 * 0.7 * M * Math.cos(s.value * TAU) }] }));
  return (
    <>
      <View style={[fill, { backgroundColor: c1 }]} />
      <A style={[at(d), a]}><Glow color={c2} opacity={1} end={0.9} /></A>
      <A style={[at(d), b]}><Glow color={c3} opacity={1} end={0.9} /></A>
      <A style={[at(d), { opacity: 0.8 }, e]}><Glow color={mix(c2, c3, 0.5)} opacity={1} end={0.8} /></A>
      <A style={[at(0.7 * M), { opacity: 0.45 }, f]}><Glow color={mix(c2, "#ffffff", 0.4)} opacity={1} end={0.9} /></A>
    </>
  );
}

// Fixed speckle for film grain (seeded so every phone draws the same).
const GRAIN = Array.from({ length: 70 }, (_, i) => {
  const r = (n: number) => { const x = Math.sin(i * 12.9898 + n * 78.233) * 43758.5453; return x - Math.floor(x); };
  return [r(1) * 64, r(2) * 64, r(3) > 0.5 ? 1 : 0] as const;
});

function Grain({ c: [c1, c2, c3], w, h, active }: MP) {
  const p = useLoop(14000, "alternate", active);
  const q = useLoop(19000, "alternate", active);
  const g = useLoop(900, "loop", active);
  const M = Math.max(w, h);
  const a = useAnimatedStyle(() => ({ transform: [{ translateX: 0.4 * 1.1 * M * p.value }, { translateY: 0.2 * h * p.value }, { scale: 0.9 + 0.25 * p.value }] }));
  const b = useAnimatedStyle(() => ({ transform: [{ translateX: -0.35 * 0.9 * M * q.value }, { translateY: -0.25 * h * q.value }, { scale: 1.1 - 0.2 * q.value }] }));
  const jit = useAnimatedStyle(() => {
    const k = Math.floor(g.value * 5);
    const xs = [0, -9, 7, -4, 11];
    const ys = [0, 5, -8, 10, 3];
    return { transform: [{ translateX: xs[k % 5] }, { translateY: ys[k % 5] }] };
  });
  return (
    <>
      <View style={[fill, { backgroundColor: c1 }]} />
      <A style={[box(-0.55 * 1.1 * M, -0.2 * h, 1.1 * M, 1.1 * M), a]}><Glow color={c2} opacity={0.7} end={1} /></A>
      <A style={[box(w - 0.45 * 0.9 * M, h - 0.9 * M + 0.3 * h, 0.9 * M, 0.9 * M), b]}><Glow color={c3} opacity={0.6} /></A>
      <A style={[box(-16, -16, w + 32, h + 32), { opacity: 0.22 }, jit]}>
        <Tile w={64} h={64}>{GRAIN.map(([x, y, l], i) => <Rect key={i} x={x} y={y} width="1" height="1" fill={l ? "#ffffff" : "#000000"} />)}</Tile>
      </A>
      <Vignette color={"#000"} start={0.55} to={0.55} />
    </>
  );
}

function Ring({ d, dur, reverse, dot, c2, c3, active, w, h }: { d: number; dur: number; reverse?: boolean; dot: number; c2: string; c3: string; active: boolean; w: number; h: number }) {
  const p = useLoop(dur, "loop", active);
  const a = useAnimatedStyle(() => ({ transform: [{ rotate: `${(reverse ? -360 : 360) * p.value}deg` }] }));
  return (
    <A style={[box(w / 2 - d / 2, h / 2 - d / 2, d, d), { borderRadius: d / 2, borderWidth: 1, borderColor: c2 + "38" }, a]}>
      <View style={{ position: "absolute", left: d / 2 - dot / 2 - 1, top: -dot / 2 - 1, width: dot, height: dot, borderRadius: dot / 2, backgroundColor: c3, shadowColor: c3, shadowOpacity: 1, shadowRadius: 6 }} />
    </A>
  );
}

function Orbit({ c: [c1, c2, c3], w, h, active }: MP) {
  const m = Math.min(w, h);
  const p = useLoop(4000, "alternate", active);
  const core = useAnimatedStyle(() => ({ opacity: 0.5 + 0.5 * p.value, transform: [{ scale: 0.78 + 0.34 * p.value }] }));
  return (
    <>
      <View style={[fill, { backgroundColor: c1 }]}><Rad c={mix(c1, c2, 0.1)} rx="60%" ry="60%" end={0.7} /></View>
      <Svg style={svgFill} preserveAspectRatio="none" viewBox="0 0 100 100">{[[14, 20], [82, 16], [70, 86], [20, 80], [50, 8], [92, 60]].map(([x, y], i) => <Circle key={i} cx={x} cy={y} r="0.35" fill={c2} opacity="0.5" />)}</Svg>
      <A style={[box(w / 2 - 0.07 * m, h / 2 - 0.07 * m, 0.14 * m, 0.14 * m), core]}><Glow color={c2} opacity={1} end={0.7} /></A>
      <Ring d={0.4 * m} dur={14000} dot={Math.max(4, 0.026 * m)} c2={c2} c3={c3} active={active} w={w} h={h} />
      <Ring d={0.68 * m} dur={26000} reverse dot={Math.max(3, 0.018 * m)} c2={c2} c3={c3} active={active} w={w} h={h} />
      <Ring d={0.96 * m} dur={44000} dot={Math.max(5, 0.034 * m)} c2={c2} c3={c3} active={active} w={w} h={h} />
    </>
  );
}

function RippleRing({ v, k, d, c2, cx, cy }: { v: SharedValue<number>; k: number; d: number; c2: string; cx: number; cy: number }) {
  const s = useAnimatedStyle(() => {
    const t = (v.value + k / 4) % 1;
    const e = 1 - Math.pow(1 - t, 2.2);
    return { opacity: t < 0.08 ? (t / 0.08) * 0.9 : 0.9 * (1 - (t - 0.08) / 0.92), transform: [{ scale: 0.02 + 0.98 * e }] };
  });
  return <A style={[box(cx - d / 2, cy - d / 2, d, d), { borderRadius: d / 2, borderWidth: 1.5, borderColor: c2 + "99" }, s]} />;
}

function Ripple({ c: [c1, c2, c3], w, h, active }: MP) {
  const v = useLoop(10000, "loop", active);
  const g = useLoop(2500, "alternate", active);
  const d = 1.5 * Math.max(w, h);
  const cx = w / 2;
  const cy = 0.6 * h;
  const dot = 0.08 * Math.min(w, h);
  const glow = useAnimatedStyle(() => ({ opacity: 0.6 + 0.4 * g.value }));
  return (
    <>
      <View style={[fill, { backgroundColor: c1 }]}><Rad c={mix(c1, c2, 0.12)} cy="60%" rx="90%" ry="70%" end={0.7} /></View>
      {[0, 1, 2, 3].map((k) => <RippleRing key={k} v={v} k={k} d={d} c2={c2} cx={cx} cy={cy} />)}
      <A style={[box(cx - dot / 2, cy - dot / 2, dot, dot), glow]}><Glow color={c3} opacity={1} end={0.7} /></A>
    </>
  );
}

function DotWave({ c: [c1, c2, c3], w, h, active }: MP) {
  const p = useLoop(7000, "alternate", active);
  const q = useLoop(11000, "alternate", active);
  const bw = 0.45 * w;
  const b1 = useAnimatedStyle(() => ({ transform: [{ translateX: -bw + p.value * (w + bw) }] }));
  const k1 = useAnimatedStyle(() => ({ transform: [{ translateX: bw - p.value * (w + bw) }] }));
  const b2 = useAnimatedStyle(() => ({ transform: [{ translateX: -bw + q.value * (w + bw) }] }));
  const k2 = useAnimatedStyle(() => ({ transform: [{ translateX: bw - q.value * (w + bw) }] }));
  const fade = <><View style={[box(0, 0, 0.35 * bw, h)]}><Lin x2="1" y2="0" stops={[[0, c1, 1], [1, c1, 0]]} /></View><View style={[box(0.65 * bw, 0, 0.35 * bw, h)]}><Lin x2="1" y2="0" stops={[[0, c1, 0], [1, c1, 1]]} /></View></>;
  return (
    <>
      <View style={[fill, { backgroundColor: c1 }]} />
      <Dots color={c2} size={14} opacity={0.22} dots={[[7, 7, 1.1]]} />
      <A style={[box(0, 0, bw, h), { overflow: "hidden" }, b1]}>
        <A style={[box(0, 0, w, h), k1]}><View style={[fill, { backgroundColor: c1 }]} /><Dots color={c2} size={14} dots={[[7, 7, 1.4]]} /></A>
        {fade}
      </A>
      <A style={[box(0, 0, bw, h), { overflow: "hidden", opacity: 0.8 }, b2]}>
        <A style={[box(0, 0, w, h), k2]}><Dots color={c3} size={14} dots={[[7, 7, 2]]} /></A>
      </A>
      <Vignette color={c1} start={0.5} to={0.8} />
    </>
  );
}

function Scan({ c: [c1, c2, c3], w, h, active }: MP) {
  const p = useLoop(7000, "loop", active);
  const g = useLoop(5000, "alternate", active);
  const roll = useAnimatedStyle(() => ({ transform: [{ translateY: -0.3 * h + p.value * 1.3 * h }] }));
  const glow = useAnimatedStyle(() => ({ opacity: 0.6 + 0.4 * g.value }));
  return (
    <>
      <View style={[fill, { backgroundColor: c1 }]}><Rad c={mix(c1, c2, 0.16)} rx="90%" ry="80%" end={0.75} /></View>
      <A style={[box(0.14 * w, 0.18 * h, 0.72 * w, 0.64 * h), glow]}><Glow color={c2} opacity={0.14} /></A>
      <Tile w={3} h={3}><Rect width="3" height="1" fill="#000" opacity="0.32" /></Tile>
      <View style={[fill, { opacity: 0.07 }]}><Tile w={3} h={3}><Rect width="1" height="3" fill="#ff3b3b" /><Rect x="1" width="1" height="3" fill="#3bff6b" /><Rect x="2" width="1" height="3" fill="#3b8bff" /></Tile></View>
      <A style={[box(0, 0, w, 0.3 * h), roll]}><Lin stops={[[0, c3, 0], [0.5, c3, 0.12], [1, c3, 0]]} /></A>
      <Vignette color={"#000"} start={0.6} to={0.75} />
    </>
  );
}

function Silk({ c: [c1, c2, c3], w, h, active }: MP) {
  const p = useLoop(15000, "alternate", active);
  const q = useLoop(19000, "alternate", active);
  const r = useLoop(23000, "alternate", active);
  const sw = useLoop(9000, "loop", active);
  const big = box(-0.5 * w, -0.5 * h, 2 * w, 2 * h);
  const a = useAnimatedStyle(() => ({ transform: [{ translateX: (-0.12 + 0.22 * p.value) * w }, { translateY: (-0.06 + 0.12 * p.value) * h }, { rotate: `${-3 + 7 * p.value}deg` }, { scaleY: 1 + 0.2 * p.value }] }));
  const b = useAnimatedStyle(() => ({ transform: [{ translateX: (0.1 - 0.22 * q.value) * w }, { translateY: (0.04 - 0.12 * q.value) * h }, { rotate: `${3 - 8 * q.value}deg` }, { scaleX: 1.1 - 0.15 * q.value }] }));
  const d = useAnimatedStyle(() => ({ transform: [{ translateX: (0.1 - 0.22 * r.value) * w }, { rotate: `${4 - 7 * r.value}deg` }] }));
  const sweep = useAnimatedStyle(() => ({ transform: [{ translateX: (-0.7 + 1.4 * Math.min(1, sw.value / 0.6)) * 1.4 * w }] }));
  return (
    <>
      <Lin x2="0.4" stops={[[0, c1], [1, mix(c1, c3, 0.3)]]} />
      <A style={[big, a]}><Lin x2="1" y2="0.45" stops={[[0.2, c3, 0], [0.3, c3, 0.7], [0.36, c2, 0.5], [0.42, c3, 0.6], [0.55, c3, 0]]} /></A>
      <A style={[big, b]}><Lin x2="1" y2="0.6" stops={[[0.45, c3, 0], [0.54, c3, 0.5], [0.59, c2, 0.4], [0.64, c3, 0.45], [0.74, c3, 0]]} /></A>
      <A style={[big, d]}><Lin x2="1" y2="0.2" stops={[[0.1, c1, 0], [0.22, c1, 0.7], [0.34, c1, 0]]} /></A>
      <A style={[box(-0.2 * w, -0.2 * h, 1.4 * w, 1.4 * h), sweep]}><Lin x2="1" y2="0.45" stops={[[0.44, c2, 0], [0.5, c2, 0.22], [0.56, c2, 0]]} /></A>
    </>
  );
}

function Disc({ cx, cy, r, color, o, ring }: { cx: number; cy: number; r: number; color: string; o: number; ring?: number }) {
  return (
    <G>
      <Circle cx={cx} cy={cy} r={r} fill={color} opacity={o} />
      {ring ? <Circle cx={cx} cy={cy} r={r} fill="none" stroke={color} strokeOpacity={ring} strokeWidth={Math.max(1.5, r * 0.1)} /> : null}
    </G>
  );
}

function Bokeh({ c: [c1, c2, c3], w, h, active }: MP) {
  const p = useLoop(26000, "loop", active);
  const q = useLoop(17000, "loop", active);
  const r = useLoop(11000, "loop", active);
  const a = useAnimatedStyle(() => ({ transform: [{ translateY: -p.value * 260 }] }));
  const b = useAnimatedStyle(() => ({ transform: [{ translateY: -q.value * 180 }] }));
  const d = useAnimatedStyle(() => ({ transform: [{ translateY: -r.value * 120 }] }));
  return (
    <>
      <View style={[fill, { backgroundColor: c1 }]}><Rad c={mix(c1, c2, 0.14)} cy="100%" rx="120%" ry="90%" end={0.7} /></View>
      <A style={[box(0, 0, w, h + 260), a]}><Tile w={260} h={260}><Disc cx={60} cy={70} r={25} color={c2} o={0.26} ring={0.4} /><Disc cx={200} cy={190} r={33} color={c3} o={0.22} ring={0.34} /></Tile></A>
      <A style={[box(0, 0, w, h + 180), b]}><Tile w={180} h={180}><Disc cx={40} cy={40} r={13} color={c3} o={0.3} /><Disc cx={130} cy={120} r={11} color={c2} o={0.32} /></Tile></A>
      <A style={[box(0, 0, w, h + 120), d]}><Tile w={120} h={120}><Disc cx={30} cy={80} r={3.5} color={c2} o={0.6} /><Disc cx={90} cy={20} r={2.5} color={c3} o={0.6} /></Tile></A>
      <Vignette color={c1} start={0.5} to={0.7} />
    </>
  );
}

function Snow({ c: [c1, c2, c3], w, h, active }: MP) {
  const p = useLoop(12000, "loop", active);
  const q = useLoop(10000, "loop", active);
  const r = useLoop(9000, "loop", active);
  const a = useAnimatedStyle(() => ({ transform: [{ translateX: 6 * Math.sin(p.value * TAU) }, { translateY: -120 + p.value * 120 }] }));
  const b = useAnimatedStyle(() => ({ transform: [{ translateX: -9 * Math.sin(q.value * TAU) }, { translateY: -180 + q.value * 180 }] }));
  const d = useAnimatedStyle(() => ({ transform: [{ translateX: 12 * Math.sin(r.value * TAU) }, { translateY: -260 + r.value * 260 }] }));
  return (
    <>
      <Lin stops={[[0, c1], [1, mix(c1, c3, 0.25)]]} />
      <A style={[box(0, 0, w, h + 120), { opacity: 0.7 }, a]}><Dots color={c2} size={120} dots={[[20, 30, 0.8], [80, 90, 0.7], [50, 10, 0.9], [100, 50, 0.7], [10, 100, 0.8]]} /></A>
      <A style={[box(0, 0, w, h + 180), { opacity: 0.85 }, b]}><Dots color={c2} size={180} dots={[[40, 50, 1.3], [140, 130, 1.2], [100, 20, 1.1], [20, 150, 1.2]]} /></A>
      <A style={[box(0, 0, w, h + 260), d]}><Dots color={c2} size={260} dots={[[70, 60, 2], [200, 190, 1.7]]} /></A>
      <View style={box(0, 0.7 * h, w, 0.3 * h)}><Lin stops={[[0, c3, 0], [1, c3, 0.22]]} /></View>
    </>
  );
}

const MOVING: Record<string, React.ComponentType<MP>> = {
  aurora: Aurora, lava: Lava, stars: Stars, rain: Rain, drive: Drive, breathe: Breathe, spin: Spin, tide: Tide, ember: Ember, holo: Holo,
  rift: Rift, chrome: Chrome, mesh: Mesh, grain: Grain, orbit: Orbit, ripple: Ripple, dotwave: DotWave, scan: Scan, silk: Silk, bokeh: Bokeh, snow: Snow,
};

/** Glow colours per theme for Soft Light (web: --pmg-soft-a / -b / -base in profile-mixed-grid.css). */
const SOFT_COLORS: Record<string, readonly [string, string]> = {
  osaka: ["#ff6fb5", "#7c5cff"], hazy: ["#ff7ad9", "#7aa8ff"], island: ["#ff7a8a", "#3fc1c9"], hacker: ["#39ff88", "#0f8f4a"],
  horror: ["#ff2b2b", "#6b0f0f"], jungle: ["#e2b060", "#3f7f4a"], war: ["#4fe3e0", "#2b6f7a"],
};
const SOFT_SPOTS = [
  [{ cx: "0%", cy: "0%", rx: "120%", ry: "80%", o: 0.38 }, { cx: "100%", cy: "100%", rx: "90%", ry: "70%", o: 0.3 }],
  [{ cx: "100%", cy: "0%", rx: "110%", ry: "80%", o: 0.3 }, { cx: "0%", cy: "100%", rx: "90%", ry: "70%", o: 0.38 }],
  [{ cx: "50%", cy: "110%", rx: "130%", ry: "70%", o: 0.38 }, null],
] as const;

/**
 * Soft Light: what a plain text post in the profile grid sits on when its
 * owner picked no backdrop. A gentle glow in the theme's colours, in one of
 * three corners so a row of text posts is not three identical boxes.
 */
export const SoftLightLayer = memo(function SoftLightLayer({ theme, light, seed }: { theme: string; light: boolean; seed: string | number }) {
  const u = useId().replace(/[^a-zA-Z0-9]/g, "");
  const [a, b] = SOFT_COLORS[theme] ?? (light ? ["#7f93a8", "#b9c4cf"] : ["#aebfce", "#6d7f92"]);
  const base = theme === "osaka" ? "#15101f" : theme === "hazy" ? "rgba(20,12,40,0.55)" : light ? "#f1f3f6" : "#0c0d10";
  const n = postBgVariant(seed, 3);
  const [first, second] = SOFT_SPOTS[n];
  const colors = n === 1 ? [b, a] : [a, b];
  return (
    <View pointerEvents="none" style={[fill, { backgroundColor: base }]}>
      <Svg style={svgFill} preserveAspectRatio="none" viewBox="0 0 100 100">
        <Defs>
          <RadialGradient id={u + "a"} cx={first.cx} cy={first.cy} rx={first.rx} ry={first.ry}><Stop offset="0" stopColor={colors[0]} stopOpacity={first.o} /><Stop offset="0.62" stopColor={colors[0]} stopOpacity="0" /></RadialGradient>
          {second && <RadialGradient id={u + "b"} cx={second.cx} cy={second.cy} rx={second.rx} ry={second.ry}><Stop offset="0" stopColor={colors[1]} stopOpacity={second.o} /><Stop offset="0.66" stopColor={colors[1]} stopOpacity="0" /></RadialGradient>}
        </Defs>
        <Rect width="100" height="100" fill={`url(#${u}a)`} />
        {second && <Rect width="100" height="100" fill={`url(#${u}b)`} />}
      </Svg>
    </View>
  );
});

const DEFAULT_COLORS: PostBgPalette = ["#0b0b0f", "#ffffff", "#8b7cff"];

/**
 * The backdrop itself: fills its parent, sits behind the content, never takes
 * touches. `active={false}` holds a moving one still (e.g. a hidden tab).
 */
export const PostBgLayer = memo(function PostBgLayer({ bg, active = true, seed }: { bg: PostBg | null; active?: boolean; seed?: string | number }) {
  const art = useContext(ProfilePostBgArtContext);
  const own = useId();
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  // A moving backdrop is an endless loop per tile: it holds while the list
  // scrolls, behind other screens and in the background (useAmbientMotion),
  // so a profile full of them doesn't redraw the window on every fling frame.
  const ambient = useAmbientMotion();
  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    if (!size || Math.abs(size.w - width) > 1 || Math.abs(size.h - height) > 1) setSize({ w: width, h: height });
  };
  if (!bg) return null;
  const colors = bg.colors ?? DEFAULT_COLORS;
  const Moving = bg.kind === "moving" ? MOVING[bg.id] : undefined;
  return (
    <View pointerEvents="none" style={[fill, { overflow: "hidden" }]} onLayout={Moving ? onLayout : undefined}>
      {bg.kind === "photo"
        ? (bg.image ? <Photo uri={bg.image} /> : null)
        : Moving
          ? (size ? <Moving key={colors.join()} c={colors} w={size.w} h={size.h} active={active && ambient} /> : null)
          : <Still id={bg.id} c={colors} n={postBgVariant(seed ?? own, 8)} art={art} />}
    </View>
  );
});

/** Ink and sub colours for text on a backdrop. */
export function usePostBgInk(bg: PostBg | null) {
  return useMemo(() => (bg ? POST_BG_INK[bg.tone] : null), [bg]);
}
