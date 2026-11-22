/**
 * The creator's pet in the corner of their live, the app side of web's
 * StreamPetCorner. Everyone watching sees it; a tap opens a small card where
 * a viewer can buy it a snack with the channel points they earned on this
 * channel. When anyone feeds it, it hops and a line rises saying who did.
 */
import React, { useEffect, useRef, useState } from "react";
import { Animated, Easing, Pressable, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toastError, toastSuccess } from "../../libs";
import { formatCount } from "../../libs/format-count";
import { getMyStreamPoints } from "../../services/live-rewards.service";
import {
  feedErrorKey,
  feederName,
  feedStreamPet,
  getStreamPet,
  parseFeeder,
  parsePet,
  petMoodKey,
} from "../../services/stream-pet.service";
import { PointsIcon } from "../LiveViewer/PointsIcon";
import PetSprite from "./PetSprite";

type SocketOn = (event: any, handler: (data: any) => void) => (() => void) | void;

interface Props {
  streamId: string;
  socketOn: SocketOn;
  own?: boolean;
  signedIn?: boolean;
  onSignIn?: () => void;
}

export default function StreamPetCorner({ streamId, socketOn, own = false, signedIn = false, onSignIn }: Props) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const key = ["stream-pet", streamId];
  const { data: pet } = useQuery({ queryKey: key, queryFn: () => getStreamPet(streamId), staleTime: 60_000, refetchInterval: 5 * 60_000, retry: false });
  const [open, setOpen] = useState(false);
  const [chomp, setChomp] = useState(0);
  const [fedLine, setFedLine] = useState<string | null>(null);
  const rise = useRef(new Animated.Value(0)).current;
  const panel = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const off = socketOn("stream.pet", (data: any) => {
      if (String(data?.streamId ?? "") !== streamId) return;
      const next = parsePet(data?.pet);
      qc.setQueryData(key, next);
      if (data?.fed?.by) {
        setChomp((n) => n + 1);
        setFedLine(t("streamPet.fedBy", { name: feederName(parseFeeder(data.fed.by)), pet: next?.name ?? "" }));
        rise.setValue(0);
        Animated.timing(rise, { toValue: 1, duration: 2600, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start(({ finished }) => {
          if (finished) setFedLine(null);
        });
      }
    });
    return () => {
      if (typeof off === "function") off();
    };
  }, [streamId, socketOn]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    Animated.timing(panel, { toValue: open ? 1 : 0, duration: 220, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [open, panel]);

  const canFeed = !!pet && pet.feeding.enabled && !own;
  const points = useQuery({
    queryKey: ["live-points", streamId],
    queryFn: () => getMyStreamPoints(streamId),
    enabled: open && canFeed && signedIn,
    staleTime: 15_000,
    retry: false,
  });
  const feed = useMutation({
    mutationFn: () => feedStreamPet(streamId),
    onSuccess: (res) => {
      if (res.pet) qc.setQueryData(key, res.pet);
      void qc.invalidateQueries({ queryKey: ["live-points", streamId] });
      toastSuccess(t("streamPet.fed", { pet: pet?.name ?? "" }));
    },
    onError: (err) => toastError(null, t(feedErrorKey(err))),
  });

  if (!pet) return null;
  const mood = petMoodKey(pet, own);
  const balance = points.data?.balance ?? null;
  const short = balance != null && balance < pet.feeding.cost;
  const disabled = feed.isPending || short;

  return (
    <View pointerEvents="box-none" className="dark-surface" style={{ alignItems: "flex-end" }} testID="stream-pet-corner">
      {open ? (
        <Animated.View
          style={{
            width: 220,
            marginBottom: 8,
            borderRadius: 16,
            borderWidth: 1,
            borderColor: "rgba(255,255,255,0.15)",
            backgroundColor: "rgba(0,0,0,0.62)",
            padding: 12,
            opacity: panel,
            transform: [{ translateY: panel.interpolate({ inputRange: [0, 1], outputRange: [6, 0] }) }, { scale: panel.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1] }) }],
          }}
        >
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Text numberOfLines={1} style={{ flex: 1, color: "#fff", fontSize: 14, fontWeight: "600" }}>{pet.name}</Text>
            <View style={{ borderRadius: 999, borderWidth: 1, borderColor: "rgba(255,255,255,0.15)", backgroundColor: "rgba(255,255,255,0.1)", paddingHorizontal: 8, paddingVertical: 2 }}>
              <Text style={{ color: "rgba(255,255,255,0.8)", fontSize: 10 }}>{t(`streamPet.stage.${pet.stage}`)}</Text>
            </View>
          </View>
          <Text style={{ marginTop: 4, color: "rgba(255,255,255,0.7)", fontSize: 12, lineHeight: 16 }}>{t(mood.key, { hours: mood.hours })}</Text>
          <View style={{ marginTop: 8, height: 6, borderRadius: 3, overflow: "hidden", backgroundColor: "rgba(255,255,255,0.12)" }}>
            <View style={{ height: "100%", borderRadius: 3, backgroundColor: "rgba(255,255,255,0.85)", width: `${Math.round(pet.progress * 100)}%` }} />
          </View>
          {canFeed ? (
            <>
              <Pressable
                accessibilityRole="button"
                disabled={signedIn && disabled}
                onPress={() => (signedIn ? feed.mutate() : onSignIn?.())}
                style={({ pressed }) => ({ marginTop: 12, opacity: signedIn && disabled ? 0.5 : pressed ? 0.8 : 1 })}
              >
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, borderRadius: 12, borderWidth: 1, borderColor: "rgba(255,255,255,0.2)", backgroundColor: "rgba(255,255,255,0.15)", paddingVertical: 9 }}>
                  <Text style={{ color: "#fff", fontSize: 12, fontWeight: "600" }}>{t("streamPet.feed")}</Text>
                  <PointsIcon size={12} color="rgba(255,255,255,0.8)" />
                  <Text style={{ color: "rgba(255,255,255,0.8)", fontSize: 12 }}>{formatCount(pet.feeding.cost)}</Text>
                </View>
              </Pressable>
              <Text style={{ marginTop: 6, textAlign: "center", color: "rgba(255,255,255,0.55)", fontSize: 10 }}>
                {!signedIn ? t("streamPet.signIn") : balance == null ? t("streamPet.pointsHint") : t("streamPet.balance", { formatted: formatCount(balance) })}
              </Text>
            </>
          ) : null}
        </Animated.View>
      ) : null}
      <View>
        {fedLine ? (
          <Animated.View
            pointerEvents="none"
            style={{
              position: "absolute",
              bottom: "100%",
              right: 0,
              marginBottom: 4,
              opacity: rise.interpolate({ inputRange: [0, 0.12, 0.8, 1], outputRange: [0, 1, 1, 0] }),
              transform: [{ translateY: rise.interpolate({ inputRange: [0, 0.12, 1], outputRange: [6, 0, -14] }) }],
            }}
          >
            <View style={{ borderRadius: 999, borderWidth: 1, borderColor: "rgba(255,255,255,0.15)", backgroundColor: "rgba(0,0,0,0.6)", paddingHorizontal: 10, paddingVertical: 4 }}>
              <Text numberOfLines={1} style={{ color: "#fff", fontSize: 11, fontWeight: "500" }}>{fedLine}</Text>
            </View>
          </Animated.View>
        ) : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("streamPet.open", { pet: pet.name })}
          onPress={() => setOpen((v) => !v)}
          style={({ pressed }) => ({ transform: [{ scale: pressed ? 0.95 : 1 }] })}
        >
          <View style={{ width: 64, height: 64, borderRadius: 16, borderWidth: 1, borderColor: "rgba(255,255,255,0.15)", backgroundColor: "rgba(0,0,0,0.35)", alignItems: "center", justifyContent: "flex-end" }}>
            <PetSprite color={pet.color} stage={pet.stage} mood={pet.mood} size={58} chomp={chomp} />
          </View>
        </Pressable>
      </View>
    </View>
  );
}
