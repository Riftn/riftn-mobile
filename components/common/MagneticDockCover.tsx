import React, { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, Image, StyleSheet, View, useWindowDimensions } from 'react-native';
import SplashScreen from '../../screens/SplashScreen';
import { measureDockTarget, type DockTarget } from '../../libs/magneticDock';
import { markLaunchMotionStarted } from '../../libs/bootReveal';
import { perfNote } from '../../libs/perfTrace';
import { DOCK_FLIGHT_MS, rememberDockLanding, type EarlyDock } from '../../libs/earlyDock';

// One frame after start(), so the native side has the animation before
// JavaScript gets busy with the rows that were waiting on it.
const motionStarted = () => { requestAnimationFrame(markLaunchMotionStarted); };

const MARK = require('../../assets/web-icons/dehub-island-logo.png');
const CROSSFADE_MS = 420;

/** The existing boot gate owns readiness; this owns only the visual handoff. */
export default function MagneticDockCover({ reveal, enabled, early = null, onComplete }: {
  reveal: boolean; enabled: boolean; onComplete: () => void;
  /** A flight to start now, before the page is ready (libs/earlyDock). */
  early?: EarlyDock | null;
}) {
  const { width, height } = useWindowDimensions();
  const entrySize = useRef({ width, height });
  const host = useRef<View>(null);
  const progress = useRef(new Animated.Value(0)).current;
  const fade = useRef(new Animated.Value(1)).current;
  const reduced = useRef(true);
  const [landing, setLanding] = useState<DockTarget | null>(null);
  // Early flight: the logo is already on its way while the page builds. This
  // layer keeps the cover black until the page says it is there.
  const guard = useRef(new Animated.Value(1)).current;
  const [earlyOn, setEarlyOn] = useState(false);
  const earlyRun = useRef({ startedAt: 0, flightDone: false, guardGone: false, done: false, target: null as DockTarget | null });
  const completeRef = useRef(onComplete);
  const finishRef = useRef<() => void>(() => {});
  completeRef.current = onComplete;
  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled().then(value => { if (mounted) reduced.current = value; }).catch(() => {});
    const listener = AccessibilityInfo.addEventListener('reduceMotionChanged', value => { reduced.current = value; });
    return () => { mounted = false; listener.remove(); };
  }, []);

  useEffect(() => {
    if (!early || earlyOn || reveal || landing) return;
    if (reduced.current) { perfNote('early dock skipped: motion setting not known yet or reduced'); return; }
    earlyRun.current.startedAt = Date.now();
    finishRef.current = () => {
      const run = earlyRun.current;
      run.flightDone = true;
      if (run.guardGone && !run.done) { run.done = true; run.target?.hide(false); completeRef.current(); }
    };
    setEarlyOn(true);
    setLanding({ x: early.x, y: early.y, width: 42, height: 36, tint: early.tint, hide: () => {} });
  }, [early, earlyOn, reveal, landing]);

  // Early flight, page ready: check the header logo is where the flight is
  // heading, hide it under the flying one, and let the cover clear.
  useEffect(() => {
    if (!reveal || !earlyOn || !early) return;
    const run = earlyRun.current;
    let cancelled = false;
    const done = () => {
      if (cancelled || run.done) return;
      run.done = true;
      clearTimeout(failsafe);
      run.target?.hide(false);
      completeRef.current();
    };
    const failsafe = setTimeout(done, 1800);
    const release = (matches: boolean) => {
      const late = Date.now() - run.startedAt > early.delayMs + DOCK_FLIGHT_MS * 0.28;
      perfNote(`early dock reveal: matches ${matches} late ${late} after ${Date.now() - run.startedAt}ms`);
      // A logo heading for the wrong spot fades out over the page instead.
      if (!matches) Animated.timing(fade, { toValue: 0, duration: 200, useNativeDriver: true }).start();
      Animated.timing(guard, { toValue: 0, duration: late || !matches ? 200 : 1, useNativeDriver: true }).start(() => {
        run.guardGone = true;
        if (run.flightDone || !matches) done();
      });
      motionStarted();
    };
    void (async () => {
      const target = await measureDockTarget();
      if (cancelled || run.done) return;
      if (!target || !host.current) { release(false); return; }
      host.current.measureInWindow((x, y) => {
        if (cancelled || run.done) return;
        const matches = Math.abs(target.x - x - early.x) <= 3 && Math.abs(target.y - y - early.y) <= 3;
        if (matches) { run.target = target; target.hide(true); }
        release(matches);
      });
    })();
    return () => { cancelled = true; clearTimeout(failsafe); run.target?.hide(false); };
  }, [reveal, earlyOn, early, fade, guard]);

  useEffect(() => {
    if (earlyOn) return;
    if (!reveal) { entrySize.current = { width, height }; return; }
    if (entrySize.current.width !== width || entrySize.current.height !== height) {
      completeRef.current();
      return;
    }
    let cancelled = false;
    let target: DockTarget | null = null;
    let motion: Animated.CompositeAnimation | undefined;
    let finished = false;
    const finish = () => {
      if (cancelled || finished) return;
      finished = true;
      clearTimeout(failsafe);
      target?.hide(false);
      completeRef.current();
    };
    // A missing layout callback or interrupted animation must never hold entry.
    const failsafe = setTimeout(finish, 1400);
    finishRef.current = finish;
    const crossfade = () => {
      // Long enough to read as a reveal rather than a cut, eased so the page
      // arrives quickly and settles; the mark drifts forward as it goes.
      motion = Animated.timing(fade, { toValue: 0, duration: CROSSFADE_MS, easing: Easing.out(Easing.cubic), useNativeDriver: true });
      motion.start(finish);
      motionStarted();
    };
    void (async () => {
      target = enabled && !reduced.current ? await measureDockTarget() : null;
      perfNote(`cover enabled ${enabled} reduced ${reduced.current} target ${target ? `${Math.round(target.x)},${Math.round(target.y)} ${Math.round(target.width)}x${Math.round(target.height)}` : "none"} window ${Math.round(width)}x${Math.round(height)} cancelled ${cancelled} finished ${finished}`);
      if (cancelled || finished) return;
      if (!target || target.y < 0 || target.y + target.height > height) { crossfade(); return; }
      const dock = target;
      host.current?.measureInWindow((x, y) => {
        if (cancelled || finished) return;
        const local = { ...dock, x: dock.x - x, y: dock.y - y };
        dock.hide(true);
        rememberDockLanding(local, width, height);
        setLanding(local);
      });
    })();
    return () => {
      cancelled = true;
      clearTimeout(failsafe);
      motion?.stop();
      progress.stopAnimation();
      target?.hide(false);
    };
  }, [reveal, enabled, earlyOn, fade, progress, width, height]);

  useEffect(() => {
    if (!landing) return;
    const flight = Easing.bezier(.4, 0, .2, 1);
    // An early flight waits inside the animation itself: a timer would fire
    // late while the page is being built.
    const wait = earlyOn && early ? early.delayMs : 0;
    const total = wait + DOCK_FLIGHT_MS;
    const animation = Animated.timing(progress, {
      toValue: 1, duration: total, useNativeDriver: true,
      easing: wait ? (t: number) => (t * total <= wait ? 0 : flight((t * total - wait) / DOCK_FLIGHT_MS)) : flight,
    });
    animation.start(({ finished }) => {
      if (finished) finishRef.current();
    });
    // An early flight starts before the page is there; the rows waiting on
    // this are let go when the page is ready instead.
    if (!earlyOn) motionStarted();
    return () => animation.stop();
  }, [landing, progress]);

  const showMark = enabled || earlyOn;
  const dx = landing ? landing.x + 21 - width / 2 : 0;
  const dy = landing ? landing.y + 18 - height / 2 : 0;
  return <View ref={host} collapsable={false} style={StyleSheet.absoluteFill} pointerEvents="auto" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
    <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: '#000', opacity: landing
      ? progress.interpolate({ inputRange: [0, .28, .78, 1], outputRange: [1, 1, 0, 0] }) : fade }]}>
      {!showMark && <Animated.View style={[StyleSheet.absoluteFill, { transform: [{ scale: fade.interpolate({ inputRange: [0, 1], outputRange: [1.08, 1] }) }] }]}>
        <SplashScreen />
      </Animated.View>}
    </Animated.View>
    {earlyOn && <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: '#000', opacity: guard }]} />}
    {showMark && <Animated.View style={{ position: 'absolute', left: width / 2 - 21, top: height / 2 - 18, width: 42, height: 36,
      opacity: fade, transform: [
        { translateX: progress.interpolate({ inputRange: [0, .1, .52, .7, .78, 1], outputRange: [0, 0, dx * .75 + 6, dx, dx, dx] }) },
        { translateY: progress.interpolate({ inputRange: [0, .1, .52, .7, .78, 1], outputRange: [0, 0, dy * .75, dy - 2, dy, dy] }) },
        { scale: progress.interpolate({ inputRange: [0, .1, .52, .7, .78, 1], outputRange: [120 / 42, 120 / 42, 1.2, .99, 1, 1] }) },
      ] }}>
      <Image source={MARK} resizeMode="contain" style={{ width: 42, height: 36, tintColor: '#fff' }} />
      {landing && <Animated.Image source={MARK} resizeMode="contain" style={[StyleSheet.absoluteFill, { width: 42, height: 36, tintColor: landing.tint,
        opacity: progress.interpolate({ inputRange: [0, .35, .78, 1], outputRange: [0, 0, 1, 1] }),
      }]} />}
    </Animated.View>}
  </View>;
}
