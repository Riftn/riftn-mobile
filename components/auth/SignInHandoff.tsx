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
 * for Trace (a light runs round the picture's outline), Picture frame (an
 * empty frame that fills) or Orbit (a light circles, then the picture grows
 * out of the middle), libs/arrival-look. Only the marks and the way the
 * frame opens change; the timing, picture and flight home are shared.
 */
import React, { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Animated, Easing, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Image } from 'expo-image';
import Svg, { Defs, Ellipse, LinearGradient, Path, RadialGradient, Stop } from 'react-native-svg';
import { useAuthState, useUser } from '../../context/AuthContext';
import { useAppTheme } from '../../context/ThemeContext';
import { getAvatarUrl } from '../../libs/misc';
import {
  measureOwnAvatar,
  noteSignInWaiting,
  peekArrivingAccount,
  signInWasWaiting,
  subscribeArrivingAccount,
  takeArrivingAccount,
  type ArrivingAccount,
} from '../../libs/signInHandoff';
import { ARRIVAL_INTRO_MS, useArrivalLook, type ArrivalLook } from '../../libs/arrival-look';

const FRAME = 120;
/** Trace: where a light running round the frame's outline is, for 0 → 1 of a lap. */
const EDGE = FRAME / 2;
const LAP = [0, 0.125, 0.375, 0.625, 0.875, 1];
const LAP_X = [0, EDGE, EDGE, -EDGE, -EDGE, 0];
const LAP_Y = [-EDGE, -EDGE, EDGE, EDGE, -EDGE, -EDGE];
/** Orbit's ring. */
const RING = 148;
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
const HOLD_MS = 450;
const FLY_MS = 520;
/** The rift opens by then whether or not the picture is in; it fades in late. */
const PICTURE_CAP_MS = 650;
/** A noted log-in older than this is not this sign-in's. */
const ACCOUNT_MAX_AGE_MS = 15_000;

/** Specks drifting in: [start x, start y, ms, delay ms]. */
const SPECKS: Array<[number, number, number, number]> = [
  [-92, -70, 2100, 0], [86, -96, 2600, 400], [-70, 104, 2300, 900], [104, 62, 2000, 1300],
  [-118, 18, 2800, 200], [64, 120, 2400, 1600], [-40, -126, 2200, 1100], [124, -20, 2700, 700],
  [-104, 88, 2500, 1900], [30, -118, 2900, 2200], [96, 100, 2600, 500], [118, -78, 2400, 1800],
];

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
  speck: { position: 'absolute', width: 3, height: 3, borderRadius: 1.5, backgroundColor: '#fff' },
  square: { width: FRAME, borderRadius: RADIUS },
  box: { position: 'absolute', width: FRAME, height: FRAME, borderRadius: RADIUS, backgroundColor: '#16181d', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)' },
  boxRim: { position: 'absolute', left: -2, top: -2, right: -2, bottom: -2, borderRadius: RADIUS + 1, borderWidth: 1.5 },
  outline: { width: FRAME, height: FRAME, borderRadius: RADIUS, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.28)' },
  dot: { position: 'absolute', left: FRAME / 2 - 3, top: FRAME / 2 - 3, width: 6, height: 6, borderRadius: 3 },
  ring: { width: RING, height: RING, borderRadius: RING / 2, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.16)' },
  orbit: { position: 'absolute', left: 0, top: 0, width: RING, height: RING },
  orbitDot: { position: 'absolute', left: RING / 2 - 3.5, top: -3.5, width: 7, height: 7, borderRadius: 3.5 },
  orbitTail: { position: 'absolute', left: RING / 2 - 2.5, top: -2.5, width: 5, height: 5, borderRadius: 2.5 },
  arrival: { ...StyleSheet.absoluteFillObject, zIndex: 9999, elevation: 9999, alignItems: 'center', justifyContent: 'center' },
  // Its own dark chip: the sign-in screen is gone by now and the screen under
  // it can be any theme, light ones included.
  nameChip: {
    position: 'absolute', alignSelf: 'center', maxWidth: 300, paddingHorizontal: 14, paddingVertical: 6,
    borderRadius: 999, backgroundColor: 'rgba(10,10,12,0.72)',
  },
  name: { color: '#fff', fontSize: 20, fontWeight: '700', textAlign: 'center' },
});

/** One speck drifting into the stroke, on its own loop. */
const Speck: React.FC<{ x: number; y: number; ms: number; delay: number; color: string; burst: Animated.Value }> = ({ x, y, ms, delay, color, burst }) => {
  const t = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(t, { toValue: 1, duration: ms, easing: Easing.in(Easing.quad), useNativeDriver: true }),
    );
    const start = setTimeout(() => loop.start(), delay);
    return () => { clearTimeout(start); loop.stop(); };
  }, [t, ms, delay]);
  const along = t.interpolate({ inputRange: [0, 1], outputRange: [1, 0] });
  return (
    <Animated.View
      style={[styles.speck, {
        backgroundColor: color,
        opacity: Animated.multiply(
          t.interpolate({ inputRange: [0, 0.25, 0.9, 1], outputRange: [0, 0.9, 0.7, 0] }),
          burst.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }),
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
}> = ({ picture, name, opened, instantOpen, skipIntro }) => {
  const noIntro = !!(instantOpen || skipIntro);
  const colors = useRiftColors();
  const spin = useRef(new Animated.Value(noIntro ? 1 : 0)).current;
  const breathe = useRef(new Animated.Value(0)).current;
  const tear = useRef(new Animated.Value(instantOpen ? 1 : 0)).current; // native: line + halo + specks
  const widen = useRef(new Animated.Value(instantOpen ? 1 : 0)).current; // JS: the window's size
  const [ready, setReady] = useState(false);
  const [settled, setSettled] = useState(noIntro);

  useEffect(() => {
    let loop: Animated.CompositeAnimation | null = null;
    const startBreathing = () => {
      setSettled(true);
      loop = Animated.loop(Animated.sequence([
        Animated.timing(breathe, { toValue: 1, duration: 800, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(breathe, { toValue: 0, duration: 800, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]));
      loop.start();
    };
    if (noIntro) startBreathing();
    else Animated.timing(spin, { toValue: 1, duration: INTRO_MS, easing: Easing.bezier(0.12, 0.7, 0.3, 1), useNativeDriver: true }).start(startBreathing);
    return () => { spin.stopAnimation(); loop?.stop(); };
  }, [spin, breathe, noIntro]);

  useEffect(() => {
    if (!opened || instantOpen) return;
    const ease = Easing.bezier(0.2, 0.8, 0.2, 1);
    Animated.parallel([
      Animated.timing(tear, { toValue: 1, duration: OPEN_MS, easing: ease, useNativeDriver: true }),
      Animated.timing(widen, { toValue: 1, duration: OPEN_MS, easing: ease, useNativeDriver: false }),
    ]).start();
  }, [opened, instantOpen, tear, widen]);

  const lineIn = spin.interpolate({ inputRange: [0, 0.85, 1], outputRange: [0, 0, 1] });
  const gone = tear.interpolate({ inputRange: [0, 1], outputRange: [1, 0] });
  const initial = (name || '?').trim().charAt(0).toUpperCase();
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
      <Svg width={110} height={110} viewBox="351 223 1210 1210">
        {!trail ? <Path d={MARK_PATH} fill={colors.a} fillOpacity={0.35} stroke={colors.a} strokeOpacity={0.35} strokeWidth={60} /> : null}
        <Path d={MARK_PATH} fill="#ffffff" />
      </Svg>
    </Animated.View>
  );
  return (
    <View style={styles.stage} pointerEvents="none">
      {/* halo */}
      <Animated.View style={[styles.abs, {
        opacity: Animated.multiply(lineIn, gone),
        transform: [
          { scaleX: tear.interpolate({ inputRange: [0, 1], outputRange: [1, 2.2] }) },
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

      {settled && SPECKS.map(([x, y, ms, delay], i) => (
        <Speck key={i} x={x} y={y} ms={ms} delay={delay} color={i % 2 ? colors.b : '#fff'} burst={tear} />
      ))}

      {!noIntro && [2, 1, 0].map(mark)}

      {/* the window the line tears open into */}
      <Animated.View style={[styles.window, {
        opacity: opened ? 1 : 0,
        width: widen.interpolate({ inputRange: [0, 1], outputRange: [LINE_W, FRAME] }),
        height: widen.interpolate({ inputRange: [0, 1], outputRange: [LINE_H, FRAME] }),
        borderRadius: widen.interpolate({ inputRange: [0, 1], outputRange: [3, RADIUS] }),
      }]}>
        {/* Only an account with no picture shows its initial; one whose
            picture is on its way shows the dark frame it fades into. */}
        {!picture ? <Text style={styles.initial}>{initial}</Text> : (
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

      {/* the line of light */}
      <Animated.View style={[styles.abs, {
        opacity: Animated.multiply(lineIn, tear.interpolate({ inputRange: [0, 0.45, 1], outputRange: [1, 0.45, 0] })),
        transform: [
          { scaleX: tear.interpolate({ inputRange: [0, 1], outputRange: [1, 20] }) },
          { scaleY: Animated.add(
            breathe.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1.05] }),
            tear.interpolate({ inputRange: [0, 1], outputRange: [0, 0.05] }),
          ) },
        ],
      }]}>
        <Svg width={LINE_W + 16} height={LINE_H + 16} viewBox="-8 -8 22 128">
          <Defs>
            <LinearGradient id="riftFill" x1="0" y1="0" x2="1" y2="0">
              <Stop offset="0" stopColor={colors.b} />
              <Stop offset="0.3" stopColor="#ffffff" />
              <Stop offset="0.7" stopColor="#ffffff" />
              <Stop offset="1" stopColor={colors.b} />
            </LinearGradient>
          </Defs>
          {/* a soft edge of the theme colour, standing in for a glow */}
          <Path d={LINE_PATH} fill="none" stroke={colors.a} strokeOpacity={0.16} strokeWidth={14} strokeLinejoin="round" />
          <Path d={LINE_PATH} fill="none" stroke={colors.a} strokeOpacity={0.4} strokeWidth={5} strokeLinejoin="round" />
          <Path d={LINE_PATH} fill="url(#riftFill)" />
        </Svg>
      </Animated.View>
    </View>
  );
};


type MarkProps = { picture: string | null; name: string; opened: boolean; instantOpen?: boolean; skipIntro?: boolean };

/**
 * Trace, Picture frame and Orbit: the same frame as the Rift, with their own
 * marks while the account loads. All on the native driver.
 */
const SimpleArrival: React.FC<MarkProps & { look: Exclude<ArrivalLook, 'rift'> }> = ({ look, picture, name, opened, instantOpen, skipIntro }) => {
  const noIntro = !!(instantOpen || skipIntro);
  const colors = useRiftColors();
  const intro = useRef(new Animated.Value(noIntro ? 1 : 0)).current;
  const run = useRef(new Animated.Value(0)).current;
  const open = useRef(new Animated.Value(instantOpen ? 1 : 0)).current;
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const introMs = ARRIVAL_INTRO_MS[look];
    if (!noIntro) Animated.timing(intro, { toValue: 1, duration: Math.max(260, introMs), easing: Easing.bezier(0.2, 0.8, 0.2, 1), useNativeDriver: true }).start();
    const loop = look === 'frame'
      ? Animated.loop(Animated.sequence([
        Animated.timing(run, { toValue: 1, duration: 800, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(run, { toValue: 0, duration: 800, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]))
      : Animated.loop(Animated.timing(run, { toValue: 1, duration: look === 'trace' ? 1300 : 1100, easing: Easing.linear, useNativeDriver: true }));
    loop.start();
    return () => { intro.stopAnimation(); loop.stop(); };
  }, [look, noIntro, intro, run]);

  useEffect(() => {
    if (!opened || instantOpen) return;
    Animated.timing(open, { toValue: 1, duration: OPEN_MS, easing: Easing.bezier(0.2, 0.8, 0.2, 1), useNativeDriver: true }).start();
  }, [opened, instantOpen, open]);

  const marksOut = {
    opacity: Animated.multiply(intro, open.interpolate({ inputRange: [0, 1], outputRange: [1, 0] })),
    transform: [{ scale: open.interpolate({ inputRange: [0, 1], outputRange: [1, 1.35] }) }],
  };
  const initial = (name || '?').trim().charAt(0).toUpperCase();
  const lit = { backgroundColor: '#fff', shadowColor: colors.a, shadowOpacity: 1, shadowRadius: 6, shadowOffset: { width: 0, height: 0 } };
  return (
    <View style={styles.stage} pointerEvents="none">
      {look !== 'frame' && (
        <Animated.View style={[styles.abs, marksOut]}>
          <Svg width={200} height={200}>
            <Defs>
              <RadialGradient id="arrivalHalo" cx="50%" cy="50%" rx="50%" ry="50%">
                <Stop offset="0" stopColor={colors.a} stopOpacity={0.32} />
                <Stop offset="1" stopColor={colors.a} stopOpacity={0} />
              </RadialGradient>
            </Defs>
            <Ellipse cx={100} cy={100} rx={100} ry={100} fill="url(#arrivalHalo)" />
          </Svg>
        </Animated.View>
      )}

      {look === 'frame' && (
        // The empty frame; the picture fills it, then it goes.
        <Animated.View style={[styles.box, {
          opacity: Animated.multiply(intro.interpolate({ inputRange: [0, 1], outputRange: [noIntro ? 1 : 0, 1] }), open.interpolate({ inputRange: [0, 0.75, 1], outputRange: [1, 1, 0] })),
        }]}>
          <Animated.View style={[styles.boxRim, { borderColor: colors.a, opacity: run.interpolate({ inputRange: [0, 1], outputRange: [0.25, 0.9] }) }]} />
        </Animated.View>
      )}

      {look === 'trace' && (
        <Animated.View style={[styles.abs, marksOut]}>
          <Animated.View style={[styles.outline, { transform: [{ scale: intro.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1] }) }] }]} />
          {[0, 0.02, 0.04, 0.06].map((lag, i) => {
            const at = lag ? Animated.modulo(Animated.add(run, 1 - lag), 1) : run;
            return (
              <Animated.View
                key={lag}
                style={[styles.dot, i === 0 ? lit : { backgroundColor: colors.b }, {
                  opacity: (1 - i * 0.24) * (i === 0 ? 1 : 0.8),
                  transform: [
                    { translateX: at.interpolate({ inputRange: LAP, outputRange: LAP_X }) },
                    { translateY: at.interpolate({ inputRange: LAP, outputRange: LAP_Y }) },
                    { scale: 1 - i * 0.15 },
                  ],
                }]}
              />
            );
          })}
        </Animated.View>
      )}

      {look === 'orbit' && (
        <Animated.View style={[styles.abs, marksOut]}>
          <Animated.View style={[styles.ring, { transform: [{ scale: intro.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] }) }] }]} />
          <Animated.View style={[styles.orbit, { transform: [{ rotate: run.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] }) }] }]}>
            <View style={[styles.orbitDot, lit]} />
            <View style={[styles.orbitTail, { backgroundColor: colors.b, opacity: 0.7, transform: [{ translateX: -10 }, { translateY: 2 }] }]} />
            <View style={[styles.orbitTail, { backgroundColor: colors.b, opacity: 0.4, transform: [{ translateX: -19 }, { translateY: 5 }, { scale: 0.7 }] }]} />
          </Animated.View>
        </Animated.View>
      )}

      {/* the picture */}
      <Animated.View style={[styles.window, styles.square, {
        opacity: open.interpolate({ inputRange: [0, 0.15, 1], outputRange: [0, 1, 1] }),
        transform: [{ scale: open.interpolate({ inputRange: [0, 1], outputRange: [look === 'orbit' ? 0.2 : look === 'trace' ? 0.86 : 1, 1] }) }],
      }]}>
        {!picture ? <Text style={styles.initial}>{initial}</Text> : (
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
    </View>
  );
};

/** The picked arrival. */
export const ArrivalMarks: React.FC<MarkProps & { look: ArrivalLook }> = ({ look, ...props }) =>
  look === 'rift' ? <Rift {...props} /> : <SimpleArrival look={look} {...props} />;

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

export const SignInWaitVeil: React.FC<{ label?: string }> = ({ label }) => {
  const fade = useRef(new Animated.Value(0)).current;
  const look = useArrivalLook();
  const arriving = useArriving();
  const [opened, setOpened] = useState(false);
  const picture = arriving?.avatarImageUrl ? getAvatarUrl(arriving.avatarImageUrl, FRAME) : null;

  useEffect(() => {
    noteSignInWaiting();
    const tick = setInterval(noteSignInWaiting, 250);
    Animated.timing(fade, { toValue: 1, duration: 220, useNativeDriver: true }).start();
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
    if (opened) { veilOpenedAt = Date.now(); return; }
    if (!arriving) return;
    return openWhenReady(picture, mountedAt + ARRIVAL_INTRO_MS[look], () => setOpened(true));
  }, [arriving, opened, picture, mountedAt, look]);

  return (
    // dark-surface: the sign-in screen is dark on every theme, so System Light
    // must not flip these greys.
    <View className="dark-surface" style={styles.veilHost}>
      <Animated.View
        style={[styles.veil, { opacity: fade }]}
        accessible
        accessibilityRole="progressbar"
        accessibilityLabel={label}
        testID="signin-wait-veil"
      >
        <ArrivalMarks look={look} picture={picture} name={arriving?.name || ''} opened={opened} />
        {opened && arriving?.name ? (
          <View style={[styles.nameChip, { top: '50%', marginTop: FRAME / 2 + 16 }]}>
            <Text numberOfLines={1} style={styles.name}>{arriving.name}</Text>
          </View>
        ) : null}
      </Animated.View>
    </View>
  );
};

export const SignInArrival: React.FC = () => {
  const { isSignedIn, needsUsername } = useAuthState();
  const user = useUser();
  const { width, height } = useWindowDimensions();
  const look = useArrivalLook();
  const [shown, setShown] = useState<{ picture: string | null; name: string; instant: boolean; skipIntro: boolean } | null>(null);
  const [opened, setOpened] = useState(false);
  const wasIn = useRef(isSignedIn && !needsUsername);
  const opacity = useRef(new Animated.Value(1)).current;
  const nameOpacity = useRef(new Animated.Value(0)).current;
  const move = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  const scale = useRef(new Animated.Value(1)).current;

  const signedIn = isSignedIn && !needsUsername;
  useEffect(() => {
    const arrived = signedIn && !wasIn.current;
    wasIn.current = signedIn;
    if (!arrived) return;
    // Only a log-in: the account was noted by the log-in itself. A session
    // restored at launch, or a new account finishing its sign-up, has none.
    const account = takeArrivingAccount(ACCOUNT_MAX_AGE_MS);
    if (!account) return;
    const avatar = account.avatarImageUrl || user?.avatarImageUrl || null;
    const picture = avatar ? getAvatarUrl(avatar, FRAME) : null;
    const veilWasUp = signInWasWaiting(1500);
    const instant = veilWasUp && Date.now() - veilOpenedAt < 4000;
    opacity.setValue(1);
    nameOpacity.setValue(0);
    move.setValue({ x: 0, y: 0 });
    scale.setValue(1);
    setOpened(instant);
    setShown({ picture, name: account.name || user?.displayName || user?.username || '', instant, skipIntro: veilWasUp });
    // `user` is read, not followed: it is usually still the old value here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signedIn]);

  // Open on the picture, or after the cap without it.
  useEffect(() => {
    if (!shown || opened) return;
    return openWhenReady(shown.picture, shown.skipIntro ? 0 : Date.now() + ARRIVAL_INTRO_MS[look], () => setOpened(true));
    // `look` is read, not followed: a change mid-arrival waits for the next one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown, opened]);

  // Open: show the name, hold, then send the picture home.
  useEffect(() => {
    if (!shown || !opened) return;
    let cancelled = false;
    const end = () => { if (!cancelled) setShown(null); };
    Animated.timing(nameOpacity, { toValue: 1, duration: 240, delay: shown.instant ? 0 : 200, useNativeDriver: true }).start();
    const timer = setTimeout(async () => {
      const to = await measureOwnAvatar();
      if (cancelled) return;
      Animated.timing(nameOpacity, { toValue: 0, duration: 140, useNativeDriver: true }).start();
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
    }, (shown.instant ? 0 : OPEN_MS) + HOLD_MS);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [shown, opened, width, height, opacity, nameOpacity, move, scale]);

  if (!shown) return null;
  return (
    <View className="dark-surface" style={styles.arrival} pointerEvents="none" testID="signin-arrival">
      <Animated.View style={[styles.frame, { opacity, transform: [...move.getTranslateTransform(), { scale }] }]}>
        <ArrivalMarks look={look} picture={shown.picture} name={shown.name} opened={opened} instantOpen={shown.instant} skipIntro={shown.skipIntro} />
      </Animated.View>
      {shown.name ? (
        <Animated.View style={[styles.nameChip, { opacity: nameOpacity, top: height / 2 + FRAME / 2 + 16 }]}>
          <Text numberOfLines={1} style={styles.name}>{shown.name}</Text>
        </Animated.View>
      ) : null}
    </View>
  );
};

export default SignInWaitVeil;
