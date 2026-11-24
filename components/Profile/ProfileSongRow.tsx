/**
 * The song under a profile's bio. Same as web's components/app/profile/ProfileSong.
 *
 * Tap to play the part the owner picked. When the owner switched on "Play
 * when people visit", it starts by itself for visitors (never the owner),
 * fading in, unless the visitor muted videos or something else is playing.
 * A visitor who stops a song that started by itself won't get any more that
 * start by themselves, until they play one on purpose. It stops when the
 * profile closes, the app goes to the background, or anything else plays.
 */
import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { AppState, Animated, Easing, Text, TouchableOpacity, View } from "react-native";
import { useTranslation } from "react-i18next";
import { NavigationContext } from "@react-navigation/native";
import { useAudioPlayer, useAudioPlayerStatus } from "expo-audio";
import Ionicons from "@expo/vector-icons/Ionicons";
import SmartImage from "../common/SmartImage";
import { useAppTheme } from "../../context/ThemeContext";
import { useKitColors } from "../page/PageKit";
import { hasAudioFocus, releaseAudioFocus, requestAudioFocus } from "../../libs/audioFocus";
import { getAudioPostPlaybackState, pauseAudioPost } from "../../libs/audio-post-playback";
import { getCachedMuted } from "../../libs/videoMutedState";
import {
  profileSongAutoplayAllowed,
  readProfileSong,
  setProfileSongAutoplayAllowed,
  type ProfileSong as Song,
} from "../../libs/profileSong";

const FADE_IN_MS = 2000;
const FADE_OUT_S = 1.2;

function useSongInk() {
  const { isLight } = useAppTheme();
  const kit = useKitColors();
  return isLight
    ? { ink: "hsla(240,8%,4%,1)", ink2: "hsla(240,8%,4%,0.62)", field: "hsla(0,0%,0%,0.05)", hairline: "hsla(0,0%,0%,0.08)", square: "hsla(0,0%,0%,0.06)", activeBg: "hsla(240,8%,7%,1)", activeInk: "hsla(0,0%,100%,1)" }
    : { ink: "#fff", ink2: "hsla(240, 5%, 65%, 1)", field: "hsla(240, 5%, 96%, 0.08)", hairline: "hsla(0, 0%, 100%, 0.10)", square: "hsla(240, 5%, 96%, 0.10)", activeBg: kit.activeBg, activeInk: kit.activeInk };
}

export default function ProfileSongRow({ customs, isOwn }: { customs?: Record<string, unknown> | null; isOwn?: boolean }) {
  const song = useMemo(() => readProfileSong(customs ?? null), [customs]);
  if (!song) return null;
  return <SongRow key={`${song.url}:${song.start}`} song={song} isOwn={!!isOwn} />;
}

/** Four bars that bounce while the song plays. */
function Bars({ color }: { color: string }) {
  const vals = useRef([0, 1, 2, 3].map(() => new Animated.Value(0.3))).current;
  useEffect(() => {
    const loops = vals.map((v, i) => Animated.loop(Animated.sequence([
      Animated.timing(v, { toValue: 1, duration: 380 + i * 90, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      Animated.timing(v, { toValue: 0.25, duration: 380 + i * 90, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
    ])));
    loops.forEach((l, i) => setTimeout(() => l.start(), i * 110));
    return () => loops.forEach((l) => l.stop());
  }, [vals]);
  return (
    <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 2, height: 14 }}>
      {vals.map((v, i) => (
        <Animated.View key={i} style={{ width: 3, height: 14, borderRadius: 2, backgroundColor: color, transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [7, 0] }) }, { scaleY: v }] }} />
      ))}
    </View>
  );
}

export function SongRow({ song, isOwn, autoStart = true }: { song: Song; isOwn: boolean; /** Edit profile preview: never starts by itself. */ autoStart?: boolean }) {
  const { t } = useTranslation();
  const c = useSongInk();
  const navigation = useContext(NavigationContext);
  const player = useAudioPlayer({ uri: song.url }, { updateInterval: 250 });
  const status = useAudioPlayerStatus(player);
  const [playing, setPlaying] = useState(false);
  const auto = useRef(false);
  const startedAt = useRef(0);
  const fade = useRef<ReturnType<typeof setInterval> | null>(null);
  const progress = useRef(new Animated.Value(0)).current;

  const stopFade = () => {
    if (fade.current) clearInterval(fade.current);
    fade.current = null;
  };

  // The focus holder's stop callback must be one stable function.
  const stopRef = useRef<() => void>(() => {});
  const onFocusLost = useCallback(() => stopRef.current(), []);

  const pause = useCallback((byPerson: boolean) => {
    stopFade();
    try { player.pause(); player.volume = 1; } catch { /* released */ }
    if (byPerson && auto.current) setProfileSongAutoplayAllowed(false);
    auto.current = false;
    releaseAudioFocus(onFocusLost);
    setPlaying(false);
  }, [player, onFocusLost]);
  stopRef.current = () => pause(false);

  const start = useCallback((byItself: boolean) => {
    if (!byItself) {
      setProfileSongAutoplayAllowed(true);
      if (getAudioPostPlaybackState().isPlaying) pauseAudioPost();
    }
    requestAudioFocus(onFocusLost);
    startedAt.current = Date.now();
    auto.current = byItself;
    stopFade();
    try {
      const at = player.currentTime || 0;
      if (at < song.start || at >= song.end - 0.25) void player.seekTo(song.start);
      player.volume = byItself ? 0 : 1;
      player.play();
      setPlaying(true);
    } catch {
      setPlaying(false);
      return;
    }
    if (byItself) {
      const began = Date.now();
      fade.current = setInterval(() => {
        const k = Math.min(1, (Date.now() - began) / FADE_IN_MS);
        try { player.volume = k * k; } catch { /* released */ }
        if (k >= 1) stopFade();
      }, 80);
    }
  }, [player, song.start, song.end, onFocusLost]);

  // Plays by itself for visitors, a moment after the profile opens.
  useEffect(() => {
    if (!autoStart || isOwn || !song.autoplay) return;
    const timer = setTimeout(() => {
      if (!profileSongAutoplayAllowed() || getCachedMuted() || hasAudioFocus() || getAudioPostPlaybackState().isPlaying) return;
      if (AppState.currentState !== "active") return;
      if (navigation && !navigation.isFocused()) return;
      start(true);
    }, 900);
    return () => clearTimeout(timer);
  }, [autoStart, isOwn, song.autoplay, start, navigation]);

  // Stop on leaving the profile, the app going to the background, or unmount.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => { if (s !== "active") stopRef.current(); });
    const offBlur = navigation?.addListener?.("blur", () => stopRef.current());
    return () => {
      sub.remove();
      offBlur?.();
      stopFade();
      releaseAudioFocus(onFocusLost);
      try { player.pause(); } catch { /* released */ }
    };
  }, [navigation, player, onFocusLost]);

  // Progress, soft ending and stop at the end of the part.
  useEffect(() => {
    if (!playing) return;
    // Right after a start the status can still hold the old position.
    if (Date.now() - startedAt.current < 600) return;
    const at = status.currentTime || 0;
    const k = Math.max(0, Math.min(1, (at - song.start) / (song.end - song.start)));
    Animated.timing(progress, { toValue: k, duration: 250, easing: Easing.linear, useNativeDriver: false }).start();
    const left = song.end - at;
    if (left < FADE_OUT_S && left > 0 && !fade.current) {
      try { player.volume = Math.max(0, left / FADE_OUT_S); } catch { /* released */ }
    }
    if (at >= song.end || status.didJustFinish) {
      pause(false);
      progress.setValue(0);
      try { void player.seekTo(song.start); } catch { /* released */ }
    }
  }, [status.currentTime, status.didJustFinish, playing, song.start, song.end, player, pause, progress]);

  const label = playing
    ? t("profileSong.pause", { defaultValue: "Pause {{title}}", title: song.title })
    : t("profileSong.play", { defaultValue: "Play {{title}}", title: song.title });

  return (
    <TouchableOpacity
      testID="profile-song"
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: playing }}
      activeOpacity={0.85}
      onPress={() => (playing ? pause(true) : start(false))}
      style={{ marginTop: 12, alignSelf: "stretch" }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10, padding: 8, borderRadius: 14, borderWidth: 1, borderColor: c.hairline, backgroundColor: c.field, overflow: "hidden" }}>
        {song.artwork
          ? <SmartImage source={{ uri: song.artwork }} style={{ width: 38, height: 38, borderRadius: 9 }} contentFit="cover" />
          : <View style={{ width: 38, height: 38, borderRadius: 9, backgroundColor: c.square, alignItems: "center", justifyContent: "center" }}><Ionicons name="musical-notes" size={16} color={c.ink} /></View>}
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={{ color: c.ink, fontSize: 14, fontWeight: "600" }} numberOfLines={1}>{song.title}</Text>
          {!!song.artist && <Text style={{ color: c.ink2, fontSize: 12.5, marginTop: 1 }} numberOfLines={1}>{song.artist}</Text>}
        </View>
        {playing ? <Bars color={c.ink} /> : null}
        <View style={{ width: 34, height: 34, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: playing ? c.activeBg : c.square }}>
          <Ionicons name={playing ? "pause" : "play"} size={15} color={playing ? c.activeInk : c.ink} />
        </View>
        <Animated.View
          pointerEvents="none"
          style={{
            position: "absolute", left: 0, bottom: 0, height: 2, backgroundColor: c.activeBg, opacity: playing ? 1 : 0,
            width: progress.interpolate({ inputRange: [0, 1], outputRange: ["0%", "100%"] }),
          }}
        />
      </View>
    </TouchableOpacity>
  );
}
