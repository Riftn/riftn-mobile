import React, { useCallback, useRef } from "react";
import { Text, View } from "react-native";
import { Image } from "expo-image";
import Animated, { FadeIn } from "react-native-reanimated";
import { useTranslation } from "react-i18next";
import { useUser } from "../../context/AuthContext";
import { useAppTheme } from "../../context/ThemeContext";
import { useStoriesEnabled } from "../../hooks/useStoriesEnabled";
import { formatCount } from "../../libs/format-count";
import { useMomentPeek, refreshMomentPeeks } from "../../libs/moment-peek";
import { useMomentPreviewsBlurred } from "../../libs/momentPreviewBlur";
import { toastError, toastInfo } from "../../libs/toast";
import { getUserStories, type MomentPeek } from "../../services/stories.service";
import { openStoryViewer } from "../../store/stories.store";
import { playable } from "./story-utils";

function useViewer(): string | null {
  const user = useUser();
  return (user?.walletAddress || user?.address || "").toLowerCase() || null;
}

/** The Moment mark for this person's face, or null when they have none up (or Moments are off). */
export function useFaceMoment(address: string | null | undefined): MomentPeek | null {
  const viewer = useViewer();
  const { storiesEnabled } = useStoriesEnabled();
  return useMomentPeek(storiesEnabled ? address : null, viewer);
}

/** Fetch someone's Moments and open the viewer on the first one not yet watched. */
export function useOpenMoments(address: string | null | undefined) {
  const { t } = useTranslation();
  const viewer = useViewer();
  const busy = useRef(false);
  return useCallback(async () => {
    if (!address || busy.current) return;
    busy.current = true;
    try {
      const { author, items } = await getUserStories(address, !!viewer);
      const ready = playable(items ?? []);
      if (!author || !ready.length) {
        refreshMomentPeeks([address]);
        toastInfo(t("stories.momentEnded", { defaultValue: "That Moment has ended" }));
        return;
      }
      const own = !!viewer && viewer === author.address.toLowerCase();
      openStoryViewer(
        [{ author, own, following: false, seen: ready.every((i) => i.viewed), latestAt: ready[ready.length - 1].createdAt, items: ready }],
        0,
      );
    } catch (e) {
      toastError(e, t("stories.momentOpenFailed", { defaultValue: "Couldn't open that Moment" }));
    } finally {
      busy.current = false;
    }
  }, [address, t, viewer]);
}

/**
 * Corner Peek (same as web's MomentFace): a small portrait of someone's Moment
 * on the bottom corner of their face, rimmed in the theme colour (grey once
 * watched all). Place it as a sibling right after the Avatar, inside the
 * pressable that opens the Moments. It takes no touches itself.
 */
/** Close Friends Moments: green rim until watched. */
export const CLOSE_FRIENDS_GREEN = "#22c55e";

export function MomentPeekBadge({ peek, size, big }: { peek: MomentPeek | null; size: number; big?: boolean }) {
  const { isLight, skin, accent, pageColors } = useAppTheme();
  const blurred = useMomentPreviewsBlurred();
  if (!peek) return null;
  const seen = peek.state === "seen";
  const rim = seen
    ? "rgba(161,161,170,0.6)"
    : peek.closeFriends
      ? CLOSE_FRIENDS_GREEN
      : skin
      ? `rgb(${accent[0]},${accent[1]},${accent[2]})`
      : isLight ? "#0a0a0a" : "#ffffff";
  const cut = pageColors.background;
  const w = Math.max(12, Math.round(size * (big ? 0.34 : 0.42)));
  const h = Math.round(w * 1.25);
  const r = Math.max(4, Math.round(w * 0.26));
  const rimW = seen ? 1.5 : big ? 2.5 : 2;
  const cutW = 2;
  const off = big ? -6 : -4;
  return (
    <>
      <Animated.View
        entering={FadeIn.duration(320)}
        pointerEvents="none"
        style={{
          position: "absolute",
          right: off - cutW - rimW,
          bottom: off - cutW - rimW,
          padding: cutW,
          borderRadius: r + cutW + rimW,
          backgroundColor: cut,
          zIndex: 3,
        }}
      >
        <View style={{ borderWidth: rimW, borderColor: rim, borderRadius: r + rimW, overflow: "hidden", backgroundColor: "#27272a" }}>
          {peek.cover ? (
            <Image
              source={{ uri: peek.cover }}
              style={{ width: w, height: h }}
              contentFit="cover"
              cachePolicy="memory-disk"
              blurRadius={blurred && !seen ? 12 : 0}
              recyclingKey={peek.cover}
            />
          ) : (
            <View style={{ width: w, height: h, backgroundColor: "#3f3f46" }} />
          )}
          {seen && <View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(9,9,11,0.5)" }} />}
        </View>
      </Animated.View>
      {big && peek.count > 1 && (
        <Animated.View
          entering={FadeIn.duration(320)}
          pointerEvents="none"
          style={{
            position: "absolute",
            right: off - 9,
            bottom: off + h - 12,
            minWidth: 22,
            height: 22,
            paddingHorizontal: 5,
            borderRadius: 7,
            borderWidth: 2,
            borderColor: cut,
            backgroundColor: seen ? "#a1a1aa" : rim,
            alignItems: "center",
            justifyContent: "center",
            zIndex: 4,
          }}
        >
          <Text style={{ fontSize: 11, fontWeight: "800", color: !seen && isLight && !skin ? "#fff" : "#000" }}>{formatCount(peek.count)}</Text>
        </Animated.View>
      )}
    </>
  );
}
