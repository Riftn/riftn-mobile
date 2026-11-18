/**
 * The bar that takes the composer's place while messages in an open chat are
 * selected (hold a message, Select, then tap others). Copy puts the picked
 * lines on the clipboard in thread order, Forward sends each to another chat,
 * Delete removes your own picked messages for everyone. Same actions and copy
 * as the website's MessageSelectBar.
 */
import React, { memo } from "react";
import { Pressable, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import Icon from "../ui/Icon";

interface Props {
  count: number;
  /** How many of the picked are yours: only those can be deleted. */
  ownCount: number;
  onCopy: () => void;
  onForward: () => void;
  onDelete: () => void;
  onCancel: () => void;
}

// Written for the dark look; the light theme's tone layer flips neutrals itself.
const INK = "#F4F4F5";
const MUTED = "#A1A1AA";
const DANGER = "#F87171";

function BarButton({ icon, label, onPress, disabled, color = INK, testID }: {
  icon: string;
  label: string;
  onPress: () => void;
  disabled?: boolean;
  color?: string;
  testID: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      testID={testID}
      style={({ pressed }) => ({ flex: 1, opacity: disabled ? 0.4 : pressed ? 0.6 : 1 })}
    >
      <View style={{ minHeight: 52, alignItems: "center", justifyContent: "center", gap: 4, borderRadius: 12 }}>
        <Icon name={icon as any} size={20} color={color} />
        <Text style={{ fontSize: 12, fontWeight: "600", color }} numberOfLines={1}>{label}</Text>
      </View>
    </Pressable>
  );
}

function MessageSelectBarComponent({ count, ownCount, onCopy, onForward, onDelete, onCancel }: Props) {
  const { t } = useTranslation();
  const none = count === 0;
  return (
    <View
      testID="msg-select-bar"
      accessibilityRole="toolbar"
      accessibilityLabel={t("msgSelect.toolbar", { defaultValue: "Selected messages" })}
      style={{ paddingHorizontal: 8, paddingTop: 6, paddingBottom: 4, borderTopWidth: 1, borderTopColor: "rgba(255,255,255,0.08)" }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 8, paddingBottom: 2 }}>
        <Text testID="msg-select-count" style={{ flex: 1, fontSize: 14, fontWeight: "600", color: INK }} numberOfLines={1}>
          {none
            ? t("msgSelect.pick", { defaultValue: "Tap messages to select them" })
            : t("msgSelect.selected", { defaultValue: "{{count}} selected", count })}
        </Text>
        <Pressable
          onPress={onCancel}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={t("chatBulk.cancel", { defaultValue: "Cancel" })}
          testID="msg-select-cancel"
          style={({ pressed }) => ({ padding: 6, opacity: pressed ? 0.6 : 1 })}
        >
          <Icon name="X" size={18} color={MUTED} />
        </Pressable>
      </View>
      <View style={{ flexDirection: "row", gap: 4 }}>
        <BarButton icon="Copy" label={t("msgSelect.copy", { defaultValue: "Copy" })} onPress={onCopy} disabled={none} testID="msg-select-copy" />
        <BarButton icon="Forward" label={t("msgSelect.forward", { defaultValue: "Forward" })} onPress={onForward} disabled={none} testID="msg-select-forward" />
        <BarButton
          icon="Trash2"
          label={ownCount > 0 && ownCount < count
            ? t("msgSelect.deleteSome", { defaultValue: "Delete {{count}}", count: ownCount })
            : t("chatBulk.delete", { defaultValue: "Delete" })}
          onPress={onDelete}
          disabled={ownCount === 0}
          color={DANGER}
          testID="msg-select-delete"
        />
      </View>
    </View>
  );
}

export default memo(MessageSelectBarComponent);
