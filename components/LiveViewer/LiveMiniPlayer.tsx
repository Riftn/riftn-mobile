/**
 * LiveMiniPlayer — a live you minimised
 * =====================================
 * Mounted once, app-wide, above the navigator (beside the other mini players).
 *
 * - **Corner window** ("video"): the live keeps playing in a small window you
 *   can drag to any corner while you use the app. Tap it to open the live
 *   again; Headphones turns it into the listen bar; the float button hands it
 *   to the phone's own floating window, which also happens by itself when you
 *   leave the app with the window up.
 * - **Listen bar** ("listen"): sound only, in the same bar the music and
 *   audio-post players use, above the menu.
 * - **Away** ("away"): nothing on screen. The full viewer on iPhone plays over
 *   WebRTC, which cannot float or keep going in the background, so leaving
 *   the app hands the sound to this player until you come back.
 *
 * Its own HLS player (the AAC copy on iPhone), so the lock screen shows the
 * live's title and host. Goes through the app's audio focus like every other
 * player: starting other sound closes it, and opening it stops theirs, so two
 * bars or two sounds are never up at once.
 */

import { LiveDot } from "../common/LiveDot";
import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { ActivityIndicator, AppState, Pressable, StyleSheet, Text, View } from "react-native";
import { isPictureInPictureSupported, VideoView, type VideoPlayer, type VideoSource } from "expo-video";
import { LinearGradient } from "expo-linear-gradient";
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useNavigation } from "@react-navigation/native";
import { useTranslation } from "react-i18next";

import Icon from "../ui/Icon";
import Avatar from "../common/Avatar";
import { KeepDarkScope } from "../../libs/jsx/tone";
import { useUser } from "../../context/AuthContext";
import { useWebSocket } from "../../context/WebSocketContext";
import { useAppTheme } from "../../context/ThemeContext";
import { useStages } from "../../context/StageContext";
import { GLASS_PLAYBACK_CONTROL } from "../../theme/skins";
import { ScreenNames } from "../../navigation/ScreenNames";
import { requestAudioFocus, releaseAudioFocus } from "../../libs/audioFocus";
import { configureForBackgroundPlayback, releaseBackgroundPlayback } from "../../libs/audioSession";
import { useCallInProgress, visualActivity } from "../../libs/visualActivity";
import { acquireStreamViewer } from "../../libs/stream-presence";
import { useSharedLivePlayer } from "../../libs/sharedLivePlayer";
import { isPictureInPicturePlayer, setPictureInPicturePlayer } from "../../libs/pictureInPicture";
import { closeInAppVideoMini } from "../../libs/in-app-video-mini";
import { toastInfo } from "../../libs/toast";
import {
  closeLiveMini,
  getLiveMini,
  getLiveMiniVersion,
  setLiveMiniMode,
  setLiveMiniPlayer,
  setLiveMiniSeat,
  subscribeLiveMini,
  type LiveMini,
} from "../../libs/live-mini";

/** Gap from the screen edge, and from the menu at the bottom. */
const MARGIN = 12;
const ABOVE_MENU = 96;
/** Below the top pill on every screen. */
const BELOW_TOP_BAR = 64;
/** A stall this long gets the stream checked: ended lives close themselves. */
const STALL_CHECK_MS = 15_000;
const OPEN_MS = 240;
const CLOSE_MS = 180;

export default function LiveMiniPlayerHost() {
  useSyncExternalStore(subscribeLiveMini, getLiveMiniVersion, getLiveMiniVersion);
  const entry = getLiveMini();
  const user = useUser();
  const owner = user?.walletAddress || user?.address || "guest";
  const previousOwner = useRef(owner);
  useEffect(() => {
    if (previousOwner.current !== owner) closeLiveMini();
    previousOwner.current = owner;
  }, [owner]);
  return entry ? <LiveMiniSession key={`${entry.streamId}:${entry.url}`} entry={entry} /> : null;
}

function LiveMiniSession({ entry }: { entry: LiveMini }) {
  const { t } = useTranslation();
  const navigation = useNavigation<any>();
  const inCall = useCallInProgress();
  const { emitAuthed, isCoreConnected, coreConnected, connectionEpoch } = useWebSocket();

  // A recovery reload carries the lock screen metadata. The handoff itself
  // keeps the buffered player intact.
  const source = useMemo<VideoSource>(() => ({
    uri: entry.url,
    metadata: { title: entry.title, artist: entry.host, artwork: entry.avatar },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [entry.url]);
  const player = useSharedLivePlayer(entry.url, source)!;
  const [playing, setPlaying] = useState(() => player.playing);
  const [ready, setReady] = useState(() => player.status === "readyToPlay");
  const [aspect, setAspect] = useState(9 / 16);
  const wantsPlayback = useRef(true);

  // One sound at a time: another player starting closes this one.
  useEffect(() => {
    setLiveMiniPlayer(entry.url, player);
    closeInAppVideoMini();
    requestAudioFocus(closeLiveMini);
    void configureForBackgroundPlayback().catch(() => {});
    try {
      player.muted = !!entry.muted;
      player.staysActiveInBackground = true;
      player.showNowPlayingNotification = true;
      if (!player.playing && !visualActivity.isCallBusy()) player.play();
    } catch {}
    return () => {
      releaseAudioFocus(closeLiveMini);
      void releaseBackgroundPlayback().catch(() => {});
    };
    // These are the incoming playback settings for this URL.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry.url, player]);

  // A call takes the sound; the live waits paused until you play it again.
  useEffect(() => {
    if (inCall) {
      wantsPlayback.current = false;
      try { player.pause(); } catch {}
    }
  }, [inCall, player]);

  // The audience seat: the one the viewer handed over, then a fresh one per
  // connection. "Away" keeps the viewer's own seat instead.
  const seatEpoch = useRef<number | null>(entry.release ? connectionEpoch : null);
  useEffect(() => {
    if (entry.mode === "away" || !entry.countsAsViewer || !coreConnected) return;
    if (seatEpoch.current === connectionEpoch && getLiveMini()?.release) return;
    seatEpoch.current = connectionEpoch;
    setLiveMiniSeat(entry.streamId, acquireStreamViewer(emitAuthed, isCoreConnected, connectionEpoch, entry.streamId));
  }, [entry.mode, entry.countsAsViewer, entry.streamId, coreConnected, connectionEpoch, emitAuthed, isCoreConnected]);

  // Coming back to the app ends an "away" hand-over: the viewer is still open.
  useEffect(() => {
    if (entry.mode !== "away") return;
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") closeLiveMini();
    });
    return () => sub.remove();
  }, [entry.mode]);

  // A live that ended stops sending; close rather than spin forever.
  useEffect(() => {
    let stallTimer: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;
    const canPlay = () => !cancelled && wantsPlayback.current && !visualActivity.isCallBusy();
    const check = async () => {
      if (!canPlay()) return;
      try {
        const res = await fetch(entry.url, { method: "GET" });
        if (cancelled) return;
        if (res.status === 404 || res.status === 410) {
          toastInfo(t("liveViewer.streamHasEnded"));
          closeLiveMini();
          return;
        }
      } catch {}
      if (!canPlay()) return;
      try { player.replace(source); player.play(); } catch {}
    };
    const recover = (delay: number) => {
      if (stallTimer) clearTimeout(stallTimer);
      stallTimer = setTimeout(() => {
        if (!canPlay()) return;
        if (player.status === "readyToPlay" && !player.playing) {
          try { player.play(); } catch {}
        } else void check();
      }, delay);
    };
    setPlaying(player.playing);
    setReady(player.status === "readyToPlay");
    if (!player.playing) recover(player.status === "readyToPlay" || player.status === "error" ? 3000 : STALL_CHECK_MS);
    const subs = [
      player.addListener("playingChange", ({ isPlaying }) => {
        setPlaying(isPlaying);
        if (stallTimer) { clearTimeout(stallTimer); stallTimer = null; }
        if (!isPlaying && canPlay()) recover(3000);
      }),
      player.addListener("statusChange", ({ status }) => {
        if (status === "readyToPlay") setReady(true);
        if (stallTimer) { clearTimeout(stallTimer); stallTimer = null; }
        if (!player.playing && canPlay()) recover(status === "loading" ? STALL_CHECK_MS : 3000);
      }),
      player.addListener("videoTrackChange", ({ videoTrack }) => {
        const size = videoTrack?.size;
        if (size && size.width > 0 && size.height > 0) setAspect(size.width / size.height);
      }),
    ];
    return () => {
      cancelled = true;
      if (stallTimer) clearTimeout(stallTimer);
      subs.forEach((sub) => sub.remove());
    };
  }, [player, entry.url, source, t]);

  const togglePlay = useCallback(() => {
    try {
      if (player.playing) {
        wantsPlayback.current = false;
        player.pause();
        return;
      }
      if (visualActivity.isCallBusy()) return;
      wantsPlayback.current = true;
      requestAudioFocus(closeLiveMini);
      // A live picks up at the live edge again, not where it was paused.
      player.replace(source);
      player.play();
    } catch {}
  }, [player, source]);

  const restore = useCallback(() => {
    navigation.navigate(ScreenNames.LiveViewer, entry.params);
  }, [navigation, entry.params]);

  if (entry.mode === "away") return null;
  return entry.mode === "video" ? (
    <CornerWindow entry={entry} player={player} playing={playing} ready={ready} aspect={aspect}
      onTogglePlay={togglePlay} onRestore={restore} />
  ) : (
    <ListenBar entry={entry} playing={playing} onTogglePlay={togglePlay} onRestore={restore} />
  );
}

type Props = {
  entry: LiveMini;
  playing: boolean;
  onTogglePlay: () => void;
  onRestore: () => void;
};

function CornerWindow({ entry, player, playing, ready, aspect, onTogglePlay, onRestore }: Props & {
  player: VideoPlayer;
  ready: boolean;
  aspect: number;
}) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const reducedMotion = useReducedMotion();
  const viewRef = useRef<VideoView>(null);
  const [firstFrame, setFirstFrame] = useState(false);
  const pipSupported = isPictureInPictureSupported();
  const [bounds, setBounds] = useState<{ width: number; height: number } | null>(null);

  const portrait = aspect < 1;
  const width = bounds ? Math.round(Math.min(portrait ? 132 : 216, bounds.width * (portrait ? 0.36 : 0.56))) : 132;
  const height = Math.round(width / Math.max(0.3, aspect));

  const x = useSharedValue(0);
  const y = useSharedValue(0);
  const w = useSharedValue(width);
  const h = useSharedValue(height);
  const shown = useSharedValue(0);
  const corner = useRef<{ right: boolean; bottom: boolean }>({ right: true, bottom: true });

  const spot = useCallback((right: boolean, bottom: boolean, bw: number, bh: number, ww: number, hh: number) => ({
    x: right ? bw - ww - MARGIN : MARGIN,
    y: bottom ? bh - hh - ABOVE_MENU - insets.bottom : insets.top + BELOW_TOP_BAR,
  }), [insets.bottom, insets.top]);

  // Lands in its corner, and moves with it when the picture's shape is known.
  useEffect(() => {
    if (!bounds) return;
    const p = spot(corner.current.right, corner.current.bottom, bounds.width, bounds.height, width, height);
    const first = shown.value === 0;
    const timing = { duration: reducedMotion || first ? 0 : 220, easing: Easing.bezier(0.45, 0, 0.1, 1) };
    x.value = withTiming(p.x, timing);
    y.value = withTiming(p.y, timing);
    w.value = withTiming(width, timing);
    h.value = withTiming(height, timing);
    if (first) shown.value = withTiming(1, { duration: reducedMotion ? 0 : OPEN_MS, easing: Easing.bezier(0.25, 0.8, 0.25, 1) });
  }, [bounds, width, height, spot, reducedMotion, x, y, w, h, shown]);

  const settle = useCallback((right: boolean, bottom: boolean) => {
    corner.current = { right, bottom };
  }, []);

  const startX = useSharedValue(0);
  const startY = useSharedValue(0);
  const drag = useMemo(() => {
    const bw = bounds?.width ?? 0;
    const bh = bounds?.height ?? 0;
    const top = insets.top + BELOW_TOP_BAR;
    const bottomGap = ABOVE_MENU + insets.bottom;
    return Gesture.Pan()
      .minDistance(6)
      .onStart(() => {
        "worklet";
        startX.value = x.value;
        startY.value = y.value;
      })
      .onUpdate((e) => {
        "worklet";
        x.value = startX.value + e.translationX;
        y.value = startY.value + e.translationY;
      })
      .onEnd((e) => {
        "worklet";
        if (!bw || !bh) return;
        // Thrown, not just dropped: carry the fling a little before choosing.
        const cx = x.value + w.value / 2 + e.velocityX * 0.12;
        const cy = y.value + h.value / 2 + e.velocityY * 0.12;
        const right = cx > bw / 2;
        const bottom = cy > bh / 2;
        const tx = right ? bw - w.value - MARGIN : MARGIN;
        const ty = bottom ? bh - h.value - bottomGap : top;
        x.value = withSpring(tx, { damping: 30, stiffness: 340, velocity: e.velocityX });
        y.value = withSpring(ty, { damping: 30, stiffness: 340, velocity: e.velocityY });
        runOnJS(settle)(right, bottom);
      });
  }, [bounds, insets.bottom, insets.top, settle, x, y, w, h, startX, startY]);

  const style = useAnimatedStyle(() => ({
    left: x.value,
    top: y.value,
    width: w.value,
    height: h.value,
    opacity: shown.value,
    transform: [{ scale: 0.92 + shown.value * 0.08 }],
  }));

  const leave = useCallback((after: () => void) => {
    shown.value = withTiming(0, { duration: reducedMotion ? 0 : CLOSE_MS, easing: Easing.in(Easing.cubic) }, (done) => {
      "worklet";
      if (done) runOnJS(after)();
    });
  }, [reducedMotion, shown]);

  const startFloat = useCallback(() => {
    if (!pipSupported) return;
    void viewRef.current?.startPictureInPicture().catch(() => {
      toastInfo(t("player.pipUnavailable"));
    });
  }, [pipSupported, t]);

  const releasePiP = useCallback(() => {
    if (isPictureInPicturePlayer(player)) setPictureInPicturePlayer(null);
  }, [player]);
  useEffect(() => releasePiP, [releasePiP]);

  // Asked to float from the viewer: as soon as the picture is up.
  useEffect(() => {
    if (!entry.float || !firstFrame) return;
    setLiveMiniMode("video");
    startFloat();
  }, [entry.float, firstFrame, startFloat]);

  return (
    <View pointerEvents="box-none" style={StyleSheet.absoluteFill}
      onLayout={(e) => setBounds({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height })}>
      {bounds ? (
        <KeepDarkScope>
          <GestureDetector gesture={drag}>
            <Animated.View testID="live-mini-window" style={[styles.window, style]}>
              {entry.avatar ? (
                <View style={styles.posterWrap} pointerEvents="none">
                  <Avatar uri={entry.avatar} size={40} name={entry.host} />
                </View>
              ) : null}
              <VideoView
                ref={viewRef}
                player={player}
                style={StyleSheet.absoluteFill}
                contentFit="cover"
                surfaceType="textureView"
                nativeControls={false}
                pointerEvents="none"
                allowsPictureInPicture={pipSupported}
                startsPictureInPictureAutomatically={pipSupported && playing && firstFrame}
                onFirstFrameRender={() => setFirstFrame(true)}
                onPictureInPictureStart={() => setPictureInPicturePlayer(player)}
                onPictureInPictureStop={releasePiP}
              />
              {!ready || !firstFrame ? (
                <View style={styles.loading} pointerEvents="none">
                  <ActivityIndicator size="small" color="#FFFFFF" />
                </View>
              ) : null}
              <Pressable onPress={onRestore} style={StyleSheet.absoluteFill} accessibilityRole="button"
                accessibilityLabel={t("liveViewer.openLive", { defaultValue: "Open live" })} />
              <LinearGradient pointerEvents="none" colors={["rgba(0,0,0,0.5)", "transparent"]} style={styles.topShade} />
              <LinearGradient pointerEvents="none" colors={["transparent", "rgba(0,0,0,0.6)"]} style={styles.bottomShade} />

              <View style={styles.liveTag} pointerEvents="none">
                <LiveDot />
                <Text style={styles.liveText}>{t("live.liveBadge")}</Text>
              </View>
              <Pressable onPress={() => leave(closeLiveMini)} hitSlop={6} style={[styles.control, styles.close]}
                accessibilityRole="button" accessibilityLabel={t("common.close")}>
                <Icon name="X" size={16} color="#FFFFFF" />
              </Pressable>

              <View style={styles.bottomRow} pointerEvents="box-none">
                <Pressable onPress={onTogglePlay} hitSlop={4} style={styles.control}
                  accessibilityRole="button" accessibilityLabel={t(playing ? "audioPost.pause" : "audioPost.play")}>
                  <Icon name={playing ? "Pause" : "Play"} size={15} color="#FFFFFF" fill="#FFFFFF" />
                </Pressable>
                <View style={styles.bottomRight} pointerEvents="box-none">
                  <Pressable onPress={() => leave(() => setLiveMiniMode("listen"))} hitSlop={4} style={styles.control}
                    accessibilityRole="button" accessibilityLabel={t("liveViewer.soundOnly", { defaultValue: "Sound only" })}>
                    <Icon name="Headphones" size={16} color="#FFFFFF" />
                  </Pressable>
                  {pipSupported && <Pressable onPress={startFloat} disabled={!firstFrame} hitSlop={4} style={styles.control}
                    accessibilityRole="button" accessibilityLabel={t("player.pictureInPicture")}>
                    <Icon name="PictureInPicture2" size={16} color="#FFFFFF" />
                  </Pressable>}
                </View>
              </View>
            </Animated.View>
          </GestureDetector>
        </KeepDarkScope>
      ) : null}
    </View>
  );
}

function ListenBar({ entry, playing, onTogglePlay, onRestore }: Props) {
  const { t } = useTranslation();
  const { theme, skin } = useAppTheme();
  const { currentSpace, isConnected } = useStages();
  const reducedMotion = useReducedMotion();
  const shown = useSharedValue(0);
  useEffect(() => {
    shown.value = withTiming(1, { duration: reducedMotion ? 0 : OPEN_MS, easing: Easing.bezier(0.25, 0.8, 0.25, 1) });
  }, [reducedMotion, shown]);
  const style = useAnimatedStyle(() => ({
    opacity: shown.value,
    transform: [{ translateY: (1 - shown.value) * 16 }],
  }));
  const leave = useCallback((after: () => void) => {
    shown.value = withTiming(0, { duration: reducedMotion ? 0 : CLOSE_MS, easing: Easing.in(Easing.cubic) }, (done) => {
      "worklet";
      if (done) runOnJS(after)();
    });
  }, [reducedMotion, shown]);

  const glass = theme === "glass";
  const liveBarShowing = !!currentSpace && isConnected;
  return (
    <Animated.View testID="live-listen-bar"
      style={[styles.bar, liveBarShowing && styles.aboveLiveBar, glass && skin?.card, glass && styles.glassBar, style]}>
      {glass ? <LinearGradient pointerEvents="none" colors={["rgba(225,255,255,.16)", "transparent"]} style={StyleSheet.absoluteFill} /> : null}
      <Pressable onPress={onRestore} style={styles.barMain} accessibilityRole="button"
        accessibilityLabel={t("liveViewer.openLive", { defaultValue: "Open live" })}>
        <Avatar uri={entry.avatar} size={34} name={entry.host} />
        <View style={styles.barText}>
          <Text style={styles.barTitle} numberOfLines={1}>{entry.title}</Text>
          <View style={styles.barSubRow}>
            <LiveDot />
            <Text style={styles.barSub} numberOfLines={1}>
              {`${t("live.liveBadge")}  ·  ${entry.host}`}
            </Text>
          </View>
        </View>
      </Pressable>
      <Pressable onPress={() => leave(() => setLiveMiniMode("video"))} hitSlop={6}
        style={[styles.barBtn, glass && GLASS_PLAYBACK_CONTROL]}
        accessibilityRole="button" accessibilityLabel={t("liveViewer.showPicture", { defaultValue: "Show picture" })}>
        <Icon name="Video" size={16} color="#FFFFFF" />
      </Pressable>
      <Pressable onPress={onTogglePlay} hitSlop={6}
        style={[styles.barBtn, glass && GLASS_PLAYBACK_CONTROL]}
        accessibilityRole="button" accessibilityLabel={t(playing ? "audioPost.pause" : "audioPost.play")}>
        <Icon name={playing ? "Pause" : "Play"} size={15} color="#FFFFFF" fill="#FFFFFF" />
      </Pressable>
      <Pressable onPress={() => leave(closeLiveMini)} hitSlop={8} style={styles.barClose}
        accessibilityRole="button" accessibilityLabel={t("common.close")}>
        <Icon name="X" size={15} color="rgba(255,255,255,0.5)" />
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  window: {
    position: "absolute",
    borderRadius: 12,
    overflow: "hidden",
    backgroundColor: "#000000",
    zIndex: 9001,
    elevation: 12,
  },
  posterWrap: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center" },
  loading: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "flex-end", paddingBottom: 48 },
  topShade: { position: "absolute", left: 0, right: 0, top: 0, height: 48 },
  bottomShade: { position: "absolute", left: 0, right: 0, bottom: 0, height: 56 },
  liveTag: {
    position: "absolute",
    top: 8,
    left: 8,
    height: 20,
    paddingHorizontal: 6,
    borderRadius: 6,
    backgroundColor: "rgba(0,0,0,0.8)",
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  liveText: { color: "#FFFFFF", fontSize: 10, fontWeight: "800", letterSpacing: 0.4 },
  control: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.5)",
  },
  close: { position: "absolute", top: 4, right: 4 },
  bottomRow: {
    position: "absolute",
    left: 4,
    right: 4,
    bottom: 4,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  bottomRight: { flexDirection: "row", gap: 4 },
  // The same bar as the music and audio-post players (AudioPostMiniPlayer).
  bar: {
    position: "absolute",
    bottom: 80,
    left: 16,
    right: 16,
    minHeight: 54,
    borderRadius: 18,
    backgroundColor: "#0C0C0E",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    paddingLeft: 10,
    paddingRight: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    zIndex: 99,
  },
  glassBar: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(225,255,255,.4)",
    borderTopColor: "rgba(255,255,255,.7)",
    overflow: "hidden",
  },
  aboveLiveBar: { bottom: 140 },
  barMain: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8 },
  barText: { flex: 1, minWidth: 0 },
  barTitle: { color: "#FFFFFF", fontSize: 13, fontWeight: "600" },
  barSubRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 2 },
  barSub: { flexShrink: 1, color: "rgba(255,255,255,0.5)", fontSize: 11 },
  barBtn: {
    width: 34,
    height: 34,
    borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.1)",
    alignItems: "center",
    justifyContent: "center",
  },
  barClose: { width: 26, height: 34, alignItems: "center", justifyContent: "center" },
});
