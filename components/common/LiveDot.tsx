import React from "react";
import { View } from "react-native";

export const LIVE_RED = "#EF4444";

export function LiveDot({ size = 6 }: { size?: number }) {
  return (
    <View
      accessible={false}
      importantForAccessibility="no"
      style={{ width: size, height: size, borderRadius: size / 2, flexShrink: 0, backgroundColor: LIVE_RED }}
    />
  );
}
