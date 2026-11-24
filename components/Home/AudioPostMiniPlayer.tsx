import { GLASS_PLAYBACK_CONTROL } from '../../theme/skins';
/**
 * AudioPostMiniPlayer — the corner player for a popped-out audio post
 * ===================================================================
 * Mounted once, app-wide, beside RadioMiniPlayer. It shows only when a card
 * asks for it: playing in place is the common case, and this is for carrying
 * the track with you while you scroll somewhere else — so it waits to be
 * asked, same rule as the stage recording player.
 *
 * **Pause and close are two different buttons.** The round control holds the
 * track where it is; the X ends playback and dismisses the panel.
 *
 * It shares its corner with the radio and stage players, which is safe
 * because all of them go through the app's audio focus manager: popping a
 * post out stops the radio and vice versa, so two are never up at once.
 *
 * @module components/Home/AudioPostMiniPlayer
 */

import React, { useCallback, useEffect, useRef } from "react";
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Image } from "expo-image";
import { useTranslation } from "react-i18next";
import { LinearGradient } from 'expo-linear-gradient';
import { useAppTheme } from '../../context/ThemeContext';
import { Easing, useSharedValue, withTiming } from "react-native-reanimated";

import Icon from "../ui/Icon";
import { useStages } from "../../context/StageContext";
import { getCachedHue } from "../../libs/audioHueState";
import {
  CROSSFADE_STEPS,
  seekAudioPost,
  setAudioCrossfade,
  skipAudioQueue,
  stopAudioPost,
  toggleAudioPost,
  toggleAudioQueueShuffle,
  useAudioPostPlayback,
} from "../../libs/audio-post-playback";
import { formatCount } from "../../libs/format-count";
import { ScrubSurface, SeekBar, fmtDuration, useSeekSurface } from "./AudioPostPlayer";

const noop = () => {};

const AudioPostMiniPlayer: React.FC = () => {
  const { t } = useTranslation();
  const { theme, skin } = useAppTheme();
  const { tokenId, track, isPlaying, isLoading, progress, currentTime, duration, queueLength, queuePos, shuffle, crossfade } =
    useAudioPostPlayback();
  const { currentSpace, isConnected } = useStages();

  // The scrubber follows the engine off a shared value, and stops following
  // it for the length of a drag so the finger wins over the status ticks.
  const position = useSharedValue(0);
  const draggingRef = useRef(false);
  const progressRef = useRef(0);
  progressRef.current = progress;

  useEffect(() => {
    if (draggingRef.current) return;
    position.value = withTiming(progress, { duration: 100, easing: Easing.linear });
  }, [progress, position]);

  // Identity-stable, every one: they feed a PanResponder built in a useMemo.
  const onScrubStart = useCallback(() => {
    draggingRef.current = true;
  }, []);
  const onCommit = useCallback((ratio: number) => {
    draggingRef.current = false;
    seekAudioPost(ratio);
  }, []);
  const onCancel = useCallback(() => {
    draggingRef.current = false;
    position.value = withTiming(progressRef.current, { duration: 120, easing: Easing.linear });
  }, [position]);

  const seek = useSeekSurface({
    position,
    onScrubStart,
    onScrub: noop,
    onCommit,
    onCancel,
    claimOnStart: true,
  });

  if (!tokenId || !track) return null;

  const liveBarShowing = !!currentSpace && isConnected;
  const inPlaylist = queueLength > 1;
  const nextCrossfade = () => {
    const i = CROSSFADE_STEPS.indexOf(crossfade as (typeof CROSSFADE_STEPS)[number]);
    setAudioCrossfade(CROSSFADE_STEPS[(i + 1) % CROSSFADE_STEPS.length]);
  };

  return (
    <View
      style={[styles.container, liveBarShowing && styles.aboveLiveBar, theme === 'glass' && { backgroundColor: skin?.card.backgroundColor, borderRadius: 16, borderWidth: 1, borderColor: 'rgba(225,255,255,.4)', borderTopColor: 'rgba(255,255,255,.7)', overflow: 'hidden' }]}
      accessibilityLabel={t("audioPost.cornerPlayer")}
    >
      {theme === 'glass' && <LinearGradient pointerEvents="none" colors={['rgba(225,255,255,.16)', 'transparent']} style={StyleSheet.absoluteFill} />}
      <View style={styles.row}>
        <View style={styles.art}>
          {track.artworkUrl ? (
            <Image source={{ uri: track.artworkUrl }} style={StyleSheet.absoluteFill} contentFit="cover" />
          ) : (
            <Icon name="AudioLines" size={16} color="#808089" />
          )}
        </View>

        <View style={styles.info}>
          <Text style={styles.name} numberOfLines={1}>
            {track.title}
          </Text>
          <Text style={styles.sub} numberOfLines={1}>
            {`${track.artist}  ·  ${fmtDuration(currentTime)} / ${fmtDuration(duration)}`}
          </Text>
        </View>

        <TouchableOpacity
          onPress={toggleAudioPost}
          style={[styles.playBtn, theme === 'glass' && GLASS_PLAYBACK_CONTROL]}
          hitSlop={6}
          accessibilityRole="button"
          accessibilityLabel={isPlaying ? t("audioPost.pause") : t("audioPost.play")}
        >
          {isLoading ? (
            <ActivityIndicator size="small" color="#FFFFFF" />
          ) : (
            <Icon name={isPlaying ? "Pause" : "Play"} size={15} color="#FFFFFF" fill="#FFFFFF" />
          )}
        </TouchableOpacity>

        <TouchableOpacity
          onPress={stopAudioPost}
          style={[styles.closeBtn, theme === 'glass' && GLASS_PLAYBACK_CONTROL]}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={t("audioPost.stopAndClose")}
        >
          <Icon name="X" size={15} color="rgba(255,255,255,0.5)" />
        </TouchableOpacity>
      </View>

      <ScrubSurface surface={seek}>
        <SeekBar position={position} hue={getCachedHue()} />
      </ScrubSurface>

      {inPlaylist && (
        <View style={styles.queueRow}>
          <TouchableOpacity
            onPress={() => skipAudioQueue(-1)}
            style={styles.queueBtn}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityLabel={t("audioPost.previous")}
          >
            <Icon name="SkipBack" size={15} color="#FFFFFF" />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => skipAudioQueue(1)}
            disabled={queuePos + 1 >= queueLength}
            style={[styles.queueBtn, queuePos + 1 >= queueLength && styles.queueBtnOff]}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityLabel={t("audioPost.next")}
          >
            <Icon name="SkipForward" size={15} color="#FFFFFF" />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={toggleAudioQueueShuffle}
            style={[styles.queueBtn, shuffle && styles.queueBtnOn]}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityState={{ selected: shuffle }}
            accessibilityLabel={t("audioPost.shuffle")}
          >
            <Icon name="Shuffle" size={15} color={shuffle ? "#22C55E" : "#FFFFFF"} />
          </TouchableOpacity>
          <Text style={styles.queuePos}>{`${formatCount(queuePos + 1)} / ${formatCount(queueLength)}`}</Text>
          <TouchableOpacity
            onPress={nextCrossfade}
            style={[styles.fadeBtn, crossfade > 0 && styles.queueBtnOn]}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityLabel={t("audioPost.crossfade")}
          >
            <Text style={[styles.fadeText, crossfade > 0 && { color: "#22C55E" }]}>
              {crossfade > 0 ? `${t("audioPost.crossfade")} ${crossfade}s` : `${t("audioPost.crossfade")} ${t("audioPost.off")}`}
            </Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    // Clear of the floating tab bar, matching RadioMiniPlayer's own anchor.
    bottom: 80,
    left: 16,
    right: 16,
    borderRadius: 18,
    backgroundColor: "#0C0C0E",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 4,
    zIndex: 99,
  },
  aboveLiveBar: {
    bottom: 140,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  art: {
    width: 34,
    height: 34,
    borderRadius: 10,
    overflow: "hidden",
    backgroundColor: "#18181B",
    alignItems: "center",
    justifyContent: "center",
  },
  info: {
    flex: 1,
    minWidth: 0,
  },
  name: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "500",
  },
  sub: {
    color: "rgba(255,255,255,0.5)",
    fontSize: 11,
    fontVariant: ["tabular-nums"],
  },
  playBtn: {
    width: 34,
    height: 34,
    borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.1)",
    alignItems: "center",
    justifyContent: "center",
  },
  queueRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingTop: 2,
    paddingBottom: 4,
  },
  queueBtn: {
    width: 30,
    height: 26,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  queueBtnOn: {
    backgroundColor: "rgba(34,197,94,0.14)",
  },
  queueBtnOff: {
    opacity: 0.35,
  },
  queuePos: {
    flex: 1,
    color: "rgba(255,255,255,0.5)",
    fontSize: 11,
    fontVariant: ["tabular-nums"],
    textAlign: "center",
  },
  fadeBtn: {
    height: 26,
    borderRadius: 9,
    paddingHorizontal: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  fadeText: {
    color: "#FFFFFF",
    fontSize: 11,
    fontWeight: "500",
  },
  closeBtn: {
    width: 26,
    height: 26,
    alignItems: "center",
    justifyContent: "center",
  },
});

export default AudioPostMiniPlayer;
