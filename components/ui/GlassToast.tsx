import React from "react";
import { useTranslation } from "react-i18next";
import {
  View,
  Text,
  TouchableOpacity,
  Image,
} from "react-native";
import type { ImageSourcePropType } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { ButtonLoader } from "../DeHubLoader";

type GlassToastType = "success" | "error" | "info" | "warning" | "loading";

export interface GlassToastProps {
  type?: GlassToastType;
  title: string;
  description?: string;
  onClose?: () => void;
  actionLabel?: string;
  actionIcon?: ImageSourcePropType;
  onActionPress?: () => void;
  children?: React.ReactNode;
}

/** Shared card for app toasts and their actions. */
const GlassToast: React.FC<GlassToastProps> = ({
  type = "info",
  title,
  description,
  onClose,
  actionLabel,
  actionIcon,
  onActionPress,
  children,
}) => {
  const { t } = useTranslation();
  if (!title) return null;

  return (
    <View
      className="w-[92%] self-center rounded-2xl my-2 p-4"
      style={{ borderWidth: 1, borderColor: "rgba(255,255,255,0.2)", backgroundColor: "#101014" }}
    >
      <View className={`flex-row gap-3 ${type === "loading" ? "items-center" : "items-start"}`}>
        {type === "loading" && <ButtonLoader size={18} />}
        <View className="flex-1 min-w-0">
          <Text className="text-white text-base leading-5 font-bold" numberOfLines={type === "loading" ? 1 : undefined}>
            {title}
          </Text>
          {description && <Text className="text-white/70 text-[13px] leading-5 mt-1.5">{description}</Text>}
        </View>
        {onClose && (
          <TouchableOpacity
            accessibilityLabel={t("common.close")}
            accessibilityRole="button"
            hitSlop={{ top: 10, bottom: 6, left: 8, right: 8 }}
            onPress={onClose}
          >
            <Ionicons name="close" size={20} color="rgba(255,255,255,0.6)" />
          </TouchableOpacity>
        )}
      </View>
      {children}
      {actionLabel && onActionPress && (
        <TouchableOpacity
          activeOpacity={0.8}
          onPress={onActionPress}
          accessibilityRole="button"
          className="mt-3 min-h-10 w-full flex-row items-center justify-center gap-2 rounded-xl bg-white/10 px-4 py-2"
          style={{ borderWidth: 1, borderColor: "rgba(255,255,255,0.3)" }}
        >
          {actionIcon && <Image source={actionIcon} className="h-5 w-5" resizeMode="contain" />}
          <Text className="shrink text-center text-sm font-medium text-white">{actionLabel}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
};

export default GlassToast;
