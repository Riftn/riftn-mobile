import React from "react";
import { Text, TouchableOpacity, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getMuteStatus, muteUser, unmuteUser } from "../../services/mute.service";
import { toastError } from "../../libs";

export function ProfileMuteRow({ address, viewerAddress }: { address: string; viewerAddress: string }) {
  const { t } = useTranslation();
  const client = useQueryClient();
  const key = ["profile-mute", viewerAddress.toLowerCase(), address.toLowerCase()];
  const status = useQuery({
    queryKey: key,
    queryFn: () => getMuteStatus(address),
    refetchOnMount: "always",
    retry: false,
  });
  const toggle = useMutation({
    mutationFn: async (muted: boolean) => {
      const result = await (muted ? unmuteUser(address) : muteUser(address));
      if (!result.status) throw new Error("Mute update failed");
      return !muted;
    },
    onSuccess: (youMuted) => {
      client.setQueryData(key, { status: true, youMuted });
      void client.invalidateQueries({ queryKey: ["mute-list"] });
    },
    onError: () => {
      toastError(t("postOptions.muteFailed"));
      void status.refetch();
    },
  });
  const muted = status.data?.youMuted;
  const disabled = status.isFetching || toggle.isPending;
  return (
    <TouchableOpacity
      accessibilityRole="button"
      disabled={disabled}
      accessibilityState={{ disabled }}
      onPress={() => {
        if (typeof muted === "boolean") toggle.mutate(muted);
        else void status.refetch();
      }}
      className="mx-3 flex-row items-center rounded-xl px-3 py-3.5 active:bg-white/10"
    >
      <View className="w-5 h-5 items-center justify-center mr-3">
        <Ionicons name={muted ? "volume-high-outline" : "volume-mute-outline"} size={18} color="#F4F4F5" />
      </View>
      <Text className="text-white text-[15px] font-medium">
        {status.isError ? t("common.tryAgain") : muted ? t("keywordFilters.remove") : t("keywordFilters.add")}
      </Text>
    </TouchableOpacity>
  );
}
