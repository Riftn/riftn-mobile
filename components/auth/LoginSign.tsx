import React, { useEffect, useRef, useState } from "react";
import { Animated, Easing, Image, StyleSheet, Text, View, type TextStyle } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import MaskedView from "@react-native-masked-view/masked-view";
import { useTranslation } from "react-i18next";
import { KeepDarkScope } from "../../libs/jsx/tone";
import type { LoginLook } from "../../libs/login-look";

/**
 * The Riftn wordmark and the sign-in headline as one lit sign, in one of seven
 * looks (picked in Settings → Appearance, libs/login-look). Same looks, timings
 * and colours as web's `.login-stack__title[data-look]` (src/styles/login-stack.css):
 *
 * - tube: crisp chrome lines (one every 6pt) rolling up non-stop, a slow dark
 *   bar drifting down, a tight halo instead of a fuzzy glow.
 * - vhs: tape lines (one every 4pt), red and blue edges, and a tracking tear
 *   sweeping down every 5s dragging a slice of the sign sideways.
 * - led: letters built from light dots, slogan in capitals, dark lines rolling up.
 * - holo: thin wide capitals, cool lines racing up, a bright scan line climbing,
 *   and the sign leaning and snapping back in short glitches.
 * - neon: a solid bright tube with a wide coloured glow, buzzing now and then.
 * - 3d: chunky letters lit from above with a solid side, slowly turning.
 * - flat: plain solid letters, nothing moving.
 *
 * Everything moves on the native driver. Every loop climbs a whole number of
 * lines, so it never jumps. Reduced motion holds a still frame.
 */

const WORDMARK = require("../../assets/login-stack/wordmark.png");
/** Pre-lit wordmark (letters + glow, 20pt of room each side), tinted for the halo. */
const HALO = require("../../assets/login-stack/neon-white.png");
/** The wordmark blurred, with 20pt of room each side: Flat's soft shadow. */
const SHADE = require("../../assets/login-stack/wordmark-shade.png");
const DOTS = require("../../assets/login-stack/led-dots.png");
const DOTS_SMALL = require("../../assets/login-stack/led-dots-small.png");

const MARK_W = 210;
const MARK_H = 62;
const HALO_PAD = 20;
/** Gap between the letters and the headline, as on web. */
const MARK_GAP = 18;

const TV_RED = "rgba(255,40,80,0.9)";
const TV_BLUE = "rgba(40,220,255,0.85)";

type Palette = {
  ink: string;
  low: string;
  gap: string;
  gapClear: string;
  /** Halo colour around the letters; none on light. */
  halo: string | null;
  holoTop: string;
  holoLow: string;
  holoGap: string;
  tape: string;
};

function hex(c: string): [number, number, number] {
  const n = parseInt(c.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function mix(a: string, b: string, amountA: number): string {
  const x = hex(a);
  const y = hex(b);
  const c = x.map((v, i) => Math.round(v * amountA + y[i] * (1 - amountA)));
  return `#${c.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

export function signPalette(theme: string, isLight: boolean): Palette {
  if (isLight) {
    return {
      ink: "#0B0B0D", low: "#4A4A52", gap: "rgba(255,255,255,0.72)", gapClear: "rgba(255,255,255,0)",
      halo: null, holoTop: "#142130", holoLow: "#3F5A73", holoGap: "rgba(255,255,255,0.6)", tape: "#8A8A90",
    };
  }
  const [ink, low, halo] =
    theme === "hazy" ? ["#EFE4FF", "#8F72C4", "#C9A7FF"]
    : theme === "osaka" ? ["#FFE1F0", "#C25A8F", "#FF6FB5"]
    : ["#FFFFFF", "#8D8D93", "#FFFFFF"];
  return {
    ink, low, gap: "rgba(0,0,0,0.78)", gapClear: "rgba(0,0,0,0)", halo,
    holoTop: mix(ink, "#A9D4F5", 0.72),
    holoLow: mix(low, "#5F7D98", 0.4),
    holoGap: "rgba(8,18,30,0.65)",
    tape: mix(low, "#000000", 0.7),
  };
}

/** One linear 0 → 1 loop on the native driver; still under reduced motion. */
function useLoop(duration: number, still: boolean) {
  const value = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    value.setValue(0);
    if (still) return;
    const anim = Animated.loop(Animated.timing(value, { toValue: 1, duration, easing: Easing.linear, useNativeDriver: true }));
    anim.start();
    return () => anim.stop();
  }, [value, duration, still]);
  return value;
}

/** Repeating lines, `pitch` tall, as many as fill `height`. */
function Lines({ pitch, height, colors, locations }: { pitch: number; height: number; colors: string[]; locations: number[] }) {
  const count = Math.ceil(height / pitch) + 1;
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <LinearGradient
          key={i}
          colors={colors as [string, string, ...string[]]}
          locations={locations as [number, number, ...number[]]}
          style={{ position: "absolute", left: 0, right: 0, top: i * pitch, height: pitch }}
        />
      ))}
    </>
  );
}

const ROLL_MS: Partial<Record<LoginLook, number>> = { tube: 6000, vhs: 3000, led: 2400, holo: 2000 };

/** The colours of the three solid looks (neon, 3d, flat), as on web. */
type Solid = { face: [string, string]; glow: string | null; side: [string, string] | null; shade?: Shade };
/** Flat's finish, as on the desktop logo: a 1pt darker lip and a soft shadow below. */
type Shade = { lip: string; shadow: number };
function solidColors(look: LoginLook, theme: string, isLight: boolean, p: Palette): Solid {
  if (look === "neon") {
    const neon = isLight ? "#E0249A" : theme === "hazy" ? "#B48CFF" : theme === "osaka" ? "#FF5FAE" : "#FF4FD8";
    const core = isLight ? mix(neon, "#FFFFFF", 0.7) : mix(neon, "#FFFFFF", 0.22);
    return { face: [core, core], glow: neon, side: null };
  }
  if (look === "3d") {
    if (isLight) return { face: ["#2A2B33", "#0B0B0D"], glow: null, side: ["#9A9BA6", "#C8C9D1"] };
    const [low, side, sideLow] =
      theme === "hazy" ? ["#D9C8FF", "#5B3E98", "#2A1A4C"]
      : theme === "osaka" ? ["#FFD0E7", "#9C2F66", "#4A1230"]
      : ["#C9CCD6", "#4A4C57", "#23242B"];
    return { face: ["#FFFFFF", low], glow: null, side: [side, sideLow] };
  }
  const shade: Shade = isLight
    ? { lip: "rgba(0,0,0,0.22)", shadow: 0.22 }
    : { lip: mix(p.ink, "#8A8F99", 0.45), shadow: 0.65 };
  return { face: [p.ink, p.ink], glow: null, side: null, shade };
}
const SOLID: LoginLook[] = ["neon", "3d", "flat"];
/** How deep the 3D letters are, in 1pt steps. */
const DEPTH = 5;

/** What shows inside the letters, for an area `height` tall. */
function Fill({ look, p, height, roll, small }: { look: LoginLook; p: Palette; height: number; roll: Animated.Value; small: boolean }) {
  const move = (from: number, to: number) => ({ transform: [{ translateY: roll.interpolate({ inputRange: [0, 1], outputRange: [from, to] }) }] });
  if (look === "tube") {
    const pitch = small ? 8 : 6;
    return (
      <>
        <Animated.View style={[styles.roll, { height: height + 72 }, move(0, -72)]}>
          <Lines pitch={pitch} height={height + 72} colors={[p.ink, p.ink, p.low, p.gap, p.gap, p.ink]} locations={[0, 0.36, 0.68, 0.8, 0.9, 1]} />
        </Animated.View>
        <Animated.View style={[styles.band, { height: 34 }, move(-60, 140)]}>
          <LinearGradient colors={["rgba(0,0,0,0)", "rgba(0,0,0,0.34)", "rgba(0,0,0,0)"]} style={StyleSheet.absoluteFill} />
        </Animated.View>
      </>
    );
  }
  if (look === "vhs") {
    return (
      <>
        <Animated.View style={[styles.roll, { height: height + 48 }, move(0, -48)]}>
          <Lines pitch={4} height={height + 48} colors={[p.ink, p.ink, p.tape, p.ink]} locations={[0, 0.5, 0.72, 1]} />
        </Animated.View>
        <Animated.View style={[styles.band, { height: 18 }, move(-40, 120)]}>
          <LinearGradient colors={["rgba(255,255,255,0)", "rgba(255,255,255,0.22)", "rgba(255,255,255,0)"]} style={StyleSheet.absoluteFill} />
        </Animated.View>
      </>
    );
  }
  if (look === "led") {
    return (
      <>
        <Image source={small ? DOTS_SMALL : DOTS} resizeMode="repeat" style={[StyleSheet.absoluteFill, { width: "100%", height: "100%", tintColor: p.ink }]} />
        <Animated.View style={[styles.roll, { height: height + 40 }, move(0, -40)]}>
          <Lines pitch={10} height={height + 40} colors={[p.gapClear, p.gapClear, p.gap, p.gapClear]} locations={[0, 0.62, 0.82, 1]} />
        </Animated.View>
      </>
    );
  }
  return (
    <>
      <LinearGradient colors={[p.holoTop, p.holoLow]} style={StyleSheet.absoluteFill} />
      <Animated.View style={[styles.roll, { height: height + 28 }, move(0, -28)]}>
        <Lines pitch={7} height={height + 28} colors={["rgba(0,0,0,0)", "rgba(0,0,0,0)", p.holoGap, "rgba(0,0,0,0)"]} locations={[0, 0.58, 0.76, 0.94]} />
      </Animated.View>
      <Animated.View style={[styles.band, { height: 5 }, move(150, -70)]}>
        <LinearGradient colors={["rgba(255,255,255,0)", "rgba(255,255,255,0.95)", "rgba(255,255,255,0)"]} style={StyleSheet.absoluteFill} />
      </Animated.View>
    </>
  );
}

function headlineStyle(look: LoginLook): TextStyle {
  if (look === "led") return { fontSize: 24, lineHeight: 27, fontWeight: "800", letterSpacing: 0.24, textTransform: "uppercase" };
  if (look === "holo") return { fontSize: 20, lineHeight: 30, fontWeight: "600", letterSpacing: 2.6, textTransform: "uppercase" };
  if (look === "neon" || look === "flat") return { fontSize: 30, lineHeight: 32, fontWeight: "800", letterSpacing: 0 };
  if (look === "3d") return { fontSize: 30, lineHeight: 32, fontWeight: "900", letterSpacing: -0.3 };
  return { fontSize: 30, lineHeight: 32, fontWeight: "900", letterSpacing: -0.6 };
}

/** The sign itself: wordmark above the headline. Drawn twice for the VHS tear. */
function SignBody({ look, p, text, roll, copy, solid }: { look: LoginLook; p: Palette; text: string; roll: Animated.Value; copy?: boolean; solid?: Solid }) {
  const { t } = useTranslation();
  const base = headlineStyle(look);
  // Each headline line stays on one line: the letters shrink to fit the
  // width (in every language) instead of a line breaking in two.
  const [boxW, setBoxW] = useState(0);
  const [natural, setNatural] = useState(0);
  const fit = boxW && natural ? Math.min(1, (boxW - 2) / natural) : 1;
  const hl = fit < 1 ? {
    ...base,
    fontSize: (base.fontSize ?? 30) * fit,
    lineHeight: (base.lineHeight ?? 32) * fit,
    letterSpacing: (base.letterSpacing ?? 0) * fit,
  } : base;
  const [late, setLate] = useState(false);
  useEffect(() => { const id = setTimeout(() => setLate(true), 250); return () => clearTimeout(id); }, []);
  const measured = (!!boxW && !!natural) || late;
  const lines = text.split("\n").length;
  const textH = (hl.lineHeight ?? 32) * lines;
  const edges = look === "vhs";
  // Neon has its own glow; 3D and Flat have none.
  const glow = solid ? solid.glow : p.halo && !edges ? p.halo : null;
  const halo = !!glow;
  const depth = solid?.side ? Array.from({ length: DEPTH }, (_, i) => DEPTH - i) : [];
  const sideAt = (step: number) => (step > 2 ? solid!.side![1] : solid!.side![0]);
  const hidden = { accessibilityElementsHidden: true, importantForAccessibility: "no-hide-descendants" as const };
  return (
    <View>
      <View style={styles.mark} pointerEvents="none" {...(copy ? hidden : { accessible: true, accessibilityRole: "image" as const, accessibilityLabel: t("maintenance.brand") })}>
        {halo && (
          <Image source={HALO} resizeMode="contain" style={[styles.halo, { tintColor: glow!, opacity: look === "neon" ? 0.95 : look === "holo" ? 0.42 : 0.3 }]} {...hidden} />
        )}
        {solid?.shade && (
          <>
            <Image source={SHADE} resizeMode="contain" style={[styles.halo, { tintColor: "#000000", opacity: solid.shade.shadow, transform: [{ translateY: 6 }] }]} {...hidden} />
            <Image source={WORDMARK} resizeMode="contain" style={[styles.markImg, { tintColor: solid.shade.lip, transform: [{ translateY: 1 }] }]} {...hidden} />
          </>
        )}
        {depth.map((step) => (
          <Image key={step} source={WORDMARK} resizeMode="contain" style={[styles.markImg, { tintColor: sideAt(step), transform: [{ translateX: step }, { translateY: step }] }]} {...hidden} />
        ))}
        {edges && (
          <>
            <Image source={WORDMARK} resizeMode="contain" style={[styles.markImg, { tintColor: TV_RED, transform: [{ translateX: -1.5 }] }]} {...hidden} />
            <Image source={WORDMARK} resizeMode="contain" style={[styles.markImg, { tintColor: TV_BLUE, transform: [{ translateX: 1.5 }] }]} {...hidden} />
          </>
        )}
        {solid ? (
          // Solid looks paint the letters straight from the tinted wordmark.
          // Android's MaskedView only redraws when its content changes, so with
          // nothing moving inside it the mask stayed blank once the wordmark
          // image finished loading and Flat (the default) showed no logo.
          <Image source={WORDMARK} resizeMode="contain" style={[styles.markImg, { tintColor: solid.face[0] }]} {...hidden} />
        ) : (
          <MaskedView style={StyleSheet.absoluteFill} maskElement={<Image source={WORDMARK} resizeMode="contain" style={styles.markImg} />} {...hidden}>
            <Fill look={look} p={p} height={MARK_H} roll={roll} small={false} />
          </MaskedView>
        )}
      </View>
      <View
        onLayout={(e) => { const w = Math.round(e.nativeEvent.layout.width); if (w !== boxW) setBoxW(w); }}
        // Hidden for the one frame before the fit is known, so a line is never seen breaking.
        style={measured ? null : { opacity: 0 }}
      >
        {/* Measures each line at full size, unwrapped. */}
        <View style={styles.measure} pointerEvents="none" {...hidden}>
          <Text
            style={[styles.text, base, { alignSelf: "flex-start" }]}
            onLayout={(e) => { const w = Math.ceil(e.nativeEvent.layout.width); if (w && w !== natural) setNatural(w); }}
          >
            {text}
          </Text>
        </View>
        {solid?.shade && (
          // The lip, carrying the soft shadow so it sits under the letters.
          <Text
            style={[
              styles.text, hl, styles.edge, styles.shadeRoom,
              {
                color: solid.shade.lip, transform: [{ translateY: 1 }],
                textShadowColor: `rgba(0,0,0,${solid.shade.shadow})`, textShadowOffset: { width: 0, height: 5 }, textShadowRadius: 14,
              },
            ]}
            {...hidden}
          >
            {text}
          </Text>
        )}
        {depth.map((step) => (
          <Text key={step} style={[styles.text, hl, styles.edge, { color: sideAt(step), transform: [{ translateX: step }, { translateY: step }] }]} {...hidden}>{text}</Text>
        ))}
        {edges && (
          <>
            <Text style={[styles.text, hl, styles.edge, { color: TV_RED, transform: [{ translateX: -1.5 }] }]} {...hidden}>{text}</Text>
            <Text style={[styles.text, hl, styles.edge, { color: TV_BLUE, transform: [{ translateX: 1.5 }] }]} {...hidden}>{text}</Text>
          </>
        )}
        {/* Lays the sign out, reads it to screen readers and carries the halo;
            the lit letters are drawn over it. Padded so Android has room to
            draw the halo, with the padding taken back by the margin. */}
        <Text
          style={[
            styles.text,
            hl,
            styles.glowRoom,
            { color: solid ? solid.face[0] : look === "holo" ? p.holoLow : p.low },
            halo ? { textShadowColor: glow!, textShadowOffset: { width: 0, height: 0 }, textShadowRadius: look === "neon" ? 14 : 6 } : null,
          ]}
          {...(copy ? hidden : { accessibilityRole: "header" as const })}
        >
          {text}
        </Text>
        {!solid && (
          <MaskedView style={StyleSheet.absoluteFill} maskElement={<Text style={[styles.text, hl, styles.maskText]}>{text}</Text>} pointerEvents="none" {...hidden}>
            <Fill look={look} p={p} height={textH} roll={roll} small />
          </MaskedView>
        )}
      </View>
    </View>
  );
}

/**
 * Old TV flicker on the whole sign: short, small dips and a tiny sideways
 * twitch on a 3.6s loop; it never switches off. Each step is [percent of the
 * loop, opacity, x], the same beats as web's ls-tv-flicker.
 */
const TV_LOOP_MS = 3600;
const TV_STEPS: [number, number, number][] = [
  [9, 0.93, 0], [10, 1, 0], [27, 0.965, 0], [28, 1, 0], [29, 0.91, 0], [30, 1, 0],
  [52, 0.95, 0.75], [53, 1, 0], [71, 0.97, 0], [72, 1, 0], [86, 0.92, -0.5], [87, 1, 0],
];
/** Hologram glitch on a 4.2s loop: [percent, skew in degrees, x], as web's ls-holo-glitch. */
const HOLO_LOOP_MS = 4200;
const HOLO_STEPS: [number, number, number][] = [[84, -10, 4], [85.5, 6, -3], [87, 0, 0], [93, -4, 2], [94, 0, 0]];

/** Neon buzz on a 5.2s loop: [percent, opacity, x], as web's ls-neon-buzz. */
const NEON_LOOP_MS = 5200;
const NEON_STEPS: [number, number, number][] = [[61, 0.55, 0], [62, 1, 0], [64, 0.4, 0], [65.5, 1, 0], [88, 0.86, 0], [89, 1, 0]];

function useSteps(steps: [number, number, number][], loopMs: number, still: boolean) {
  const a = useRef(new Animated.Value(steps === HOLO_STEPS ? 0 : 1)).current;
  const x = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    a.setValue(steps === HOLO_STEPS ? 0 : 1);
    x.setValue(0);
    if (still) return;
    let at = 0;
    const beats: Animated.CompositeAnimation[] = [];
    for (const [pct, va, vx] of steps) {
      const time = (pct / 100) * loopMs;
      beats.push(Animated.delay(time - at));
      beats.push(Animated.parallel([
        Animated.timing(a, { toValue: va, duration: 0, useNativeDriver: true }),
        Animated.timing(x, { toValue: vx, duration: 0, useNativeDriver: true }),
      ]));
      at = time;
    }
    beats.push(Animated.delay(loopMs - at));
    const anim = Animated.loop(Animated.sequence(beats));
    anim.start();
    return () => anim.stop();
  }, [a, x, steps, loopMs, still]);
  return [a, x] as const;
}

/** VHS tracking tear: every 5s a 22pt slice sweeps down the sign, dragged sideways. */
const TEAR_H = 22;
function useTear(on: boolean) {
  const y = useRef(new Animated.Value(-140)).current;
  const shift = useRef(new Animated.Value(0)).current;
  const shown = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!on) return;
    const set = (v: Animated.Value, to: number) => Animated.timing(v, { toValue: to, duration: 0, useNativeDriver: true });
    const anim = Animated.loop(Animated.sequence([
      Animated.delay(2900),
      Animated.parallel([set(y, -140), set(shift, 6), set(shown, 1)]),
      Animated.parallel([
        Animated.timing(y, { toValue: 64, duration: 600, easing: Easing.linear, useNativeDriver: true }),
        Animated.sequence([
          Animated.timing(shift, { toValue: 11, duration: 300, easing: Easing.linear, useNativeDriver: true }),
          Animated.timing(shift, { toValue: 5, duration: 300, easing: Easing.linear, useNativeDriver: true }),
        ]),
      ]),
      set(shown, 0),
      Animated.delay(1500),
    ]));
    anim.start();
    return () => anim.stop();
  }, [on, y, shift, shown]);
  return { y, shift, shown };
}

/** 3D: the sign turns slowly side to side, 7s each way, eased, as web's ls-3d-turn. */
function useTurn(on: boolean) {
  const v = useRef(new Animated.Value(0.5)).current;
  useEffect(() => {
    v.setValue(on ? 0 : 0.5);
    if (!on) return;
    const ease = Easing.inOut(Easing.quad);
    const anim = Animated.loop(Animated.sequence([
      Animated.timing(v, { toValue: 1, duration: 7000, easing: ease, useNativeDriver: true }),
      Animated.timing(v, { toValue: 0, duration: 7000, easing: ease, useNativeDriver: true }),
    ]));
    anim.start();
    return () => anim.stop();
  }, [on, v]);
  return v;
}

export default function LoginSign({ look, text, theme, isLight, still, style }: {
  look: LoginLook;
  /** Both headline lines, joined with "\n". */
  text: string;
  theme: string;
  isLight: boolean;
  still: boolean;
  style?: object;
}) {
  const p = signPalette(theme, isLight);
  const solid = SOLID.includes(look) ? solidColors(look, theme, isLight, p) : undefined;
  const roll = useLoop(ROLL_MS[look] ?? 1000, still || !!solid);
  const neon = look === "neon";
  // The TV flicker (or the neon buzz); 3D and Flat hold steady.
  const [opacity, twitch] = useSteps(neon ? NEON_STEPS : TV_STEPS, neon ? NEON_LOOP_MS : TV_LOOP_MS, still || look === "3d" || look === "flat");
  const turn = useTurn(look === "3d" && !still);
  const [skew, glitchX] = useSteps(HOLO_STEPS, HOLO_LOOP_MS, still || look !== "holo");
  const tear = useTear(look === "vhs" && !still);
  return (
    <Animated.View style={[style, { opacity, transform: [{ translateX: twitch }] }]}>
      {/* Colours are written for the final tone already. */}
      <KeepDarkScope>
        <Animated.View
          style={
            look === "holo" ? { transform: [{ translateX: glitchX }, { skewX: skew.interpolate({ inputRange: [-10, 10], outputRange: ["-10deg", "10deg"] }) }] }
            : look === "3d" ? { transform: [{ perspective: 700 }, { rotateX: "12deg" }, { rotateY: turn.interpolate({ inputRange: [0, 1], outputRange: ["-16deg", "16deg"] }) }] }
            : null
          }
        >
          <SignBody look={look} p={p} text={text} roll={roll} solid={solid} />
          {look === "vhs" && !still && (
            <Animated.View pointerEvents="none" style={[styles.tearClip, { opacity: tear.shown, transform: [{ translateY: tear.y }] }]}>
              <Animated.View style={[styles.tearCopy, { transform: [{ translateY: Animated.multiply(tear.y, -1) }, { translateX: tear.shift }] }]}>
                <SignBody look={look} p={p} text={text} roll={roll} copy />
              </Animated.View>
            </Animated.View>
          )}
        </Animated.View>
      </KeepDarkScope>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  // Sits just above the headline; the letters end MARK_GAP above it.
  mark: { position: "absolute", alignSelf: "center", bottom: "100%", marginBottom: MARK_GAP, width: MARK_W, height: MARK_H },
  markImg: { position: "absolute", left: 0, top: 0, width: MARK_W, height: MARK_H },
  halo: { position: "absolute", left: -HALO_PAD, top: -HALO_PAD, width: MARK_W + HALO_PAD * 2, height: MARK_H + HALO_PAD * 2 },
  text: { color: "#FFFFFF", textAlign: "center" },
  glowRoom: { paddingVertical: 12, marginVertical: -12 },
  edge: { position: "absolute", left: 0, right: 0, top: 0 },
  // Room for the soft shadow (5 down, 14 blur) so Android does not cut it flat.
  shadeRoom: { top: -24, paddingVertical: 24 },
  maskText: { color: "#000000" },
  roll: { position: "absolute", left: 0, right: 0, top: 0 },
  measure: { position: "absolute", left: 0, top: 0, width: 2000, opacity: 0, alignItems: "flex-start" },
  band: { position: "absolute", left: 0, right: 0, top: 0 },
  tearClip: { position: "absolute", left: -40, right: -40, top: 0, height: TEAR_H, overflow: "hidden" },
  tearCopy: { position: "absolute", left: 40, right: 40, top: 0 },
});
