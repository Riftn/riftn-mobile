import { useCallback, useEffect, useRef, useState } from "react";
import { Animated, Easing } from "react-native";

export type ClipArt = { uri: string; ms: number };
type Art = ClipArt;

/** After its last frame the moving emoji rests this long, then melts into the still one. */
const REST_MS = 140;
const MELT_MS = 240;

/**
 * Plays an emoji's moving file once over the still emoji and hands back.
 *
 * `prepare` puts the file in place on its first frame, out of sight.
 * `begin` shows it and starts it (straight away, or as soon as it is drawn),
 * and when it reports its last frame the two cross over. The still emoji
 * only leaves once the moving one is really on screen, so there is never a
 * gap, and a reaction that lands while one is playing lets it finish.
 */
export function useClipPlayer() {
  const [clip, setClip] = useState<(Art & { key: number }) | null>(null);
  const [playing, setPlaying] = useState(false);
  const clipOpacity = useRef(new Animated.Value(0)).current;
  const stillOpacity = useRef(new Animated.Value(1)).current;
  const s = useRef({
    alive: true,
    phase: "idle" as "idle" | "loading" | "playing" | "melting",
    ready: false,
    want: null as null | { covered: boolean },
    key: 0,
    ms: 0,
    timer: null as ReturnType<typeof setTimeout> | null,
  }).current;

  const reset = useCallback(() => {
    if (s.timer) clearTimeout(s.timer);
    s.timer = null;
    s.phase = "idle";
    s.ready = false;
    s.want = null;
    clipOpacity.stopAnimation();
    stillOpacity.stopAnimation();
    clipOpacity.setValue(0);
    stillOpacity.setValue(1);
    if (s.alive) { setClip(null); setPlaying(false); }
  }, [s, clipOpacity, stillOpacity]);

  useEffect(() => () => { s.alive = false; if (s.timer) clearTimeout(s.timer); }, [s]);

  const melt = useCallback((key: number) => {
    if (!s.alive || s.key !== key || s.phase !== "playing") return;
    s.phase = "melting";
    if (s.timer) clearTimeout(s.timer);
    Animated.parallel([
      Animated.timing(clipOpacity, { toValue: 0, duration: MELT_MS, easing: Easing.in(Easing.quad), useNativeDriver: true }),
      Animated.timing(stillOpacity, { toValue: 1, duration: MELT_MS, easing: Easing.out(Easing.quad), useNativeDriver: true }),
    ]).start(() => { if (s.key === key && s.phase === "melting") reset(); });
  }, [s, clipOpacity, stillOpacity, reset]);

  const run = useCallback(() => {
    const want = s.want;
    if (!want || !s.ready || s.phase !== "loading" || !s.alive) return;
    s.phase = "playing";
    if (s.timer) clearTimeout(s.timer);
    if (want.covered) {
      // A flying copy is sitting on top right now and covers the swap.
      clipOpacity.setValue(1);
      stillOpacity.setValue(0);
    } else {
      Animated.parallel([
        Animated.timing(clipOpacity, { toValue: 1, duration: 140, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.timing(stillOpacity, { toValue: 0, duration: 140, easing: Easing.in(Easing.quad), useNativeDriver: true }),
      ]).start();
    }
    setPlaying(true);
    // If the end is never reported, the still emoji still comes back.
    const key = s.key;
    s.timer = setTimeout(() => melt(key), s.ms + 2500);
  }, [s, clipOpacity, stillOpacity, melt]);

  /** Put the file in place, held on its first frame. False when one is already playing (it carries on). */
  const prepare = useCallback((art: Art): boolean => {
    if (!s.alive || s.phase === "playing" || s.phase === "loading") return s.phase === "loading";
    reset();
    s.phase = "loading";
    s.key += 1;
    s.ms = art.ms;
    setClip({ ...art, key: s.key });
    // A file that never arrives must not stay pending.
    s.timer = setTimeout(reset, 5000);
    return true;
  }, [s, reset]);

  /** Show it and start it. `covered`: a flying copy has just landed on top, so it appears at once. */
  const begin = useCallback((covered: boolean) => {
    if (s.phase !== "loading" || s.want) return;
    s.want = { covered };
    run();
  }, [s, run]);

  const onReady = useCallback((key: number) => {
    if (s.key !== key || s.phase !== "loading") return;
    s.ready = true;
    // Asked for before it was drawn: whatever was covering the swap has gone by now, so fade instead.
    if (s.want) s.want = { covered: false };
    run();
  }, [s, run]);

  const onEnd = useCallback((key: number) => {
    if (s.key !== key || s.phase !== "playing") return;
    if (s.timer) clearTimeout(s.timer);
    s.timer = setTimeout(() => melt(key), REST_MS);
  }, [s, melt]);

  return { clip, playing, clipOpacity, stillOpacity, prepare, begin, onReady, onEnd };
}
