import React, { useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import Avatar from "../common/Avatar";
import GlassModal from "../ui/GlassModal";
import { useAuthState, useUser } from "../../context/AuthContext";
import { getAvatarUrl } from "../../libs/misc";
import { getBroadcasterViewers, type ViewerPeriod } from "../../services/live.service";

interface Props {
  streamId: string;
  visible: boolean;
  onClose: () => void;
  live?: boolean;
}

function ViewerList({ streamId, address, live }: { streamId: string; address: string; live: boolean }) {
  const { t } = useTranslation();
  const [selection, setSelection] = useState<ViewerPeriod>("now");
  const [offsets, setOffsets] = useState([0]);
  const period = live ? selection : "past";
  const offset = offsets[offsets.length - 1];
  const query = useQuery({
    queryKey: ["broadcaster-viewers", address, streamId, period, offset],
    queryFn: () => getBroadcasterViewers(streamId, period, offset),
    gcTime: 0,
    staleTime: 0,
    retry: false,
    refetchInterval: live && offset === 0 ? 15_000 : false,
  });
  const next = query.isError ? null : query.data?.nextOffset;

  return (
    <>
      {live && (
        <View className="flex-row gap-2 pb-2">
          {(["now", "past"] as const).map((tab) => (
            <Pressable key={tab} accessibilityRole="tab" accessibilityState={{ selected: tab === period }}
              onPress={() => { setSelection(tab); setOffsets([0]); }}
              className={`min-h-11 justify-center rounded-lg px-3 ${tab === period ? "bg-theme-neutrals-700" : ""}`}>
              <Text className="text-sm font-medium text-white">
                {tab === "now" ? t("liveAudience.hereNow", "Here now") : t("liveAudience.wasHere", "Was here")}
              </Text>
            </Pressable>
          ))}
        </View>
      )}
      {query.isPending ? (
        <ActivityIndicator className="py-4" color="#A1A1AA" accessibilityLabel={t("common.loading", "Loading…")} />
      ) : query.isError ? (
        <View className="py-3">
          <Text accessibilityLiveRegion="polite" className="text-sm text-theme-neutrals-400">
            {t("liveAudience.viewersFailed", "Could not load viewers.")}
          </Text>
          <Pressable accessibilityRole="button" onPress={() => void query.refetch()} className="min-h-11 justify-center">
            <Text className="text-sm font-medium text-white">{t("common.retry", "Retry")}</Text>
          </Pressable>
        </View>
      ) : query.data.viewers.length === 0 ? (
        <Text accessibilityLiveRegion="polite" className="py-4 text-sm text-theme-neutrals-400">
          {t("liveAudience.noViewersSharing", "No viewers to show.")}
        </Text>
      ) : (
        query.data.viewers.map((viewer) => {
          const name = viewer.displayName || viewer.username || t("liveAudience.unnamedViewer", "Riftn viewer");
          return (
            <View key={viewer.id} className="min-h-12 flex-row items-center gap-3 border-b border-theme-neutrals-800 py-1.5">
              <Avatar uri={getAvatarUrl(viewer.avatarImageUrl)} size={32} name={name} />
              <View className="min-w-0 flex-1">
                <Text numberOfLines={1} className="text-sm font-medium text-white">{name}</Text>
                {viewer.username && viewer.username !== name && (
                  <Text numberOfLines={1} className="text-xs text-theme-neutrals-400">@{viewer.username}</Text>
                )}
              </View>
            </View>
          );
        })
      )}
      {(offset > 0 || next != null) && (
        <View className="flex-row justify-between gap-2 pt-2">
          <Pressable accessibilityRole="button" accessibilityState={{ disabled: offset === 0 }} disabled={offset === 0}
            onPress={() => setOffsets((pages) => pages.slice(0, -1))} className="min-h-11 justify-center px-2">
            <Text className={offset === 0 ? "text-theme-neutrals-500" : "text-white"}>{t("common.previous", "Previous")}</Text>
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityState={{ disabled: next == null }} disabled={next == null}
            onPress={() => { if (next != null) setOffsets((pages) => [...pages, next]); }} className="min-h-11 justify-center px-2">
            <Text className={next == null ? "text-theme-neutrals-500" : "text-white"}>{t("common.next", "Next")}</Text>
          </Pressable>
        </View>
      )}
    </>
  );
}

export default function BroadcasterViewersSheet({ streamId, visible, onClose, live = false }: Props) {
  const { t } = useTranslation();
  const { isSignedIn } = useAuthState();
  const user = useUser();
  const address = isSignedIn ? (user?.walletAddress || user?.address)?.toLowerCase() : undefined;

  return (
    <GlassModal visible={visible && !!address} onClose={onClose} presentation="bottom" scrollable dragFromContent maxHeight="82%">
      <View className="px-4 pb-4 pt-2">
        <Text accessibilityRole="header" className="text-base font-semibold text-white">
          {live ? t("liveAudience.viewers", "Viewers") : t("liveAudience.wasHere", "Was here")}
        </Text>
        <Text className="pb-3 pt-1 text-sm text-theme-neutrals-400">
          {t("liveAudience.presencePrivacy", "Only viewers who share their presence appear here.")}
        </Text>
        {visible && address && <ViewerList key={`${address}:${streamId}:${live}`} address={address} streamId={streamId} live={live} />}
      </View>
    </GlassModal>
  );
}
