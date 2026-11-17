/**
 * The composer video preview's only control: the whole preview is the button,
 * with one frosted glass pill at the bottom that says what it does. It opens
 * the edit screen people see when they first add a video, where cover, trim,
 * crop, looks, timer, alt text, sound, replace and remove all live.
 */
import React from "react";
import { Pressable, Text, View } from "react-native";
import FrostedPill from "../ui/FrostedPill";
import Icon from "../ui/Icon";
import { useAppTheme } from "../../context/ThemeContext";
import { KeepDarkScope } from "../../libs/jsx/tone";

/** Dark wash over the frost so white text reads on a bright video. */
const FROST_TINT = "rgba(8,8,10,0.5)";

interface Props {
  label: string;
  /** A song is laid over the video. */
  hasSound?: boolean;
  onPress: () => void;
  accessibilityLabel: string;
}

export default function VideoEditButton({ label, hasSound, onPress, accessibilityLabel }: Props) {
  // The frost is pale under System Light: ink on it there, white elsewhere.
  // Colours are picked here, so the light colour pass is kept out.
  const { isLight } = useAppTheme();
  const ink = isLight ? "#0B0B0D" : "#FFFFFF";
  return (
    <Pressable
      onPress={onPress}
      style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0, alignItems: "center", justifyContent: "flex-end", paddingBottom: 10, zIndex: 20 }}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      testID="upload-edit-video"
    >
      <View style={{ height: 36, paddingHorizontal: 16, borderRadius: 999, flexDirection: "row", alignItems: "center", overflow: "hidden" }}>
        {/* Frosted on every theme: a theme's see-through card glass let the
            video show through the label. */}
        <FrostedPill tint={FROST_TINT} borderRadius={999} />
        <KeepDarkScope>
          <View style={{ flexDirection: "row", alignItems: "center", zIndex: 1 }}>
            <Icon name={hasSound ? "Music" : "SlidersHorizontal"} size={14} color={ink} />
            <Text style={{ color: ink, fontSize: 13, fontWeight: "600", marginLeft: 6 }}>{label}</Text>
          </View>
        </KeepDarkScope>
      </View>
    </Pressable>
  );
}
