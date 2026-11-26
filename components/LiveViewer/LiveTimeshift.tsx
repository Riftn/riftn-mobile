/**
 * Pause, rewind and back-to-live on a live: the LIVE tag (red at the edge,
 * white with how far back once behind, tap to catch up) with play/pause
 * beside it, and the timeline along the floor of the screen. Each polls the
 * player itself twice a second, so the viewer screen never re-renders for it.
 */
import { LiveDot } from "../common/LiveDot";
import React, { memo, useCallback, useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSharedValue } from "react-native-reanimated";
import { useTranslation } from "react-i18next";
import Ionicons from "@expo/vector-icons/Ionicons";
import ViewerScrubBar from "../common/ViewerScrubBar";
import { formatBehind, isBehindLive, type LiveTimeshift, type TimeshiftSnap } from "../../libs/liveTimeshift";

export function useTimeshiftSnap(timeshift: LiveTimeshift | null | undefined): TimeshiftSnap | null {
  const [snap, setSnap] = useState<TimeshiftSnap | null>(() => timeshift?.snapshot() ?? null);
  useEffect(() => {
    if (!timeshift) {
      setSnap(null);
      return;
    }
    const read = () => {
      const next = timeshift.snapshot();
      setSnap((prev) => {
        if (!next || !prev) return next;
        if (prev.paused === next.paused && Math.round(prev.behind) === Math.round(next.behind)) return prev;
        return next;
      });
    };
    read();
    const id = setInterval(read, 500);
    return () => clearInterval(id);
  }, [timeshift]);
  return snap;
}

/** Play / pause and the LIVE tag, for the pill line over the picture. */
export const LiveTimeshiftTag = memo(function LiveTimeshiftTag({ timeshift }: { timeshift: LiveTimeshift }) {
  const { t } = useTranslation();
  const snap = useTimeshiftSnap(timeshift);
  const behind = isBehindLive(snap);
  const paused = !!snap?.paused;
  return (
    <View style={styles.row}>
      <Pressable
        onPress={timeshift.togglePlay}
        hitSlop={{ top: 10, bottom: 10, left: 8, right: 4 }}
        accessibilityRole="button"
        accessibilityLabel={paused ? t("audioPost.play") : t("audioPost.pause")}
        style={styles.playPause}
      >
        <Ionicons name={paused ? "play" : "pause"} size={13} color="#fff" />
      </Pressable>
      {behind && snap ? (
        <Pressable
          onPress={timeshift.goLive}
          hitSlop={{ top: 10, bottom: 10, left: 4, right: 8 }}
          accessibilityRole="button"
          accessibilityLabel={t("liveViewer.backToLive")}
        >
          {/* Fill on an inner View: Pressable fills get repainted by the tone pass. */}
          <View style={[styles.tag, styles.tagBehind]}>
            <LiveDot size={5} />
            <Text style={[styles.tagText, styles.tagTextBehind]}>{t("live.statusLive")}</Text>
            <Text style={styles.behindText}>{formatBehind(snap.behind)}</Text>
          </View>
        </Pressable>
      ) : (
        <View style={styles.tag}>
          <LiveDot size={5} />
          <Text style={styles.tagText}>{t("live.statusLive")}</Text>
        </View>
      )}
    </View>
  );
});

/**
 * The timeline on the floor of the screen: the same bar the shorts viewer
 * and a replay draw, with a red end for live. Drag back up to three minutes.
 */
export const LiveTimeshiftBar = memo(function LiveTimeshiftBar({ timeshift }: { timeshift: LiveTimeshift }) {
  const snap = useTimeshiftSnap(timeshift);
  const progress = useSharedValue(1);
  const scrubbing = useRef(false);
  useEffect(() => {
    if (snap && !scrubbing.current) progress.value = snap.ratio;
  }, [snap, progress]);
  const onSeek = useCallback(
    (ratio: number) => (ratio >= 0.99 ? timeshift.goLive() : timeshift.seek(ratio)),
    [timeshift]
  );
  const onScrubbingChange = useCallback((on: boolean) => {
    scrubbing.current = on;
  }, []);
  if (!snap) return null;
  return <ViewerScrubBar progress={progress} onSeek={onSeek} onScrubbingChange={onScrubbingChange} liveEnd />;
});

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  playPause: {
    width: 18,
    height: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  tag: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "rgba(0,0,0,0.8)",
    borderRadius: 5,
    paddingHorizontal: 5,
    paddingVertical: 1.5,
  },
  tagBehind: {
    backgroundColor: "#fff",
  },
  tagText: {
    color: "#fff",
    fontSize: 9.5,
    fontWeight: "900",
    letterSpacing: 0.6,
  },
  tagTextBehind: {
    color: "#000",
    textShadowColor: "transparent",
  },
  behindText: {
    color: "rgba(0,0,0,0.6)",
    fontSize: 9.5,
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
  },
});
