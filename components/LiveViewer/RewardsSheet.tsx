/**
 * The creator's rewards, paid for with the points a viewer earned watching
 * them. Tap a reward to pick it; one that asks for a message opens a box;
 * Redeem spends the points and puts a line in the stream's chat. The app side
 * of web's RewardsSheet.
 */
import React, { useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import GlassModal from "../ui/GlassModal";
import { toastError, toastSuccess } from "../../libs/toast";
import { PointsIcon } from "./PointsIcon";
import {
  redeemErrorKey,
  redeemReward,
  REWARD_TEXT_MAX,
  type LiveReward,
  type PointsBalance,
} from "../../services/live-rewards.service";

interface Props {
  visible: boolean;
  onClose: () => void;
  streamId: string;
  balance: PointsBalance;
  rewards: LiveReward[];
  loading?: boolean;
}

export default function RewardsSheet({ visible, onClose, streamId, balance, rewards, loading }: Props) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [picked, setPicked] = useState<string | null>(null);
  const [text, setText] = useState("");
  const fmt = (n: number) => n.toLocaleString();

  useEffect(() => {
    if (!visible) {
      setPicked(null);
      setText("");
    }
  }, [visible]);

  const reward = rewards.find((r) => r.id === picked) ?? null;
  const redeem = useMutation({
    mutationFn: () => redeemReward(streamId, reward!.id, reward!.needsText ? text.trim() : undefined),
    onSuccess: (res) => {
      qc.setQueryData(["live-points", streamId], (prev: PointsBalance | undefined) =>
        prev ? { ...prev, balance: res.balance, spent: prev.spent + (reward?.cost ?? 0) } : prev,
      );
      void qc.invalidateQueries({ queryKey: ["live-points", streamId] });
      toastSuccess(t("livePoints.redeemed", { title: reward?.title ?? "" }));
      onClose();
    },
    onError: (err) => toastError(null, t(redeemErrorKey(err))),
  });

  const canAfford = (r: LiveReward) => balance.balance >= r.cost;
  const ready = !!reward && canAfford(reward) && (!reward.needsText || !!text.trim()) && !redeem.isPending;

  return (
    <GlassModal scrollable visible={visible} onClose={onClose} presentation="bottom" maxHeight="85%">
      <View className="px-4 pt-2 pb-6" style={{ gap: 14 }} testID="live-rewards-sheet">
        <View className="flex-row items-center justify-center py-2" style={{ gap: 8 }}>
          <PointsIcon size={18} color="#E4E4E7" />
          <Text className="text-theme-neutrals-100 text-lg font-bold">{t("livePoints.title")}</Text>
        </View>

        <View className="flex-row items-center justify-between rounded-xl bg-theme-neutrals-800 px-3.5 py-3">
          <Text className="text-theme-neutrals-400 text-sm">{t("livePoints.yourPoints")}</Text>
          <View className="flex-row items-center" style={{ gap: 6 }}>
            <PointsIcon size={16} color="#F4F4F5" />
            <Text className="text-theme-neutrals-100 text-base font-semibold">{fmt(balance.balance)}</Text>
          </View>
        </View>

        {loading ? (
          <View className="py-6 items-center"><ActivityIndicator color="#A1A1AA" /></View>
        ) : rewards.length === 0 ? (
          <Text className="text-theme-neutrals-400 text-sm text-center py-4">{t("livePoints.noRewards")}</Text>
        ) : (
          <View className="flex-row flex-wrap" style={{ gap: 8 }}>
            {rewards.map((r) => {
              const selected = r.id === picked;
              return (
                <TouchableOpacity
                  key={r.id}
                  onPress={() => setPicked(selected ? null : r.id)}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  style={[styles.tile, { opacity: canAfford(r) ? 1 : 0.6 }]}
                >
                  {/* Fills on an inner View: a Touchable's own fill is repainted as the theme's control material. */}
                  <View pointerEvents="none" className="bg-theme-neutrals-800" style={[StyleSheet.absoluteFill, { borderRadius: 12 }]} />
                  {selected ? <View pointerEvents="none" style={styles.ring} /> : null}
                  <Text className="text-theme-neutrals-100 text-sm font-medium" numberOfLines={2}>{r.title}</Text>
                  <View className="flex-row items-center" style={{ gap: 4 }}>
                    <PointsIcon size={13} color="#D4D4D8" />
                    <Text className="text-theme-neutrals-300 text-xs">{fmt(r.cost)}</Text>
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
        )}

        {reward?.needsText ? (
          <View style={{ gap: 6 }}>
            <Text className="text-theme-neutrals-400 text-xs">{t("livePoints.messageLabel")}</Text>
            <TextInput
              value={text}
              onChangeText={(v) => setText(v.slice(0, REWARD_TEXT_MAX))}
              placeholder={t("livePoints.messagePlaceholder")}
              placeholderTextColor="#71717A"
              multiline
              className="bg-theme-neutrals-800 text-theme-neutrals-100 rounded-xl px-4 py-3 text-[15px]"
              style={{ minHeight: 64, textAlignVertical: "top" }}
            />
          </View>
        ) : null}

        {reward ? (
          <TouchableOpacity
            onPress={() => redeem.mutate()}
            disabled={!ready}
            className="rounded-xl bg-theme-neutrals-100 py-3.5 flex-row items-center justify-center"
            style={{ gap: 8, opacity: ready || redeem.isPending ? 1 : 0.5 }}
            testID="live-rewards-redeem"
          >
            {redeem.isPending ? <ActivityIndicator color="#18181B" /> : <PointsIcon size={16} color="#18181B" />}
            <Text className="text-theme-neutrals-900 font-semibold text-[15px]">
              {canAfford(reward)
                ? t("livePoints.redeemFor", { cost: fmt(reward.cost) })
                : t("livePoints.needMore", { count: reward.cost - balance.balance, formatted: fmt(reward.cost - balance.balance) })}
            </Text>
          </TouchableOpacity>
        ) : null}

        <Text className="text-theme-neutrals-500 text-[11px]">{t("livePoints.howToEarn")}</Text>
      </View>
    </GlassModal>
  );
}

const styles = StyleSheet.create({
  tile: { width: "48.5%", minHeight: 84, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, justifyContent: "space-between", gap: 8 },
  ring: { ...StyleSheet.absoluteFillObject, borderRadius: 12, borderWidth: 2, borderColor: "#F4F4F5" },
});
