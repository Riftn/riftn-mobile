/**
 * The ask bar that takes the shelf's place while nobody has a Moment up.
 *
 * "What's on today?" starts a post, the camera and live buttons go straight
 * to a Moment or a livestream, and + opens a sheet with all five ways to
 * create: Moment, Post, Live, Stage and Status. Each opens its real flow.
 * Same as web's StoryCreatePill.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Modal, Platform, Pressable, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import Animated, { Easing, runOnJS, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useNavigation } from "@react-navigation/native";
import { useTranslation } from "react-i18next";
import Icon, { type IconName } from "../ui/Icon";
import { useAuthActions, useUser } from "../../context/AuthContext";
import { useAppTheme } from "../../context/ThemeContext";
import { useStages } from "../../context/StageContext";
import { ScreenNames } from "../../navigation/ScreenNames";
import { openStoryCreator } from "../../store/stories.store";
import { SHEET_GLASS_FILL } from "../../theme/sheetGlass";
import { SheetGlassFill } from "../ui/SheetGlass";
import SheetBackdrop, { useSheetBackdrop } from "../ui/SheetBackdrop";
import { useSheetClosed } from "../../hooks/useSheetClosed";
import NotesSheet from "../DM/NotesSheet";

type Kind = "moment" | "post" | "live" | "stage" | "status";

const OPTIONS: ReadonlyArray<{ kind: Kind; icon: IconName; label: string; hint: string }> = [
  { kind: "moment", icon: "Camera", label: "Moment", hint: "Photo or video for 24 hours" },
  { kind: "post", icon: "PenLine", label: "Post", hint: "Words, photos or video on your feed" },
  { kind: "live", icon: "Radio", label: "Live", hint: "Go live with video right now" },
  { kind: "stage", icon: "Mic", label: "Stage", hint: "Talk live with voices" },
  { kind: "status", icon: "MessagesSquare", label: "Status", hint: "A short note your followers see" },
];

const HIDE = 520;

/** Light colours are written as their final hsla values, so the System Light pass leaves them. */
function usePalette() {
  const { isLight, skin } = useAppTheme();
  return useMemo(() => isLight
    ? { ink: "hsla(240,8%,4%,1)", sub: "hsla(240,8%,4%,0.66)", line: "hsla(240,8%,4%,0.12)", fill: "transparent", keyBg: "hsla(240,8%,7%,1)", keyInk: "hsla(0,0%,100%,1)", grab: "hsla(240,8%,4%,0.16)" }
    : { ink: "hsla(0,0%,100%,1)", sub: "rgba(255,255,255,0.62)", line: skin ? "rgba(255,255,255,0.18)" : "rgba(255,255,255,0.14)", fill: skin ? "rgba(255,255,255,0.07)" : "transparent", keyBg: "hsla(0,0%,100%,1)", keyInk: "hsla(240,6%,5%,1)", grab: "rgba(255,255,255,0.2)" },
  [isLight, skin]);
}

/** What each option opens, plus the status sheet it may need. */
function useCreateFlows() {
  const navigation = useNavigation<any>();
  const { openModal } = useStages();
  const { requireAuth } = useAuthActions();
  const [menuOpen, setMenuOpen] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
  const pendingPick = useRef<Kind | null>(null);
  const pick = useCallback((kind: Kind) => {
    if (kind === "moment") requireAuth(() => openStoryCreator());
    else if (kind === "post") navigation.navigate(ScreenNames.Upload);
    else if (kind === "live") navigation.navigate(ScreenNames.Upload, { live: true });
    else if (kind === "stage") openModal("create");
    else if (kind === "status") setNotesOpen(true);
  }, [navigation, openModal, requireAuth]);
  const finishPick = useCallback(() => {
    const kind = pendingPick.current;
    pendingPick.current = null;
    if (kind) pick(kind);
  }, [pick]);
  const elements = (
    <>
      <CreateSheet
        visible={menuOpen}
        onClose={() => setMenuOpen(false)}
        onDismiss={finishPick}
        onPick={(kind) => {
          if (pendingPick.current) return;
          pendingPick.current = kind;
          setMenuOpen(false);
        }}
      />
      {notesOpen ? (
        <NotesSheet
          visible={notesOpen}
          onClose={() => setNotesOpen(false)}
          onMessage={() => { setNotesOpen(false); navigation.navigate(ScreenNames.DM); }}
        />
      ) : null}
    </>
  );
  return { pick, openMenu: () => setMenuOpen(true), elements };
}

export default function StoryCreateBar() {
  const { t } = useTranslation();
  const user = useUser() as { displayName?: string; username?: string } | null;
  const c = usePalette();
  const { pick, openMenu, elements } = useCreateFlows();
  const firstName = (user?.displayName || user?.username || "").trim().split(/\s+/)[0] || "";

  return (
    <View style={styles.wrap}>
      <View style={[styles.bar, { borderColor: c.line, backgroundColor: c.fill }]}>
        <TouchableOpacity style={styles.prompt} activeOpacity={0.85} onPress={() => pick("post")} accessibilityRole="button">
          <Text style={[styles.promptText, { color: c.sub }]} numberOfLines={1}>
            {firstName
              ? t("stories.ask.promptNamed", { name: firstName, defaultValue: "What's on today, {{name}}?" })
              : t("stories.ask.prompt", { defaultValue: "What's on today?" })}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.iconBtn} activeOpacity={0.85} onPress={() => pick("moment")} hitSlop={4}
          accessibilityRole="button" accessibilityLabel={t("stories.ask.moment", { defaultValue: "Moment" })}>
          <Icon name="Camera" size={20} color={c.ink} />
        </TouchableOpacity>
        <TouchableOpacity style={styles.iconBtn} activeOpacity={0.85} onPress={() => pick("live")} hitSlop={4}
          accessibilityRole="button" accessibilityLabel={t("stories.ask.live", { defaultValue: "Live" })}>
          <Icon name="Radio" size={20} color={c.ink} />
        </TouchableOpacity>
        <TouchableOpacity style={styles.iconBtn} activeOpacity={0.85} onPress={openMenu} hitSlop={4}
          accessibilityRole="button" accessibilityLabel={t("stories.ask.create", { defaultValue: "Create" })}>
          <View style={[styles.key, { backgroundColor: c.keyBg }]}>
            <Icon name="Plus" size={16} color={c.keyInk} strokeWidth={2.4} />
          </View>
        </TouchableOpacity>
      </View>
      {elements}
    </View>
  );
}

/** First tile of the row while Moments or lives are up: a centred + that opens the same sheet. */
export function StoryCreateTile({ width, height }: { width: number; height: number }) {
  const { t } = useTranslation();
  const c = usePalette();
  const { openMenu, elements } = useCreateFlows();
  const label = t("stories.ask.create", { defaultValue: "Create" });
  return (
    <>
      <TouchableOpacity
        style={[styles.tile, { width, height, backgroundColor: c.keyBg }]}
        activeOpacity={0.85}
        onPress={openMenu}
        accessibilityRole="button"
        accessibilityLabel={label}
        testID="story-create-tile"
      >
        <Icon name="Plus" size={22} color={c.keyInk} strokeWidth={2.4} />
      </TouchableOpacity>
      {elements}
    </>
  );
}

function CreateSheet({ visible, onClose, onDismiss, onPick }: {
  visible: boolean;
  onClose: () => void;
  onDismiss: () => void;
  onPick: (kind: Kind) => void;
}) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const c = usePalette();
  const backdrop = useSheetBackdrop(visible);
  const [isFullyClosed, setIsFullyClosed] = useSheetClosed(visible);
  const y = useSharedValue(HIDE);
  const fade = useSharedValue(0);

  useEffect(() => {
    if (visible) {
      setIsFullyClosed(false);
      y.value = withTiming(0, { duration: 280, easing: Easing.out(Easing.cubic) });
      fade.value = withTiming(1, { duration: 240 });
    } else {
      y.value = withTiming(HIDE, { duration: 200, easing: Easing.in(Easing.cubic) }, () => runOnJS(setIsFullyClosed)(true));
      fade.value = withTiming(0, { duration: 180 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const sheetStyle = useAnimatedStyle(() => ({ transform: [{ translateY: y.value }] }));
  const backdropStyle = useAnimatedStyle(() => ({ opacity: fade.value }));

  useEffect(() => {
    if (Platform.OS !== "ios" && isFullyClosed) onDismiss();
  }, [isFullyClosed, onDismiss]);

  return (
    <Modal visible={visible || !isFullyClosed} transparent animationType="none" statusBarTranslucent navigationBarTranslucent onRequestClose={onClose} onDismiss={onDismiss}>
      <Animated.View style={[StyleSheet.absoluteFill, backdropStyle]}>
        <SheetBackdrop backdrop={backdrop} />
        <Pressable style={{ flex: 1 }} onPress={onClose} />
      </Animated.View>
      <Animated.View style={[styles.sheet, { paddingBottom: insets.bottom + 12, borderColor: c.line }, sheetStyle]} testID="story-create-sheet">
        <SheetGlassFill allThemes backdropBlurred={backdrop.blurred} style={[StyleSheet.absoluteFill, { backgroundColor: SHEET_GLASS_FILL }]} />
        <View style={styles.grabWrap}><View style={[styles.grab, { backgroundColor: c.grab }]} /></View>
        <Text style={[styles.title, { color: c.ink }]}>{t("stories.ask.create", { defaultValue: "Create" })}</Text>
        {OPTIONS.map(({ kind, icon, label, hint }) => (
          <TouchableOpacity key={kind} style={styles.row} activeOpacity={0.85} onPress={() => onPick(kind)}
            accessibilityRole="menuitem" testID={`story-create-${kind}`}>
            <View style={[styles.rowIcon, { borderColor: c.line }]}>
              <Icon name={icon} size={20} color={c.ink} />
            </View>
            <View style={styles.rowText}>
              <Text style={[styles.rowLabel, { color: c.ink }]}>{t(`stories.ask.${kind}`, { defaultValue: label })}</Text>
              <Text style={[styles.rowHint, { color: c.sub }]} numberOfLines={1}>{t(`stories.ask.${kind}Hint`, { defaultValue: hint })}</Text>
            </View>
          </TouchableOpacity>
        ))}
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: 6, marginBottom: 10 },
  bar: {
    height: 48,
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    paddingLeft: 4,
    paddingRight: 6,
    borderRadius: 12,
    borderWidth: 1,
  },
  prompt: { flex: 1, minWidth: 0, height: 40, justifyContent: "center", paddingLeft: 12, paddingRight: 10 },
  promptText: { fontSize: 15, fontWeight: "500" },
  iconBtn: { width: 40, height: 40, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  key: { width: 30, height: 30, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  /** The row's + key: a solid square the height of the pills beside it. */
  tile: { borderRadius: 17, alignItems: "center", justifyContent: "center" },
  sheet: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingTop: 8,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    borderTopWidth: 1,
    overflow: "hidden",
  },
  grabWrap: { alignItems: "center", paddingBottom: 8 },
  grab: { width: 36, height: 4, borderRadius: 2 },
  title: { fontSize: 16, fontWeight: "700", paddingHorizontal: 16, paddingTop: 4, paddingBottom: 8 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 10 },
  rowIcon: { width: 40, height: 40, borderRadius: 10, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  rowText: { flex: 1, minWidth: 0, gap: 2 },
  rowLabel: { fontSize: 15, fontWeight: "700", lineHeight: 20 },
  rowHint: { fontSize: 13, fontWeight: "500", lineHeight: 17 },
});
