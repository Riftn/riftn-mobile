import React, { useState } from "react";
import { View, Text, TouchableOpacity, ActivityIndicator, Linking } from "react-native";
import { useTranslation } from "react-i18next";
import Slider from "@react-native-community/slider";
import GlassModal from "../ui/GlassModal";
import CustomSwitch from "../ui/CustomSwitch";
import Icon from "../ui/Icon";
import WebPurchaseLink from "../common/WebPurchaseLink";
import { DIGITAL_PURCHASES_ENABLED } from "../../config/storefront";
import { useAppTheme } from "../../context/ThemeContext";
import { useSelectedCrossPosts, selectCrossPostAccount } from "../../libs/crosspost-store";
import { MULTIPOST_PLATFORMS, PLATFORM_NAMES, type SocialAccount } from "../../services/multipost.service";
import {
  BUNDLE_STOPS, CREDIT_PRICE_USD, DEFAULT_PLATFORM_CREDITS, bundleDiscount, bundlePriceUsd, creditsFor,
} from "../../libs/social-pricing";
import { platformIcon, useMultipostSetup } from "../Settings/MultiPostPanel";

const FILL = "rgba(127,127,127,0.12)";

interface MultiPostSheetViewProps {
  visible: boolean;
  onClose: () => void;
  accounts: SocialAccount[];
  balance: number;
  loading?: boolean;
  failed?: boolean;
  selected: readonly string[];
  onToggle: (accountId: string) => void;
  connecting: string | null;
  onConnect: (platform: string) => void;
  buying: boolean;
  onBuy: (credits: number) => void;
}

/**
 * Multi-posting set up from inside the composer: connect accounts, switch them
 * on for this post and top up credits, then Done drops back onto the post
 * exactly as it was. Settings keeps the same controls as a page.
 */
const MultiPostSheet: React.FC<{ visible: boolean; onClose: () => void }> = ({ visible, onClose }) => {
  const { wallet, status, buying, connecting, handleConnect, handleBuy } = useMultipostSetup({ inPost: true });
  const selected = useSelectedCrossPosts(wallet, status.data?.accounts);
  if (!wallet) return null;
  return (
    <MultiPostSheetView
      visible={visible}
      onClose={onClose}
      accounts={status.data?.accounts ?? []}
      balance={status.data?.credits ?? 0}
      loading={status.isLoading}
      failed={status.isError}
      selected={selected}
      onToggle={id => selectCrossPostAccount(wallet, id, !selected.includes(id))}
      connecting={connecting}
      onConnect={handleConnect}
      buying={buying}
      onBuy={handleBuy}
    />
  );
};

export const MultiPostSheetView: React.FC<MultiPostSheetViewProps> = ({
  visible, onClose, accounts, balance, loading, failed, selected, onToggle, connecting, onConnect, buying, onBuy,
}) => {
  const { t } = useTranslation();
  const { colors } = useAppTheme();
  const [stopIndex, setStopIndex] = useState(3);
  const connected = new Set(accounts.filter((a) => !a.pending).map((a) => a.platform));
  const toConnect = MULTIPOST_PLATFORMS.filter((p) => !connected.has(p));
  const credits = BUNDLE_STOPS[stopIndex];
  const discount = bundleDiscount(credits);
  const total = bundlePriceUsd(credits);
  const using = accounts.filter((a) => !a.pending && selected.includes(a.id)).reduce((sum, a) => sum + creditsFor(a.platform), 0);

  const label = (text: string, right?: string) => (
    <View className="flex-row items-center justify-between mb-2 mt-5">
      <Text className="text-xs font-medium uppercase" style={{ color: colors.mutedForeground, letterSpacing: 0.6 }}>{text}</Text>
      {right ? <Text className="text-xs" style={{ color: colors.mutedForeground }}>{right}</Text> : null}
    </View>
  );

  return (
    <GlassModal visible={visible} onClose={onClose} presentation="bottom" scrollable maxHeight="88%">
      <View className="px-4 pt-2 pb-4">
        <View className="flex-row items-center" style={{ gap: 8 }}>
          <Icon name="Share2" size={18} color={colors.foreground} />
          <Text className="text-base font-semibold" style={{ color: colors.foreground }}>{t("multiPost.title")}</Text>
        </View>
        <Text className="text-sm mt-1" style={{ color: colors.mutedForeground }}>{t("multiPost.intro")}</Text>

        {label(t("multiPost.alsoPostTo"), using > 0 ? t("multiPost.creditsUsed", { count: using, balance }) : undefined)}
        {loading ? (
          <ActivityIndicator color={colors.foreground} className="my-3" />
        ) : failed ? (
          <Text className="text-sm text-red-400">{t("multiPost.loadFailed")}</Text>
        ) : accounts.length === 0 ? (
          <Text className="text-sm" style={{ color: colors.mutedForeground }}>{t("multiPost.noAccounts")}</Text>
        ) : (
          <View className="rounded-2xl overflow-hidden" style={{ backgroundColor: FILL, borderWidth: 1, borderColor: colors.border }}>
            {accounts.map((a, i) => {
              const name = PLATFORM_NAMES[a.platform] ?? a.platform;
              return (
                <View key={a.id} className="flex-row items-center px-4 py-3" style={{ gap: 12, borderTopWidth: i ? 1 : 0, borderTopColor: colors.border }}>
                  <View className="w-8 h-8 rounded-xl items-center justify-center" style={{ backgroundColor: FILL }}>
                    <Icon name={platformIcon(a.platform)} size={16} color={colors.foreground} />
                  </View>
                  <View className="flex-1">
                    <Text className="text-sm" style={{ color: colors.foreground }} numberOfLines={1}>{name}</Text>
                    <Text className="text-xs" style={{ color: colors.mutedForeground }} numberOfLines={1}>
                      {a.pending ? t("multiPost.pendingApproval") : a.username ? `@${a.username.replace(/^@/, "")}` : t("multiPost.connectedLabel")}
                    </Text>
                  </View>
                  {a.pending ? (
                    a.approvalUrl ? (
                      <TouchableOpacity onPress={() => Linking.openURL(a.approvalUrl!)} accessibilityRole="button"
                        className="px-3 py-1 rounded-full" style={{ borderWidth: 1, borderColor: colors.border }}>
                        <Text className="text-xs" style={{ color: colors.foreground }}>{t("multiPost.approve")}</Text>
                      </TouchableOpacity>
                    ) : null
                  ) : (
                    <CustomSwitch
                      value={selected.includes(a.id)}
                      onValueChange={() => onToggle(a.id)}
                      accessibilityLabel={`${t("multiPost.alsoPostTo")} ${name}`}
                    />
                  )}
                </View>
              );
            })}
          </View>
        )}

        {label(t("multiPost.connectMore"))}
        <View className="flex-row flex-wrap" style={{ gap: 8 }}>
          {toConnect.map((platform) => (
            <TouchableOpacity
              key={platform}
              onPress={() => onConnect(platform)}
              disabled={connecting !== null}
              accessibilityRole="button"
              accessibilityLabel={`${t("multiPost.connect")} ${PLATFORM_NAMES[platform]}`}
              className="flex-row items-center px-3 py-2.5 rounded-xl"
              style={{ width: "48.5%", gap: 8, backgroundColor: FILL, borderWidth: 1, borderColor: colors.border, opacity: connecting && connecting !== platform ? 0.5 : 1 }}
            >
              <Icon name={platformIcon(platform)} size={14} color={colors.foreground} />
              <Text className="flex-1 text-sm" style={{ color: colors.foreground }} numberOfLines={1}>{PLATFORM_NAMES[platform]}</Text>
              {connecting === platform
                ? <ActivityIndicator size="small" color={colors.foreground} />
                : <Text className="text-xs" style={{ color: colors.mutedForeground }}>{t("multiPost.connect")}</Text>}
            </TouchableOpacity>
          ))}
        </View>
        <Text className="text-xs mt-2" style={{ color: colors.mutedForeground }}>{t("multiPost.platformNotes")}</Text>

        {label(t("multiPost.creditsHeading"))}
        <View className="rounded-2xl p-4" style={{ backgroundColor: FILL, borderWidth: 1, borderColor: colors.border }}>
          <View className="flex-row items-center mb-3" style={{ gap: 8 }}>
            <Icon name="Coins" size={16} color={colors.foreground} />
            <Text className="text-sm font-medium" style={{ color: colors.foreground }}>{t("multiPost.credits", { count: balance })}</Text>
          </View>
          {/* Buying credits is a purchase the App Store build leaves out (3.1.1). */}
          {DIGITAL_PURCHASES_ENABLED ? (
            <>
              <View className="flex-row justify-between items-baseline">
                <Text className="text-sm" style={{ color: colors.foreground }}>{t("multiPost.topUpTitle")}</Text>
                <Text className="text-emerald-400 text-sm">
                  {discount > 0 ? t("multiPost.discount", { percent: Math.round(discount * 100) }) : t("multiPost.noDiscount")}
                </Text>
              </View>
              <Slider
                minimumValue={0}
                maximumValue={BUNDLE_STOPS.length - 1}
                step={1}
                value={stopIndex}
                onValueChange={(v) => setStopIndex(Math.round(v))}
                minimumTrackTintColor={colors.foreground}
                maximumTrackTintColor="rgba(127,127,127,0.3)"
                thumbTintColor={colors.foreground}
                accessibilityLabel={t("multiPost.topUpTitle")}
              />
              <View className="flex-row justify-between">
                {BUNDLE_STOPS.map((s) => (
                  <Text key={s} style={{ fontSize: 10, color: colors.mutedForeground }}>{s >= 1000 ? `${s / 1000}k` : s}</Text>
                ))}
              </View>
              <View className="flex-row items-center justify-between mt-4">
                <View className="flex-1 mr-3">
                  <Text className="font-semibold" style={{ color: colors.foreground }}>{t("multiPost.topUpCredits", { count: credits })}</Text>
                  <Text className="text-xs mt-0.5" style={{ color: colors.mutedForeground }}>
                    {t("multiPost.total", { usd: total.toFixed(2) })} · {t("multiPost.perCredit", { price: (total / credits).toFixed(3) })}
                  </Text>
                </View>
                <TouchableOpacity
                  onPress={() => onBuy(credits)}
                  disabled={buying}
                  className="px-4 py-2.5 rounded-xl"
                  style={{ borderWidth: 1, borderColor: colors.border, backgroundColor: FILL, opacity: buying ? 0.6 : 1 }}
                  accessibilityRole="button"
                >
                  <Text className="font-semibold text-sm" style={{ color: colors.foreground }}>{buying ? t("multiPost.buying") : t("multiPost.buy")}</Text>
                </TouchableOpacity>
              </View>
            </>
          ) : (
            <WebPurchaseLink path="/app/settings?tab=multipost" />
          )}
          <Text className="text-xs mt-3" style={{ color: colors.mutedForeground }}>
            {`${t("multiPost.creditRules", { x: creditsFor("twitter"), farcaster: creditsFor("farcaster"), other: DEFAULT_PLATFORM_CREDITS })} ${t("multiPost.payAsYouGoCredits", { price: CREDIT_PRICE_USD.toFixed(2) })}`}
          </Text>
        </View>

        <TouchableOpacity
          onPress={onClose}
          accessibilityRole="button"
          className="mt-5 h-11 rounded-xl items-center justify-center"
          style={{ backgroundColor: FILL, borderWidth: 1, borderColor: colors.border }}
        >
          <Text className="font-semibold text-sm" style={{ color: colors.foreground }}>{t("common.done")}</Text>
        </TouchableOpacity>
      </View>
    </GlassModal>
  );
};

export default MultiPostSheet;
