import React from "react";
import { useTranslation as _useCopy } from "react-i18next";
import { Text, View, TouchableOpacity, ActivityIndicator } from "react-native";
import GlassModal from "../ui/GlassModal";
import Icon, { type IconName } from "../ui/Icon";

export type ConfirmModalProps = {
  visible: boolean;
  title: string;
  description?: string;
  confirmText?: string;
  cancelText?: string;
  onConfirm: () => void;
  onCancel: () => void;
  loading?: boolean;
  confirmIcon?: IconName;
  error?: string;
  confirmKind?: "primary" | "danger" | "neutral";
};

const kindBg: Record<NonNullable<ConfirmModalProps["confirmKind"]>, string> = {
  primary: "bg-theme-accent",
  danger: "bg-white/15 border border-white/25",
  neutral: "bg-theme-neutrals-700",
};

// Near-white accent fill needs dark content; dark fills keep white content.
const kindContent: Record<NonNullable<ConfirmModalProps["confirmKind"]>, string> = {
  primary: "#09090B",
  danger: "#FFFFFF",
  neutral: "#FFFFFF",
};

const ConfirmModal: React.FC<ConfirmModalProps> = ({
  visible,
  title,
  description,
  confirmText,
  cancelText,
  onConfirm,
  onCancel,
  loading,
  confirmIcon,
  error,
  confirmKind = "primary",
}) => {
  const { t: _copy } = _useCopy();
  return (
    <GlassModal visible={visible} onClose={onCancel} dismissible={!loading} presentation="center" backdropScope="panel">
      <View className="px-5 py-5" accessibilityViewIsModal>
        <Text className="text-theme-neutrals-100 text-base font-semibold" accessibilityRole="header">{title}</Text>
        {!!description && (
          <Text className="text-theme-neutrals-300 text-sm mt-2">{description}</Text>
        )}
        {!!error && (
          <Text className="text-theme-neutrals-100 text-sm mt-2" accessibilityRole="alert" accessibilityLiveRegion="polite">
            {error}
          </Text>
        )}
        <View className="flex-row flex-wrap justify-end gap-2 mt-5">
          <TouchableOpacity
            className="min-h-[44px] justify-center px-4 py-2 rounded-xl bg-theme-neutrals-700/70 active:opacity-80 disabled:opacity-60"
            accessibilityRole="button"
            onPress={onCancel}
            disabled={!!loading}
          >
            <Text className="text-theme-neutrals-100 text-sm">{cancelText ?? _copy("copy.19766ed6ccb2", { defaultValue: "Cancel" })}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            className={`${kindBg[confirmKind]} min-h-[44px] flex-row items-center gap-2 px-4 py-2 rounded-xl active:opacity-80`}
            accessibilityRole="button"
            accessibilityState={{ disabled: !!loading, busy: !!loading }}
            onPress={onConfirm}
            disabled={!!loading}
          >
            {loading ? <ActivityIndicator size="small" color={kindContent[confirmKind]} /> :
              confirmIcon && <Icon name={confirmIcon} size={18} color={kindContent[confirmKind]} />}
            <Text className="text-sm font-semibold" style={{ color: kindContent[confirmKind] }}>
              {confirmText ?? _copy("copy.eebdd24a77d9", { defaultValue: "Confirm" })}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </GlassModal>
  );
};

export default ConfirmModal;
