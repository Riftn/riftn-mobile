import React from "react";
import { Pressable, StyleSheet, View, type PressableProps } from "react-native";
import Icon from "../ui/Icon";
import { CHROME_HIT_SLOP, CHROME_SIZE, ICON_COLOR } from "./ViewerChrome";

type Props = Pick<PressableProps, "onPress" | "accessibilityLabel" | "accessibilityState"> & {
  icon: React.ComponentProps<typeof Icon>["name"];
  size?: number;
};

export default function ViewerHeaderButton({ icon, size = 21, ...props }: Props) {
  return (
    <Pressable {...props} accessibilityRole="button" hitSlop={CHROME_HIT_SLOP} style={styles.button}>
      <View pointerEvents="none" style={{ width: size, height: size }}>
        {/* Offset a second glyph for the shadow on platforms without SVG shadows. */}
        <View style={styles.shadow}>
          <Icon name={icon} size={size} color="rgba(0,0,0,0.45)" />
        </View>
        <Icon name={icon} size={size} color={ICON_COLOR} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: { width: CHROME_SIZE, height: CHROME_SIZE, alignItems: "center", justifyContent: "center" },
  shadow: { position: "absolute", top: 1, left: 0 },
});
