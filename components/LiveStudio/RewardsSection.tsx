/**
 * Live Studio's channel points rewards on a phone: what viewers can spend the
 * points they earn watching you on, and the queue of what they redeemed. The
 * app side of web's RewardsPanel.
 *
 * Rewards are things the creator does on stream. Points have no money value,
 * so nothing here pays out, sells or moves anything.
 */
import React, { useEffect, useState } from "react";
import { ActivityIndicator, Switch, Text, TextInput, TouchableOpacity, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Icon from "../ui/Icon";
import Avatar from "../common/Avatar";
import { getAvatarUrl } from "../../libs/misc";
import { toastError, toastSuccess } from "../../libs";
import { PointsIcon } from "../LiveViewer/PointsIcon";
import { FIELD } from "./WidgetSettingsForm";
import {
  getMyRedemptions,
  getMyRewards,
  MAX_REWARDS,
  REWARD_COST_MAX,
  REWARD_TITLE_MAX,
  saveMyRewards,
  settleRedemption,
  type LiveReward,
} from "../../services/live-rewards.service";

const draftId = () => Math.random().toString(36).slice(2, 10);

export function RewardsSection() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const fmt = (n: number) => n.toLocaleString();

  const saved = useQuery({ queryKey: ["my-live-rewards"], queryFn: getMyRewards, staleTime: 60_000 });
  const [draft, setDraft] = useState<LiveReward[] | null>(null);
  useEffect(() => {
    if (saved.data && draft === null) setDraft(saved.data);
  }, [saved.data, draft]);
  const list = draft ?? [];
  const dirty = !!saved.data && JSON.stringify(saved.data) !== JSON.stringify(draft);
  const valid = list.every((r) => r.title.trim() && r.cost >= 1 && r.cost <= REWARD_COST_MAX);

  const save = useMutation({
    mutationFn: () => saveMyRewards(list.map((r) => ({ ...r, title: r.title.trim() }))),
    onSuccess: (rewards) => {
      qc.setQueryData(["my-live-rewards"], rewards);
      setDraft(rewards);
      toastSuccess(t("livePoints.studio.saved"));
    },
    onError: (err) => toastError(err, t("livePoints.studio.saveFailed")),
  });

  const queue = useQuery({ queryKey: ["my-live-redemptions"], queryFn: getMyRedemptions, refetchInterval: 10_000 });
  const settle = useMutation({
    mutationFn: ({ id, action }: { id: string; action: "done" | "refund" }) => settleRedemption(id, action),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["my-live-redemptions"] }),
    onError: () => toastError(null, t("livePoints.studio.settleFailed")),
  });

  const update = (id: string, patch: Partial<LiveReward>) => setDraft((l) => (l ?? []).map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const add = () =>
    setDraft((l) => [...(l ?? []), { id: draftId(), title: "", cost: 100, needsText: false, enabled: true }].slice(0, MAX_REWARDS));
  const starters = () =>
    setDraft([
      { id: draftId(), title: t("livePoints.starter.hi"), cost: 100, needsText: false, enabled: true },
      { id: draftId(), title: t("livePoints.starter.hydrate"), cost: 250, needsText: false, enabled: true },
      { id: draftId(), title: t("livePoints.starter.song"), cost: 500, needsText: true, enabled: true },
    ]);

  const pending = (queue.data ?? []).filter((r) => r.status === "pending");
  const handled = (queue.data ?? []).filter((r) => r.status !== "pending").slice(0, 5);

  return (
    <View className="gap-3" testID="live-studio-rewards">
      <Text className="text-theme-neutrals-500 text-xs">{t("livePoints.studio.intro")}</Text>

      {saved.isLoading ? (
        <ActivityIndicator color="#a1a1aa" />
      ) : (
        <>
          {list.length === 0 ? (
            <View className="flex-row items-center gap-3 rounded-xl border border-dashed border-theme-neutrals-600 p-3">
              <Text className="text-theme-neutrals-400 text-sm flex-1">{t("livePoints.studio.empty")}</Text>
              <TouchableOpacity onPress={starters} className="px-3 py-1.5 rounded-lg border border-theme-neutrals-600">
                <Text className="text-white text-xs font-medium">{t("livePoints.studio.addStarters")}</Text>
              </TouchableOpacity>
            </View>
          ) : null}
          {list.map((r) => (
            <View key={r.id} className="rounded-xl border border-theme-neutrals-700 p-3 gap-2.5">
              <View className="flex-row items-center gap-2">
                <TextInput
                  value={r.title}
                  onChangeText={(v) => update(r.id, { title: v })}
                  maxLength={REWARD_TITLE_MAX}
                  placeholder={t("livePoints.studio.namePlaceholder")}
                  placeholderTextColor="#71717a"
                  accessibilityLabel={t("livePoints.studio.name")}
                  className={`${FIELD} flex-1`}
                />
                <View className="flex-row items-center rounded-xl border border-theme-neutrals-700 bg-theme-neutrals-800 px-2.5 h-10 w-24 gap-1.5">
                  <PointsIcon size={13} color="#a1a1aa" />
                  <TextInput
                    value={r.cost ? String(r.cost) : ""}
                    onChangeText={(v) => update(r.id, { cost: Math.max(0, Math.round(Number(v.replace(/\D/g, "")) || 0)) })}
                    keyboardType="number-pad"
                    maxLength={7}
                    accessibilityLabel={t("livePoints.studio.cost")}
                    className="flex-1 text-white text-sm"
                  />
                </View>
                <TouchableOpacity
                  onPress={() => setDraft((l) => (l ?? []).filter((x) => x.id !== r.id))}
                  accessibilityLabel={t("livePoints.studio.remove")}
                  className="p-1"
                >
                  <Icon name="Trash2" size={16} color="#a1a1aa" />
                </TouchableOpacity>
              </View>
              <View className="flex-row items-center gap-5">
                <View className="flex-row items-center gap-2">
                  <Switch value={r.needsText} onValueChange={(v) => update(r.id, { needsText: v })} accessibilityLabel={t("livePoints.studio.needsText")} />
                  <Text className="text-theme-neutrals-400 text-xs">{t("livePoints.studio.needsText")}</Text>
                </View>
                <View className="flex-row items-center gap-2">
                  <Switch value={r.enabled} onValueChange={(v) => update(r.id, { enabled: v })} accessibilityLabel={t("livePoints.studio.enabled")} />
                  <Text className="text-theme-neutrals-400 text-xs">{t("livePoints.studio.enabled")}</Text>
                </View>
              </View>
            </View>
          ))}
          <View className="flex-row items-center justify-between">
            <TouchableOpacity
              onPress={add}
              disabled={list.length >= MAX_REWARDS}
              className={`flex-row items-center gap-1 py-1 ${list.length >= MAX_REWARDS ? "opacity-40" : ""}`}
            >
              <Icon name="Plus" size={16} color="#ffffff" />
              <Text className="text-white text-sm font-medium">{t("livePoints.studio.add")}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              disabled={!dirty || !valid || save.isPending}
              onPress={() => save.mutate()}
              accessibilityRole="button"
              className={`px-4 py-2.5 rounded-xl bg-white ${!dirty || !valid || save.isPending ? "opacity-40" : ""}`}
            >
              <Text className="text-[#09090B] text-sm font-semibold">{t("livePoints.studio.save")}</Text>
            </TouchableOpacity>
          </View>
        </>
      )}

      <Text className="text-white text-sm font-semibold mt-2">{t("livePoints.studio.queue")}</Text>
      {queue.isLoading ? (
        <ActivityIndicator color="#a1a1aa" />
      ) : !pending.length && !handled.length ? (
        <Text className="text-theme-neutrals-500 text-sm">{t("livePoints.studio.queueEmpty")}</Text>
      ) : (
        [...pending, ...handled].map((r) => {
          const name = r.viewer.displayName || r.viewer.username || `${r.viewer.address.slice(0, 6)}…`;
          return (
            <View key={r.id} className={`flex-row items-start gap-3 rounded-xl border border-theme-neutrals-700 p-2.5 ${r.status === "pending" ? "" : "opacity-60"}`}>
              <Avatar uri={getAvatarUrl(r.viewer.avatarImageUrl, 32)} size={32} name={name} />
              <View className="flex-1">
                <Text className="text-white text-sm" numberOfLines={2}>
                  <Text className="font-semibold">{name}</Text>{" "}
                  <Text className="text-theme-neutrals-400">{t("livePoints.chatRedeemedShort")}</Text>{" "}
                  <Text className="font-medium">{r.title}</Text>
                </Text>
                {r.text ? <Text className="text-theme-neutrals-300 text-sm mt-0.5">{r.text}</Text> : null}
                <View className="flex-row items-center gap-1 mt-0.5">
                  <PointsIcon size={11} color="#71717a" />
                  <Text className="text-theme-neutrals-500 text-xs">
                    {fmt(r.cost)}
                    {r.status !== "pending" ? ` · ${t(r.status === "done" ? "livePoints.studio.done" : "livePoints.studio.refunded")}` : ""}
                  </Text>
                </View>
              </View>
              {r.status === "pending" ? (
                <View className="flex-row items-center">
                  <TouchableOpacity
                    disabled={settle.isPending}
                    onPress={() => settle.mutate({ id: r.id, action: "done" })}
                    accessibilityLabel={t("livePoints.studio.markDone")}
                    className="p-2"
                  >
                    <Icon name="Check" size={18} color="#e4e4e7" />
                  </TouchableOpacity>
                  <TouchableOpacity
                    disabled={settle.isPending}
                    onPress={() => settle.mutate({ id: r.id, action: "refund" })}
                    accessibilityLabel={t("livePoints.studio.refund")}
                    className="p-2"
                  >
                    <Icon name="Undo2" size={18} color="#e4e4e7" />
                  </TouchableOpacity>
                </View>
              ) : null}
            </View>
          );
        })
      )}
    </View>
  );
}
