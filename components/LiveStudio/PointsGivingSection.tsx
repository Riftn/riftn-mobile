/**
 * Live Studio on a phone: let viewers give each other channel points. The app
 * side of web's PointsGivingSection. Off by default; when on, a viewer can
 * give another viewer some of their points with this channel from a chat
 * line's hold menu, up to the daily limit set here. The log shows who gave
 * what.
 */
import React, { useEffect, useState } from "react";
import { ActivityIndicator, Switch, Text, TextInput, TouchableOpacity, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Avatar from "../common/Avatar";
import { getAvatarUrl } from "../../libs/misc";
import { toastError, toastSuccess } from "../../libs";
import { PointsIcon } from "../LiveViewer/PointsIcon";
import { formatCount } from "../../libs/format-count";
import {
  GIVING_CAP_MAX,
  getMyGifts,
  getMyGiving,
  personName,
  saveMyGiving,
  type PointsGiving,
} from "../../services/live-rewards.service";

export function PointsGivingSection() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const saved = useQuery({ queryKey: ["my-points-giving"], queryFn: getMyGiving, staleTime: 60_000 });
  const [draft, setDraft] = useState<PointsGiving | null>(null);
  useEffect(() => {
    if (saved.data && draft === null) setDraft(saved.data);
  }, [saved.data, draft]);

  const save = useMutation({
    mutationFn: (next: PointsGiving) => saveMyGiving(next),
    onSuccess: (giving) => {
      qc.setQueryData(["my-points-giving"], giving);
      setDraft(giving);
      toastSuccess(t("livePoints.give.studio.saved"));
    },
    onError: (err) => toastError(err, t("livePoints.studio.saveFailed")),
  });

  const gifts = useQuery({
    queryKey: ["my-points-gifts"],
    queryFn: getMyGifts,
    enabled: !!draft?.enabled || !!saved.data?.enabled,
    refetchInterval: 15_000,
  });

  if (saved.isLoading || !draft) return <ActivityIndicator color="#a1a1aa" />;
  const capValid = draft.dailyCap >= 1 && draft.dailyCap <= GIVING_CAP_MAX;
  const capDirty = !!saved.data && saved.data.dailyCap !== draft.dailyCap;

  return (
    <View className="gap-3 mt-2" testID="live-studio-points-giving">
      <Text className="text-white text-sm font-semibold">{t("livePoints.give.studio.title")}</Text>
      <Text className="text-theme-neutrals-500 text-xs">{t("livePoints.give.studio.intro")}</Text>
      <View className="rounded-xl border border-theme-neutrals-700 p-3 gap-3">
        <View className="flex-row items-center justify-between gap-3">
          <Text className="text-white text-sm flex-1">{t("livePoints.give.studio.switch")}</Text>
          <Switch
            value={draft.enabled}
            disabled={save.isPending}
            onValueChange={(enabled) => save.mutate({ ...draft, enabled })}
            accessibilityLabel={t("livePoints.give.studio.switch")}
          />
        </View>
        <View className="flex-row items-center gap-2">
          <Text className="text-theme-neutrals-400 text-xs flex-1">{t("livePoints.give.studio.cap")}</Text>
          <View className="flex-row items-center rounded-xl border border-theme-neutrals-700 bg-theme-neutrals-800 px-2.5 h-10 w-28 gap-1.5">
            <PointsIcon size={13} color="#a1a1aa" />
            <TextInput
              value={draft.dailyCap ? String(draft.dailyCap) : ""}
              onChangeText={(v) => setDraft({ ...draft, dailyCap: Math.max(0, Math.round(Number(v.replace(/\D/g, "")) || 0)) })}
              keyboardType="number-pad"
              maxLength={6}
              accessibilityLabel={t("livePoints.give.studio.cap")}
              className="flex-1 text-white text-sm"
            />
          </View>
          <TouchableOpacity
            disabled={!capDirty || !capValid || save.isPending}
            onPress={() => save.mutate(draft)}
            accessibilityRole="button"
            className={`px-3 py-2.5 rounded-xl bg-white ${!capDirty || !capValid || save.isPending ? "opacity-40" : ""}`}
          >
            <Text className="text-[#09090B] text-xs font-semibold">{t("livePoints.studio.save")}</Text>
          </TouchableOpacity>
        </View>
      </View>

      {draft.enabled || (gifts.data?.length ?? 0) > 0 ? (
        <>
          <Text className="text-white text-sm font-semibold mt-1">{t("livePoints.give.studio.log")}</Text>
          {gifts.isLoading ? (
            <ActivityIndicator color="#a1a1aa" />
          ) : !gifts.data?.length ? (
            <Text className="text-theme-neutrals-500 text-sm">{t("livePoints.give.studio.logEmpty")}</Text>
          ) : (
            gifts.data.slice(0, 20).map((g) => (
              <View key={g.id} className="flex-row items-center gap-3 rounded-xl border border-theme-neutrals-700 p-2.5">
                <Avatar uri={getAvatarUrl(g.from.avatarImageUrl, 28)} size={28} name={personName(g.from)} />
                <Text className="text-white text-sm flex-1" numberOfLines={1}>
                  <Text className="font-semibold">{personName(g.from)}</Text>{" "}
                  <Text className="text-theme-neutrals-400">{t("livePoints.give.studio.gave")}</Text>{" "}
                  <Text className="font-semibold">{personName(g.to)}</Text>
                </Text>
                <View className="flex-row items-center gap-1">
                  <PointsIcon size={11} color="#a1a1aa" />
                  <Text className="text-theme-neutrals-300 text-xs">{formatCount(g.amount)}</Text>
                </View>
              </View>
            ))
          )}
        </>
      ) : null}
    </View>
  );
}
