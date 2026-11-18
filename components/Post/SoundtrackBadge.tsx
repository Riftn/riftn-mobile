import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { TouchableOpacity, View, Text, StyleSheet, ActivityIndicator, AppState, Animated, Easing, Platform, Linking, type StyleProp, type ViewStyle } from "react-native";
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
import { playableSoundUrl, soundCredit, soundWindowCorrection, soundWindowProgress } from "../../libs/soundWindow";

interface Props {
  title: string;
  creator: string;
  url: string;
  isVisible?: boolean;
  /** overlay: a glass capsule on the photo that opens into a wave along its
   *  bottom edge while the song plays. inline: the capsule alone. */
  variant?: "overlay" | "inline";
  onPlayingChange?: (playing: boolean) => void;
  /** A video's song plays with the video itself: the badge only credits it. */
  withVideo?: boolean;
}

const SoundtrackBadge: React.FC<Props> = ({ title, creator, url, isVisible = true, variant = "inline", onPlayingChange, withVideo = false }) => {
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
        const jump = soundWindowCorrection(url, status.currentTime ?? 0);
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
  }, [url]);

  useEffect(() => { if (!isVisible || !focused) pause(); }, [isVisible, focused, pause]);
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => { if (state !== "active") pause(); });
    return () => subscription.remove();
  }, [pause]);

  const [progress, setProgress] = useState(0);
  useEffect(() => {
    if (!playing || variant !== "overlay") return;
    const read = () => {
      const audio = session.value;
      const duration = audio?.duration ?? 0;
      setProgress(audio && duration > 0 ? soundWindowProgress(url, audio.currentTime, duration) : 0);
    };
    read();
    const id = setInterval(read, 250);
    return () => clearInterval(id);
  }, [playing, variant, session, url]);

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
    return (
      <View style={styles.edge} pointerEvents="box-none">
        <LinearGradient
          colors={["rgba(0,0,0,0)", "rgba(0,0,0,0.15)", "rgba(0,0,0,0.65)"]}
          locations={[0, 0.35, 1]}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        />
        <View style={styles.edgeRow} pointerEvents="box-none">
          <View style={styles.edgeMeta} pointerEvents={creditLine ? "box-none" : "none"}>
            <View style={styles.edgeTitleRow}>
              <Ionicons name="musical-note" size={13} color="#fff" />
              <Text style={[styles.edgeTitle, styles.shadow]} numberOfLines={1}>{name}</Text>
            </View>
            {!!creator && <Text style={[styles.edgeCreator, styles.shadow]} numberOfLines={1}>{creator}</Text>}
            {!!creditLine && (
              <Text onPress={openCredit} style={[styles.edgeCredit, styles.shadow]} numberOfLines={1} accessibilityRole="link">{creditLine}</Text>
            )}
          </View>
          <TouchableOpacity onPress={onPress} activeOpacity={0.75} accessibilityRole="button" accessibilityLabel={label} style={styles.edgeButton}>
            <GlassFill radius={20} />
            {loading ? <ActivityIndicator size="small" color="#fff" /> : <Ionicons name={playing ? "pause" : "play"} size={17} color="#fff" style={playing ? undefined : { marginLeft: 2 }} />}
          </TouchableOpacity>
        </View>
        <SoundWave seed={`${name}|${creator}`} playing={playing} progress={progress} />
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

const BAR_COUNT = 40;
const BEAT_MS = 508; // 118 BPM

/** Stable bar heights per song, so the same song always draws the same wave. */
function waveFor(seed: string): number[] {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return Array.from({ length: BAR_COUNT }, (_, i) => {
    h = Math.imul(h ^ (h >>> 15), 2246822507) + i;
    const noise = ((h >>> 0) % 1000) / 1000;
    const shape = Math.abs(Math.sin(i * 0.55)) * 0.5 + 0.5;
    return 0.3 + 0.7 * noise * shape;
  });
}

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

function SoundWave({ seed, playing, progress }: { seed: string; playing: boolean; progress: number }) {
  const bars = useMemo(() => waveFor(seed), [seed]);
  const beat = useBeat(playing);
  return (
    <View style={styles.wave} pointerEvents="none">
      {bars.map((h, i) => {
        const low = h * 0.35;
        const scaleY = playing
          ? beat.interpolate({ inputRange: [0, 1], outputRange: i % 2 ? [h, low] : [low, h] })
          : 0.15;
        return (
          <Animated.View
            key={i}
            style={[styles.bar, i / BAR_COUNT < progress && styles.barPlayed, { transform: [{ scaleY }] }]}
          />
        );
      })}
    </View>
  );
}

function SoundEq() {
  const beat = useBeat(true, 300);
  const ranges: [number, number][] = [[0.25, 1], [1, 0.3], [0.4, 0.9], [0.9, 0.2]];
  return (
    <View style={styles.eq}>
      {ranges.map((range, i) => (
        <Animated.View key={i} style={[styles.eqBar, { transform: [{ scaleY: beat.interpolate({ inputRange: [0, 1], outputRange: range }) }] }]} />
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
  edgeCredit: { color: "rgba(255,255,255,0.7)", fontSize: 10, marginTop: 2 },
  edge: { position: "absolute", left: 0, right: 0, bottom: 0, paddingTop: 40, paddingBottom: 8 },
  edgeRow: { flexDirection: "row", alignItems: "flex-end", gap: 12, paddingHorizontal: 12 },
  edgeMeta: { flex: 1, minWidth: 0 },
  edgeTitleRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  edgeTitle: { color: "#fff", fontSize: 14, fontWeight: "700", flexShrink: 1 },
  edgeCreator: { color: "rgba(255,255,255,0.82)", fontSize: 12, marginTop: 1 },
  shadow: { textShadowColor: "rgba(0,0,0,0.6)", textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 8 },
  edgeButton: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  wave: { flexDirection: "row", alignItems: "center", gap: 2, height: 14, marginTop: 8, marginHorizontal: 12 },
  bar: { flex: 1, height: "100%", borderRadius: 2, backgroundColor: "rgba(255,255,255,0.4)" },
  barPlayed: { backgroundColor: "rgba(255,255,255,0.95)" },
  eq: { flexDirection: "row", alignItems: "flex-end", gap: 2, height: 12 },
  eqBar: { width: 2.5, height: "100%", borderRadius: 2, backgroundColor: "#fff" },
});

export default React.memo(SoundtrackBadge);
