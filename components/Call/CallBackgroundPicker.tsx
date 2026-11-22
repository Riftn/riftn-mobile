import React from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import * as FileSystem from "expo-file-system/legacy";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import Icon from "../ui/Icon";
import { radius } from "../../theme/radius";
import { Fill, useStage } from "./CallChrome";
import { CALL_BACKGROUNDS, loadCallBackgroundPhoto, saveCallBackgroundPhoto, type CallBackgroundId } from "../../libs/callBackground";
import { toastError } from "../../libs/toast";

/**
 * Background effects on a video call: the round button in the stage's top
 * right corner opens a row of choices above the controls. Off, blur, four
 * scenes and your own photo. The pick is remembered for the next call.
 */
export const CallFxButton: React.FC<{ open: boolean; active: boolean; onToggle: () => void }> = ({ open, active, onToggle }) => {
  const { palette } = useStage();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const solid = open || active;
  return (
    <Pressable
      onPress={onToggle}
      accessibilityRole="button"
      accessibilityLabel={t("calls.background", "Background")}
      accessibilityState={{ expanded: open }}
      hitSlop={8}
      style={[styles.fx, { top: insets.top + 12 }]}
    >
      <Fill color={solid ? palette.fg : palette.dock} line={palette.line} />
      <View><Icon name={open ? "X" : "Sparkles"} size={20} color={solid ? palette.onFg : palette.fg} /></View>
    </Pressable>
  );
};

/** Copies a picked photo into the app's own folder so it outlives the picker's cache. */
async function keepPhoto(uri: string): Promise<string> {
  const dir = `${FileSystem.documentDirectory ?? ""}call-backgrounds/`;
  try { await FileSystem.makeDirectoryAsync(dir, { intermediates: true }); } catch { /* already there */ }
  const target = `${dir}bg-${Date.now()}.jpg`;
  await FileSystem.copyAsync({ from: uri, to: target });
  const previous = loadCallBackgroundPhoto();
  if (previous && previous !== target) { try { await FileSystem.deleteAsync(previous, { idempotent: true }); } catch { /* fine */ } }
  saveCallBackgroundPhoto(target);
  return target;
}

export const CallBackgroundPanel: React.FC<{
  value: CallBackgroundId;
  busy?: boolean;
  onPick: (id: CallBackgroundId, photo?: string | null) => void;
  onClose: () => void;
}> = ({ value, busy, onPick, onClose }) => {
  const { palette } = useStage();
  const { t } = useTranslation();
  const [photo, setPhoto] = React.useState<string | null>(() => loadCallBackgroundPhoto());

  const choosePhoto = async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.85, allowsEditing: false });
      if (result.canceled || !result.assets?.[0]?.uri) return;
      const kept = await keepPhoto(result.assets[0].uri);
      setPhoto(kept);
      onPick("photo", kept);
    } catch {
      toastError(t("calls.backgroundPhotoFailed", "That picture couldn't be opened."));
    }
  };

  return (
    <View style={[styles.panel, { backgroundColor: palette.dock, borderColor: palette.line }]}>
      <View style={styles.head}>
        <Text style={[styles.title, { color: palette.fg }]}>{t("calls.background", "Background")}</Text>
        {busy ? <ActivityIndicator size="small" color={palette.fg} /> : null}
        <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel={t("common.close", "Close")} hitSlop={8} style={styles.close}>
          <Fill color={palette.glassStrong} />
          <View><Icon name="X" size={16} color={palette.fg} /></View>
        </Pressable>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
        {CALL_BACKGROUNDS.map(choice => {
          const selected = value === choice.id;
          const isPhoto = choice.id === "photo";
          const onPress = () => {
            if (isPhoto && (!photo || selected)) { void choosePhoto(); return; }
            onPick(choice.id, isPhoto ? photo : null);
          };
          return (
            <Pressable
              key={choice.id}
              onPress={onPress}
              disabled={busy}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              accessibilityLabel={t(choice.labelKey, choice.label)}
              style={[styles.opt, busy ? { opacity: 0.6 } : null]}
            >
              <View style={[styles.swatch, { borderColor: selected ? palette.fg : palette.line, borderWidth: selected ? 2 : 1 }]}>
                <View style={[styles.swatchInner, { backgroundColor: palette.glassStrong }]}>
                  {choice.swatch ? (
                    <LinearGradient colors={choice.swatch} start={{ x: 0, y: 0 }} end={{ x: 0.6, y: 1 }} style={StyleSheet.absoluteFill} />
                  ) : null}
                  {choice.id === "blur" ? (
                    <LinearGradient colors={["rgba(255,255,255,0.5)", "rgba(255,255,255,0.08)"]} start={{ x: 0.2, y: 0.2 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
                  ) : null}
                  {isPhoto && photo ? <Image source={{ uri: photo }} style={StyleSheet.absoluteFill} contentFit="cover" /> : null}
                  {choice.id === "none" ? <Icon name="X" size={20} color={palette.fg} /> : null}
                  {isPhoto && !photo ? <Icon name="ImagePlus" size={20} color={palette.fg} /> : null}
                </View>
              </View>
              <Text numberOfLines={1} style={[styles.label, { color: selected ? palette.fg : palette.muted }]}>
                {t(choice.labelKey, choice.label)}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  fx: {
    position: "absolute",
    right: 16,
    width: 40,
    height: 40,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  panel: {
    alignSelf: "stretch",
    marginHorizontal: 12,
    paddingTop: 12,
    paddingBottom: 10,
    borderRadius: 22,
    borderWidth: 1,
    overflow: "hidden",
  },
  head: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingBottom: 10,
  },
  title: {
    fontSize: 13,
    fontWeight: "700",
  },
  close: {
    marginLeft: "auto",
    width: 28,
    height: 28,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  row: {
    gap: 10,
    paddingHorizontal: 12,
  },
  opt: {
    width: 56,
    alignItems: "center",
    gap: 6,
  },
  swatch: {
    width: 50,
    height: 50,
    borderRadius: 25,
    padding: 1,
  },
  swatchInner: {
    flex: 1,
    borderRadius: 24,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  label: {
    fontSize: 11,
    fontWeight: "600",
  },
});
