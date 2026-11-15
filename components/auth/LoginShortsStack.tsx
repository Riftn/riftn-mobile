import React, { useEffect, useRef, useState } from "react";
import { Animated, Easing, Image, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import MaskedView from "@react-native-masked-view/masked-view";
import { VideoView, useVideoPlayer } from "expo-video";
import { shareAudioWhenSilent } from "../../libs/videoAudioMixing";
import { useTranslation } from "react-i18next";
import { useAppTheme } from "../../context/ThemeContext";
import { useSilenceOnRelease } from "../../hooks/useSilenceOnRelease";
import { useReducedMotion } from "react-native-reanimated";
import { KeepDarkScope } from "../../libs/jsx/tone";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { loginClipLanes } from "../../libs/login-clip-lanes";
import { LOGIN_CLIPS as CLIPS } from "./login-clip-assets";

/**
 * The Riftn wordmark as a neon sign, pre-lit (tube + glow + shade baked in at
 * 3x with 20pt of room for the glow), one per tint. Matches the web sheet:
 * white on most themes, lilac on Hazy, pink on Osaka, a darker shade on light.
 */
const NEON = {
  white: require("../../assets/login-stack/neon-white.png"),
  light: require("../../assets/login-stack/neon-light.png"),
  hazy: require("../../assets/login-stack/neon-hazy.png"),
  osaka: require("../../assets/login-stack/neon-osaka.png"),
};
const NEON_W = 250;
const NEON_H = 102;
/** Glow room baked into the image under the letters, in points. */
const NEON_PAD = 20;
/** Gap between the letters and the headline, as on web. */
const NEON_GAP = 18;

/** Faint red/blue TV edge, colour themes only (System and Light stay clean). */
const TV_RED = "rgba(255,40,80,0.35)";
const TV_BLUE = "rgba(40,220,255,0.35)";
const TV_EDGE = 1;

/** Soft scan line tile: one line every 2pt that fades in and out, no hard edge. */
const TV_LINES = require("../../assets/login-stack/tv-lines.png");

/**
 * Old TV inside the letters only: soft scan lines plus a faint band rolling
 * down, cut to the shape of whatever `mask` draws. Same as the web sheet.
 */
function TvLines({ mask, light, line, band, from, to, still }: {
  mask: React.ReactElement; light: boolean; line: number; band: string; from: number; to: number; still: boolean;
}) {
  const roll = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (still) return;
    const anim = Animated.loop(Animated.timing(roll, { toValue: 1, duration: 4500, easing: Easing.linear, useNativeDriver: true }));
    anim.start();
    return () => anim.stop();
  }, [roll, still]);
  return (
    <MaskedView style={StyleSheet.absoluteFill} maskElement={mask} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {/* Colours as written: System Light's pass would turn the white lines on ink into ink. */}
      <KeepDarkScope>
        <Image source={TV_LINES} resizeMode="repeat" style={[styles.tvLines, { tintColor: light ? "#FFFFFF" : "#000000", opacity: line }]} />
        {!still && (
          <Animated.View style={[styles.tvBand, { transform: [{ translateY: roll.interpolate({ inputRange: [0, 1], outputRange: [from, to] }) }] }]}>
            <LinearGradient colors={["transparent", band, "transparent"]} style={StyleSheet.absoluteFill} />
          </Animated.View>
        )}
      </KeepDarkScope>
    </MaskedView>
  );
}

function NeonLogo({ tint, edges, light, still }: { tint: keyof typeof NEON; edges: boolean; light: boolean; still: boolean }) {
  const { t } = useTranslation();
  return (
    <View style={styles.neon} pointerEvents="none">
      {edges && (
        <>
          <Image source={NEON[tint]} style={[styles.neonImg, { tintColor: TV_RED, transform: [{ translateX: -TV_EDGE }] }]} resizeMode="contain" accessibilityElementsHidden importantForAccessibility="no" />
          <Image source={NEON[tint]} style={[styles.neonImg, { tintColor: TV_BLUE, transform: [{ translateX: TV_EDGE }] }]} resizeMode="contain" accessibilityElementsHidden importantForAccessibility="no" />
        </>
      )}
      <Image
        source={NEON[tint]}
        accessibilityRole="image"
        accessibilityLabel={t("maintenance.brand")}
        style={styles.neonImg}
        resizeMode="contain"
      />
      {/* The letters start NEON_PAD into the image, so the band starts and ends where web's does. */}
      <TvLines
        mask={<Image source={NEON[tint]} style={styles.neonImg} resizeMode="contain" />}
        light={light}
        line={light ? 0.16 : 0.15}
        band={light ? "rgba(255,255,255,0.1)" : "rgba(255,255,255,0.12)"}
        from={NEON_PAD - 40}
        to={NEON_PAD + 110}
        still={still}
      />
    </View>
  );
}

/**
 * Old TV flicker on the logo and headline together: short, small dips and a
 * tiny sideways twitch on a 3.6s loop; it never switches off. Each step is
 * [percent of the loop, opacity, x], the same beats as web's ls-tv-flicker.
 */
const TV_LOOP_MS = 3600;
const TV_STEPS: [number, number, number][] = [
  [9, 0.93, 0], [10, 1, 0], [27, 0.965, 0], [28, 1, 0], [29, 0.91, 0], [30, 1, 0],
  [52, 0.95, 0.75], [53, 1, 0], [71, 0.97, 0], [72, 1, 0], [86, 0.92, -0.5], [87, 1, 0],
];
function useTvFlicker(still: boolean) {
  const opacity = useRef(new Animated.Value(1)).current;
  const x = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (still) return;
    let at = 0;
    const beats: Animated.CompositeAnimation[] = [];
    for (const [pct, o, dx] of TV_STEPS) {
      const time = (pct / 100) * TV_LOOP_MS;
      beats.push(Animated.delay(time - at));
      beats.push(Animated.parallel([
        Animated.timing(opacity, { toValue: o, duration: 0, useNativeDriver: true }),
        Animated.timing(x, { toValue: dx, duration: 0, useNativeDriver: true }),
      ]));
      at = time;
    }
    beats.push(Animated.delay(TV_LOOP_MS - at));
    const anim = Animated.loop(Animated.sequence(beats));
    anim.start();
    return () => anim.stop();
  }, [opacity, x, still]);
  return { opacity, transform: [{ translateX: x }] };
}

/**
 * The top half of the sign-in screen: two phone lanes, or three on wider screens, drifting past
 * in opposite directions, then the headline. Shares the selected clip
 * catalogue and shuffled lane order with the web drawer.
 *
 * The clips ship with the app (sources in assets/login-stack/SOURCES.txt),
 * so the sign-in screen never waits on the
 * network and can never show a feed post.
 *
 * Colours: the tiles sit in KeepDarkScope and are written in their final
 * colours; the headline is written dark (white) and System Light flips it to
 * ink like every other screen.
 */
type ClipName = keyof typeof CLIPS;

const GAP = 8;
const SIDE = 10;
/** One trip through a lane's four clips, as on web. */
const LOOP_MS = 32000;

/**
 * Mounted only once its tile has come into view, so opening the screen builds
 * no players at all and the first few start a frame later. Fades in on its
 * first decoded frame instead of popping in over the empty tile.
 */
function Clip({ name, playing }: { name: ClipName; playing: boolean }) {
  const player = useVideoPlayer(CLIPS[name].video, (p) => {
    shareAudioWhenSilent(p);
    p.muted = true;
    p.loop = true;
  });
  useSilenceOnRelease(player);
  const opacity = useRef(new Animated.Value(0)).current;
  const fadeIn = () => Animated.timing(opacity, { toValue: 1, duration: 450, easing: Easing.out(Easing.quad), useNativeDriver: true }).start();
  useEffect(() => {
    if (playing) player.play();
    else player.pause();
  }, [player, playing]);
  return (
    <Animated.View style={[StyleSheet.absoluteFill, { opacity }]}>
      <Image source={CLIPS[name].poster} style={StyleSheet.absoluteFill} resizeMode="cover" />
      <VideoView
        onFirstFrameRender={fadeIn}
        player={player}
        style={StyleSheet.absoluteFill}
        contentFit="cover"
        // Android SurfaceView bypasses the mask and paints over the headline.
        surfaceType="textureView"
        nativeControls={false}
        allowsPictureInPicture={false}
        fullscreenOptions={{ enable: false }}
      />
    </Animated.View>
  );
}

/**
 * A lane is its four clips plus the first two again, so the jump from the end
 * back to the start lands on the same picture. Only tiles inside the window
 * play, so at most three decode per lane.
 *
 * Reduce Motion only stops the drift: the clips in view still play. It used to
 * swap every clip for its still frame, which read as a broken login.
 */
function Lane({ clips, down, tileW, height, still, line, armed }: {
  clips: ClipName[];
  down?: boolean;
  tileW: number;
  height: number;
  still: boolean;
  line: string;
  armed: boolean;
}) {
  const tileH = (tileW * 16) / 9;
  const step = tileH + GAP;
  const span = step * clips.length;
  // Lane B starts part-way down a tile, like web's -40% offset.
  const offset = down ? -tileW * 0.4 : 0;
  const tiles = [...clips, ...clips.slice(0, 2)];

  // Which tiles overlap the window when the loop is at `value` (0..1).
  const visibleAt = (value: number) => {
    const y = (down ? span * (1 - value) : span * value) - offset;
    return tiles.map((_, i) => i * step + tileH > y && i * step < y + height);
  };
  const t = useRef(new Animated.Value(0)).current;
  const [visible, setVisible] = useState<boolean[]>(() => visibleAt(0));
  // Tiles that have been on screen keep their player, so a clip drifting back
  // in does not reload; tiles never seen never build one.
  const [seen, setSeen] = useState<boolean[]>(() => visibleAt(0));
  useEffect(() => {
    setSeen((prev) => (visible.some((v, i) => v && !prev[i]) ? prev.map((p, i) => p || visible[i]) : prev));
  }, [visible]);

  useEffect(() => {
    if (still) return;
    const anim = Animated.loop(
      Animated.timing(t, { toValue: 1, duration: LOOP_MS, easing: Easing.linear, useNativeDriver: true }),
    );
    anim.start();
    const id = t.addListener(({ value }) => {
      const next = visibleAt(value);
      setVisible((prev) => (prev.every((v, i) => v === next[i]) ? prev : next));
    });
    return () => {
      anim.stop();
      t.removeListener(id);
    };
    // visibleAt only reads the values listed here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t, still, down, span, step, tileH, height, offset, clips]);

  const translateY = t.interpolate({
    inputRange: [0, 1],
    outputRange: down ? [offset - span, offset] : [offset, offset - span],
  });

  return (
    <Animated.View style={{ width: tileW, gap: GAP, transform: [{ translateY }] }}>
      {tiles.map((name, i) => (
        <View key={i} style={[styles.tile, { width: tileW, height: tileH, borderColor: line }]}>
          {armed && seen[i] ? <Clip name={name} playing={visible[i]} /> : null}
        </View>
      ))}
    </Animated.View>
  );
}

/** Swaps the "You will own everything / and be happy." lines, e.g. for the sign-in code step. */
export interface LoginStackHeadline {
  top: string;
  accent: string;
}

export default function LoginShortsStack({ viewportHeight, reservedHeight = 360, headline }: { viewportHeight?: number; reservedHeight?: number; headline?: LoginStackHeadline }) {
  const { t } = useTranslation();
  const { theme, isLight } = useAppTheme();
  const still = !!useReducedMotion();
  const [lanes] = useState(() => loginClipLanes(Object.keys(CLIPS) as ClipName[]));
  const { width, height: screenH } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  // The screen slides up with empty tiles; clips start building the frame
  // after it has drawn, so opening sign-in never waits on video players.
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    let second = 0;
    const first = requestAnimationFrame(() => { second = requestAnimationFrame(() => setArmed(true)); });
    return () => { cancelAnimationFrame(first); cancelAnimationFrame(second); };
  }, []);

  // Neon tint shared by the logo and the headline. The headline is written
  // dark (white); System Light flips it to ink, where it gets no glow.
  const tint = theme === "hazy" ? "hazy" : theme === "osaka" ? "osaka" : isLight ? "light" : "white";
  const sign = isLight
    ? null
    : {
        color: tint === "hazy" ? "#E4D2FF" : tint === "osaka" ? "#FFC2E0" : "#FFFFFF",
        textShadowColor: tint === "hazy" ? "rgba(201,167,255,0.5)" : tint === "osaka" ? "rgba(255,111,181,0.5)" : "rgba(255,255,255,0.35)",
        textShadowOffset: { width: 0, height: 0 },
        textShadowRadius: 8,
      };
  const edges = !isLight && theme !== "system";
  const flicker = useTvFlicker(still);
  const headlineText = `${headline?.top ?? t("loginStack.headlineTop", "You will own everything")}\n${headline?.accent ?? t("loginStack.headlineAccent", "and be happy.")}`;
  const line = isLight ? "rgba(11,11,13,0.08)" : theme === "osaka" ? "rgba(80,200,255,0.4)" : "rgba(255,255,255,0.10)";

  // The screen pads 24 each side; the lanes sit 10 from the edges.
  const lanesW = width - SIDE * 2;
  const selected = [...lanes.first, ...lanes.second];
  const columns = width >= 768 ? [selected.slice(0, 3), selected.slice(3, 6), selected.slice(6)] : [lanes.first, lanes.second];
  const tileW = (lanesW - GAP * (columns.length - 1)) / columns.length;
  // Native navigation can give the sheet less space than the window reports.
  // Budget against the actual scroll frame, reserving room for the form.
  const availableHeight = viewportHeight ?? screenH - insets.top - insets.bottom;
  const lanesH = Math.floor(Math.max(160, availableHeight - reservedHeight));

  return (
    <View style={styles.root}>
      <KeepDarkScope>
        <MaskedView
          style={{ width: lanesW, marginHorizontal: SIDE - 24, height: lanesH }}
          maskElement={
            <LinearGradient
              colors={["#000", "#000", "transparent"]}
              locations={[0, 0.58, 0.92]}
              style={StyleSheet.absoluteFill}
            />
          }
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          <View style={[styles.lanes, { height: lanesH }]}>
            {columns.map((clips, index) => <Lane key={index} clips={clips} down={index % 2 === 1} tileW={tileW} height={lanesH} still={still} line={line} armed={armed} />)}
          </View>
        </MaskedView>
      </KeepDarkScope>
      <Animated.View style={[styles.headline, flicker]}>
        <NeonLogo tint={tint} edges={edges} light={isLight} still={still} />
        {/* Both lines lit like the logo, so logo and headline read as one sign.
            One Text, padded: Android draws a text shadow only inside the Text's
            own box, so two Texts cut the glow flat under each line. The
            padding gives the glow room, the negative margin takes it back. */}
        <View>
          {edges && (
            <>
              <Text style={[styles.headlineText, styles.edge, { color: TV_RED, transform: [{ translateX: -TV_EDGE }] }]} accessibilityElementsHidden importantForAccessibility="no">{headlineText}</Text>
              <Text style={[styles.headlineText, styles.edge, { color: TV_BLUE, transform: [{ translateX: TV_EDGE }] }]} accessibilityElementsHidden importantForAccessibility="no">{headlineText}</Text>
            </>
          )}
          <Text style={[styles.headlineText, sign, styles.glowRoom]} accessibilityRole="header">
            {headlineText}
          </Text>
          <TvLines
            mask={<Text style={[styles.headlineText, styles.maskText]}>{headlineText}</Text>}
            light={isLight}
            line={isLight ? 0.21 : 0.2}
            band={isLight ? "rgba(255,255,255,0.18)" : "rgba(255,255,255,0.18)"}
            from={-40}
            to={110}
            still={still}
          />
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { alignItems: "stretch" },
  corner: { position: "absolute", left: -24, top: 0, width: 220, height: 170 },
  lanes: { flexDirection: "row", gap: GAP, overflow: "hidden" },
  tile: { borderRadius: 18, borderWidth: 1, overflow: "hidden", backgroundColor: "#111" },
  ai: {
    position: "absolute",
    left: 8,
    top: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingVertical: 4,
    paddingLeft: 6,
    paddingRight: 8,
    borderRadius: 999,
    backgroundColor: "rgba(0,0,0,0.45)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.25)",
  },
  aiText: { color: "#FFFFFF", fontSize: 10, fontWeight: "800", letterSpacing: 0.2 },
  headline: { marginTop: -64 },
  // Sits over the faded bottom of the lanes; the letters end NEON_GAP above the headline.
  neon: { position: "absolute", alignSelf: "center", bottom: "100%", marginBottom: NEON_GAP - NEON_PAD, width: NEON_W, height: NEON_H },
  headlineText: { color: "#FFFFFF", textAlign: "center", fontSize: 30, lineHeight: 32, fontWeight: "900", letterSpacing: -0.6 },
  glowRoom: { paddingVertical: 12, marginVertical: -12 },
  neonImg: { position: "absolute", left: 0, top: 0, width: NEON_W, height: NEON_H },
  edge: { position: "absolute", left: 0, right: 0, top: 0 },
  maskText: { color: "#000000" },
  tvLines: { position: "absolute", left: 0, top: 0, width: "100%", height: "100%" },
  tvBand: { position: "absolute", left: 0, right: 0, top: 0, height: 26 },
});
