import React, { useCallback, useRef } from "react";
import { View } from "react-native";
import { useTranslation } from "react-i18next";
import { useUser } from "../../context/AuthContext";
import { useAppTheme } from "../../context/ThemeContext";
import { useStoriesEnabled } from "../../hooks/useStoriesEnabled";
import { useMomentPeek, refreshMomentPeeks } from "../../libs/moment-peek";
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

/** Close Friends Moments: green rim until watched. */
export const CLOSE_FRIENDS_GREEN = "#22c55e";

/** Draw inside the avatar's pressable, alongside the avatar. */
export function MomentAvatarOutline({ peek, radius }: { peek: MomentPeek | null; radius: number }) {
  const { skin, accent, pageColors } = useAppTheme();
  if (!peek) return null;
  const color = peek.state === "seen"
    ? "rgba(161,161,170,0.6)"
    : peek.closeFriends
      ? CLOSE_FRIENDS_GREEN
      : skin ? `rgb(${accent[0]},${accent[1]},${accent[2]})` : pageColors.foreground;
  const width = 2;
  return (
    <View
      pointerEvents="none"
      style={{
        position: "absolute",
        top: -width,
        right: -width,
        bottom: -width,
        left: -width,
        borderWidth: width,
        borderRadius: radius + width,
        borderColor: color,
      }}
    />
  );
}
