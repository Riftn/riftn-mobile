import React from "react";
import { ActivityIndicator, TouchableOpacity, Text, ViewStyle, StyleSheet } from "react-native";
import AccentButtonGradient from "./AccentButtonGradient";
import Icon from "./Icon";
import { useAppTheme } from "../../context/ThemeContext";

type PrimaryButtonProps = {
  title: string;
  onPress?: () => void;
  disabled?: boolean;
  className?: string;
  style?: ViewStyle;
  neutral?: boolean;
  /** The full-width call to action at the foot of a first-run step. */
  large?: boolean;
  size?: "sm" | "icon";
  icon?: React.ComponentProps<typeof Icon>["name"];
  loading?: boolean;
  hitSlop?: number;
};

/** Shared primary action using the active theme's existing chrome. */
const PrimaryButton: React.FC<PrimaryButtonProps> = ({
  title, onPress, disabled, className, style, neutral = false, large = false, size, icon, loading = false, hitSlop,
}) => {
  const { skin } = useAppTheme();
  const iconOnly = size === "icon";
  const blocked = disabled || loading;
  const foreground = skin && !neutral ? skin.centreIcon : "#FFFFFF";
  return (
    <TouchableOpacity
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={iconOnly || loading ? title : undefined}
      accessibilityState={{ disabled: blocked, busy: loading }}
      disabled={blocked}
      hitSlop={hitSlop}
      activeOpacity={0.85}
      className={`overflow-hidden ${large ? "rounded-2xl" : "rounded-xl"} ${blocked ? "opacity-60" : ""} ${className || ""}`}
      style={style}
    >
      <AccentButtonGradient
        style={[styles.fill, size === "sm" && styles.fillSmall, iconOnly && styles.fillIcon, large && styles.fillLarge]}
        borderRadius={large ? 16 : 12}
        neutral={neutral}
      >
        {loading ? <ActivityIndicator size="small" color={foreground} /> : icon && <Icon name={icon} size={16} color={foreground} />}
        {!iconOnly && <Text style={[styles.label, large && styles.labelLarge, { color: foreground }]}>{title}</Text>}
      </AccentButtonGradient>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  fill: {
    height: 40,
    paddingHorizontal: 16,
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.30)",
  },
  fillSmall: { height: 36, paddingHorizontal: 12 },
  fillIcon: { width: 36, height: 36, paddingHorizontal: 0 },
  fillLarge: {
    height: 54,
    borderRadius: 16,
  },
  labelLarge: {
    fontSize: 17,
    fontWeight: "600",
  },
  label: {
    fontSize: 14,
    fontWeight: "500",
  },
});

export default PrimaryButton;
