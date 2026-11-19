import React, { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useTranslation } from "react-i18next";
import GlassModal from "../ui/GlassModal";
import Icon from "../ui/Icon";
import { useAppTheme } from "../../context/ThemeContext";
import { useAuth } from "../../context/AuthContext";
import { CallControl, Fill, useStage } from "./CallChrome";
import { usePeerIdentity } from "./usePeerIdentity";
import { useCallCaptionEngine, useCallCaptionLines, useCallCaptionsReady } from "../../hooks/useCallCaptions";
import {
  CAPTION_LANGUAGES, setCallCaptionLanguage, setSendCallCaptions, setShowCallCaptions, useCallCaptionPrefs,
} from "../../libs/callCaptions";

/**
 * Live subtitles in calls (see hooks/useCallCaptions). The engine is mounted
 * once by CallModalsHost; the call screens draw the lines and the button.
 */
export function CallCaptionEngine() {
  const { user } = useAuth();
  const self = usePeerIdentity((user?.walletAddress || user?.address || "").toLowerCase());
  useCallCaptionEngine(self.name.replace(/^@/, ""));
  return null;
}

/** The subtitle lines, above the call's controls. */
export function CallCaptionsOverlay() {
  const lines = useCallCaptionLines();
  const { show, language } = useCallCaptionPrefs();
  if (!show || !lines.length) return null;
  return (
    <View style={styles.overlay} pointerEvents="none" accessibilityLiveRegion="polite">
      {lines.map((line) => {
        const translated = language ? line.translations?.[language] : undefined;
        const settled = line.final && (!language || !!translated);
        return (
          <View key={line.id} style={[styles.pill, !settled && styles.provisional]}>
            <Text style={styles.text} numberOfLines={3}>
              <Text style={styles.name}>{line.name}  </Text>
              {translated ?? line.text}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

/**
 * The control that opens the subtitle settings. A round dock button on voice
 * calls; a small chip above the dock on video calls, whose dock is already full.
 */
export function CallCaptionsControl({ variant = "control" }: { variant?: "control" | "chip" }) {
  const { t } = useTranslation();
  const { palette } = useStage();
  const ready = useCallCaptionsReady();
  const { show, language } = useCallCaptionPrefs();
  const [open, setOpen] = useState(false);
  if (!ready) return null;
  const label = t("calls.subtitles", { defaultValue: "Subtitles" });
  return (
    <>
      {variant === "chip" ? (
        <Pressable
          onPress={() => setOpen(true)}
          accessibilityRole="button"
          accessibilityLabel={label}
          accessibilityState={{ selected: show }}
          style={({ pressed }) => [styles.chip, pressed && { opacity: 0.8 }]}
        >
          <Fill color={show ? palette.fg : palette.glassStrong} />
          <View><Icon name="Captions" size={16} color={show ? palette.onFg : palette.fg} /></View>
          <Text style={[styles.chipText, { color: show ? palette.onFg : palette.fg }]}>
            {show && language ? `${label} · ${language.toUpperCase()}` : label}
          </Text>
        </Pressable>
      ) : (
        <CallControl icon="Captions" label={label} onPress={() => setOpen(true)} active={show} />
      )}
      <CallCaptionsSheet visible={open} onClose={() => setOpen(false)} />
    </>
  );
}

function Row({ label, checked, onPress }: { label: string; checked: boolean; onPress: () => void }) {
  const { colors } = useAppTheme();
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.7} style={styles.row} accessibilityRole="button" accessibilityState={{ selected: checked }}>
      <View style={styles.check}>{checked ? <Icon name="Check" size={18} color={colors.foreground} /> : null}</View>
      <Text style={[styles.rowText, { color: colors.foreground }]}>{label}</Text>
    </TouchableOpacity>
  );
}

function CallCaptionsSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const { colors } = useAppTheme();
  const { show, send, language } = useCallCaptionPrefs();
  return (
    <GlassModal visible={visible} onClose={onClose} presentation="bottom">
      <ScrollView style={styles.sheet} contentContainerStyle={styles.sheetBody}>
        <Row label={t("stages.showSubtitles", { defaultValue: "Show subtitles" })} checked={show} onPress={() => setShowCallCaptions(!show)} />
        <Row label={t("calls.subtitleMyVoice", { defaultValue: "Subtitle my voice" })} checked={send} onPress={() => setSendCallCaptions(!send)} />
        <Text style={[styles.heading, { color: colors.mutedForeground }]}>{t("stages.language", { defaultValue: "Language" })}</Text>
        <Row
          label={t("stages.asSpoken", { defaultValue: "As spoken" })}
          checked={!language}
          onPress={() => { setCallCaptionLanguage(null); if (!show) setShowCallCaptions(true); }}
        />
        {CAPTION_LANGUAGES.map((option) => (
          <Row
            key={option.code}
            label={option.name}
            checked={language === option.code}
            onPress={() => { setCallCaptionLanguage(option.code); if (!show) setShowCallCaptions(true); }}
          />
        ))}
      </ScrollView>
    </GlassModal>
  );
}

const styles = StyleSheet.create({
  overlay: { width: "100%", alignItems: "center", gap: 4, paddingHorizontal: 12, marginBottom: 10 },
  pill: {
    maxWidth: "100%", borderRadius: 12, paddingHorizontal: 10, paddingVertical: 5,
    backgroundColor: "rgba(0,0,0,0.78)", borderWidth: StyleSheet.hairlineWidth, borderColor: "rgba(255,255,255,0.12)",
  },
  provisional: { opacity: 0.7 },
  text: { color: "#FFFFFF", fontSize: 13, lineHeight: 18, textAlign: "center" },
  name: { color: "rgba(255,255,255,0.6)", fontSize: 11, fontWeight: "600" },
  chip: { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "center", height: 32, paddingHorizontal: 12, borderRadius: 999, marginBottom: 10 },
  chipText: { fontSize: 13, fontWeight: "600" },
  sheet: { maxHeight: 520 },
  sheetBody: { paddingVertical: 8 },
  row: { flexDirection: "row", alignItems: "center", paddingHorizontal: 20, paddingVertical: 12 },
  check: { width: 28 },
  rowText: { fontSize: 15, fontWeight: "500" },
  heading: { fontSize: 12, fontWeight: "600", paddingHorizontal: 20, paddingTop: 14, paddingBottom: 4, textTransform: "uppercase", letterSpacing: 0.5 },
});
