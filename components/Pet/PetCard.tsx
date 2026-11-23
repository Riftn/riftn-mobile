/**
 * A stream pet's card, the app side of web's PetCard: the pet, its name and
 * stage, how it feels, and how far it is from growing up. On the creator's
 * profile and in Live Studio.
 */
import React from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { formatCount } from "../../libs/format-count";
import { getCreatorPet, petMoodKey, petRequestKey, PET_STAGES, type StreamPet } from "../../services/stream-pet.service";
import PetSprite from "./PetSprite";

export function PetCard({ pet, own = false, className }: { pet: StreamPet; own?: boolean; className?: string }) {
  const { t } = useTranslation();
  const mood = petMoodKey(pet, own);
  const percent = Math.round(pet.progress * 100);
  const toNext = pet.nextStageFood == null ? 0 : Math.max(0, pet.nextStageFood - pet.food);
  const nextStage = pet.nextStageFood == null ? null : PET_STAGES[pet.stageIndex + 1];
  const hours = Math.floor(pet.streamedMinutes / 60);
  const requests = petRequestKey(pet, own);

  return (
    <View testID="stream-pet-card" className={`rounded-2xl border border-white/10 bg-white/5 p-4 ${className || ""}`}>
      <View className="flex-row items-center gap-4">
        <View className="h-24 w-24 items-center justify-end rounded-xl border border-white/10 bg-white/5">
          <PetSprite color={pet.color} stage={pet.stage} mood={pet.mood} size={88} />
        </View>
        <View className="flex-1 min-w-0">
          <View className="flex-row flex-wrap items-center gap-2">
            <Text numberOfLines={1} className="text-white text-base font-semibold">{pet.name}</Text>
            <View className="rounded-full border border-white/15 bg-white/10 px-2 py-0.5">
              <Text className="text-white/80 text-[11px]">{t(`streamPet.stage.${pet.stage}`)}</Text>
            </View>
          </View>
          <Text className="text-white/70 text-sm mt-1 leading-5">{t(mood.key, { hours: mood.hours })}</Text>
          <Text className="text-white/45 text-[11px] mt-1">
            {t("streamPet.snacks", { count: pet.food, formatted: formatCount(pet.food) })}
            {hours > 0 ? ` · ${t("streamPet.hoursStreamed", { count: hours, formatted: formatCount(hours) })}` : ""}
          </Text>
          {requests ? (
            <Text testID="stream-pet-requests" className="text-white/45 text-[11px] mt-0.5">
              {requests.count != null
                ? t(requests.key, { count: requests.count, formatted: formatCount(requests.count) })
                : t(requests.key)}
            </Text>
          ) : null}
        </View>
      </View>
      {nextStage ? (
        <>
          <View className="mt-4 h-2 rounded-full bg-white/10 border border-white/10 overflow-hidden">
            <View className="h-full rounded-full bg-white" style={{ width: `${Math.max(percent, pet.progress > 0 ? 3 : 0)}%` }} />
          </View>
          <Text className="text-white/60 text-[11px] mt-2 text-right">
            {t("streamPet.toNext", { count: toNext, formatted: formatCount(toNext), stage: t(`streamPet.stage.${nextStage}`) })}
          </Text>
        </>
      ) : null}
    </View>
  );
}

/** A creator's pet on their profile. Nothing for someone without one, or who keeps it off their profile. */
export default function ProfilePetCard({ address, own, className }: { address?: string | null; own?: boolean; className?: string }) {
  const { data } = useQuery({
    queryKey: ["creator-pet", (address || "").toLowerCase()],
    queryFn: () => getCreatorPet(address || ""),
    enabled: !!address,
    staleTime: 60_000,
    retry: false,
  });
  if (!data) return null;
  return <PetCard pet={data} own={own} className={className} />;
}
