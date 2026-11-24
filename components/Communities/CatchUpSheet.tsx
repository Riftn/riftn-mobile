/**
 * "Catch me up" in a group, channel or community chat (same as web): pick a
 * window and a private recap of the chat lands in your DMs from @assistant.
 * Nothing is posted in the group. Typing "catch me up" in the message box does
 * the same (CommunityChatPanel.handleSend).
 */
import React from "react";
import { View, Text, TouchableOpacity } from "react-native";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";

import GlassModal from "../ui/GlassModal";
import Icon, { type IconName } from "../ui/Icon";
import { requestCatchUp, type CatchUpPeriod } from "../../libs/community-recap";
import { dismissToast, toastError, toastInfo, toastLoading, toastSuccess } from "../../libs/toast";
import { formatCount } from "../../libs/format-count";
import { ASSISTANT_ADDRESS, ASSISTANT_USERNAME } from "../../libs/assistant";
import { ScreenNames } from "../../navigation/ScreenNames";

// Inline greys, not text-white classes: the sheet renders in its own root,
// and System Light's tone pass flips inline greys to ink there.

/** Ask for a recap and say how it went. Shared by the sheet and the typed command. */
export async function runCatchUp(opts: {
  communityId: string;
  walletAddress: string;
  period?: CatchUpPeriod;
  text?: string;
  t: TFunction;
  lang?: string;
  navigation: { navigate: (...args: any[]) => void };
}): Promise<void> {
  const { t } = opts;
  const id = toastLoading(t("communities.catchUp.working", { defaultValue: "Catching you up…" }));
  try {
    const result = await requestCatchUp(opts);
    dismissToast(id);
    if (!result.sent) {
      toastInfo(t("communities.catchUp.nothing", { defaultValue: "Nothing new to catch up on" }));
      return;
    }
    toastSuccess(t("communities.catchUp.sent", { defaultValue: "Recap sent to your DMs" }), {
      description: t("communities.catchUp.sentCount", {
        defaultValue: "{{window}} · {{formattedCount}} messages",
        window: result.window,
        count: result.count,
        formattedCount: formatCount(result.count),
      }),
      ...(result.conversationId
        ? {
            actionLabel: t("communities.catchUp.open", { defaultValue: "Open" }),
            onActionPress: () =>
              opts.navigation.navigate(ScreenNames.Chat as any, {
                conversationId: result.conversationId,
                targetAddress: ASSISTANT_ADDRESS,
                title: `@${ASSISTANT_USERNAME}`,
                targetUser: { username: ASSISTANT_USERNAME, address: ASSISTANT_ADDRESS },
              }),
          }
        : {}),
    });
  } catch (err: any) {
    dismissToast(id);
    toastError(
      err?.status === 429
        ? t("communities.catchUp.busy", { defaultValue: "Your recap is on its way. Try again in a bit." })
        : t("communities.catchUp.failed", { defaultValue: "Couldn't make your recap. Try again." }),
    );
  }
}

function Row({ icon, label, onPress, testID }: { icon: IconName; label: string; onPress: () => void; testID?: string }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.7}
      className="flex-row items-center px-5 py-3.5"
      accessibilityRole="button"
      accessibilityLabel={label}
      testID={testID}
    >
      <View className="mr-3 w-9 h-9 rounded-xl bg-theme-neutrals-700/50 items-center justify-center">
        <Icon name={icon} size={18} color="#D4D4D8" />
      </View>
      <Text style={{ color: "#FFFFFF", fontSize: 15, fontWeight: "500" }}>{label}</Text>
    </TouchableOpacity>
  );
}

export default function CatchUpSheet({
  visible,
  onClose,
  onPick,
}: {
  visible: boolean;
  onClose: () => void;
  onPick: (period: CatchUpPeriod) => void;
}) {
  const { t } = useTranslation();
  const pick = (period: CatchUpPeriod) => {
    onClose();
    onPick(period);
  };
  return (
    <GlassModal surface="theme" visible={visible} onClose={onClose} presentation="bottom" scrollable maxHeight="60%">
      <View className="pb-4 pt-2">
        <Text style={{ color: "#FFFFFF", fontSize: 17, fontWeight: "600", textAlign: "center", paddingTop: 12 }}>
          {t("communities.catchUp.button", { defaultValue: "Catch me up" })}
        </Text>
        <Text style={{ color: "#A1A1AA", fontSize: 13, textAlign: "center", paddingTop: 4, paddingBottom: 12 }}>
          {t("communities.catchUp.menuHint", { defaultValue: "A private recap, sent to your DMs" })}
        </Text>
        <Row icon="Clock" label={t("communities.catchUp.last24h", { defaultValue: "Last 24 hours" })} onPress={() => pick("24h")} testID="catch-up-24h" />
        <Row icon="Calendar" label={t("communities.catchUp.last3d", { defaultValue: "Last 3 days" })} onPress={() => pick("3d")} testID="catch-up-3d" />
        <Row icon="History" label={t("communities.catchUp.sinceRead", { defaultValue: "Since I last read" })} onPress={() => pick("unread")} testID="catch-up-unread" />
      </View>
    </GlassModal>
  );
}
