import React from "react";
import { Pressable, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useReducedMotion } from "react-native-reanimated";
import { useAppTheme } from "../../context/ThemeContext";
import { LOGIN_LOOKS, setLoginLook, useLoginLook, type LoginLook } from "../../libs/login-look";
import LoginSign from "../auth/LoginSign";
import LookCarousel from "./LookCarousel";

/**
 * Settings → Appearance → Sign-in screen: how the Riftn logo and slogan move
 * on the sign-in screen. A side-swipe carousel, Flat first; a card builds its
 * look once swiped into view and plays it only while in view. Same choice and
 * key as web's LoginLookSetting.
 */
const LABELS: Record<LoginLook, [string, string]> = {
  tube: ["settings.loginLook.tube", "Tube TV"],
  vhs: ["settings.loginLook.vhs", "VHS tape"],
  led: ["settings.loginLook.led", "LED wall"],
  holo: ["settings.loginLook.holo", "Hologram"],
  neon: ["settings.loginLook.neon", "Neon glow"],
  "3d": ["settings.loginLook.3d", "3D"],
  flat: ["settings.loginLook.flat", "Flat"],
};

/** The sign is drawn at this width, then shrunk to fit the card with room on both sides. */
const SIGN_W = 360;
const CARD_PAD = 6;

export default function LoginLookPicker() {
  const { t } = useTranslation();
  const { theme, isLight } = useAppTheme();
  const still = !!useReducedMotion();
  const current = useLoginLook();
  const text = `${t("loginStack.headlineTop", "You will own everything")}\n${t("loginStack.headlineAccent", "and be happy.")}`;
  return (
    <View>
      <Text className="text-theme-neutrals-500 text-xs mb-3">
        {t("settings.loginLook.desc", "How the Riftn logo and slogan move on the sign-in screen on this device.")}
      </Text>
      <LookCarousel
        count={LOGIN_LOOKS.length}
        activeIndex={Math.max(0, LOGIN_LOOKS.indexOf(current))}
        renderCard={(i, { seen, inView, width }) => {
          const look = LOGIN_LOOKS[i];
          const active = current === look;
          const [key, fallback] = LABELS[look];
          const inner = width - CARD_PAD * 2;
          const scale = Math.min(0.5, (inner - 20) / SIGN_W);
          return (
            <Pressable
              testID={`login-look-${look}`}
              accessibilityRole="radio"
              accessibilityState={{ checked: active }}
              accessibilityLabel={t(key, fallback)}
              onPress={() => setLoginLook(look)}
              style={{
                borderRadius: 16,
                padding: CARD_PAD,
                borderWidth: active ? 2 : 1,
                borderColor: active ? (isLight ? "#0B0B0D" : "#FFFFFF") : isLight ? "rgba(11,11,13,0.12)" : "rgba(255,255,255,0.12)",
                backgroundColor: active ? (isLight ? "rgba(11,11,13,0.06)" : "rgba(255,255,255,0.08)") : "transparent",
              }}
            >
              <View
                pointerEvents="none"
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
                style={{ height: Math.round(240 * scale), borderRadius: 12, overflow: "hidden", backgroundColor: isLight ? "#ECECF0" : "#08080B", alignItems: "center", justifyContent: "center" }}
              >
                {seen ? (
                  <View style={{ width: SIGN_W, paddingTop: 84, transform: [{ scale }] }}>
                    {/* Moves only while it is in view. */}
                    <LoginSign look={look} text={text} theme={theme} isLight={isLight} still={still || !inView} />
                  </View>
                ) : null}
              </View>
              <Text className="text-theme-neutrals-100 text-sm font-medium mt-2 mx-1 mb-1">{t(key, fallback)}</Text>
            </Pressable>
          );
        }}
      />
    </View>
  );
}
