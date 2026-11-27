/**
 * Public Chat's + (2026-11-24): the header keeps the title with "24 online"
 * under it, search and text size; voice call, video call and chat info live
 * in here so the top isn't crowded. Same glass menu as a DM's ⋯
 * (components/Chat/ChatMenu).
 */
import React, { useState } from "react";
import { Modal, Pressable, Text, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import Icon from "../ui/Icon";
import type { IconName } from "../ui/Icon";
import MessageSurface from "../DM/MessageSurface";
import { useAppTheme } from "../../context/ThemeContext";
import { useCall } from "../../context/CallContext";
import { PUBLIC_CHAT_CALL_ID } from "../../libs/groupCall";
import { chatEmbedCode } from "../../libs/chat-embed-code";
import { copyToClipboard } from "../../libs/clipboard.utils";
import { toastSuccess } from "../../libs/toast";
import { SCREEN_HEADER_HEIGHT } from "../ScreenHeader";

function Row({ icon, label, onPress, color, disabled }: { icon: IconName; label: string; onPress: () => void; color: string; disabled?: boolean }) {
  return (
    <TouchableOpacity className="flex-row items-center px-3 py-3 active:opacity-70" onPress={onPress} disabled={disabled} style={disabled ? { opacity: 0.4 } : undefined} accessibilityRole="button">
      <Icon name={icon} size={18} color={color} />
      <Text className="ml-2 flex-1 text-sm" style={{ color }} numberOfLines={1}>{label}</Text>
    </TouchableOpacity>
  );
}

/** `canCall`: signed in and not banned (the call rows hide otherwise). */
export default function PublicChatHeaderMenu({ onInfo, canCall, onCatchUp }: { onInfo: () => void; canCall: boolean; onCatchUp?: () => void }) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { colors } = useAppTheme();
  const { joinGroupCall, currentCall } = useCall();
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  const call = (type: "audio" | "video") => { close(); void joinGroupCall({ id: PUBLIC_CHAT_CALL_ID, name: t("publicChat.title") }, type); };
  const line = <View className="h-[1px]" style={{ backgroundColor: colors.border }} />;
  return (
    <>
      <TouchableOpacity
        onPress={() => setOpen(true)}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={t("player.moreOptions", { defaultValue: "More options" })}
        style={{ width: 36, height: 36, alignItems: "center", justifyContent: "center" }}
      >
        <Icon name="Plus" size={22} color="#A1A1AA" />
      </TouchableOpacity>
      <Modal visible={open} transparent animationType="fade" onRequestClose={close}>
        <Pressable onPress={close} style={{ flex: 1 }} className="bg-black/40">
          <Pressable onPress={(e) => e.stopPropagation()} style={{ top: insets.top + SCREEN_HEADER_HEIGHT + 6 }} className="absolute right-3 w-56 rounded-xl overflow-hidden">
            <MessageSurface radius={12} />
            {canCall ? (
              <>
                <Row color={colors.foreground} icon="Phone" label={t("calls.voiceCallShort", { defaultValue: "Voice call" })} disabled={!!currentCall} onPress={() => call("audio")} />
                {line}
                <Row color={colors.foreground} icon="Video" label={t("calls.videoCallShort", { defaultValue: "Video call" })} disabled={!!currentCall} onPress={() => call("video")} />
                {line}
              </>
            ) : null}
            {onCatchUp && (
              <>
                <Row color={colors.foreground} icon="History" label={t("communities.catchUp.button", "Catch me up")} onPress={() => { close(); onCatchUp(); }} />
                {line}
              </>
            )}
            <Row color={colors.foreground} icon="Copy" label={t("postOptions.copyEmbedCode")} onPress={() => {
              copyToClipboard(chatEmbedCode());
              toastSuccess(t("postOptions.embedCodeCopied"));
              close();
            }} />
            {line}
            <Row color={colors.foreground} icon="Info" label={t("screens.chatInfo", { defaultValue: "Chat info" })} onPress={() => { close(); onInfo(); }} />
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}
