/**
 * Give some of your channel points to another viewer. The app side of web's
 * GivePointsSheet: only on a channel whose creator switched giving on in Live
 * Studio, up to their daily limit. Opened from "Give points" on a chat line's
 * hold menu (the person comes filled in) or from the points sheet (type a
 * handle).
 */
import React, { useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import GlassModal from "../ui/GlassModal";
import { toastError, toastSuccess } from "../../libs/toast";
import { PointsIcon } from "./PointsIcon";
import { formatCount } from "../../libs/format-count";
import { giveErrorKey, givePoints, type PointsBalance } from "../../services/live-rewards.service";

const QUICK_AMOUNTS = [10, 50, 100, 250];

export interface GiveTarget {
  /** Handle or address the server resolves. */
  to: string;
  name: string;
}

interface Props {
  visible: boolean;
  onClose: () => void;
  streamId: string;
  balance?: number;
  dailyCap: number;
  target?: GiveTarget | null;
}

export default function GivePointsSheet({ visible, onClose, streamId, balance, dailyCap, target }: Props) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState(50);

  useEffect(() => {
    if (visible) {
      setTo(target?.to ?? "");
      setAmount(Math.min(50, dailyCap));
    }
  }, [visible, target, dailyCap]);

  const give = useMutation({
    mutationFn: () => givePoints(streamId, to.trim(), amount),
    onSuccess: (res) => {
      qc.setQueryData(["live-points", streamId], (prev: PointsBalance | undefined) => (prev ? { ...prev, balance: res.balance } : prev));
      void qc.invalidateQueries({ queryKey: ["live-points", streamId] });
      toastSuccess(t("livePoints.give.sent", { amount: formatCount(amount), name: target?.name || to.trim() }));
      onClose();
    },
    onError: (err) => {
      const key = giveErrorKey(err);
      toastError(null, key === "livePoints.give.limit" ? String((err as Error)?.message || t(key)) : t(key));
    },
  });

  const valid = !!to.trim() && amount >= 1 && amount <= dailyCap && (balance == null || amount <= balance);

  return (
    <GlassModal scrollable visible={visible} onClose={onClose} presentation="bottom" maxHeight="85%">
      <View className="px-4 pt-2 pb-6" style={{ gap: 14 }} testID="give-points-sheet">
        <View className="flex-row items-center justify-center py-2" style={{ gap: 8 }}>
          <PointsIcon size={18} color="#E4E4E7" />
          <Text className="text-theme-neutrals-100 text-lg font-bold" numberOfLines={1}>
            {target ? t("livePoints.give.titleTo", { name: target.name }) : t("livePoints.give.title")}
          </Text>
        </View>

        {balance != null ? (
          <View className="flex-row items-center justify-between rounded-xl bg-theme-neutrals-800 px-3.5 py-3">
            <Text className="text-theme-neutrals-400 text-sm">{t("livePoints.yourPoints")}</Text>
            <View className="flex-row items-center" style={{ gap: 6 }}>
              <PointsIcon size={16} color="#F4F4F5" />
              <Text className="text-theme-neutrals-100 text-base font-semibold">{formatCount(balance)}</Text>
            </View>
          </View>
        ) : null}

        {!target ? (
          <View style={{ gap: 6 }}>
            <Text className="text-theme-neutrals-400 text-xs">{t("livePoints.give.who")}</Text>
            <TextInput
              value={to}
              onChangeText={setTo}
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="@username"
              placeholderTextColor="#71717A"
              className="bg-theme-neutrals-800 text-theme-neutrals-100 rounded-xl px-4 py-3 text-[15px]"
            />
          </View>
        ) : null}

        <View style={{ gap: 6 }}>
          <Text className="text-theme-neutrals-400 text-xs">{t("livePoints.give.howMany")}</Text>
          <View className="flex-row flex-wrap items-center" style={{ gap: 8 }}>
            {QUICK_AMOUNTS.filter((n) => n <= dailyCap).map((n) => {
              const on = amount === n;
              return (
                <TouchableOpacity key={n} onPress={() => setAmount(n)} accessibilityRole="button" accessibilityState={{ selected: on }} style={styles.chip}>
                  {/* Fills on an inner View: a Touchable's own fill is repainted as the theme's control material. */}
                  <View pointerEvents="none" className="bg-theme-neutrals-800" style={[StyleSheet.absoluteFill, { borderRadius: 10 }]} />
                  {on ? <View pointerEvents="none" style={styles.ring} /> : null}
                  <PointsIcon size={12} color="#E4E4E7" />
                  <Text className="text-theme-neutrals-100 text-sm">{formatCount(n)}</Text>
                </TouchableOpacity>
              );
            })}
            <TextInput
              value={amount ? String(amount) : ""}
              onChangeText={(v) => setAmount(Math.max(0, Math.round(Number(v.replace(/\D/g, "")) || 0)))}
              keyboardType="number-pad"
              maxLength={6}
              accessibilityLabel={t("livePoints.give.howMany")}
              className="bg-theme-neutrals-800 text-theme-neutrals-100 rounded-xl px-3 text-[15px]"
              style={{ width: 84, height: 36 }}
            />
          </View>
          <Text className="text-theme-neutrals-500 text-[11px]">{t("livePoints.give.limitNote", { cap: formatCount(dailyCap) })}</Text>
        </View>

        <TouchableOpacity
          onPress={() => give.mutate()}
          disabled={!valid || give.isPending}
          className="rounded-xl bg-theme-neutrals-100 py-3.5 flex-row items-center justify-center"
          style={{ gap: 8, opacity: valid || give.isPending ? 1 : 0.5 }}
          testID="give-points-send"
        >
          {give.isPending ? <ActivityIndicator color="#18181B" /> : <PointsIcon size={16} color="#18181B" />}
          <Text className="text-theme-neutrals-900 font-semibold text-[15px]">{t("livePoints.give.button", { amount: formatCount(amount || 0) })}</Text>
        </TouchableOpacity>
      </View>
    </GlassModal>
  );
}

const styles = StyleSheet.create({
  chip: { flexDirection: "row", alignItems: "center", gap: 4, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 },
  ring: { ...StyleSheet.absoluteFillObject, borderRadius: 10, borderWidth: 2, borderColor: "#F4F4F5" },
});
