/**
 * "Enjoying Riftn?" — the Home review card
 * =========================================
 * A slim card above the tab bar that asks people who keep coming back to rate
 * the app, and opens the store's review page when they tap Rate.
 *
 * When it shows lives in libs/review-prompt (shouldShowReviewCard): after a few
 * days of use, never more than once a month, and never again after Rate or a
 * second "Not now". Same spot and shape as the Getting Started card, and it
 * stays away while that one is up so the two never stack.
 */
import React, { useState } from "react";
import { Platform, Pressable, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import Icon from "../ui/Icon";
import { useAppTheme } from "../../context/ThemeContext";
import { useAuthState } from "../../context/AuthContext";
import { useOnboarding } from "../../context/OnboardingChecklistContext";
import { useActiveScreenEffect } from "../../hooks/useScreenActivity";
import { TAB_BAR_CONTENT_INSET } from "../../navigation/tabBarLayout";
import { dismissReviewCard, noteHomeVisitDay, openStoreReviewPage, shouldShowReviewCard } from "../../libs/review-prompt";

// Let Home settle (feed, stories, any launch sheet) before anything slides in.
const SHOW_AFTER_MS = 6000;

const ReviewPromptCard: React.FC = () => {
  const { t } = useTranslation();
  const { colors } = useAppTheme();
  const { isSignedIn } = useAuthState();
  const onboarding = useOnboarding();
  const onboardingUp = !!onboarding && (onboarding.loading || onboarding.shouldOffer || (onboarding.active && !!onboarding.progress));
  const [visible, setVisible] = useState(false);

  useActiveScreenEffect(() => {
    if (!isSignedIn) return;
    const visit = noteHomeVisitDay();
    if (onboardingUp) return;

    let cancelled = false;
    const timer = setTimeout(() => {
      void visit.then((days) => shouldShowReviewCard(days)).then((show) => {
        if (!cancelled) setVisible(show);
      });
    }, SHOW_AFTER_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [isSignedIn, onboardingUp]);

  if (!visible || !isSignedIn || onboardingUp) return null;

  const storeName = Platform.OS === "ios" ? t("reviewCard.appStore", "App Store") : t("reviewCard.googlePlay", "Google Play");

  return (
    <View
      pointerEvents="box-none"
      style={{ position: "absolute", left: 12, right: 12, bottom: TAB_BAR_CONTENT_INSET + 8 }}
    >
      <View
        className="flex-row items-center rounded-2xl bg-theme-neutrals-800 border border-white/10 px-4 py-3"
        style={{ gap: 12 }}
        accessibilityRole="summary"
      >
        <Icon name="Star" size={20} color={colors.accent} />
        <View className="flex-1">
          <Text className="text-white text-sm font-semibold">{t("reviewCard.title", "Enjoying Riftn?")}</Text>
          <Text className="text-theme-neutrals-400 text-xs mt-0.5">
            {t("reviewCard.body", "A quick rating on {{store}} helps more people find us.", { store: storeName })}
          </Text>
        </View>
        <Pressable
          onPress={() => {
            setVisible(false);
            void openStoreReviewPage();
          }}
          accessibilityRole="button"
          accessibilityLabel={t("reviewCard.rate", "Rate")}
          hitSlop={6}
        >
          {/* The fill sits on an inner View: Pressable fills get repainted by the theme pass. */}
          <View className="rounded-xl px-3 py-1.5" style={{ backgroundColor: "#FFFFFF" }}>
            <Text className="text-sm font-semibold" style={{ color: "#09090B" }}>
              {t("reviewCard.rate", "Rate")}
            </Text>
          </View>
        </Pressable>
        <Pressable
          onPress={() => {
            setVisible(false);
            void dismissReviewCard();
          }}
          accessibilityRole="button"
          accessibilityLabel={t("reviewCard.notNow", "Not now")}
          hitSlop={10}
        >
          <Icon name="X" size={16} color={colors.neutrals[500]} />
        </Pressable>
      </View>
    </View>
  );
};

export default ReviewPromptCard;
