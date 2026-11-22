/**
 * The beat between logging in and the logged-in app: the Rift.
 *
 * `SignInWaitVeil` dims the sign-in screen while it waits, and in the middle a
 * slit of light in the shape of the Riftn mark's middle stroke breathes while
 * specks drift into it. No words. If the account lands while the veil is still
 * up, the rift tears open into its picture right there.
 *
 * `SignInArrival` sits at the app root. When a log-in lands it opens the same
 * rift into the account's picture and name (or shows it already open, when
 * the veil got there first), then sends the picture to where it lives in the
 * header. It never takes a touch.
 *
 * Log-ins only. The picture comes from the log-in response itself (see
 * noteSignInAccount), not from the profile refetch after it, and starts
 * loading at once; the rift opens when it is in or after a short cap.
 *
 * The Rift is the default. Settings → Appearance → After you sign in swaps it
 * for Trace, Tune in, Deck or Glass drop (ArrivalConcepts, libs/arrival-look).
 * Only what plays and how the picture comes in change; the picture and its
 * flight home are shared.
 */
import React, { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Animated, Easing, Platform, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Image } from 'expo-image';
import Svg, { Defs, Ellipse, LinearGradient, Path, RadialGradient, Stop } from 'react-native-svg';
import { useAuthState, useUser } from '../../context/AuthContext';
import { useAppTheme } from '../../context/ThemeContext';
import { getAvatarUrl, getBadgeHoverOpticalStyle as getBadgeOpticalStyle, getBadgeUrlFor } from '../../libs/misc';
import BadgeArtwork from '../common/BadgeArtwork';
import { withAlpha } from '../ui/glow';
import {
  measureOwnAvatar,
  noteSignInWaitStarted,
  noteSignInWaiting,
  peekArrivingAccount,
  rootSignInWaiting,
  setRootSignInWait,
  signInWaitStartedAt,
  signInWasWaiting,
  subscribeRootSignInWait,
  subscribeArrivingAccount,
  takeArrivingAccount,
  noteArrivalPlaying,
  type ArrivingAccount,
} from '../../libs/signInHandoff';
import {
  ARRIVAL_INTRO_MS,
  CONCEPT_HOLD_MS,
  CONCEPT_NAME_MS,
  isConceptLook as isConceptName,
  useArrivalLook,
  type ArrivalLook,
  type ConceptLook,
} from '../../libs/arrival-look';
import { optionalSkia } from '../../libs/skia';

// Skia is only in the newer binaries; on older ones the concepts play as the Rift.
const ConceptArrival = optionalSkia(
  () => (require('./ArrivalConcepts') as typeof import('./ArrivalConcepts')).ConceptArrival,
);

const FRAME = 120;
/** The profile picture's curve (96pt with a 12pt corner), scaled to the frame. */
const RADIUS = 15;
/**
 * The rift: a thin line with the Riftn mark's middle-stroke ends, the top end
 * curving on the left and the bottom end on the right.
 */
const LINE_W = 6;
const LINE_H = 112;
const LINE_PATH = 'M0 112L0 6Q0 0 6 0L6 106Q6 112 0 112Z';
/** The Riftn mark (assets brand-icon.svg on web). */
const MARK_PATH = 'M868.0 1411.1C865.0 1410.1 850.4 1405.3 835.5 1400.5C805.2 1390.7 783.8 1382.8 771.1 1376.9C717.6 1351.7 677.9 1324.1 639.5 1285.6C609.6 1255.6 590.7 1231.4 568.8 1195.0C551.3 1165.8 533.4 1123.9 523.7 1089.0C515.5 1059.9 511.6 1039.4 508.5 1009.0C507.1 995.1 506.9 967.6 507.2 749.0L507.5 504.5L552.5 504.5C597.0 504.5 597.6 504.5 605.0 506.9C634.6 516.1 654.8 536.7 664.1 567.0L666.4 574.5L667.1 783.0C667.5 910.3 668.2 994.6 668.8 999.5C672.9 1032.5 683.8 1067.8 699.3 1098.5C706.9 1113.5 712.2 1122.1 723.1 1136.9C751.6 1175.7 783.2 1202.4 828.4 1226.0C838.4 1231.2 843.3 1234.6 850.6 1241.2C860.7 1250.5 869.9 1264.7 874.3 1278.0C878.3 1290.1 878.5 1293.7 878.5 1354.0L878.5 1412.5L876.0 1412.7C874.6 1412.9 871.0 1412.1 868.0 1411.1ZM1035.7 1412.3C1035.3 1412.0 1035.0 1385.5 1035.0 1353.6C1035.0 1300.8 1035.2 1294.7 1036.9 1286.4C1040.5 1269.2 1048.7 1254.3 1060.9 1242.7C1068.7 1235.4 1075.0 1231.1 1088.0 1224.2C1136.6 1198.6 1172.6 1165.5 1201.4 1120.1C1225.3 1082.4 1238.4 1044.7 1244.1 997.6C1245.9 982.2 1246.0 972.8 1246.0 780.3C1246.0 585.7 1246.1 578.9 1247.9 571.3C1250.4 561.2 1252.4 555.8 1256.2 549.0C1268.3 527.2 1287.4 512.3 1310.8 506.4C1320.0 504.1 1321.2 504.0 1362.4 504.0C1393.9 504.0 1404.9 504.3 1405.8 505.2C1407.4 506.8 1407.6 962.7 1406.0 988.5C1402.8 1041.2 1392.1 1089.5 1373.0 1137.5C1361.3 1167.0 1335.8 1211.7 1316.3 1237.0C1299.7 1258.6 1293.0 1266.1 1272.6 1286.5C1239.8 1319.1 1206.7 1343.6 1168.0 1363.7C1162.2 1366.8 1155.9 1370.1 1154.0 1371.1C1137.6 1379.8 1121.7 1385.9 1075.6 1401.1C1040.4 1412.7 1037.0 1413.7 1035.7 1412.3ZM883.1 836.6C882.3 835.6 882.0 765.2 882.2 564.9L882.5 294.5L885.5 286.0C892.9 265.5 909.0 250.5 932.5 242.5C944.5 238.4 950.0 238.0 998.1 238.0C1032.9 238.0 1044.9 238.3 1045.8 239.2C1046.7 240.1 1047.0 300.6 1047.0 505.5C1047.0 786.1 1047.1 779.4 1042.6 791.9C1036.3 809.4 1017.8 826.1 997.5 832.8C982.3 837.8 980.0 838.0 930.7 838.0C892.7 838.0 884.0 837.8 883.1 836.6Z';
/** The mark spins in fast, slows and stops edge-on, which is the line. */
const INTRO_MS = 1100;
const OPEN_MS = 480;
/** How long after a sheet's veil closes its log-in may still land. */
const SHEET_GRACE_MS = 2500;
const HOLD_MS = 450;
const FLY_MS = 520;
/** The rift opens by then whether or not the picture is in; it fades in late. */
const PICTURE_CAP_MS = 650;
/** With no picture known at the log-in, how long to wait for the profile's. */
const NO_PICTURE_WAIT_MS = 1500;
/** A noted log-in older than this is not this sign-in's. */
const ACCOUNT_MAX_AGE_MS = 15_000;
/** A wait that ended this long ago without an account was not a log-in. */
const WAIT_GRACE_MS = 1200;
/** The veil behind the rift: the sign-in page dims to near black. */
const VEIL = 'rgba(6,7,9,0.92)';
/** Light themes: the sign-in page is light, so a near-black veil read as a dark wave sweeping over it. They get a pale veil and no rift. */
const LIGHT_VEIL = 'rgba(247,248,250,0.96)';
const VEIL_IN_MS = 220;
const VEIL_OUT_MS = 260;
/** The spin's ease, cubic-bezier(0.12, 0.7, 0.3, 1), as points (native-driven interpolation takes no easing). */
const SPIN_EASE = Easing.bezier(0.12, 0.7, 0.3, 1);
const SPIN_IN = Array.from({ length: 25 }, (_, i) => i / 24);
const SPIN_OUT = SPIN_IN.map((x) => SPIN_EASE(x));

/**
 * Specks drifting in: [start x, start y, ms, delay ms, size]. A cloud around
 * the line, taller than wide, as in the concept.
 */
const SPECKS: Array<[number, number, number, number, number]> = (() => {
  let seed = 42;
  const r = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  return Array.from({ length: 26 }, () => {
    const ang = r() * Math.PI * 2;
    const rad = 70 + r() * 110;
    return [Math.cos(ang) * rad * 0.55, Math.sin(ang) * rad, 1700 + r() * 1300, r() * 600, 1.5 + r() * 2] as [number, number, number, number, number];
  });
})();

type Rgb = [number, number, number];
const NEUTRAL_THEMES = new Set(['system', 'light', 'minimal', 'immersive']);
const hex = (c: Rgb) => `#${c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')}`;
const lift = (c: Rgb, p: number): Rgb => c.map((v) => v + (255 - v) * p) as Rgb;

/** The glow's two colours: white on the plain themes, the theme's colour elsewhere. */
function useRiftColors(): { a: string; b: string } {
  const { theme, accent } = useAppTheme();
  return useMemo(() => {
    if (NEUTRAL_THEMES.has(theme)) return { a: '#ffffff', b: '#c9d2e3' };
    return { a: hex(lift(accent as Rgb, 0.15)), b: hex(lift(accent as Rgb, 0.6)) };
  }, [theme, accent]);
}

/** When the veil last opened on a picture: the arrival then starts already open. */
let veilOpenedAt = 0;
/**
 * Bumped when a sheet's veil opens on the picture: the root arrival then
 * draws the same open picture underneath, so when the sheet closes the
 * picture is already there (no frame of the app, no empty frame).
 */
let sheetOpenTick = 0;
const sheetOpenListeners = new Set<() => void>();
const subscribeSheetOpen = (l: () => void) => { sheetOpenListeners.add(l); return () => { sheetOpenListeners.delete(l); }; };
const readSheetOpen = () => sheetOpenTick;

function useArriving(): ArrivingAccount | null {
  return useSyncExternalStore(subscribeArrivingAccount, () => peekArrivingAccount(ACCOUNT_MAX_AGE_MS));
}

const styles = StyleSheet.create({
  veilHost: { ...StyleSheet.absoluteFillObject, zIndex: 20 },
  veil: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(6,7,9,0.86)' },
  stage: { width: 0, height: 0, alignItems: 'center', justifyContent: 'center' },
  abs: { position: 'absolute' },
  frame: { position: 'absolute', width: FRAME, height: FRAME, alignItems: 'center', justifyContent: 'center' },
  window: { height: FRAME, overflow: 'hidden', backgroundColor: '#16181d', alignItems: 'center', justifyContent: 'center' },
  picture: { position: 'absolute', width: FRAME, height: FRAME },
  initial: { color: 'rgba(255,255,255,0.85)', fontSize: 52, fontWeight: '700' },
  speck: { position: 'absolute', borderRadius: 2, backgroundColor: '#fff' },
  arrival: { ...StyleSheet.absoluteFillObject, zIndex: 9999, elevation: 9999, alignItems: 'center', justifyContent: 'center' },
  nameRow: {
    position: 'absolute', alignSelf: 'center', maxWidth: 320, flexDirection: 'row', alignItems: 'center', gap: 6,
  },
  name: {
    flexShrink: 1, fontSize: 24, lineHeight: 30, fontWeight: '700', textAlign: 'center',
    textShadowColor: 'rgba(0,0,0,0.35)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 10,
  },
  nameBadge: { alignSelf: 'flex-end', height: 28, justifyContent: 'center' },
});

/** One speck drifting into the stroke, on its own loop. */
/**
 * A soft glow that follows what is drawn inside, like web's stacked
 * `drop-shadow(0 0 Npx c)`: [blur px, colour, alpha], innermost first.
 * Android draws the same drop-shadow filter as web; iPhone a layer shadow per
 * glow. Padded so the glow is never clipped at the view's edge. No stroked
 * bands: those read as outlines, not light.
 */
const Glow: React.FC<{ layers: Array<[number, string, number]>; pad: number; children: React.ReactNode }> = ({ layers, pad, children }) => {
  const box = { padding: pad, alignItems: 'center' as const, justifyContent: 'center' as const };
  if (!layers.length) return <View style={box}>{children}</View>;
  if (Platform.OS === 'web') {
    const filter = layers.map(([blur, color, a]) => `drop-shadow(0 0 ${blur}px ${withAlpha(color, a)})`).join(' ');
    return <View style={[box, { filter } as any]}>{children}</View>;
  }
  if (Platform.OS === 'android') {
    const filter = layers.map(([blur, color, a]) => ({
      dropShadow: { offsetX: 0, offsetY: 0, standardDeviation: blur / 2, color: withAlpha(color, a) },
    }));
    return <View style={[box, { filter } as any]}>{children}</View>;
  }
  // iPhone: each layer's shadow follows everything inside it, so nesting stacks them.
  return layers.reduce<React.ReactNode>((inner, [blur, color, a], i) => (
    <View style={[i === layers.length - 1 ? box : null, { shadowColor: color, shadowOpacity: a, shadowRadius: blur / 2, shadowOffset: { width: 0, height: 0 } }]}>
      {inner}
    </View>
  ), children) as React.ReactElement;
};

const Speck: React.FC<{ x: number; y: number; ms: number; delay: number; phase: number; size: number; color: string; burst: Animated.Value }> = ({ x, y, ms, delay, phase, size, color, burst }) => {
  // The first drift starts part-way in, so the cloud is there with the line
  // rather than building up over a few seconds.
  const t = useRef(new Animated.Value(phase)).current;
  useEffect(() => {
    let loop: Animated.CompositeAnimation | null = null;
    const ease = Easing.in(Easing.quad);
    const start = setTimeout(() => {
      Animated.timing(t, { toValue: 1, duration: ms * (1 - phase), easing: ease, useNativeDriver: true }).start(({ finished }) => {
        if (!finished) return;
        t.setValue(0);
        loop = Animated.loop(Animated.timing(t, { toValue: 1, duration: ms, easing: ease, useNativeDriver: true }));
        loop.start();
      });
    }, delay);
    return () => { clearTimeout(start); t.stopAnimation(); loop?.stop(); };
  }, [t, ms, delay, phase]);
  const along = t.interpolate({ inputRange: [0, 1], outputRange: [1, 0] });
  // A speck that starts mid-flight fades in instead of popping on.
  const appear = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const a = Animated.timing(appear, { toValue: 1, duration: 260, delay, useNativeDriver: true });
    a.start();
    return () => a.stop();
  }, [appear, delay]);
  return (
    <Animated.View
      style={[styles.speck, {
        width: size,
        height: size,
        backgroundColor: color,
        opacity: Animated.multiply(
          Animated.multiply(
            t.interpolate({ inputRange: [0, 0.12, 0.9, 1], outputRange: [0, 0.9, 0.7, 0] }),
            burst.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }),
          ),
          appear,
        ),
        transform: [
          { translateX: Animated.multiply(along, Animated.add(x, burst.interpolate({ inputRange: [0, 1], outputRange: [0, x * 1.5] }))) },
          { translateY: Animated.multiply(along, Animated.add(y, burst.interpolate({ inputRange: [0, 1], outputRange: [0, y * 1.5] }))) },
        ],
      }]}
    />
  );
};

/**
 * The rift itself, centred on its parent's middle. It opens with the mark
 * spinning in (unless `instantOpen`), then breathes; `opened` tears it open
 * into the picture frame. Callers open it no earlier than INTRO_MS after mount.
 */
const Rift: React.FC<{
  picture: string | null;
  name: string;
  opened: boolean;
  instantOpen?: boolean;
  /** Start on the line: the spin already played on the veil. */
  skipIntro?: boolean;
  /** How much of the spin already played (on the sheet's veil): carry on from there. */
  introElapsed?: number;
}> = ({ picture, name, opened, instantOpen, skipIntro, introElapsed = 0 }) => {
  const from = Math.min(1, Math.max(0, introElapsed / INTRO_MS));
  const noIntro = !!(instantOpen || skipIntro) || from >= 1;
  const colors = useRiftColors();
  // A linear clock, eased below, so a spin that started on the sheet carries on mid-turn.
  const clock = useRef(new Animated.Value(noIntro ? 1 : from)).current;
  const spin = useMemo(() => clock.interpolate({ inputRange: SPIN_IN, outputRange: SPIN_OUT }), [clock]);
  const breathe = useRef(new Animated.Value(0)).current;
  const tear = useRef(new Animated.Value(instantOpen ? 1 : 0)).current; // native: line + halo + specks
  // The window opens by scale (on the UI thread, so a busy JS thread while the
  // app mounts underneath can't make it step); its picture is scaled back.
  const winX = useMemo(() => tear.interpolate({ inputRange: [0, 1], outputRange: [LINE_W / FRAME, 1] }), [tear]);
  const winY = useMemo(() => tear.interpolate({ inputRange: [0, 1], outputRange: [LINE_H / FRAME, 1] }), [tear]);
  const unX = useMemo(() => Animated.divide(1, winX), [winX]);
  const unY = useMemo(() => Animated.divide(1, winY), [winY]);
  const [ready, setReady] = useState(false);
  // When the line shows, from this mount: the spin is 85% done then.
  const lineAt = useRef(noIntro ? 0 : Math.max(0, Math.round(INTRO_MS * (0.85 - from)))).current;

  useEffect(() => {
    let loop: Animated.CompositeAnimation | null = null;
    const startBreathing = () => {
      loop = Animated.loop(Animated.sequence([
        Animated.timing(breathe, { toValue: 1, duration: 800, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(breathe, { toValue: 0, duration: 800, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]));
      loop.start();
    };
    if (noIntro) startBreathing();
    else Animated.timing(clock, { toValue: 1, duration: INTRO_MS * (1 - from), easing: Easing.linear, useNativeDriver: true }).start(({ finished }) => { if (finished) startBreathing(); });
    return () => { clock.stopAnimation(); loop?.stop(); };
    // `from` is read once: the spin is not restarted by a later prop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clock, breathe, noIntro]);

  useEffect(() => {
    if (!opened || instantOpen) return;
    const ease = Easing.bezier(0.2, 0.8, 0.2, 1);
    Animated.timing(tear, { toValue: 1, duration: OPEN_MS, easing: ease, useNativeDriver: true }).start();
  }, [opened, instantOpen, tear]);

  const lineIn = spin.interpolate({ inputRange: [0, 0.85, 1], outputRange: [0, 0, 1] });
  const gone = tear.interpolate({ inputRange: [0, 1], outputRange: [1, 0] });
  // Never a "?": an account with no name yet shows the plain frame.
  const initial = (name || '').trim().charAt(0).toUpperCase();
  const mark = (trail: number) => (
    <Animated.View
      key={trail}
      style={[styles.abs, {
        opacity: trail
          ? spin.interpolate({ inputRange: [0, 0.2, 0.6, 1], outputRange: [0, 0.22 / trail, 0, 0] })
          : spin.interpolate({ inputRange: [0, 0.22, 0.88, 1], outputRange: [0, 1, 1, 0] }),
        transform: [
          { perspective: 600 },
          { rotateY: spin.interpolate({ inputRange: [0, 1], outputRange: [`${-30 * trail}deg`, `${990 - 4 * trail}deg`] }) },
          { scale: spin.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1.02] }) },
        ],
      }]}
    >
      <Glow layers={trail ? [] : [[10, colors.a, 1]]} pad={24}>
        <Svg width={110} height={110} viewBox="351 223 1210 1210">
          <Path d={MARK_PATH} fill="#ffffff" />
        </Svg>
      </Glow>
    </Animated.View>
  );
  return (
    <View style={styles.stage} pointerEvents="none">
      {/* halo */}
      <Animated.View style={[styles.abs, {
        opacity: Animated.multiply(Animated.multiply(lineIn, gone), tear.interpolate({ inputRange: [0, 0.5, 1], outputRange: [1, 0.35, 0] })),
        transform: [
          { scaleX: tear.interpolate({ inputRange: [0, 1], outputRange: [1, 1.4] }) },
          { scale: breathe.interpolate({ inputRange: [0, 1], outputRange: [0.94, 1.04] }) },
        ],
      }]}>
        <Svg width={120} height={220}>
          <Defs>
            <RadialGradient id="riftHalo" cx="50%" cy="50%" rx="50%" ry="50%">
              <Stop offset="0" stopColor={colors.a} stopOpacity={0.55} />
              <Stop offset="0.55" stopColor={colors.b} stopOpacity={0.12} />
              <Stop offset="1" stopColor={colors.b} stopOpacity={0} />
            </RadialGradient>
          </Defs>
          <Ellipse cx={60} cy={110} rx={60} ry={110} fill="url(#riftHalo)" />
        </Svg>
      </Animated.View>

      {/* the bloom right around the line */}
      <Animated.View style={[styles.abs, {
        opacity: Animated.multiply(lineIn, tear.interpolate({ inputRange: [0, 0.6, 1], outputRange: [1, 0.3, 0] })),
        transform: [{ scaleY: breathe.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1.06] }) }],
      }]}>
        <Svg width={60} height={170}>
          <Defs>
            <RadialGradient id="riftBloom" cx="50%" cy="50%" rx="50%" ry="50%">
              <Stop offset="0" stopColor="#ffffff" stopOpacity={0.75} />
              <Stop offset="0.35" stopColor={colors.a} stopOpacity={0.45} />
              <Stop offset="1" stopColor={colors.a} stopOpacity={0} />
            </RadialGradient>
          </Defs>
          <Ellipse cx={30} cy={85} rx={30} ry={85} fill="url(#riftBloom)" />
        </Svg>
      </Animated.View>

      {SPECKS.map(([x, y, ms, delay, size], i) => (
        <Speck
          key={i} x={x} y={y} ms={ms} size={size}
          // From when the spin lands on the line, staggered a little.
          delay={lineAt + delay}
          phase={0.2 + ((i * 0.37) % 0.5)}
          color={i % 2 ? colors.b : '#fff'} burst={tear}
        />
      ))}

      {!noIntro && [2, 1, 0].map(mark)}

      {/* the window the line tears open into */}
      <Animated.View style={[styles.window, {
        width: FRAME,
        borderRadius: RADIUS,
        opacity: opened ? 1 : 0,
        transform: [{ scaleX: winX }, { scaleY: winY }],
      }]}>
        <Animated.View style={[styles.picture, { alignItems: 'center', justifyContent: 'center', transform: [{ scaleX: unX }, { scaleY: unY }] }]}>
          {/* Only an account with no picture shows its initial; one whose
              picture is on its way shows the dark frame it fades into. */}
          {!picture ? (initial ? <Text style={styles.initial}>{initial}</Text> : null) : (
            <Image
              source={{ uri: picture }}
              style={[styles.picture, { opacity: ready ? 1 : 0 }]}
              contentFit="cover"
              transition={160}
              onLoad={() => setReady(true)}
              accessible={false}
            />
          )}
        </Animated.View>
      </Animated.View>

      {/* the line of light */}
      <Animated.View style={[styles.abs, {
        opacity: Animated.multiply(lineIn, tear.interpolate({ inputRange: [0, 0.35, 1], outputRange: [1, 0, 0] })),
        transform: [
          { scaleX: tear.interpolate({ inputRange: [0, 0.35, 1], outputRange: [1, 4, 4] }) },
          { scaleY: Animated.add(
            breathe.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1.05] }),
            tear.interpolate({ inputRange: [0, 1], outputRange: [0, 0.05] }),
          ) },
        ],
      }]}>
        <Glow layers={[[4, '#ffffff', 1], [12, colors.a, 1], [30, colors.a, 0.6]]} pad={40}>
        <Svg width={LINE_W} height={LINE_H} viewBox="0 0 6 112">
          <Defs>
            <LinearGradient id="riftFill" x1="0" y1="0" x2="1" y2="0">
              <Stop offset="0" stopColor={colors.b} />
              <Stop offset="0.3" stopColor="#ffffff" />
              <Stop offset="0.7" stopColor="#ffffff" />
              <Stop offset="1" stopColor={colors.b} />
            </LinearGradient>
          </Defs>
          <Path d={LINE_PATH} fill="url(#riftFill)" />
        </Svg>
        </Glow>
      </Animated.View>
    </View>
  );
};


type MarkProps = { picture: string | null; name: string; opened: boolean; instantOpen?: boolean; skipIntro?: boolean; introElapsed?: number };

/** Trace, Tune in, Deck and Glass drop (ArrivalConcepts), in the theme's colours. */
const Concept: React.FC<MarkProps & { look: ConceptLook }> = (props) => {
  const colors = useRiftColors();
  if (!ConceptArrival) return <Rift {...props} />;
  const { introElapsed: _introElapsed, ...rest } = props;
  return <ConceptArrival {...rest} colors={colors} />;
};

export const isConceptLook = (look: ArrivalLook): look is ConceptLook => !!ConceptArrival && isConceptName(look);

/**
 * The name under the picture, as on the profile: bold 24pt with the badge
 * after it, no chip. White on the sign-in veil; the theme's text colour once
 * the app shows through.
 */
const ArrivalName: React.FC<{ name: string; badge?: number; color: string; style?: any }> = ({ name, badge, color, style }) => (
  <Animated.View style={[styles.nameRow, style]} pointerEvents="none">
    <Text numberOfLines={1} style={[styles.name, { color }]}>{name}</Text>
    {badge ? (
      <View style={styles.nameBadge}>
        <BadgeArtwork source={badge} style={[getBadgeOpticalStyle(badge, 20), { marginLeft: 0 }]} contentFit="contain" />
      </View>
    ) : null}
  </Animated.View>
);

/** The picked arrival. */
export const ArrivalMarks: React.FC<MarkProps & { look: ArrivalLook }> = ({ look, ...props }) =>
  isConceptLook(look) ? <Concept look={look} {...props} /> : <Rift {...props} />;

/**
 * Open once the picture is in (or PICTURE_CAP_MS has passed without it), and
 * not before `notBefore`. Returns the cancel.
 */
function openWhenReady(picture: string | null, notBefore: number, open: () => void): () => void {
  let cancelled = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const openAt = (at: number) => {
    if (cancelled) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { if (!cancelled) open(); }, Math.max(0, Math.max(at, notBefore) - Date.now()));
  };
  openAt(Date.now() + PICTURE_CAP_MS);
  if (picture) void Image.prefetch(picture).then((ok) => { if (ok) openAt(Date.now()); }).catch(() => {});
  return () => { cancelled = true; if (timer) clearTimeout(timer); };
}

/**
 * The wait. On the sign-in page (`atRoot`) the app root draws it
 * (SignInArrival), so the veil and the rift carry on unbroken while the page
 * under them is swapped for the app; here only a still layer takes the touches.
 * Inside a sheet (a native modal, which the root can't draw over) it is drawn
 * here, and the root carries on from wherever the spin had got to.
 */
export const SignInWaitVeil: React.FC<{ label?: string; atRoot?: boolean }> = ({ label, atRoot }) => {
  useEffect(() => {
    if (!atRoot) return;
    noteSignInWaiting();
    setRootSignInWait(true);
    return () => {
      noteSignInWaiting();
      setRootSignInWait(false);
    };
  }, [atRoot]);
  if (atRoot) {
    return (
      <View
        style={styles.veilHost}
        accessible
        accessibilityRole="progressbar"
        accessibilityLabel={label}
        testID="signin-wait-veil"
      />
    );
  }
  return <SheetWaitVeil label={label} />;
};

const SheetWaitVeil: React.FC<{ label?: string }> = ({ label }) => {
  const { isLight } = useAppTheme();
  const fade = useRef(new Animated.Value(0)).current;
  const look = useArrivalLook();
  const arriving = useArriving();
  const [opened, setOpened] = useState(false);
  const picture = arriving?.avatarImageUrl ? getAvatarUrl(arriving.avatarImageUrl, FRAME) : null;

  useEffect(() => {
    noteSignInWaitStarted();
    noteSignInWaiting();
    const tick = setInterval(noteSignInWaiting, 250);
    Animated.timing(fade, { toValue: 1, duration: VEIL_IN_MS, useNativeDriver: true }).start();
    return () => {
      clearInterval(tick);
      noteSignInWaiting();
    };
  }, [fade]);

  // The account landed while the veil is still up: open here, on the picture
  // or after the cap.
  // Never before the spin has landed on the line.
  const mountedAt = useRef(Date.now()).current;
  useEffect(() => {
    if (opened) {
      veilOpenedAt = Date.now();
      sheetOpenTick += 1;
      sheetOpenListeners.forEach((l) => l());
      return;
    }
    // Nothing to open on yet (no picture, no name): the arrival opens once
    // the profile has them, instead of a blank frame or a "?" here.
    if (!arriving || (!picture && !arriving.name)) return;
    return openWhenReady(picture, mountedAt + ARRIVAL_INTRO_MS[look], () => setOpened(true));
  }, [arriving, opened, picture, mountedAt, look]);

  // The name comes in under the picture once it is there.
  const [nameOn, setNameOn] = useState(false);
  useEffect(() => {
    if (!opened) { setNameOn(false); return; }
    const timer = setTimeout(() => setNameOn(true), isConceptLook(look) ? CONCEPT_NAME_MS[look as ConceptLook] : 0);
    return () => clearTimeout(timer);
  }, [opened, look]);

  return (
    // dark-surface: the sign-in screen is dark on every theme, so System Light
    // must not flip these greys.
    <View className="dark-surface" style={styles.veilHost}>
      <Animated.View
        style={[styles.veil, { opacity: fade }, isLight && { backgroundColor: LIGHT_VEIL }]}
        accessible
        accessibilityRole="progressbar"
        accessibilityLabel={label}
        testID="signin-wait-veil"
      >
        {!isLight && <ArrivalMarks look={look} picture={picture} name={arriving?.name || ''} opened={opened} />}
        {!isLight && nameOn && arriving?.name ? (
          <ArrivalName name={arriving.name} badge={arriving.badge} color="#ffffff" style={{ top: '50%', marginTop: FRAME / 2 + 12 }} />
        ) : null}
      </Animated.View>
    </View>
  );
};

type Session = {
  /** When this session's rift went on screen. */
  at: number;
  /** How much of the spin had played before it (on a sheet's veil). */
  introElapsed: number;
  /** The log-in's account, once signed in. Until then the noted one is peeked. */
  taken: ArrivingAccount | null;
  takenAt: number;
  /** The sheet's veil already opened on the picture. */
  instant: boolean;
  skipIntro: boolean;
  /** Drawn under a sheet whose veil already opened on the picture. */
  fromSheet?: boolean;
};

/**
 * At the app root, above every screen: the wait the sign-in page asked for,
 * then the arrival. The veil stays until the picture flies home, so the app
 * swapping in under it is never seen; it clears as the picture flies.
 */
export const SignInArrival: React.FC = () => {
  const { isLight } = useAppTheme();
  const { isSignedIn, needsUsername } = useAuthState();
  const user = useUser();
  const { width, height } = useWindowDimensions();
  const look = useArrivalLook();
  const rootWait = useSyncExternalStore(subscribeRootSignInWait, rootSignInWaiting);
  const peeked = useArriving();
  const [session, setSessionState] = useState<Session | null>(null);
  const sessionRef = useRef<Session | null>(null);
  const setSession = (s: Session | null) => { sessionRef.current = s; setSessionState(s); };
  const [opened, setOpened] = useState(false);
  const wasIn = useRef(isSignedIn && !needsUsername);
  const address = String(user?.address || (user as any)?.walletAddress || '').toLowerCase();
  const wasAddress = useRef(address);
  const veil = useRef(new Animated.Value(0)).current;
  const opacity = useRef(new Animated.Value(1)).current;
  const nameOpacity = useRef(new Animated.Value(0)).current;
  const move = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  const scale = useRef(new Animated.Value(1)).current;

  const begin = (s: Session, veilUp: boolean) => {
    veil.stopAnimation();
    opacity.setValue(1);
    // Under a sheet the name is already showing: keep it, no fade.
    nameOpacity.setValue(s.fromSheet ? 1 : 0);
    move.setValue({ x: 0, y: 0 });
    scale.setValue(1);
    veil.setValue(veilUp ? 1 : 0);
    if (!veilUp) Animated.timing(veil, { toValue: 1, duration: VEIL_IN_MS, useNativeDriver: true }).start();
    setOpened(s.instant);
    setSession(s);
  };

  // A sheet's veil opened on the picture: draw it open underneath now, so it
  // is already there the moment the sheet goes.
  const sheetOpen = useSyncExternalStore(subscribeSheetOpen, readSheetOpen);
  useEffect(() => {
    if (!sheetOpen || sessionRef.current) return;
    begin({ at: Date.now(), introElapsed: 0, taken: null, takenAt: 0, instant: true, skipIntro: true, fromSheet: true }, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sheetOpen]);

  // The sign-in page is waiting: the veil and the spin, from here.
  useEffect(() => {
    if (!rootWait || sessionRef.current) return;
    begin({ at: Date.now(), introElapsed: 0, taken: null, takenAt: 0, instant: false, skipIntro: false }, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rootWait]);

  const signedIn = isSignedIn && !needsUsername;
  useEffect(() => {
    // A log-in, or a switch to another account (Add profile) while signed in.
    const switched = signedIn && wasIn.current && !!address && !!wasAddress.current && address !== wasAddress.current;
    const arrived = (signedIn && !wasIn.current) || switched;
    wasIn.current = signedIn;
    if (address) wasAddress.current = address;
    if (!arrived) return;
    // Only a log-in: the account was noted by the log-in itself. A session
    // restored at launch, or a new account finishing its sign-up, has none.
    const account = takeArrivingAccount(ACCOUNT_MAX_AGE_MS);
    if (!account) return;
    noteArrivalPlaying(6000);
    const current = sessionRef.current;
    if (current && !current.taken) {
      // The wait drawn here carries on into the arrival, unbroken.
      setSession({ ...current, taken: account, takenAt: Date.now() });
      return;
    }
    const veilWasUp = signInWasWaiting(1500);
    const instant = veilWasUp && Date.now() - veilOpenedAt < 8000;
    const introElapsed = veilWasUp ? Date.now() - signInWaitStartedAt() : 0;
    begin({
      at: Date.now(), introElapsed, taken: account, takenAt: Date.now(), instant,
      skipIntro: veilWasUp && introElapsed >= ARRIVAL_INTRO_MS[look],
    }, veilWasUp);
    // `user` and `look` are read, not followed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signedIn, address]);

  // The wait ended without a log-in (cancelled, failed, or a new account
  // going on to pick its name): let it go.
  useEffect(() => {
    if (rootWait || !session || session.taken) return;
    const letGo = () => {
      if (sessionRef.current !== session) return;
      Animated.parallel([
        Animated.timing(veil, { toValue: 0, duration: VEIL_OUT_MS, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0, duration: VEIL_OUT_MS, useNativeDriver: true }),
      ]).start(() => { if (sessionRef.current === session) { setSession(null); setOpened(false); } });
    };
    if (session.fromSheet) {
      // Kept while the sheet is up, and a little after it closes for the
      // log-in to land; let go if it never does.
      const poll = setInterval(() => { if (!signInWasWaiting(SHEET_GRACE_MS)) { clearInterval(poll); letGo(); } }, 250);
      return () => clearInterval(poll);
    }
    const timer = setTimeout(letGo, WAIT_GRACE_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rootWait, session]);

  // The log-in response may not carry the picture, name or badge: the
  // profile that loads right after it fills them in, never a "?".
  const account = session ? (session.taken ?? peeked) : null;
  const signedInNow = !!session?.taken;
  const picture = account?.avatarImageUrl
    ? getAvatarUrl(account.avatarImageUrl, FRAME)
    : signedInNow && user?.avatarImageUrl ? getAvatarUrl(user.avatarImageUrl, FRAME) : null;
  const name = account?.name || (signedInNow ? user?.displayName || user?.username || '' : '');
  const badge = account?.badge ?? (signedInNow && user && !(user as any).hideBadgeAndBalance ? getBadgeUrlFor(user) : undefined);

  // Open on the picture, or after the cap without it, never before the spin
  // has landed on the line. With no picture known yet, give the profile a
  // moment to bring it before opening on the frame.
  useEffect(() => {
    if (!session || opened || !account) return;
    const notBefore = session.skipIntro || session.instant
      ? 0
      : session.at + Math.max(0, ARRIVAL_INTRO_MS[look] - session.introElapsed);
    if (!picture) {
      if (!session.taken) return;
      const timer = setTimeout(() => setOpened(true), Math.max(0, Math.max(notBefore, session.takenAt + NO_PICTURE_WAIT_MS) - Date.now()));
      return () => clearTimeout(timer);
    }
    return openWhenReady(picture, notBefore, () => setOpened(true));
    // `look` is read, not followed: a change mid-arrival waits for the next one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, opened, picture, !!account]);

  // Open and signed in: show the name, hold, then send the picture home as
  // the veil clears.
  useEffect(() => {
    if (!session || !opened || !session.taken) return;
    let cancelled = false;
    const end = () => { if (!cancelled) { setSession(null); setOpened(false); } };
    const concept = isConceptLook(look);
    const nameDelay = session.instant ? 0 : concept ? CONCEPT_NAME_MS[look as ConceptLook] : 200;
    Animated.timing(nameOpacity, { toValue: 1, duration: 240, delay: nameDelay, useNativeDriver: true }).start();
    const timer = setTimeout(async () => {
      const to = await measureOwnAvatar();
      if (cancelled) return;
      Animated.timing(nameOpacity, { toValue: 0, duration: 140, useNativeDriver: true }).start();
      Animated.timing(veil, { toValue: 0, duration: VEIL_OUT_MS, useNativeDriver: true }).start();
      if (!to) {
        Animated.parallel([
          Animated.timing(opacity, { toValue: 0, duration: 240, useNativeDriver: true }),
          Animated.timing(scale, { toValue: 0.92, duration: 240, useNativeDriver: true }),
        ]).start(end);
        return;
      }
      const ease = Easing.bezier(0.2, 0.8, 0.2, 1);
      Animated.parallel([
        Animated.timing(move, {
          toValue: { x: to.x + to.width / 2 - width / 2, y: to.y + to.height / 2 - height / 2 },
          duration: FLY_MS, easing: ease, useNativeDriver: true,
        }),
        Animated.timing(scale, { toValue: to.width / FRAME, duration: FLY_MS, easing: ease, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0, duration: 160, delay: FLY_MS - 80, useNativeDriver: true }),
      ]).start(end);
    }, session.instant ? HOLD_MS : concept ? CONCEPT_HOLD_MS : OPEN_MS + HOLD_MS);
    return () => { cancelled = true; clearTimeout(timer); };
    // `look` is read, not followed, as above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.taken, session?.at, opened, width, height]);

  if (!session) return null;
  return (
    <View className="dark-surface" style={styles.arrival} pointerEvents="none" testID="signin-arrival">
      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: isLight ? LIGHT_VEIL : VEIL, opacity: veil }]} />
      {!isLight && <Animated.View style={[styles.frame, { opacity, transform: [...move.getTranslateTransform(), { scale }] }]}>
        <ArrivalMarks
          key={session.at}
          look={look}
          picture={picture}
          name={name}
          opened={opened}
          instantOpen={session.instant}
          skipIntro={session.skipIntro}
          introElapsed={session.introElapsed}
        />
      </Animated.View>}
      {!isLight && name && opened ? (
        // White on the veil, which is up for as long as the name shows.
        <ArrivalName name={name} badge={badge} color="#ffffff" style={{ opacity: nameOpacity, top: height / 2 + FRAME / 2 + 12 }} />
      ) : null}
    </View>
  );
};

export default SignInWaitVeil;
