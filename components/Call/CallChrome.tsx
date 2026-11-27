import React, { createContext, useContext, useEffect, useMemo, useRef } from "react";
import { Animated, Easing, Modal, Pressable, StatusBar, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Avatar from "../common/Avatar";
import Icon, { type IconName } from "../ui/Icon";
import { radius } from "../../theme/radius";
import { useAppTheme } from "../../context/ThemeContext";
import { KeepDarkScope } from "../../libs/jsx/tone";
import { useTranslation } from "react-i18next";
import CallRings from "./CallRings";
import { stagePalette, withAlpha, type StagePalette } from "./callStage";
import type { PeerIdentity } from "./usePeerIdentity";
import type { AppThemeName } from "../../theme/colors";

/**
 * The call stage: one full-screen surface for ringing, incoming, connecting,
 * in-call and ended. The other person's picture, blurred and tinted by the
 * theme, is the backdrop, so a call looks like it is with someone rather than
 * like a settings page.
 *
 * A call takes the whole screen, the way the platform's own phone UI does: the
 * controls have to be hittable without looking. What stays ours is the
 * palette: no green accept and no red hang-up anywhere. The single strong
 * control is the solid one, and which action gets it depends on the step:
 * accept while it rings, hang up once the call is up, call back once it is
 * over.
 *
 * `radius.full` is deliberate here and only here among our buttons: the
 * in-call controls follow the platform's round-button convention. Avatars stay
 * rounded squares.
 *
 * The stage owns its colours (callStage.ts) and opts out of System Light's
 * colour pass, which would otherwise turn its glass and scrims around. Its
 * buttons paint their fill in a child (Fill) for the same reason: they sit
 * over a picture and keep their own look instead of taking the theme's
 * control material, which only restyles a button that carries a fill itself.
 */

interface Stage { palette: StagePalette; theme: AppThemeName }
const StageContext = createContext<Stage | null>(null);

export function useStage(): Stage {
  const { themeChoice, accent } = useAppTheme();
  const inherited = useContext(StageContext);
  const own = useMemo(() => ({ theme: themeChoice, palette: stagePalette(themeChoice, accent) }), [themeChoice, accent]);
  return inherited ?? own;
}

/** A stage button's own fill, drawn inside it so the button itself stays unpainted. */
export const Fill: React.FC<{ color: string; line?: string }> = ({ color, line }) => (
  <View
    pointerEvents="none"
    style={[StyleSheet.absoluteFill, { borderRadius: radius.full, backgroundColor: color }, line ? { borderWidth: 1, borderColor: line } : null]}
  />
);

/** Controls drawn over live video are always light on dark, whatever the theme. */
const OVER_VIDEO: Partial<StagePalette> = {
  fg: "#FFFFFF",
  onFg: "#0A0A0C",
  muted: "rgba(255,255,255,0.82)",
  glassStrong: "rgba(255,255,255,0.22)",
  line: "rgba(255,255,255,0.2)",
  dock: "rgba(18,18,22,0.78)",
};

export const CallStage: React.FC<{
  peer: PeerIdentity;
  onRequestClose: () => void;
  /** The round button in the top corner: minimise during a call, close after it. */
  onCorner?: () => void;
  cornerIcon?: IconName;
  cornerLabel?: string;
  onMessage?: () => void;
  /** Live video fills the stage, so the blurred picture steps aside. */
  live?: boolean;
  children: React.ReactNode;
}> = ({ peer, onRequestClose, onCorner, cornerIcon = "ChevronDown", cornerLabel, onMessage, live, children }) => {
  const { themeChoice, accent } = useAppTheme();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const stage = useMemo<Stage>(() => {
    const palette = stagePalette(themeChoice, accent);
    return { theme: themeChoice, palette: live ? { ...palette, ...OVER_VIDEO, light: false } : palette };
  }, [themeChoice, accent, live]);
  const { palette } = stage;

  return (
    <Modal visible onRequestClose={onRequestClose} statusBarTranslucent animationType="fade" transparent={false}>
      <StatusBar barStyle={palette.light ? "dark-content" : "light-content"} />
      <KeepDarkScope>
        <StageContext.Provider value={stage}>
          <View style={[styles.stage, { backgroundColor: live ? "#000000" : palette.bg }]}>
            {!live && (
              <>
                {peer.avatarUrl ? (
                  <Image
                    source={{ uri: peer.avatarUrl }}
                    style={styles.backdrop}
                    contentFit="cover"
                    blurRadius={50}
                    transition={0}
                    pointerEvents="none"
                  />
                ) : null}
                <LinearGradient
                  colors={[palette.tintTop, palette.bg]}
                  locations={[0, 0.92]}
                  style={StyleSheet.absoluteFill}
                  pointerEvents="none"
                />
              </>
            )}
            {children}
            {onCorner ? (
              <Pressable
                onPress={onCorner}
                accessibilityRole="button"
                accessibilityLabel={cornerLabel ?? t("calls.minimize")}
                hitSlop={8}
                style={({ pressed }) => [styles.corner, { left: 16, top: insets.top + 12 }, pressed && styles.pressed]}
              >
                <Fill color={live ? palette.dock : palette.glass} line={palette.line} />
                <View><Icon name={cornerIcon} size={20} color={palette.fg} /></View>
              </Pressable>
            ) : null}
            {onMessage ? (
              <Pressable
                onPress={onMessage}
                accessibilityRole="button"
                accessibilityLabel={t("dm.openChat")}
                style={({ pressed }) => [styles.corner, { right: 16, top: insets.top + 12 }, pressed && styles.pressed]}
              >
                <Fill color={live ? palette.dock : palette.glass} line={palette.line} />
                <View><Icon name="MessageCircle" size={20} color={palette.fg} /></View>
              </Pressable>
            ) : null}
          </View>
        </StageContext.Provider>
      </KeepDarkScope>
    </Modal>
  );
};

const AVATAR = 148;

/** Who the call is with, what kind it is and where it has got to. */
export const CallIdentity: React.FC<{
  kindLabel: string;
  kindIcon: IconName;
  peer: PeerIdentity;
  status: React.ReactNode;
  /** Waiting on an answer, either way round: the theme's ringing effect plays. */
  ringing?: boolean;
  direct?: boolean;
  children?: React.ReactNode;
}> = ({ kindLabel, kindIcon, peer, status, ringing, direct, children }) => {
  const { palette, theme } = useStage();
  const insets = useSafeAreaInsets();
  const { height, width } = useWindowDimensions();
  const size = direct ? Math.max(96, Math.min(180, Math.round(height * 0.23), Math.round(width * 0.48))) : AVATAR;
  const corner = theme === "minimal" ? 0 : theme === "hacker" ? 4 : Math.round(size * 0.26);
  const detailColor = direct ? palette.fg : palette.muted;
  const headingOffset = direct && height >= 680 ? Math.round(height * 0.12) : 68;
  return (
    <View style={[styles.identity, { paddingTop: insets.top + headingOffset }]}>
      <View style={styles.kindRow}>
        <Icon name={kindIcon} size={13} color={detailColor} />
        <Text style={[styles.kindLabel, { color: detailColor }]} numberOfLines={1}>{kindLabel}</Text>
      </View>
      <Text style={[styles.name, { color: palette.fg }]} numberOfLines={1}>{peer.name}</Text>
      <Text style={[styles.status, { color: detailColor }]} numberOfLines={1}>{status}</Text>
      <View style={{ width: size, height: size, marginTop: direct ? (height < 620 ? 12 : 24) : 48 }}>
        {ringing ? <CallRings theme={theme} size={size} radius={corner} palette={palette} /> : null}
        <Avatar
          uri={peer.avatarUrl}
          size={size}
          radius={corner}
          name={peer.name.replace(/^@/, "")}
          borderWidth={direct ? 1 : 0}
          borderColor={withAlpha(palette.fg, 0.36)}
        />
      </View>
      {children}
    </View>
  );
};

const WAVE = [0.45, 0.8, 1, 0.65, 0.9, 0.5, 0.75];

/** A small voice wave: the call is live and sound is moving. Still when muted. */
export const CallWave: React.FC<{ paused?: boolean; height?: number; color?: string }> = ({ paused, height = 22, color }) => {
  const { palette } = useStage();
  const bars = useRef(WAVE.map(() => new Animated.Value(0.3))).current;
  useEffect(() => {
    if (paused) return;
    const loops = bars.map((bar, index) => Animated.loop(Animated.sequence([
      Animated.timing(bar, { toValue: 1, duration: 420 + index * 70, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      Animated.timing(bar, { toValue: 0.3, duration: 420 + index * 70, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
    ])));
    loops.forEach((loop) => loop.start());
    return () => loops.forEach((loop) => loop.stop());
  }, [bars, paused]);
  return (
    <View style={[styles.wave, { height, opacity: paused ? 0.35 : 1 }]} pointerEvents="none">
      {bars.map((bar, index) => (
        <Animated.View
          key={index}
          style={{ width: 3, height: height * WAVE[index], borderRadius: 2, backgroundColor: color ?? palette.fg, transform: [{ scaleY: bar }] }}
        />
      ))}
    </View>
  );
};

/**
 * One round control with its label underneath. `active` and `primary` both
 * take the solid fill, so a muted mic or a live loudspeaker reads at a glance
 * without reaching for a colour we do not have.
 */
export const CallControl: React.FC<{
  icon: IconName;
  label: string;
  onPress: () => void;
  active?: boolean;
  primary?: boolean;
  compact?: boolean;
  disabled?: boolean;
  direct?: boolean;
  large?: boolean;
  /** Can't be turned on right now, but still tappable so it can say why. */
  dimmed?: boolean;
}> = ({ icon, label, onPress, active, primary, compact, disabled, direct, large, dimmed }) => {
  const { palette } = useStage();
  const size = large ? 66 : compact ? 52 : 60;
  const solid = (primary || active) && !dimmed;
  const singleLineLabel = compact || !direct;
  return (
    <View style={[styles.controlSlot, { width: size + 8, opacity: disabled ? 0.4 : dimmed ? 0.6 : 1 }]}>
      <Pressable
        onPress={onPress}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ selected: !!active, disabled: !!disabled }}
        style={({ pressed }) => [
          styles.control,
          { width: size, height: size, borderRadius: radius.full },
          pressed && styles.pressed,
        ]}
      >
        <Fill color={solid ? palette.fg : palette.glassStrong} line={direct && !solid ? palette.line : undefined} />
        <View><Icon name={icon} size={compact ? 21 : 24} color={solid ? palette.onFg : palette.fg} /></View>
      </Pressable>
      <Text
        style={[styles.controlLabel, { color: direct ? palette.fg : palette.muted, fontSize: direct ? 13 : 12 }]}
        numberOfLines={singleLineLabel ? 1 : 2}
        adjustsFontSizeToFit={singleLineLabel}
        minimumFontScale={0.8}
      >
        {label}
      </Text>
    </View>
  );
};

/** The floating glass bar the in-call controls sit in. */
export const CallDock: React.FC<{ children: React.ReactNode; compact?: boolean }> = ({ children, compact }) => {
  const { palette } = useStage();
  return (
    <View style={[styles.dock, { gap: compact ? 6 : 14, paddingHorizontal: compact ? 12 : 18, backgroundColor: palette.dock, borderColor: palette.line }]}>
      {children}
    </View>
  );
};

/** A wide pill for the two-way choices: Decline or Accept, Close or Call back. */
export const CallPill: React.FC<{
  icon: IconName;
  label: string;
  onPress: () => void;
  solid?: boolean;
}> = ({ icon, label, onPress, solid }) => {
  const { palette } = useStage();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [
        styles.pill,
        solid ? styles.pillSolid : null,
        pressed && styles.pressed,
      ]}
    >
      <Fill color={solid ? palette.fg : palette.glassStrong} />
      <View><Icon name={icon} size={20} color={solid ? palette.onFg : palette.fg} /></View>
      <Text style={[styles.pillLabel, { color: solid ? palette.onFg : palette.fg }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>
        {label}
      </Text>
    </Pressable>
  );
};

/** The bottom of the stage: the dock or the pills, clear of the home bar. */
export const CallFoot: React.FC<{ children: React.ReactNode; onHeight?: (height: number) => void; overVideo?: boolean; ringing?: boolean }> = ({ children, onHeight, overVideo, ringing }) => {
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const bottomSpace = ringing && height >= 680 ? Math.round(height * 0.08) : 22;
  return (
    <View
      style={[styles.foot, { paddingBottom: Math.max(bottomSpace, insets.bottom + 10) }]}
      onLayout={onHeight ? (e) => onHeight(e.nativeEvent.layout.height) : undefined}
    >
      {overVideo ? (
        <LinearGradient colors={["transparent", "rgba(0,0,0,0.84)"]} style={StyleSheet.absoluteFill} pointerEvents="none" />
      ) : null}
      {children}
    </View>
  );
};

export const CallRow: React.FC<{ children: React.ReactNode; ringing?: boolean }> = ({ children, ringing }) => (
  <View style={[styles.row, ringing && styles.ringingRow]}>{children}</View>
);

const styles = StyleSheet.create({
  stage: {
    flex: 1,
    overflow: "hidden",
  },
  backdrop: {
    position: "absolute",
    top: -60,
    left: -60,
    right: -60,
    bottom: -60,
    opacity: 0.8,
  },
  corner: {
    position: "absolute",
    width: 44,
    height: 44,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
  },
  identity: {
    flex: 1,
    alignItems: "center",
    paddingHorizontal: 24,
    gap: 4,
  },
  kindRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  kindLabel: {
    fontSize: 13,
    fontWeight: "600",
  },
  name: {
    fontSize: 32,
    fontWeight: "800",
    letterSpacing: -0.6,
    maxWidth: "100%",
    textAlign: "center",
  },
  status: {
    fontSize: 15,
    fontVariant: ["tabular-nums"],
  },
  wave: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    marginTop: 26,
  },
  foot: {
    alignItems: "center",
    gap: 14,
    paddingHorizontal: 16,
    paddingTop: 16,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    width: "100%",
    maxWidth: 380,
  },
  ringingRow: { gap: 56 },
  dock: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "center",
    paddingVertical: 14,
    borderRadius: 36,
    borderWidth: 1,
  },
  controlSlot: {
    alignItems: "center",
    gap: 7,
  },
  control: {
    alignItems: "center",
    justifyContent: "center",
  },
  controlLabel: {
    fontSize: 12,
    fontWeight: "600",
    textAlign: "center",
  },
  pill: {
    flex: 1,
    height: 56,
    borderRadius: radius.full,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingHorizontal: 18,
  },
  pillSolid: {
    flex: 1.35,
    height: 62,
  },
  pillLabel: {
    fontSize: 16,
    fontWeight: "700",
    flexShrink: 1,
  },
  pressed: {
    opacity: 0.72,
    transform: [{ scale: 0.96 }],
  },
});

export default CallStage;
