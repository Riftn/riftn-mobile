import React from "react";
import { Pressable, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useReducedMotion } from "react-native-reanimated";
import { useAppTheme } from "../../context/ThemeContext";
import { LOGIN_LOOKS, setLoginLook, useLoginLook, type LoginLook } from "../../libs/login-look";
import LoginSign from "../auth/LoginSign";

/**
 * Settings → Appearance → Sign-in screen: how the Riftn logo and slogan move
 * on the sign-in screen. Each card plays its look live, shrunk. Same choice
 * and key as web's LoginLookSetting.
 */
const LABELS: Record<LoginLook, [string, string]> = {
  tube: ["settings.loginLook.tube", "Tube TV"],
  vhs: ["settings.loginLook.vhs", "VHS tape"],
  led: ["settings.loginLook.led", "LED wall"],
  holo: ["settings.loginLook.holo", "Hologram"],
};

const SCALE = 0.4;
const SIGN_W = 360;
const CARD_H = 96;

export default function LoginLookPicker() {
  const { t } = useTranslation();
  const { theme, isLight } = useAppTheme();
  const still = !!useReducedMotion();
  const current = useLoginLook();
  const text = `${t("loginStack.headlineTop", "You will own everything")}\n${t("loginStack.headlineAccent", "and be happy.")}`;
  return (
    <View className="px-4" accessibilityRole="radiogroup">
      <Text className="text-theme-neutrals-500 text-xs mb-3">
        {t("settings.loginLook.desc", "How the Riftn logo and slogan move on the sign-in screen on this device.")}
      </Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
        {LOGIN_LOOKS.map((look) => {
          const active = current === look;
          const [key, fallback] = LABELS[look];
          return (
            <Pressable
              key={look}
              testID={`login-look-${look}`}
              accessibilityRole="radio"
              accessibilityState={{ checked: active }}
              accessibilityLabel={t(key, fallback)}
              onPress={() => setLoginLook(look)}
              style={{
                width: "47%",
                flexGrow: 1,
                borderRadius: 16,
                padding: 6,
                borderWidth: active ? 2 : 1,
                borderColor: active ? (isLight ? "#0B0B0D" : "#FFFFFF") : isLight ? "rgba(11,11,13,0.12)" : "rgba(255,255,255,0.12)",
                backgroundColor: active ? (isLight ? "rgba(11,11,13,0.06)" : "rgba(255,255,255,0.08)") : "transparent",
              }}
            >
              <View
                pointerEvents="none"
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
                style={{ height: CARD_H, borderRadius: 12, overflow: "hidden", backgroundColor: isLight ? "#ECECF0" : "#08080B", alignItems: "center", justifyContent: "center" }}
              >
                <View style={{ width: SIGN_W, paddingTop: 84, transform: [{ scale: SCALE }] }}>
                  <LoginSign look={look} text={text} theme={theme} isLight={isLight} still={still} />
                </View>
              </View>
              <Text className="text-theme-neutrals-100 text-sm font-medium mt-2 mx-1 mb-1">{t(key, fallback)}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
