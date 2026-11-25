import React from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useAuthActions, useUser } from "../../context/AuthContext";
import { setActivityBarHidden, setActivityItemsHidden } from "../../libs/activity-shelf-preferences";
import { toastError, toastSuccess } from "../../libs/toast";
import { blockUser } from "../../services/block.service";
import { muteUser } from "../../services/mute.service";
import HoldSheet, { type HoldTile } from "../ui/HoldSheet";

export type ActivityTarget = {
  kind: "story" | "stage" | "stream";
  ids: string[];
  open: () => void;
  creator?: string;
};

export function ActivityShelfMenu({ visible, target, onClose }: {
  visible: boolean;
  target?: ActivityTarget;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { requireAuth } = useAuthActions();
  const user = useUser();
  const queryClient = useQueryClient();
  const me = (user?.walletAddress || user?.address || "").toLowerCase();
  const run = (action: () => void) => () => { onClose(); action(); };
  const tiles: HoldTile[] = [{
    key: "hide-bar", icon: "EyeOff", label: t("stories.activity.hideBar", { defaultValue: "Hide activity bar" }),
    onPress: run(() => setActivityBarHidden(true)), secondary: true,
  }];

  if (target) {
    const story = target.kind === "story";
    const stage = target.kind === "stage";
    tiles.push({
      key: "hide-item", icon: "EyeOff", secondary: true,
      label: story ? t("stories.activity.hideStory", { defaultValue: "Hide story" }) : t("stories.activity.hideLive", { defaultValue: "Hide live" }),
      onPress: run(() => {
        setActivityItemsHidden(target.ids, true);
        toastSuccess(story ? t("stories.activity.storyHidden", { defaultValue: "Story hidden" }) : t("stories.activity.liveHidden", { defaultValue: "Live hidden" }), {
          actionLabel: t("common.undo", { defaultValue: "Undo" }), onActionPress: () => setActivityItemsHidden(target.ids, false),
        });
      }),
    }, {
      key: "open", icon: stage ? "Mic" : "Play", secondary: true,
      label: stage ? t("stories.activity.join", { defaultValue: "Join" }) : t("stories.activity.watch", { defaultValue: "Watch" }),
      onPress: run(target.open),
    });
  }

  const creator = target?.creator;
  if (creator && creator.toLowerCase() !== me) {
    const moderate = (action: typeof muteUser | typeof blockUser, message: string) => run(() => {
      requireAuth(() => {
        void action(creator).then(result => {
          if (!result.status) throw new Error();
          void queryClient.invalidateQueries({ queryKey: ["story-shelf"] });
          toastSuccess(message);
        }).catch(() => toastError(t("common.tryAgain", { defaultValue: "Try again" })));
      });
    });
    tiles.push({
      key: "mute", icon: "VolumeX", secondary: true,
      label: t("postOptions.muteCreator", { defaultValue: "Mute creator" }),
      onPress: moderate(muteUser, t("stories.activity.creatorMuted", { defaultValue: "Creator muted" })),
    }, {
      key: "block", icon: "Ban", secondary: true, destructive: true,
      label: t("postOptions.blockCreator", { defaultValue: "Block creator" }),
      onPress: moderate(blockUser, t("stories.activity.creatorBlocked", { defaultValue: "Creator blocked" })),
    });
  }

  return <HoldSheet visible={visible} onClose={onClose} layout={null} reactions={null} tiles={tiles} />;
}
