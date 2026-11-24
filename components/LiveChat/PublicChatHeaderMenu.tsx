/**
 * Public Chat's + (2026-11-24): the header keeps the title with "24 online"
 * under it, call and video; search, text size and chat info live in here so
 * the top isn't crowded. Same glass menu as a DM's ⋯ (components/Chat/ChatMenu).
 */
import React, { useState } from "react";
import { Modal, Pressable, Text, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import Icon from "../ui/Icon";
import type { IconName } from "../ui/Icon";
import MessageSurface from "../DM/MessageSurface";
import WhenOpened from "../ui/WhenOpened";
import { useAppTheme } from "../../context/ThemeContext";
import { useAppPrefs } from "../../hooks/useAppPrefs";
import { SCREEN_HEADER_HEIGHT } from "../ScreenHeader";
import { ChatTextSizePicker, useChatTextSizeLabels } from "./ChatTextSizeButton";

function Row({ icon, label, value, onPress, color }: { icon: IconName; label: string; value?: string; onPress: () => void; color: string }) {
  return (
    <TouchableOpacity className="flex-row items-center px-3 py-3 active:opacity-70" onPress={onPress} accessibilityRole="button">
      <Icon name={icon} size={18} color={color} />
      <Text className="ml-2 flex-1 text-sm" style={{ color }} numberOfLines={1}>{label}</Text>
      {value ? <Text className="ml-2 text-xs" style={{ color, opacity: 0.55 }}>{value}</Text> : null}
    </TouchableOpacity>
  );
}

export default function PublicChatHeaderMenu({ onSearch, onInfo }: { onSearch: () => void; onInfo: () => void }) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { colors } = useAppTheme();
  const prefs = useAppPrefs();
  const sizeLabels = useChatTextSizeLabels();
  const [open, setOpen] = useState(false);
  const [sizeOpen, setSizeOpen] = useState(false);
  const close = () => setOpen(false);
  const line = <View className="h-[1px]" style={{ backgroundColor: colors.border }} />;
  return (
    <>
      <TouchableOpacity
        onPress={() => setOpen(true)}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={t("chatTabs.menu", { defaultValue: "Chat options" })}
        style={{ width: 36, height: 36, alignItems: "center", justifyContent: "center" }}
      >
        <Icon name="Plus" size={22} color="#A1A1AA" />
      </TouchableOpacity>
      <Modal visible={open} transparent animationType="fade" onRequestClose={close}>
        <Pressable onPress={close} style={{ flex: 1 }} className="bg-black/40">
          <Pressable onPress={(e) => e.stopPropagation()} style={{ top: insets.top + SCREEN_HEADER_HEIGHT + 6 }} className="absolute right-3 w-56 rounded-xl overflow-hidden">
            <MessageSurface radius={12} />
            <Row color={colors.foreground} icon="Search" label={t("publicChat.searchMessages")} onPress={() => { close(); onSearch(); }} />
            {line}
            <Row color={colors.foreground} icon="Info" label={t("screens.chatInfo", { defaultValue: "Chat info" })} onPress={() => { close(); onInfo(); }} />
            {line}
            <Row
              color={colors.foreground}
              icon="Type"
              label={t("chatTextSize.title", "Text size")}
              value={sizeLabels[prefs.chatTextSize]}
              onPress={() => { close(); setSizeOpen(true); }}
            />
          </Pressable>
        </Pressable>
      </Modal>
      <WhenOpened open={sizeOpen}>
        {() => <ChatTextSizePicker visible={sizeOpen} onClose={() => setSizeOpen(false)} />}
      </WhenOpened>
    </>
  );
}
