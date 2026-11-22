import React, { useState } from "react";
import { ActivityIndicator, Text, TouchableOpacity, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import { removeBioTag } from "../../services/user.service";
import { bioTagsUser } from "../../libs/bio-tags";
import { toastError, toastSuccess } from "../../libs";

/**
 * "Remove me from their bio": only for someone this profile's bio @tags.
 * Their name stays in the bio as plain text.
 */
export function BioTagRemoveRow({ ownerAddress, bio, viewerUsername, onDone }: {
  ownerAddress: string;
  bio?: string | null;
  viewerUsername?: string | null;
  onDone?: () => void;
}) {
  const { t } = useTranslation();
  const client = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [gone, setGone] = useState(false);
  if (gone || !ownerAddress || !bioTagsUser(bio, viewerUsername)) return null;
  const run = async () => {
    setBusy(true);
    try {
      await removeBioTag(ownerAddress);
      setGone(true);
      toastSuccess(t("profileOptions.bioTagRemoved"));
      void client.invalidateQueries();
      onDone?.();
    } catch {
      toastError(t("common.tryAgain"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <TouchableOpacity
        accessibilityRole="button"
        disabled={busy}
        accessibilityState={{ disabled: busy }}
        onPress={run}
        activeOpacity={0.7}
        className="mx-3 flex-row items-center rounded-xl px-3 py-3.5 active:bg-white/10"
      >
        <View className="w-5 h-5 items-center justify-center mr-3">
          {busy ? <ActivityIndicator size="small" color="#F4F4F5" /> : <Ionicons name="at-outline" size={18} color="#F4F4F5" />}
        </View>
        <View className="flex-1">
          <Text className="text-white text-[15px] font-medium">{t("profileOptions.removeBioTag")}</Text>
          <Text className="text-theme-neutrals-500 text-xs mt-0.5">{t("profileOptions.removeBioTagHint")}</Text>
        </View>
      </TouchableOpacity>
      <View className="mx-5 my-1 h-px bg-white/10" />
    </>
  );
}
