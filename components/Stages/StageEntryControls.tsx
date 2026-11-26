import { stageRoomLabel, stageTopicLabel } from '../../i18n/stage-room-copy';
import React, { useState } from "react";
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toastError } from "../../libs/toast";
import { withWalletHeader } from "../../libs/supabase-wallet-client";
import { supabase } from "../../services/supabase";
import { getAccountSummaries } from "../../services/user.service";

import { STAGE_TOPICS, type StageTopic } from "../../libs/stage-topics";

export default function StageEntryControls({ spaceId, wallet }: { spaceId: string; wallet: string }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const [title, setTitle] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const lockKey = ["stage-entry-lock", spaceId] as const;
  const requestsKey = ["stage-entry-requests", spaceId, wallet] as const;
  const lock = useQuery({
    queryKey: lockKey,
    enabled: expanded,
    queryFn: async (): Promise<{ entry_locked: boolean; title: string; topic: string | null }> => {
      const { data, error } = await supabase.from("audio_spaces").select("entry_locked, title, topic").eq("id", spaceId).single();
      if (error) throw error;
      return data;
    },
  });
  const pending = useQuery({
    queryKey: requestsKey,
    enabled: expanded && lock.data?.entry_locked === true,
    refetchInterval: expanded && lock.data?.entry_locked === true ? 10_000 : false,
    queryFn: async (): Promise<string[]> => {
      const { data, error } = await withWalletHeader(supabase.from("stage_entry_requests")
        .select("wallet_address").eq("space_id", spaceId).is("approved_at", null)
        .order("requested_at").limit(20), wallet);
      if (error) throw error;
      return (data ?? []).map((request) => request.wallet_address);
    },
  });
  const addresses = pending.data ?? [];
  const { data: profiles } = useQuery({
    queryKey: ["stage-entry-profiles", addresses],
    enabled: expanded && lock.data?.entry_locked === true && addresses.length > 0,
    queryFn: () => getAccountSummaries(addresses),
    staleTime: 5 * 60_000,
  });
  const toggle = useMutation({
    mutationFn: async (patch: { entry_locked?: boolean; title?: string; topic?: StageTopic | null }) => {
      const { data, error } = await withWalletHeader(supabase.from("audio_spaces").update(patch)
        .eq("id", spaceId).eq("status", "live").select("entry_locked, title, topic").maybeSingle(), wallet);
      if (error || !data) throw error ?? new Error("Stage is no longer live");
      return data as { entry_locked: boolean; title: string; topic: string | null };
    },
    onSuccess: (room, patch) => {
      queryClient.setQueryData(lockKey, room);
      if (patch.title !== undefined) setTitle(null);
    },
    onError: () => toastError(stageRoomLabel(t, 'entryUnavailable')),
  });
  const approve = useMutation({
    mutationFn: async (address: string) => {
      const { data, error } = await withWalletHeader(supabase.rpc("approve_stage_entry", {
        p_space_id: spaceId,
        p_wallet: address,
      }), wallet);
      if (error || !data) throw error ?? new Error("Entry request is no longer pending");
    },
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: requestsKey }); },
    onError: () => toastError(stageRoomLabel(t, 'entryUnavailable')),
  });

  return (
    <View style={styles.group}>
      <TouchableOpacity accessibilityRole="button" accessibilityState={{ expanded }} onPress={() => setExpanded(!expanded)}
        style={styles.button}>
        <Text style={styles.text}>{stageRoomLabel(t, 'entrySettings')}</Text>
      </TouchableOpacity>
      {expanded && (
        <View style={styles.panel}>
          {lock.isError && <Text accessibilityRole="alert" style={styles.text}>{stageRoomLabel(t, 'entryUnavailable')}</Text>}
          {lock.isLoading && <Text style={styles.text}>{t("common.loading")}</Text>}
          {lock.data && (
            <>
              <Text style={styles.text}>{stageRoomLabel(t, 'editRoomTitle')}</Text>
              <TextInput value={title ?? lock.data.title} maxLength={100} onChangeText={setTitle}
                accessibilityLabel={stageRoomLabel(t, 'editRoomTitle')} style={styles.input} />
              <TouchableOpacity accessibilityRole="button" disabled={toggle.isPending || !title?.trim() || title.trim() === lock.data.title}
                onPress={() => { if (title?.trim()) toggle.mutate({ title: title.trim() }); }} style={styles.button}>
                <Text style={styles.text}>{t("common.save")}</Text>
              </TouchableOpacity>
              <Text style={styles.text}>{stageRoomLabel(t, 'roomTopic')}</Text>
              <View style={styles.topics}>
                {([null, ...STAGE_TOPICS] as const).map((topic) => {
                  const selected = (lock.data?.topic ?? null) === topic;
                  return (
                    <TouchableOpacity key={topic ?? "none"} accessibilityRole="button" accessibilityState={{ selected }}
                      disabled={toggle.isPending} onPress={() => toggle.mutate({ topic })}
                      style={[styles.button, selected && styles.selected]}>
                      <Text style={styles.text}>{topic ? stageTopicLabel(t, topic) : stageRoomLabel(t, 'topicNone')}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              <Text style={styles.text}>{stageRoomLabel(t, 'entryHelp')}</Text>
              <TouchableOpacity accessibilityRole="button" disabled={toggle.isPending} onPress={() => toggle.mutate({ entry_locked: !lock.data?.entry_locked })}
                accessibilityState={{ disabled: toggle.isPending }} style={styles.button}>
                <Text style={styles.text}>{lock.data.entry_locked ? stageRoomLabel(t, 'unlockEntry') : stageRoomLabel(t, 'lockEntry')}</Text>
              </TouchableOpacity>
            </>
          )}
          {lock.data?.entry_locked === true && (
            <View style={styles.group}>
              {pending.isError && <Text accessibilityRole="alert" style={styles.text}>{stageRoomLabel(t, 'entryUnavailable')}</Text>}
              {pending.isSuccess && addresses.length === 0 && <Text style={styles.text}>{stageRoomLabel(t, 'noEntryRequests')}</Text>}
              {addresses.map((address) => {
                const profile = profiles?.find((item) => item.address.toLowerCase() === address);
                const name = profile?.username ? "@" + profile.username.replace(/^@+/, "") : address;
                return (
                  <View key={address} style={styles.request}>
                    <Text style={[styles.text, styles.name]}>{name}</Text>
                    <TouchableOpacity accessibilityRole="button" disabled={approve.isPending} accessibilityState={{ disabled: approve.isPending }}
                      onPress={() => approve.mutate(address)} style={styles.button}>
                      <Text style={styles.text}>{stageRoomLabel(t, 'approveEntry')}</Text>
                    </TouchableOpacity>
                  </View>
                );
              })}
            </View>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  group: { gap: 8 },
  panel: { gap: 10, borderRadius: 12, borderWidth: 1, borderColor: "rgba(255,255,255,0.2)", padding: 12 },
  button: { alignSelf: "flex-start", borderRadius: 8, backgroundColor: "rgba(255,255,255,0.15)", padding: 10 },
  text: { color: "#fff", fontSize: 13 },
  request: { flexDirection: "row", alignItems: "center", gap: 8 },
  name: { flex: 1 },
  input: { color: "#fff", borderWidth: 1, borderColor: "rgba(255,255,255,0.2)", borderRadius: 8, padding: 8 },
  topics: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  selected: { backgroundColor: "#5346A4" },
});
