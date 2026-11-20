import React, { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useReducedMotion } from "react-native-reanimated";
import { useAppTheme } from "../../context/ThemeContext";
import { useUser } from "../../context/AuthContext";
import { getAvatarUrl } from "../../libs/misc";
import { ARRIVAL_INTRO_MS, AVAILABLE_ARRIVAL_LOOKS, setArrivalLook, useArrivalLook, type ArrivalLook } from "../../libs/arrival-look";
import { ArrivalMarks, isConceptLook } from "../auth/SignInHandoff";

/**
 * Settings → Appearance → After you sign in: what plays between logging in
 * and the app (Trace, Tune in, the Rift, Deck or Glass drop). Each card plays its
 * arrival with your own picture, shrunk. Same choice and key as web's
 * ArrivalLookSetting.
 */
const LABELS: Record<ArrivalLook, [string, string]> = {
  trace: ["settings.arrivalLook.trace", "Trace"],
  tune: ["settings.arrivalLook.tune", "Tune in"],
  rift: ["settings.arrivalLook.rift", "Rift"],
  deck: ["settings.arrivalLook.deck", "Deck"],
  glass: ["settings.arrivalLook.glass", "Glass drop"],
};

const SCALE = 0.5;
const CARD_H = 110;
const WAIT_MS = 900;
/** The drawn arrivals loop a little longer before they open. */
const CONCEPT_WAIT_MS = 1500;
const SHOW_MS = 1600;

/** The picked one plays through on a loop; the others wait on their marks. */
function Preview({ look, picture, name, playing, still }: { look: ArrivalLook; picture: string | null; name: string; playing: boolean; still: boolean }) {
  const [round, setRound] = useState(0);
  const [opened, setOpened] = useState(false);
  useEffect(() => {
    setOpened(false);
    if (still || !playing) return;
    const wait = ARRIVAL_INTRO_MS[look] + (isConceptLook(look) ? CONCEPT_WAIT_MS : WAIT_MS);
    const open = setTimeout(() => setOpened(true), wait);
    const again = setTimeout(() => { setOpened(false); setRound((r) => r + 1); }, wait + SHOW_MS);
    return () => { clearTimeout(open); clearTimeout(again); };
  }, [look, round, still, playing]);
  return (
    <View style={{ transform: [{ scale: SCALE }] }}>
      <ArrivalMarks key={`${round}-${playing}`} look={look} picture={picture} name={name} opened={still || opened} instantOpen={still} skipIntro={!playing} />
    </View>
  );
}

export default function ArrivalLookPicker() {
  const { t } = useTranslation();
  const { isLight } = useAppTheme();
  const still = !!useReducedMotion();
  const current = useArrivalLook();
  const user = useUser();
  const picture = user?.avatarImageUrl ? getAvatarUrl(user.avatarImageUrl, 120) : null;
  const name = user?.displayName || user?.username || "R";
  return (
    <View className="px-4" accessibilityRole="radiogroup">
      <Text className="text-theme-neutrals-500 text-xs mb-3">
        {t("settings.arrivalLook.desc", "What plays while your account loads, before your picture lands on the page. On this device.")}
      </Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
        {AVAILABLE_ARRIVAL_LOOKS.map((look) => {
          const active = current === look;
          const [key, fallback] = LABELS[look];
          return (
            <Pressable
              key={look}
              testID={`arrival-look-${look}`}
              accessibilityRole="radio"
              accessibilityState={{ checked: active }}
              accessibilityLabel={t(key, fallback)}
              onPress={() => setArrivalLook(look)}
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
                className="dark-surface"
                style={{ height: CARD_H, borderRadius: 12, overflow: "hidden", backgroundColor: "#060709", alignItems: "center", justifyContent: "center" }}
              >
                <Preview look={look} picture={picture} name={name} playing={active} still={still} />
              </View>
              <Text className="text-theme-neutrals-100 text-sm font-medium mt-2 mx-1 mb-1">{t(key, fallback)}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
