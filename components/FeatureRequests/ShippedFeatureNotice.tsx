/**
 * "Your feedback shipped!"
 * ========================
 * Native port of web's ShippedFeatureNotificationModal. When one of the
 * signed-in user's feature requests or bug reports is marked shipped, this
 * thanks them once, on their next app open, and links to the request. Seen
 * state lives in `feature_shipped_notifications`, shared with web, so the
 * notice shows once per item across both clients.
 */
import React, { useEffect, useState } from "react";
import { ScrollView, Text, TouchableOpacity, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { useTranslation as _useCopy } from "react-i18next";
import GlassModal from "../ui/GlassModal";
import Icon from "../ui/Icon";
import { useAuthState } from "../../context/AuthContext";
import { useAppTheme, useThemeRootStyle } from "../../context/ThemeContext";
import { ScreenNames } from "../../navigation/ScreenNames";
import {
  CATEGORY_LABELS,
  useMarkShippedNotified,
  useUnnotifiedShippedFeatures,
} from "../../hooks/useFeatureRequests";
import { SHIPPED_POINTS } from "../../libs/top-builders";

import { formatCount } from '../../libs/format-count';
/** Lets launch, onboarding and the username step settle before it appears. */
const SHOW_DELAY_MS = 2500;

export default function ShippedFeatureNotice() {
  const { t: _copy } = _useCopy();
  const navigation = useNavigation<any>();
  const { isSignedIn, needsUsername } = useAuthState();
  const { pageColors, isLight } = useAppTheme();
  // System Light colours are written as hsla() so its colour pass leaves
  // them alone: a hex ink was flipped to white, and the className whites
  // vanished on the white card (title and request rows were white on white).
  const ink = isLight ? "hsla(240,6%,10%,1)" : pageColors.foreground;
  const muted = isLight ? "hsla(240,4%,46%,1)" : pageColors.mutedForeground;
  const tileFill = isLight ? "hsla(0,0%,0%,0.05)" : "rgba(255,255,255,0.05)";
  const tileBorder = isLight ? "hsla(0,0%,0%,0.10)" : "rgba(255,255,255,0.10)";
  const chipFill = isLight ? "hsla(0,0%,0%,0.07)" : "rgba(255,255,255,0.10)";
  const onInk = isLight ? "hsla(0,0%,100%,1)" : "#0B0B0D";
  // A Modal draws outside the root view, so the theme's colour variables are
  // put back here or System Light would paint white text on its white card.
  const themeVars = useThemeRootStyle();
  const { data: items } = useUnnotifiedShippedFeatures();
  const markNotified = useMarkShippedNotified();
  const [show, setShow] = useState(false);

  const hasItems = !!items && items.length > 0;

  useEffect(() => {
    if (!isSignedIn || needsUsername || !hasItems) {
      setShow(false);
      return;
    }
    const timer = setTimeout(() => setShow(true), SHOW_DELAY_MS);
    return () => clearTimeout(timer);
  }, [isSignedIn, needsUsername, hasItems]);

  if (!items || items.length === 0) return null;

  const isPlural = items.length > 1;
  const totalPoints = items.length * SHIPPED_POINTS;

  const dismiss = () => {
    setShow(false);
    markNotified.mutate(items.map((f) => f.id));
  };

  const open = (requestId?: string) => {
    dismiss();
    navigation.navigate(ScreenNames.FeatureRequests, requestId ? { requestId } : { tab: "shipped" });
  };

  return (
    <GlassModal visible={show} onClose={dismiss} presentation="center" blurIntensity={40}>
      <View className="px-5 pt-5 pb-5" style={themeVars}>
        <View className="flex-row items-start justify-between">
          <View className="w-10 h-10 rounded-xl items-center justify-center" style={{ backgroundColor: chipFill }}>
            <Icon name="CircleCheckBig" size={20} color={ink} />
          </View>
          <TouchableOpacity
            onPress={dismiss}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel={_copy("copy.bdd4f5015e96", { defaultValue: "Close shipped request notification" })}
          >
            <Icon name="X" size={20} color={muted} />
          </TouchableOpacity>
        </View>

        <Text className="font-bold text-lg mt-3 mb-1.5" style={{ color: ink }}>
          {_copy("copy.8f3dc69e83c4", { defaultValue: "Your feedback shipped!" })}
        </Text>
        <Text className="text-sm leading-5 mb-4" style={{ color: muted }}>
          {isPlural
            ? _copy("copy.905392fbed15", { defaultValue: "Thanks for helping make Riftn better — {{value1}} things you asked for are now live:", value1: items.length })
            : _copy("copy.2971f9103f78", { defaultValue: "Thanks for helping make Riftn better — something you asked for is now live:" })}
        </Text>

        <View
          className="flex-row items-center rounded-xl border px-3.5 py-3 mb-4"
          style={{ gap: 12, backgroundColor: tileFill, borderColor: tileBorder }}
        >
          <Text className="text-2xl font-bold" style={{ color: ink, fontVariant: ["tabular-nums"] }}>+{formatCount(totalPoints)}</Text>
          <View className="flex-1">
            <Text className="text-sm font-semibold" style={{ color: ink }}>
              {_copy("copy.f0c8bb34335b", { defaultValue: "You earned +{{value1}} points", value1: totalPoints })}
            </Text>
            <Text className="text-xs leading-4 mt-0.5" style={{ color: muted }}>
              {_copy("copy.0fbe06b679a8", { defaultValue: "{{value1}} points for each shipped request, added to your Top builders score.", value1: SHIPPED_POINTS })}
            </Text>
          </View>
        </View>

        <ScrollView style={{ maxHeight: 192 }} contentContainerStyle={{ gap: 8 }} className="mb-5">
          {items.map((item) => (
            <TouchableOpacity
              key={item.id}
              onPress={() => open(item.id)}
              activeOpacity={0.7}
              accessibilityRole="button"
              className="flex-row items-center rounded-xl border px-3 py-2.5"
              style={{ gap: 8, backgroundColor: tileFill, borderColor: tileBorder }}
            >
              <Text className="text-sm font-medium flex-1" numberOfLines={2} style={{ color: ink }}>{item.title}</Text>
              <Text className="text-[10px] font-medium px-2 py-0.5 rounded-lg overflow-hidden" style={{ backgroundColor: chipFill, color: muted }}>
                {CATEGORY_LABELS[item.category] ?? CATEGORY_LABELS.other}
              </Text>
              <Text className="text-[11px] font-semibold" style={{ color: ink, fontVariant: ["tabular-nums"] }}>
                {_copy("copy.7f78bdc0762d", { defaultValue: "+{{value1}} pts", value1: SHIPPED_POINTS })}
              </Text>
              <Icon name="ArrowUpRight" size={16} color={muted} />
            </TouchableOpacity>
          ))}
        </ScrollView>

        <View className="flex-row items-center" style={{ gap: 8 }}>
          <TouchableOpacity
            onPress={() => open(isPlural ? undefined : items[0].id)}
            activeOpacity={0.8}
            accessibilityRole="button"
            className="flex-1 px-4 py-2.5 rounded-xl items-center"
            style={{ backgroundColor: ink }}
          >
            <Text className="text-sm font-semibold" style={{ color: onInk }}>
              {isPlural
                ? _copy("copy.20d4214b9d4b", { defaultValue: "View shipped requests" })
                : _copy("copy.da4c7c208cf4", { defaultValue: "Check it out" })}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={dismiss} activeOpacity={0.7} accessibilityRole="button" className="px-4 py-2.5">
            <Text className="text-sm font-medium" style={{ color: muted }}>
              {_copy("copy.1aa7b1c1d5fb", { defaultValue: "Thanks!" })}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </GlassModal>
  );
}
