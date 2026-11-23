/**
 * Live Studio's stream pet on a phone, the app side of web's PetPanel. Hatch
 * it, name it and pick its colour; it eats a snack for every five minutes on
 * air. Below, where it shows and whether viewers can buy it snacks with their
 * channel points, and who fed it most.
 */
import React, { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, Switch, Text, TextInput, TouchableOpacity, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Avatar from "../common/Avatar";
import { getAvatarUrl } from "../../libs/misc";
import { toastError, toastSuccess } from "../../libs";
import { formatCount } from "../../libs/format-count";
import { PointsIcon } from "../LiveViewer/PointsIcon";
import { FIELD } from "./WidgetSettingsForm";
import { PetCard } from "../Pet/PetCard";
import PetSprite from "../Pet/PetSprite";
import {
  FEED_COST_MAX,
  FEED_COST_MIN,
  feederName,
  getMyPet,
  hatchPet,
  PET_COLORS,
  PET_NAME_MAX,
  PET_PALETTE,
  saveMyPet,
  type PetColor,
  type PetSettings,
  type StreamPet,
} from "../../services/stream-pet.service";

const KEY = ["my-stream-pet"];

function ColorPicker({ value, onChange, disabled }: { value: PetColor; onChange: (c: PetColor) => void; disabled?: boolean }) {
  const { t } = useTranslation();
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={t("streamPet.studio.color")} className="flex-row flex-wrap gap-2.5">
      {PET_COLORS.map((c) => (
        <Pressable
          key={c}
          disabled={disabled}
          onPress={() => onChange(c)}
          accessibilityRole="radio"
          accessibilityState={{ checked: value === c }}
          accessibilityLabel={t(`streamPet.color.${c}`)}
          style={{ width: 34, height: 34, borderRadius: 17, padding: 2, borderWidth: 2, borderColor: value === c ? "#ffffff" : "transparent" }}
        >
          <View style={{ flex: 1, borderRadius: 14, backgroundColor: PET_PALETTE[c].body }} />
        </Pressable>
      ))}
    </View>
  );
}

function Toggle({ label, value, onChange, disabled }: { label: string; value: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <View className="flex-row items-center justify-between gap-3">
      <Text className="text-white text-sm flex-1">{label}</Text>
      <Switch value={value} disabled={disabled} onValueChange={onChange} accessibilityLabel={label} />
    </View>
  );
}

function Hatch({ onHatched }: { onHatched: (pet: StreamPet) => void }) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [color, setColor] = useState<PetColor>("violet");
  const hatch = useMutation({
    mutationFn: () => hatchPet(name.trim(), color),
    onSuccess: (pet) => {
      if (pet) onHatched(pet);
      toastSuccess(t("streamPet.studio.hatched"));
    },
    onError: (err) => toastError(err, t("streamPet.errors.failed")),
  });
  const ready = !!name.trim() && !hatch.isPending;
  return (
    <View className="gap-3" testID="stream-pet-hatch">
      <View className="items-center">
        <View className="h-28 w-28 items-center justify-end rounded-xl border border-white/10 bg-white/5">
          <PetSprite color={color} stage="egg" mood="egg" size={100} />
        </View>
      </View>
      <TextInput
        value={name}
        onChangeText={setName}
        maxLength={PET_NAME_MAX}
        placeholder={t("streamPet.studio.namePlaceholder")}
        placeholderTextColor="#71717a"
        accessibilityLabel={t("streamPet.studio.name")}
        className={FIELD}
      />
      <ColorPicker value={color} onChange={setColor} />
      <TouchableOpacity
        disabled={!ready}
        onPress={() => hatch.mutate()}
        accessibilityRole="button"
        className={`self-start px-4 py-2.5 rounded-xl bg-white ${ready ? "" : "opacity-40"}`}
      >
        <Text className="text-[#09090B] text-sm font-semibold">{t("streamPet.studio.hatch")}</Text>
      </TouchableOpacity>
    </View>
  );
}

export function PetSection() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: KEY, queryFn: getMyPet, staleTime: 30_000, refetchInterval: 60_000 });
  const pet = data?.pet ?? null;
  const [name, setName] = useState("");
  const [cost, setCost] = useState(100);
  useEffect(() => {
    if (!pet) return;
    setName(pet.name);
    setCost(pet.feeding.cost);
  }, [pet?.name, pet?.feeding.cost]); // eslint-disable-line react-hooks/exhaustive-deps

  const put = (next: StreamPet) => {
    qc.setQueryData(KEY, (prev: typeof data) => ({ feeders: prev?.feeders ?? [], pet: next }));
    void qc.invalidateQueries({ queryKey: ["creator-pet"] });
  };
  const save = useMutation({
    mutationFn: (s: PetSettings) => saveMyPet(s),
    onSuccess: (next) => {
      if (next) put(next);
      toastSuccess(t("streamPet.studio.saved"));
    },
    onError: (err) => toastError(err, t("streamPet.errors.failed")),
  });

  return (
    <View className="gap-3" testID="live-studio-pet">
      <Text className="text-theme-neutrals-500 text-xs">{t("streamPet.studio.intro")}</Text>
      {isLoading ? (
        <ActivityIndicator color="#a1a1aa" />
      ) : !pet ? (
        <Hatch onHatched={put} />
      ) : (
        <>
          <PetCard pet={pet} own />
          <View className="rounded-xl border border-theme-neutrals-700 p-3 gap-3">
            <View className="flex-row items-center gap-2">
              <TextInput
                value={name}
                onChangeText={setName}
                maxLength={PET_NAME_MAX}
                accessibilityLabel={t("streamPet.studio.name")}
                className={`${FIELD} flex-1`}
              />
              <TouchableOpacity
                disabled={!name.trim() || name.trim() === pet.name || save.isPending}
                onPress={() => save.mutate({ name: name.trim() })}
                className={`px-3 h-10 justify-center rounded-xl border border-theme-neutrals-600 ${!name.trim() || name.trim() === pet.name ? "opacity-40" : ""}`}
              >
                <Text className="text-white text-xs font-medium">{t("streamPet.studio.save")}</Text>
              </TouchableOpacity>
            </View>
            <ColorPicker value={pet.color} disabled={save.isPending} onChange={(color) => save.mutate({ color })} />
            <Toggle label={t("streamPet.studio.showOnProfile")} value={pet.showOnProfile} disabled={save.isPending} onChange={(v) => save.mutate({ showOnProfile: v })} />
            <Toggle label={t("streamPet.studio.showOnStream")} value={pet.showOnStream} disabled={save.isPending} onChange={(v) => save.mutate({ showOnStream: v })} />
            <Toggle
              label={t("streamPet.studio.feeding")}
              value={pet.feeding.enabled}
              disabled={save.isPending || !pet.showOnStream}
              onChange={(v) => save.mutate({ feeding: { enabled: v } })}
            />
            {pet.feeding.enabled && pet.showOnStream ? (
              <View className="flex-row items-center gap-2">
                <Text className="text-theme-neutrals-400 text-xs flex-1">{t("streamPet.studio.cost")}</Text>
                <View className="flex-row items-center rounded-xl border border-theme-neutrals-700 bg-theme-neutrals-800 px-2.5 h-10 w-24 gap-1.5">
                  <PointsIcon size={13} color="#a1a1aa" />
                  <TextInput
                    value={cost ? String(cost) : ""}
                    onChangeText={(v) => setCost(Math.max(0, Math.round(Number(v.replace(/\D/g, "")) || 0)))}
                    keyboardType="number-pad"
                    maxLength={5}
                    accessibilityLabel={t("streamPet.studio.cost")}
                    className="flex-1 text-white text-sm"
                  />
                </View>
                <TouchableOpacity
                  disabled={cost === pet.feeding.cost || cost < FEED_COST_MIN || cost > FEED_COST_MAX || save.isPending}
                  onPress={() => save.mutate({ feeding: { cost } })}
                  className={`px-3 h-10 justify-center rounded-xl bg-white ${cost === pet.feeding.cost || cost < FEED_COST_MIN || cost > FEED_COST_MAX ? "opacity-40" : ""}`}
                >
                  <Text className="text-[#09090B] text-xs font-semibold">{t("streamPet.studio.save")}</Text>
                </TouchableOpacity>
              </View>
            ) : null}
            <Text className="text-theme-neutrals-500 text-xs">{t("streamPet.studio.rules")}</Text>
            <Text className="text-theme-neutrals-500 text-xs">{t("streamPet.studio.requests")}</Text>
          </View>
          {data?.feeders.length ? (
            <View className="gap-2">
              <Text className="text-white text-sm font-semibold">{t("streamPet.studio.feeders")}</Text>
              {data.feeders.map((f) => (
                <View key={f.address} className="flex-row items-center gap-3">
                  <Avatar uri={getAvatarUrl(f.avatarImageUrl, 28)} size={28} name={feederName(f)} />
                  <Text numberOfLines={1} className="text-white text-sm flex-1">{feederName(f)}</Text>
                  <Text className="text-theme-neutrals-300 text-sm">
                    {t("streamPet.snacks", { count: f.snacks ?? 0, formatted: formatCount(f.snacks ?? 0) })}
                  </Text>
                </View>
              ))}
            </View>
          ) : null}
        </>
      )}
    </View>
  );
}
