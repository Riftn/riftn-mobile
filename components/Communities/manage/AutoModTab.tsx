/**
 * AutoModTab
 * ==========
 * Owners and admins set the group's buy bot and auto-mod here. The rules run
 * in the database (community_chat_automod trigger and the buy bot tick), so
 * web and the app enforce the same thing and no client can skip them.
 */
import React, { useEffect, useState } from "react";
import { View, Text, ScrollView, TouchableOpacity, TextInput, ActivityIndicator, StyleSheet } from "react-native";
import { useTranslation } from "react-i18next";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import CustomSwitch from "../../ui/CustomSwitch";
import { useWalletAddress } from "../../../hooks/useCommunityAdmin";
import {
  getGroupBotSettings,
  updateGroupBotSettings,
  type GroupBotSettings,
  type GroupBotSettingsPatch,
} from "../../../services/communities.service";
import { communityErrorMessage } from "../../../libs/community-permissions";
import { toastError, toastSuccess } from "../../../libs/toast";
import { IS_APP_STORE_BUILD } from "../../../config/storefront";
import { parseBannedWords } from "../../../libs/group-bots";
import type { Community } from "../../../types/community";

const MIN_USD_OPTIONS = [0, 10, 50, 100, 250, 1000];
const FLOOD_MAX_OPTIONS = [3, 5, 10, 20];
const FLOOD_SECONDS_OPTIONS = [5, 10, 30, 60];


export function AutoModTab({ community }: { community: Community }) {
  const { t } = useTranslation();
  const wallet = useWalletAddress();
  const qc = useQueryClient();
  const key = ["community-bot-settings", community.id, wallet];
  const { data, isLoading, error } = useQuery<GroupBotSettings>({
    queryKey: key,
    queryFn: () => getGroupBotSettings(wallet as string, community.id),
    enabled: !!wallet,
    staleTime: 30_000,
  });
  const [saving, setSaving] = useState<string | null>(null);
  const [words, setWords] = useState("");

  const serverWords = (data?.automod.banned_words ?? []).join("\n");
  useEffect(() => {
    setWords(serverWords);
  }, [serverWords]);

  const save = async (id: string, patch: GroupBotSettingsPatch) => {
    if (!wallet) return;
    setSaving(id);
    try {
      const next = await updateGroupBotSettings(wallet, community.id, patch);
      qc.setQueryData(key, next);
      void qc.invalidateQueries({ queryKey: ["community-admin-log", community.id] });
      toastSuccess(t("communities.automod.saved", { defaultValue: "Saved" }));
    } catch (e) {
      toastError(communityErrorMessage(e, t("communities.automod.saveFailed", { defaultValue: "Couldn't save. Try again." })));
    } finally {
      setSaving(null);
    }
  };

  if (isLoading) {
    return (
      <View className="flex-1 items-center justify-center py-10">
        <ActivityIndicator color="#fff" />
      </View>
    );
  }
  if (error || !data) {
    return (
      <Text className="text-zinc-500 text-sm text-center py-8 px-4">
        {t("communities.automod.noAccess", { defaultValue: "Only the owner and admins can change these settings." })}
      </Text>
    );
  }

  const { automod, buy_bot: buyBot, token } = data;
  const busy = saving !== null;
  const wordsChanged = parseBannedWords(words).join("\n") !== serverWords;

  const Toggle = ({ id, title, hint, value, onChange, disabled }: {
    id: string; title: string; hint?: string; value: boolean; onChange: (v: boolean) => void; disabled?: boolean;
  }) => (
    <View className="flex-row items-center gap-3 py-3 border-b border-white/5">
      <View className="flex-1 pr-2">
        <Text className="text-white text-sm font-medium">{title}</Text>
        {!!hint && <Text className="text-zinc-400 text-xs mt-0.5">{hint}</Text>}
      </View>
      {saving === id && <ActivityIndicator size="small" color="#fff" />}
      <CustomSwitch value={value} onValueChange={onChange} disabled={busy || disabled} />
    </View>
  );

  const Chips = ({ options, value, label, onPick, disabled }: {
    options: number[]; value: number; label: (n: number) => string; onPick: (n: number) => void; disabled?: boolean;
  }) => (
    <View className="flex-row flex-wrap gap-2 mt-2">
      {[...new Set([...options, value])].sort((a, b) => a - b).map((n) => {
        const active = n === value;
        return (
          <TouchableOpacity
            key={n}
            onPress={() => { if (!active) onPick(n); }}
            disabled={busy || disabled}
            style={[styles.chip, active && styles.chipActive, (busy || disabled) && { opacity: 0.5 }]}
          >
            <Text style={[styles.chipLabel, active && styles.chipLabelActive]}>{label(n)}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );

  return (
    <ScrollView
      className="flex-1"
      contentContainerStyle={{ padding: 16, paddingBottom: 48, gap: 12 }}
      keyboardShouldPersistTaps="handled"
    >
      {/* Token trades are not shown in the App Store build (3.1.1). */}
      {!IS_APP_STORE_BUILD && (
        <View style={styles.card}>
          <Text className="text-white text-sm font-medium">{t("communities.buyBot.title", { defaultValue: "Buy bot" })}</Text>
          {!token.address ? (
            <Text className="text-zinc-400 text-xs mt-1">
              {t("communities.buyBot.noToken", { defaultValue: "Link a token from the group header (edit, then Ticker) and every buy shows up in this chat." })}
            </Text>
          ) : !token.supported ? (
            <Text className="text-zinc-400 text-xs mt-1">
              {t("communities.buyBot.unsupported", {
                defaultValue: "${{symbol}} is on a chain or pool type the buy bot does not watch yet. Supported: Base, Ethereum, BNB Chain, Arbitrum, Polygon, Optimism and Avalanche (Uniswap v2/v3-style pools).",
                symbol: token.symbol ?? "",
              })}
            </Text>
          ) : (
            <>
              <Text className="text-zinc-400 text-xs mt-1">
                {t("communities.buyBot.hint", { defaultValue: "Posts every ${{symbol}} buy into this chat, about a minute after it happens.", symbol: token.symbol ?? "" })}
              </Text>
              <Toggle
                id="bb-enabled"
                title={t("communities.buyBot.enabled", { defaultValue: "Post buy alerts" })}
                value={buyBot.enabled}
                onChange={(v) => void save("bb-enabled", { buy_bot: { enabled: v } })}
              />
              <Text className="text-white text-sm font-medium mt-3">{t("communities.buyBot.minUsd", { defaultValue: "Smallest buy to post" })}</Text>
              <Chips
                options={MIN_USD_OPTIONS}
                value={buyBot.min_usd}
                disabled={!buyBot.enabled}
                label={(n) => (n === 0 ? t("communities.buyBot.any", { defaultValue: "Any size" }) : `$${n.toLocaleString("en-US")}`)}
                onPick={(n) => void save("bb-min", { buy_bot: { min_usd: n } })}
              />
            </>
          )}
        </View>
      )}

      <View style={styles.card}>
        <Text className="text-white text-sm font-medium">{t("communities.automod.title", { defaultValue: "Auto-mod" })}</Text>
        <Text className="text-zinc-400 text-xs mt-1">
          {t("communities.automod.hint", { defaultValue: "Blocks a message before anyone sees it and tells the sender why. Owners and admins are never blocked." })}
        </Text>
        <Toggle
          id="am-enabled"
          title={t("communities.automod.enabled", { defaultValue: "Auto-mod on" })}
          value={automod.enabled}
          onChange={(v) => void save("am-enabled", { automod: { enabled: v } })}
        />

        <View style={!automod.enabled && { opacity: 0.5 }} pointerEvents={automod.enabled ? "auto" : "none"}>
          <View className="py-3 border-b border-white/5">
            <Text className="text-white text-sm font-medium">{t("communities.automod.bannedWords", { defaultValue: "Banned words" })}</Text>
            <Text className="text-zinc-400 text-xs mt-0.5">
              {t("communities.automod.bannedWordsHint", { defaultValue: "One per line or comma. Whole words only, and spaced-out spellings like s.c.a.m are caught too." })}
            </Text>
            <TextInput
              value={words}
              onChangeText={setWords}
              multiline
              autoCapitalize="none"
              autoCorrect={false}
              maxLength={20000}
              placeholder={t("communities.automod.bannedWordsPlaceholder", { defaultValue: "scam\nrug pull" })}
              placeholderTextColor="#71717a"
              style={styles.input}
            />
            <View className="flex-row items-center justify-between mt-2">
              <Text className="text-zinc-500 text-xs">
                {t("communities.automod.wordCount", { defaultValue: "{{count}} words", count: parseBannedWords(words).length })}
              </Text>
              <TouchableOpacity
                disabled={!wordsChanged || busy}
                onPress={() => void save("am-words", { automod: { banned_words: parseBannedWords(words) } })}
                style={[styles.chip, styles.chipActive, (!wordsChanged || busy) && { opacity: 0.4 }]}
              >
                {saving === "am-words"
                  ? <ActivityIndicator size="small" color="#000" />
                  : <Text style={[styles.chipLabel, styles.chipLabelActive]}>{t("communities.automod.saveWords", { defaultValue: "Save words" })}</Text>}
              </TouchableOpacity>
            </View>
          </View>
          <Toggle
            id="am-links"
            title={t("communities.automod.blockLinks", { defaultValue: "Block links" })}
            hint={t("communities.automod.blockLinksHint", { defaultValue: "Off-site links and Telegram/Discord invites. Riftn links still work." })}
            value={automod.block_links}
            onChange={(v) => void save("am-links", { automod: { block_links: v } })}
          />
          <Toggle
            id="am-repeats"
            title={t("communities.automod.repeats", { defaultValue: "Block repeats" })}
            hint={t("communities.automod.repeatsHint", { defaultValue: "Stops someone sending the same line again within 10 minutes." })}
            value={automod.block_repeats}
            onChange={(v) => void save("am-repeats", { automod: { block_repeats: v } })}
          />
          <Toggle
            id="am-flood"
            title={t("communities.automod.flood", { defaultValue: "Anti-flood" })}
            hint={t("communities.automod.floodHint", {
              defaultValue: "At most {{max}} messages every {{seconds}}s per person.",
              max: automod.flood_max,
              seconds: automod.flood_seconds,
            })}
            value={automod.flood_enabled}
            onChange={(v) => void save("am-flood", { automod: { flood_enabled: v } })}
          />
          {automod.flood_enabled && (
            <View className="pt-1">
              <Chips
                options={FLOOD_MAX_OPTIONS}
                value={automod.flood_max}
                label={(n) => t("communities.automod.floodMax", { defaultValue: "{{count}} messages", count: n })}
                onPick={(n) => void save("am-flood", { automod: { flood_max: n } })}
              />
              <Chips
                options={FLOOD_SECONDS_OPTIONS}
                value={automod.flood_seconds}
                label={(n) => (n >= 60 ? `${n / 60} min` : `${n}s`)}
                onPick={(n) => void save("am-flood", { automod: { flood_seconds: n } })}
              />
            </View>
          )}
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.1)",
    backgroundColor: "rgba(255,255,255,0.04)",
    padding: 14,
  },
  input: {
    marginTop: 8,
    minHeight: 96,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.15)",
    backgroundColor: "rgba(255,255,255,0.04)",
    color: "#fff",
    fontSize: 14,
    padding: 10,
    textAlignVertical: "top",
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: "rgba(255,255,255,0.08)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.1)",
  },
  chipActive: { backgroundColor: "#ffffff", borderColor: "#ffffff" },
  chipLabel: { color: "#a1a1aa", fontSize: 13, fontWeight: "600" },
  chipLabelActive: { color: "#000000" },
});
