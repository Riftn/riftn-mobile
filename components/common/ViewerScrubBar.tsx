/**
 * The thin timeline that sits on the floor of a fullscreen viewer.
 *
 * Lifted out of ShortsViewerScreen so the live viewer gets the exact same bar
 * rather than a second one that looks nearly right: 2pt at rest, 4pt and a
 * thumb while a finger is on it, 24pt of hit area under a 2pt line, and the
 * same four greys. If a value changes it changes here and both surfaces move.
 *
 * The caller owns the clock. It writes `progress` (0..1) from whatever is
 * playing and gets `onSeek` back when the finger lifts; a drag owns the bar in
 * between, so the caller must stop writing while `onScrubbingChange` is true or
 * the clock yanks the line back to wherever playback still is.
 */
import React, { memo, useCallback, useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { GestureDetector } from "react-native-gesture-handler";
import type { GestureType } from "react-native-gesture-handler";
import Reanimated, { runOnJS, useAnimatedReaction, useAnimatedStyle } from "react-native-reanimated";
import { useTranslation } from "react-i18next";
import type { SharedValue } from "react-native-reanimated";
import { useScrubGesture } from "../../hooks/useScrubGesture";
import { EDGE, TEXT_SHADOW } from "./ViewerChrome";
import { formatTime } from "../VideoPlayerCore/utils";

interface Props {
  /** 0..1 of the timeline. Owned by the caller, read on the UI thread. */
  progress: SharedValue<number>;
  /** Finger up: the position to play from. */
  onSeek: (ratio: number) => void;
  /** Off for a stream with no seekable window — the bar still draws. */
  enabled?: boolean;
  /** Tells the caller to stop writing `progress` for the length of a drag. */
  onScrubbingChange?: (scrubbing: boolean) => void;
  /** Gestures this one must outrank, e.g. a pager the viewer sits in. */
  blocks?: (GestureType | React.RefObject<GestureType | undefined>)[];
  /**
   * A live's timeline: the right end is live, marked with a red dot, and the
   * hit area is kept short so the chat box just above keeps its touches.
   */
  liveEnd?: boolean;
  /** Show the replay clock and its thicker track while viewer chrome is up. */
  replayDurationMs?: number;
}

const ViewerScrubBar: React.FC<Props> = ({
  progress,
  onSeek,
  enabled = true,
  onScrubbingChange,
  blocks,
  liveEnd = false,
  replayDurationMs = 0,
}) => {
  const { t } = useTranslation();
  const [scrubbing, setScrubbing] = useState(false);
  const [progressPercent, setProgressPercent] = useState(0);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  useAnimatedReaction(
    () => Math.floor(Math.round(Math.max(0, Math.min(1, progress.value)) * replayDurationMs) / 1000),
    (next, previous) => { if (next !== previous) runOnJS(setElapsedSeconds)(next); },
    [progress, replayDurationMs],
  );
  const clock = replayDurationMs > 0
    ? formatTime(elapsedSeconds * 1000) + " / " + formatTime(replayDurationMs)
    : undefined;
  useAnimatedReaction(
    () => Math.round(Math.max(0, Math.min(1, progress.value)) * 100),
    (next, previous) => { if (next !== previous) runOnJS(setProgressPercent)(next); },
    [progress],
  );

  const handleScrubStart = useCallback(() => {
    setScrubbing(true);
    onScrubbingChange?.(true);
  }, [onScrubbingChange]);

  const handleScrub = useCallback(
    (ratio: number) => {
      progress.value = ratio;
    },
    [progress]
  );

  const handleCommit = useCallback(
    (ratio: number) => {
      progress.value = ratio;
      setScrubbing(false);
      onScrubbingChange?.(false);
      onSeek(ratio);
    },
    [progress, onSeek, onScrubbingChange]
  );

  const handleCancel = useCallback(() => {
    setScrubbing(false);
    onScrubbingChange?.(false);
  }, [onScrubbingChange]);

  const blockList = useMemo(() => blocks, [blocks]);

  const { onLayout, gesture, touchGuard } = useScrubGesture({
    onScrubStart: handleScrubStart,
    onScrub: handleScrub,
    onCommit: handleCommit,
    onCancel: handleCancel,
    enabled,
    // A dedicated target at the foot of the screen: it takes the touch straight
    // away instead of waiting for travel.
    immediate: true,
    blocks: blockList,
  });

  const fillStyle = useAnimatedStyle(() => ({
    width: `${Math.max(0, Math.min(1, progress.value)) * 100}%`,
  }));
  const thumbStyle = useAnimatedStyle(() => ({
    left: `${Math.max(0, Math.min(1, progress.value)) * 100}%`,
  }));

  return (
    <View style={styles.track} pointerEvents={enabled ? "box-none" : "none"}>
      {clock ? <Text style={styles.clock} accessible={false}>{clock}</Text> : null}
      <GestureDetector gesture={gesture}>
        <View
          style={[styles.hitArea, liveEnd && styles.hitAreaLive]}
          onLayout={onLayout}
          {...touchGuard}
          accessibilityRole="adjustable"
          accessible={enabled}
          accessibilityLabel={t('feed.videos')}
          accessibilityState={{ disabled: !enabled }}
          accessibilityValue={{ min: 0, max: 100, now: progressPercent, text: clock }}
          accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
          onAccessibilityAction={({ nativeEvent }) => {
            if (!enabled) return;
            const delta = nativeEvent.actionName === 'increment' ? 0.05
              : nativeEvent.actionName === 'decrement' ? -0.05 : 0;
            if (delta) handleCommit(Math.max(0, Math.min(1, progress.value + delta)));
          }}
        >
          <View style={[styles.line, (scrubbing || replayDurationMs > 0) && styles.lineActive]}>
            <Reanimated.View
              style={[styles.fill, scrubbing && styles.fillActive, fillStyle]}
            />
            {liveEnd ? <View style={styles.liveDot} pointerEvents="none" /> : null}
            {scrubbing || replayDurationMs > 0 ? (
              <Reanimated.View style={[styles.thumb, thumbStyle]} pointerEvents="none" />
            ) : null}
          </View>
        </View>
      </GestureDetector>
    </View>
  );
};

const styles = StyleSheet.create({
  track: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    // Above the bottom scrim, below whatever chrome is drawn after it.
    zIndex: 8,
  },
  clock: {
    position: "absolute",
    left: EDGE,
    bottom: 20,
    color: "#fff",
    fontSize: 12,
    fontWeight: "500",
    fontVariant: ["tabular-nums"],
    ...TEXT_SHADOW,
  },
  hitArea: {
    // The line is 2pt; the finger gets 24.
    height: 24,
    justifyContent: "flex-end",
    paddingHorizontal: EDGE,
    paddingBottom: 6,
  },
  hitAreaLive: {
    height: 14,
    paddingBottom: 4,
  },
  liveDot: {
    position: "absolute",
    right: -3,
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "#EF4444",
  },
  line: {
    height: 2,
    borderRadius: 1,
    backgroundColor: "rgba(255,255,255,0.25)",
    justifyContent: "center",
  },
  lineActive: {
    height: 4,
    borderRadius: 2,
    backgroundColor: "rgba(255,255,255,0.35)",
  },
  fill: {
    height: "100%",
    borderRadius: 2,
    backgroundColor: "rgba(255,255,255,0.85)",
  },
  fillActive: {
    backgroundColor: "#fff",
  },
  thumb: {
    position: "absolute",
    top: "50%",
    marginTop: -7,
    width: 14,
    height: 14,
    marginLeft: -7,
    borderRadius: 7,
    backgroundColor: "#fff",
  },
});

export default memo(ViewerScrubBar);
