import React from "react";
import { ScrollView, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import type { getStreamRewards } from "../../services/live-rewards.service";
import { PointsIcon } from "./PointsIcon";

export function StreamChatRewards({ summary }: { summary: Awaited<ReturnType<typeof getStreamRewards>> }) {
  const { t, i18n } = useTranslation();
  const recent = summary.recentRedemptions ?? [];
  if (!summary.rewards.length && !recent.length) return null;
  return (
    <View testID="stream-chat-rewards" className="mx-3 my-1 gap-1 rounded-lg bg-black/55 px-2 py-1">
      {summary.rewards.length > 0 && (
        <View className="flex-row items-center gap-2">
          <Text className="text-xs font-semibold text-white">{t("livePoints.rewards")}</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 12 }}>
            {summary.rewards.map(r => (
              <View key={r.id} className="flex-row items-center gap-1">
                <Text className="text-xs text-white">{r.title}</Text>
                <PointsIcon size={12} color="white" />
                <Text className="text-xs text-white">{r.cost.toLocaleString(i18n.language?.replace('_', '-'))}</Text>
              </View>
            ))}
          </ScrollView>
        </View>
      )}
      {recent.length > 0 && (
        <View className="flex-row items-center gap-2">
          <Text className="text-xs font-semibold text-white">{t("livePoints.studio.queue")}</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 12 }}>
            {recent.map(r => <Text key={r.id} className="text-xs text-white">{r.title}</Text>)}
          </ScrollView>
        </View>
      )}
    </View>
  );
}
