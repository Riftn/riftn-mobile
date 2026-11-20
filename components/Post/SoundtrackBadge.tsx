import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { TouchableOpacity, View, Text, StyleSheet, ActivityIndicator, AppState, Animated, Easing, Platform, Linking, type GestureResponderEvent, type StyleProp, type ViewStyle } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import IosGlassPill from "../ui/IosGlassPill";
import { useIsFocused } from "@react-navigation/native";
import { useTranslation } from "react-i18next";
import { createAudioPlayer } from "expo-audio";
import { usePostAudioSession } from "../../hooks/usePostAudioSession";
import { postMediaIsTransferring } from "../../libs/post-media-session";
import Ionicons from "@expo/vector-icons/Ionicons";
import { requestAudioFocus, releaseAudioFocus } from "../../libs/audioFocus";
import { configureForDuckedPlayback } from "../../libs/audioSession";
import { clock, playableSoundUrl, soundCredit, soundWindowCorrection } from "../../libs/soundWindow";

interface Props {
  title: string;
  creator: string;
  url: string;
  isVisible?: boolean;
  /** overlay: a glass capsule on the photo while idle; while the song plays a
   *  solid player bar docks under the photo, so nothing covers the picture.
   *  The parent puts the badge next to the photo, not inside its clip.
   *  inline: the capsule alone. */
  variant?: "overlay" | "inline";
  /** Side gutter for the docked bar under edge-to-edge photos. */
  barInset?: number;
  /** The app is on a light theme: the docked bar takes dark ink. */
  isLight?: boolean;
  onPlayingChange?: (playing: boolean) => void;
  /** A video's song plays with the video itself: the badge only credits it. */
  withVideo?: boolean;
}

const SoundtrackBadge: React.FC<Props> = ({ title, creator, url, isVisible = true, variant = "inline", barInset = 0, isLight = false, onPlayingChange, withVideo = false }) => {
  const { t } = useTranslation();
  const focused = useIsFocused();
  const { session, ownsPlayer, active: ownsAudio } = usePostAudioSession(url);
  const [, refresh] = useState(0);
  const player = session.value;
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const wanted = useRef(false);
  const confirmed = useRef(false);
  const generation = useRef(0);
  const loadedUrl = useRef<string | null>(null);
  const timeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const active = useRef(false);
  active.current = isVisible && focused;
  // The song the listener scrubbed through themselves: it plays in full from
  // there. Without this the part's guard pulled every seek past its end back
  // to the start.
  const wholeSong = useRef<string | null>(null);

  const clearLoadingTimeout = useCallback(() => {
    if (timeout.current) clearTimeout(timeout.current);
    timeout.current = null;
  }, []);

  const pause = useCallback(() => {
    if (!ownsPlayer() || postMediaIsTransferring(session)) return;
    wanted.current = false;
    confirmed.current = false;
    generation.current++;
    clearLoadingTimeout();
    try { session.value?.pause(); } catch { /* Player may already be released. */ }
    setPlaying(false);
    setLoading(false);
    releaseAudioFocus(pause);
  }, [session, ownsPlayer, clearLoadingTimeout]);

  useLayoutEffect(() => {
    if (!ownsAudio) {
      wanted.current = false;
      confirmed.current = false;
      generation.current++;
      clearLoadingTimeout();
      return;
    }
    if (!player || wanted.current) return;
    wanted.current = player.playing;
    confirmed.current = player.playing;
    loadedUrl.current = url;
    setPlaying(player.playing);
    setLoading(false);
    if (player.playing) requestAudioFocus(pause);
  }, [ownsAudio, player, url, pause, clearLoadingTimeout]);

  const fail = useCallback(() => {
    pause();
    loadedUrl.current = null;
    setError(true);
  }, [pause]);

  useEffect(() => {
    if (!player || !ownsAudio) return;
    player.loop = true;
    const subscription = player.addListener("playbackStatusUpdate", (status) => {
      if (!ownsPlayer()) return;
      if (!wanted.current) return;
      if (status.playbackState === "error" || status.playbackState === "failed") { fail(); return; }
      // A post can use one part of the song: start there and loop it.
      if (status.isLoaded) {
        const jump = soundWindowCorrection(url, status.currentTime ?? 0, wholeSong.current === url);
        if (jump != null) { void player.seekTo(jump).catch(() => {}); }
      }
      const buffering = !status.isLoaded || status.isBuffering;
      if (confirmed.current && !status.playing && !buffering) { pause(); return; }
      if (status.playing && !buffering) confirmed.current = true;
      setLoading(buffering || !confirmed.current);
      setPlaying(status.playing && !buffering);
      if (status.playing && !buffering) clearLoadingTimeout();
      else if (buffering && !timeout.current) timeout.current = setTimeout(fail, 15000);
    });
    return () => { subscription.remove(); clearLoadingTimeout(); releaseAudioFocus(pause); };
  }, [player, ownsAudio, ownsPlayer, pause, fail, clearLoadingTimeout, url]);

  useEffect(() => {
    setError(false);
    wholeSong.current = null;
  }, [url]);

  useEffect(() => { if (!isVisible || !focused) pause(); }, [isVisible, focused, pause]);
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => { if (state !== "active") pause(); });
    return () => subscription.remove();
  }, [pause]);

  const [time, setTime] = useState({ current: 0, duration: 0 });
  const readTime = useCallback(() => {
    const audio = session.value;
    const duration = audio && audio.duration > 0 && Number.isFinite(audio.duration) ? audio.duration : 0;
    const current = duration ? audio!.currentTime : 0;
    setTime(prev => prev.current === current && prev.duration === duration ? prev : { current, duration });
  }, [session]);
  useEffect(() => {
    if (!(playing || loading) || variant !== "overlay") return;
    readTime();
    const id = setInterval(readTime, 250);
    return () => clearInterval(id);
  }, [playing, loading, variant, readTime]);
  const seek = useCallback((seconds: number) => {
    const audio = session.value;
    if (!audio || !time.duration || !ownsPlayer()) return;
    wholeSong.current = url;
    const to = Math.min(time.duration, Math.max(0, seconds));
    setTime(prev => ({ ...prev, current: to }));
    void audio.seekTo(to).catch(() => {});
  }, [session, time.duration, ownsPlayer, url]);

  const toggle = useCallback(async () => {
    if (wanted.current) { pause(); return; }
    if (!ownsPlayer() || !active.current || AppState.currentState !== "active") return;
    const attempt = ++generation.current;
    wanted.current = true;
    setLoading(true);
    setError(false);
    // Claim before awaiting setup, so another tap can cancel this request.
    requestAudioFocus(pause);
    timeout.current = setTimeout(fail, 15000);
    try {
      await configureForDuckedPlayback();
      if (!ownsPlayer() || generation.current !== attempt || !wanted.current || !active.current) return;
      let audio = session.value;
      if (!audio) {
        audio = createAudioPlayer({ uri: playableSoundUrl(url) });
        session.value = audio;
        loadedUrl.current = url;
        refresh(version => version + 1);
      }
      if (loadedUrl.current !== url) {
        audio.replace({ uri: playableSoundUrl(url) });
        loadedUrl.current = url;
      }
      audio.loop = true;
      audio.play();
    } catch {
      if (generation.current === attempt) fail();
    }
  }, [url, session, ownsPlayer, pause, fail]);

  useEffect(() => { onPlayingChange?.(playing); }, [playing, onPlayingChange]);
  useEffect(() => () => onPlayingChange?.(false), [onPlayingChange]);

  const action = error ? t("common.retry") : loading ? t("common.cancel") : playing ? t("audioPost.pause") : t("audioPost.play");
  const name = title || t("feed.music");
  const label = `${action}: ${name}${creator ? ` — ${creator}` : ""}`;
  const onPress = (event: { stopPropagation?: () => void }) => { event.stopPropagation?.(); void toggle(); };
  const open = playing || loading;
  // Songs from outside libraries credit the artist, the licence and the song's page.
  const credit = soundCredit(url);
  // The artist and licence are credited; the library the song came from is not named on posts.
  const outside = !!credit && credit.source !== "riftn";
  const creditLine = outside ? [creator ? `© ${creator}` : "", credit?.license].filter(Boolean).join(" · ") : "";
  const openCredit = () => { if (credit?.page) void Linking.openURL(credit.page).catch(() => {}); };

  if (withVideo) {
    // A second player here would fight the video for the speaker.
    return (
      <TouchableOpacity
        onPress={credit?.page ? (event) => { event.stopPropagation?.(); openCredit(); } : undefined}
        disabled={!credit?.page}
        activeOpacity={0.75}
        accessibilityRole={credit?.page ? "link" : "text"}
        accessibilityLabel={`${name}${creator ? ` — ${creator}` : ""}`}
        style={styles.capsule}
      >
        <GlassFill radius={18} />
        <Ionicons name="musical-note" size={14} color="#fff" />
        <Text style={styles.capsuleTitle} numberOfLines={1}>{name}{creator ? ` · ${creator}` : ""}</Text>
      </TouchableOpacity>
    );
  }

  if (variant === "overlay" && open) {
    const ink = isLight ? "#0b0b0f" : "#fff";
    const soft = isLight ? "rgba(0,0,0,0.55)" : "rgba(255,255,255,0.5)";
    return (
      <View
        style={[styles.bar, { marginHorizontal: barInset }, isLight ? styles.barLight : styles.barDark]}
        onStartShouldSetResponder={() => true}
        onResponderRelease={(event) => event.stopPropagation?.()}
      >
        <View style={[styles.barArt, { backgroundColor: isLight ? "rgba(0,0,0,0.06)" : "rgba(255,255,255,0.1)" }]}>
          <SoundEq playing={playing} color={soft} />
        </View>
        <View style={styles.barMeta}>
          <Text style={[styles.barTitle, { color: ink }]} numberOfLines={1}>{name}</Text>
          {creditLine ? (
            <Text onPress={credit?.page ? openCredit : undefined} style={[styles.barSub, { color: soft }]} numberOfLines={1} accessibilityRole={credit?.page ? "link" : "text"}>{creditLine}</Text>
          ) : !!creator && <Text style={[styles.barSub, { color: soft }]} numberOfLines={1}>{creator}</Text>}
          <View style={styles.barTimeRow}>
            <Text style={[styles.barTime, { color: soft }]}>{clock(time.current)}</Text>
            <ScrubBar current={time.current} duration={time.duration} onSeek={seek} isLight={isLight} label={t("spotify.seek")} />
            <Text style={[styles.barTime, styles.barTimeEnd, { color: soft }]}>{time.duration ? clock(time.duration) : "–:––"}</Text>
          </View>
        </View>
        <TouchableOpacity onPress={onPress} activeOpacity={0.75} accessibilityRole="button" accessibilityLabel={label} style={[styles.barButton, { backgroundColor: ink }]}>
          {loading ? <ActivityIndicator size="small" color={isLight ? "#fff" : "#000"} /> : <Ionicons name={playing ? "pause" : "play"} size={17} color={isLight ? "#fff" : "#000"} style={playing ? undefined : { marginLeft: 2 }} />}
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.75}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={[styles.capsule, variant === "overlay" && styles.capsuleOverlay]}
    >
      <GlassFill radius={18} />
      {playing ? <SoundEq /> : error ? <Ionicons name="refresh" size={14} color="#fff" />
        : loading ? <ActivityIndicator size="small" color="#fff" />
        : <Ionicons name="musical-note" size={14} color="#fff" />}
      <Text style={styles.capsuleTitle} numberOfLines={1}>{name}</Text>
      {playing ? <Ionicons name="pause" size={13} color="#fff" /> : !error && !loading ? <Ionicons name="play" size={13} color="#fff" /> : null}
    </TouchableOpacity>
  );
};

/**
 * Liquid glass on iPhone. Android cannot blur a playing video behind a view,
 * so it builds web's glass (`.dh-sound-glass`) from its parts: a smoked
 * tint, a light sheen across the top, and a rim that is brighter on top.
 */
function GlassFill({ radius }: { radius: number }) {
  if (Platform.OS === "ios") return <IosGlassPill tint="rgba(0,0,0,0.18)" borderRadius={radius} />;
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { borderRadius: radius, overflow: "hidden" }]}>
      <View style={[StyleSheet.absoluteFill, { backgroundColor: "rgba(14,14,18,0.46)" }]} />
      <LinearGradient
        colors={["rgba(255,255,255,0.24)", "rgba(255,255,255,0.07)", "rgba(255,255,255,0)"]}
        locations={[0, 0.48, 1]}
        style={StyleSheet.absoluteFill}
      />
      <View style={[StyleSheet.absoluteFill, { borderRadius: radius, borderWidth: 1, borderColor: "rgba(255,255,255,0.2)", borderTopColor: "rgba(255,255,255,0.45)" }]} />
    </View>
  );
}

/**
 * The song chip in the corner of a video, as on web: a small smoked glass
 * tile with 8pt corners, "♪ Song — Artist". Tapping it starts a new post
 * with the same song.
 */
export function SoundtrackChip({ title, creator, onPress, style }: {
  title: string;
  creator?: string;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  const { t } = useTranslation();
  const name = title || t("feed.music");
  return (
    <TouchableOpacity
      onPress={onPress ? (event) => { event.stopPropagation?.(); onPress(); } : undefined}
      disabled={!onPress}
      activeOpacity={0.75}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={`${t("copy.0418db35eb35", { defaultValue: "Use this sound" })}: ${name}`}
      style={[styles.chip, style]}
    >
      <ChipGlass />
      <Ionicons name="musical-note" size={12} color="#fff" />
      <Text style={styles.chipText} numberOfLines={1}>{name}{creator ? ` — ${creator}` : ""}</Text>
    </TouchableOpacity>
  );
}

/** Web's `bg-black/40 backdrop-blur border-white/10`. Android draws the frost without a blur. */
function ChipGlass() {
  if (Platform.OS === "ios") return <IosGlassPill tint="rgba(0,0,0,0.28)" borderRadius={8} />;
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { borderRadius: 8, overflow: "hidden" }]}>
      <View style={[StyleSheet.absoluteFill, { backgroundColor: "rgba(10,10,14,0.5)" }]} />
      <LinearGradient
        colors={["rgba(255,255,255,0.16)", "rgba(255,255,255,0.04)", "rgba(255,255,255,0)"]}
        locations={[0, 0.5, 1]}
        style={StyleSheet.absoluteFill}
      />
      <View style={[StyleSheet.absoluteFill, { borderRadius: 8, borderWidth: 1, borderColor: "rgba(255,255,255,0.1)", borderTopColor: "rgba(255,255,255,0.28)" }]} />
    </View>
  );
}

const BEAT_MS = 508; // 118 BPM

/** One looping beat drives every bar; each bar maps it to its own range and
 *  half of them run against it, so the wave ripples instead of pumping. */
function useBeat(playing: boolean, period = BEAT_MS) {
  const beat = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!playing) { beat.stopAnimation(); beat.setValue(0); return; }
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(beat, { toValue: 1, duration: period, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      Animated.timing(beat, { toValue: 0, duration: period, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [playing, beat, period]);
  return beat;
}

/**
 * The song's seek bar, 0 to the whole song. It holds its own touch, so a drag
 * along it neither scrolls the feed nor opens the post; the song jumps where
 * the finger lifts.
 */
function ScrubBar({ current, duration, onSeek, isLight, label }: {
  current: number;
  duration: number;
  onSeek: (seconds: number) => void;
  isLight: boolean;
  label: string;
}) {
  const track = useRef<View>(null);
  const box = useRef({ x: 0, width: 0 });
  const [drag, setDrag] = useState<number | null>(null);
  const measure = () => track.current?.measureInWindow((x, _y, width) => { box.current = { x, width }; });
  const fractionAt = (event: GestureResponderEvent) => {
    const { x, width } = box.current;
    return width > 0 ? Math.min(1, Math.max(0, (event.nativeEvent.pageX - x) / width)) : 0;
  };
  const progress = drag ?? (duration ? current / duration : 0);
  const fill = isLight ? "#0b0b0f" : "#fff";
  return (
    <View
      ref={track}
      onLayout={measure}
      style={styles.scrub}
      hitSlop={{ top: 12, bottom: 12 }}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={label}
      accessibilityValue={{ min: 0, max: Math.round(duration), now: Math.round(current), text: `${clock(current)} / ${clock(duration)}` }}
      accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
      onAccessibilityAction={(event) => { if (duration) onSeek(current + (event.nativeEvent.actionName === "increment" ? 5 : -5)); }}
      onStartShouldSetResponder={() => duration > 0}
      onMoveShouldSetResponder={() => duration > 0}
      onResponderTerminationRequest={() => false}
      onResponderGrant={(event) => { measure(); setDrag(fractionAt(event)); }}
      onResponderMove={(event) => setDrag(fractionAt(event))}
      onResponderRelease={(event) => { const f = fractionAt(event); setDrag(null); onSeek(f * duration); }}
      onResponderTerminate={() => setDrag(null)}
    >
      <View style={[styles.scrubTrack, { backgroundColor: isLight ? "rgba(0,0,0,0.12)" : "rgba(255,255,255,0.15)" }]}>
        <View style={[styles.scrubFill, { width: `${progress * 100}%`, backgroundColor: fill }]} />
      </View>
      <View style={[styles.scrubThumb, { left: `${progress * 100}%`, backgroundColor: fill, opacity: drag === null ? 0 : 1 }]} />
    </View>
  );
}

function SoundEq({ playing = true, color = "#fff" }: { playing?: boolean; color?: string }) {
  const beat = useBeat(playing, 300);
  const ranges: [number, number][] = [[0.25, 1], [1, 0.3], [0.4, 0.9], [0.9, 0.2]];
  return (
    <View style={styles.eq}>
      {ranges.map((range, i) => (
        <Animated.View key={i} style={[styles.eqBar, { backgroundColor: color, transform: [{ scaleY: beat.interpolate({ inputRange: [0, 1], outputRange: range }) }] }]} />
      ))}
    </View>
  );
}

/** The photo under a playing soundtrack drifts and zooms slowly, like a film shot. */
export function SoundDrift({ playing, children }: { playing: boolean; children: React.ReactNode }) {
  const drift = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!playing) {
      Animated.timing(drift, { toValue: 0, duration: 600, easing: Easing.out(Easing.quad), useNativeDriver: true }).start();
      return;
    }
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(drift, { toValue: 1, duration: 16000, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      Animated.timing(drift, { toValue: 0, duration: 16000, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [playing, drift]);
  const scale = drift.interpolate({ inputRange: [0, 1], outputRange: [1, 1.08] });
  const translateX = drift.interpolate({ inputRange: [0, 1], outputRange: [0, -6] });
  return <Animated.View style={{ transform: [{ scale }, { translateX }] }}>{children}</Animated.View>;
}

const styles = StyleSheet.create({
  capsule: { flexDirection: "row", alignItems: "center", gap: 8, height: 36, paddingHorizontal: 12, borderRadius: 18, alignSelf: "flex-start", maxWidth: 240, ...(Platform.OS === "ios" ? { overflow: "hidden" as const } : { boxShadow: "0px 6px 18px rgba(0,0,0,0.22)" }) },
  capsuleOverlay: { position: "absolute", left: 10, bottom: 10 },
  chip: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, maxWidth: "60%", alignSelf: "flex-start" },
  chipText: { color: "#fff", fontSize: 10, flexShrink: 1 },
  capsuleTitle: { color: "#fff", fontSize: 12, fontWeight: "600", flexShrink: 1, textShadowColor: "rgba(0,0,0,0.35)", textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 3 },
  bar: { flexDirection: "row", alignItems: "center", gap: 12, marginTop: 8, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth },
  barDark: { backgroundColor: "rgba(255,255,255,0.05)", borderColor: "rgba(255,255,255,0.1)" },
  barLight: { backgroundColor: "rgba(0,0,0,0.03)", borderColor: "rgba(0,0,0,0.1)" },
  barArt: { width: 44, height: 44, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  barMeta: { flex: 1, minWidth: 0 },
  barTitle: { fontSize: 14, fontWeight: "600" },
  barSub: { fontSize: 12, marginTop: 1 },
  barTimeRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 6 },
  barTime: { width: 36, fontSize: 11, fontVariant: ["tabular-nums"] },
  barTimeEnd: { textAlign: "right" },
  barButton: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  scrub: { flex: 1, height: 20, justifyContent: "center" },
  scrubTrack: { height: 4, borderRadius: 2, overflow: "hidden" },
  scrubFill: { height: 4, borderRadius: 2 },
  scrubThumb: { position: "absolute", top: 4, width: 12, height: 12, borderRadius: 6, marginLeft: -6 },
  eq: { flexDirection: "row", alignItems: "flex-end", gap: 2, height: 12 },
  eqBar: { width: 2.5, height: "100%", borderRadius: 2, backgroundColor: "#fff" },
});

export default React.memo(SoundtrackBadge);
