import React, { memo, useEffect, useState } from "react";
import { Text, View, type TextStyle } from "react-native";
import { Image } from "expo-image";
import { storyboardOffset, storyboardSheetSize, type Storyboard } from "../../libs/storyboard";

interface StoryboardPreviewProps {
  storyboard?: Storyboard;
  /** Where the finger is along the timeline, 0–1. */
  fraction: number;
  duration: number;
  /** Width of the timeline in points, to place the tile over the finger. */
  trackWidth: number;
  /** Shown only while scrubbing. */
  visible: boolean;
  /** Distance from the bottom of the parent to float above, in points. */
  bottom: number;
  /** With no storyboard to show, float just the time instead of nothing. */
  timeOnly?: boolean;
}

const formatTime = (seconds: number) => {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = (s % 60).toString().padStart(2, "0");
  return h > 0 ? `${h}:${m.toString().padStart(2, "0")}:${sec}` : `${m}:${sec}`;
};

const timeStyle: TextStyle = {
  paddingHorizontal: 6,
  paddingVertical: 2,
  borderRadius: 4,
  overflow: "hidden",
  backgroundColor: "rgba(0,0,0,0.6)",
  color: "#fff",
  fontSize: 12,
  fontWeight: "500",
  fontVariant: ["tabular-nums"],
};

/**
 * The frame under the finger while scrubbing, floated above the timeline.
 * The sheet is prefetched as soon as the player has one, so the first scrub
 * shows a frame at once. Renders nothing without a public storyboard.
 */
function StoryboardPreview({ storyboard, fraction, duration, trackWidth, visible, bottom, timeOnly = false }: StoryboardPreviewProps) {
  const [failed, setFailed] = useState(false);
  const url = storyboard?.url;

  useEffect(() => {
    setFailed(false);
    // A failed prefetch is not a broken sheet: on a phone it is usually a
    // dropped or slow connection. Treating it as one hid the preview for the
    // rest of the video. Only the tile's own load error (below) gives up.
    if (url) void Image.prefetch(url, { cachePolicy: "memory-disk" }).catch(() => {});
  }, [url]);

  if (!visible || !(duration > 0) || !(trackWidth > 0)) return null;

  const clamped = Math.max(0, Math.min(1, Number.isFinite(fraction) ? fraction : 0));
  const seconds = clamped * duration;
  if (!storyboard || failed) {
    if (!timeOnly) return null;
    const pill = 64;
    return (
      <View
        pointerEvents="none"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={{ position: "absolute", left: Math.max(0, Math.min(trackWidth - pill, clamped * trackWidth - pill / 2)), bottom, width: pill, alignItems: "center" }}
      >
        <Text style={timeStyle}>{formatTime(seconds)}</Text>
      </View>
    );
  }
  const { x, y } = storyboardOffset(storyboard, seconds);
  const sheet = storyboardSheetSize(storyboard);
  const { spriteWidth: width, spriteHeight: height } = storyboard;
  const left = Math.max(4, Math.min(trackWidth - width - 4, clamped * trackWidth - width / 2));

  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ position: "absolute", left, bottom, alignItems: "center" }}
    >
      <View
        style={{
          width,
          height,
          overflow: "hidden",
          borderRadius: 6,
          borderWidth: 1,
          borderColor: "rgba(255,255,255,0.3)",
          backgroundColor: "#000",
        }}
      >
        <Image
          source={{ uri: storyboard.url }}
          cachePolicy="memory-disk"
          contentFit="fill"
          transition={0}
          onError={() => setFailed(true)}
          style={{ position: "absolute", width: sheet.width, height: sheet.height, left: -x, top: -y }}
        />
      </View>
      <Text style={[timeStyle, { marginTop: 4 }]}>
        {formatTime(seconds)}
      </Text>
    </View>
  );
}

export default memo(StoryboardPreview);
