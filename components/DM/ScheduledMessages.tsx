/**
 * Scheduled messages for one direct chat, matching web's
 * (riftn-web src/components/app/chat/ScheduledMessages.tsx): the strip above
 * the composer that says something is waiting, and the sheet where each one
 * can be edited, moved, sent now or deleted.
 */
import React, { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import GlassModal from "../ui/GlassModal";
import Icon from "../ui/Icon";
import ScheduleSheet from "../Upload/ScheduleSheet";
import { KitButton, useKitColors } from "../page/PageKit";
import { appLocale, formatMessageTime } from "../../libs/date.util";
import { toastError, toastSuccess } from "../../libs/toast";
import { useWebSocketApi } from "../../context/WebSocketContext";
import { DMSocketEvent } from "../../services/enums/dm-socket-events.enum";
import { decryptFromPeer, prepareOutgoing } from "../../libs/dm-e2ee/keys";
import { isEncryptedContent } from "../../libs/dm-e2ee/crypto";
import {
  cancelScheduledDm,
  listScheduledDms,
  updateScheduledDm,
  type ScheduledDm,
} from "../../services/dm/dm.scheduled";

export const scheduledDmKey = (dmId: string) => ["dm-scheduled", dmId] as const;

/** A scheduled message with its words opened for the person who wrote it. */
export interface ScheduledDmView extends ScheduledDm {
  text: string;
  /** Sealed on another device, so this one cannot show or edit the words. */
  unreadable: boolean;
}

async function openScheduled(rows: ScheduledDm[], peerAddress?: string | null): Promise<ScheduledDmView[]> {
  return Promise.all(rows.map(async (row) => {
    if (!isEncryptedContent(row.content)) return { ...row, text: row.content, unreadable: false };
    const text = peerAddress ? await decryptFromPeer(peerAddress, row.content).catch(() => null) : null;
    return { ...row, text: text ?? "", unreadable: text === null };
  }));
}

/**
 * The caller's waiting and failed messages in this chat. Kept fresh by the
 * socket note the server sends when one is sent or refused.
 */
export function useScheduledDms(dmId: string | null | undefined, peerAddress?: string | null) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const ws = useWebSocketApi();
  const enabled = !!dmId;
  const query = useQuery({
    queryKey: scheduledDmKey(dmId || ""),
    queryFn: async () => openScheduled(await listScheduledDms(dmId as string), peerAddress),
    enabled,
    staleTime: 30_000,
    retry: false,
  });

  useEffect(() => {
    if (!dmId) return;
    return ws.on(DMSocketEvent.ScheduledMessageUpdate, (update: { dmId?: string; status?: string; failureReason?: string }) => {
      if (update?.dmId !== dmId) return;
      void queryClient.invalidateQueries({ queryKey: scheduledDmKey(dmId) });
      if (update.status === "failed") {
        toastError(update.failureReason || t("dmSchedule.failedToast", { defaultValue: "A scheduled message could not be sent" }));
      }
    });
  }, [ws, dmId, queryClient, t]);

  // The next one is due: look again just after, in case the socket note was missed.
  const nextAt = query.data?.find((r) => r.status === "scheduled")?.sendAt;
  useEffect(() => {
    if (!dmId || !nextAt) return;
    const wait = new Date(nextAt).getTime() - Date.now() + 15_000;
    if (wait > 2_147_000_000) return;
    const timer = setTimeout(() => {
      void queryClient.invalidateQueries({ queryKey: scheduledDmKey(dmId) });
    }, Math.max(wait, 1000));
    return () => clearTimeout(timer);
  }, [dmId, nextAt, queryClient]);

  return { items: query.data ?? [], isLoading: enabled && query.isLoading };
}

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/** "Today, 09:00" / "Tomorrow, 09:00" / "Fri 20 Nov, 09:00", in the viewer's own zone. */
export function useWhenLabel() {
  const { t } = useTranslation();
  return (iso: string | Date) => {
    const locale = appLocale();
    const at = new Date(iso);
    const days = Math.round((startOfDay(at) - startOfDay(new Date())) / 86_400_000);
    const day = days === 0
      ? t("whenSheet.today", { defaultValue: "Today" })
      : days === 1
        ? t("whenSheet.tomorrow", { defaultValue: "Tomorrow" })
        : at.toLocaleDateString(locale, { weekday: "short", day: "numeric", month: "short", ...(at.getFullYear() !== new Date().getFullYear() ? { year: "numeric" as const } : {}) });
    return `${day}, ${formatMessageTime(at)}`;
  };
}

const AMBER = "#FBBF24";

/** One line above the composer while anything is waiting. Opens the sheet. */
export function ScheduledStrip({ items, onOpen }: { items: ScheduledDmView[]; onOpen: () => void }) {
  const { t } = useTranslation();
  const whenLabel = useWhenLabel();
  const c = useKitColors();
  if (!items.length) return null;
  const failed = items.filter((r) => r.status === "failed").length;
  const waiting = items.filter((r) => r.status === "scheduled");
  return (
    <Pressable
      onPress={onOpen}
      accessibilityRole="button"
      accessibilityLabel={t("dmSchedule.title", { defaultValue: "Scheduled messages" })}
      style={({ pressed }) => [styles.strip, { backgroundColor: c.chipBg, borderColor: c.hairline, opacity: pressed ? 0.8 : 1 }]}
    >
      <Icon name="Clock" size={14} color="#D4D4D8" />
      <Text numberOfLines={1} style={styles.stripText}>
        {waiting.length > 0 ? (
          <Text style={styles.stripStrong}>{t("dmSchedule.waiting", { defaultValue: "{{n}} scheduled", n: waiting.length })}</Text>
        ) : null}
        {failed > 0 ? (
          <Text style={[styles.stripStrong, { color: AMBER }]}>
            {waiting.length > 0 ? " · " : ""}{t("dmSchedule.failedCount", { defaultValue: "{{n}} not sent", n: failed })}
          </Text>
        ) : null}
        {waiting.length > 0 ? (
          <Text>{" · "}{t("dmSchedule.next", { defaultValue: "next {{when}}", when: whenLabel(waiting[0].sendAt) })}</Text>
        ) : null}
      </Text>
      <Text style={styles.stripStrong}>{t("dmSchedule.view", { defaultValue: "View" })}</Text>
    </Pressable>
  );
}

interface ScheduledMessagesSheetProps {
  visible: boolean;
  onClose: () => void;
  dmId: string;
  peerAddress?: string | null;
  peerName?: string;
  items: ScheduledDmView[];
  isLoading?: boolean;
}

export function ScheduledMessagesSheet({ visible, onClose, dmId, peerAddress, peerName, items, isLoading }: ScheduledMessagesSheetProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const whenLabel = useWhenLabel();
  const c = useKitColors();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [movingId, setMovingId] = useState<string | null>(null);
  const moving = useMemo(() => items.find((r) => r._id === movingId) ?? null, [items, movingId]);

  useEffect(() => {
    if (!visible) { setEditingId(null); setMovingId(null); }
  }, [visible]);

  const run = async (id: string, work: () => Promise<unknown>, done?: string) => {
    setBusyId(id);
    try {
      await work();
      if (done) toastSuccess(done);
    } catch (err: any) {
      toastError(err?.message || t("dmSchedule.error", { defaultValue: "That did not work. Try again." }));
    } finally {
      setBusyId(null);
      void queryClient.invalidateQueries({ queryKey: scheduledDmKey(dmId) });
    }
  };

  const saveEdit = (row: ScheduledDmView) => {
    const text = draft.trim();
    if (!text) return;
    if (text === row.text) { setEditingId(null); return; }
    void run(row._id, async () => {
      // Sealed again for this chat, the same as a message sent by hand.
      const wire = await prepareOutgoing(peerAddress || "", text);
      await updateScheduledDm(row._id, { content: wire.content });
      setEditingId(null);
    });
  };

  const chip = (label: string, icon: string, onPress: () => void, disabled: boolean) => (
    <Pressable
      key={label}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.chip, { backgroundColor: c.chipBg, borderColor: c.hairline, borderWidth: c.isMinimal ? 1 : 0, opacity: disabled ? 0.45 : pressed ? 0.8 : 1 }]}
    >
      <Icon name={icon as any} size={13} color="#FFFFFF" />
      <Text style={styles.chipText}>{label}</Text>
    </Pressable>
  );

  return (
    <>
      <GlassModal visible={visible && !moving} onClose={onClose} presentation="bottom" maxHeight="88%">
        <View style={styles.header}>
          <Pressable onPress={onClose} hitSlop={8} accessibilityRole="button" accessibilityLabel={t("common.close", { defaultValue: "Close" })} style={styles.close}>
            <Icon name="X" size={20} color="rgba(255,255,255,0.7)" />
          </Pressable>
          <Text style={styles.title}>{t("dmSchedule.title", { defaultValue: "Scheduled messages" })}</Text>
          <View style={styles.close} />
        </View>

        <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.body}>
          {isLoading ? <ActivityIndicator color="#FFFFFF" style={{ paddingVertical: 40 }} /> : null}

          {!isLoading && items.length === 0 ? (
            <View style={styles.empty}>
              <Icon name="Clock" size={34} color="rgba(255,255,255,0.45)" />
              <Text style={styles.emptyTitle}>{t("dmSchedule.emptyTitle", { defaultValue: "Nothing scheduled" })}</Text>
              <Text style={styles.emptyBody}>{t("dmSchedule.emptyBody", { defaultValue: "Write a message, then tap the clock to pick when it is sent." })}</Text>
            </View>
          ) : null}

          {items.map((row) => {
            const busy = busyId === row._id;
            const editing = editingId === row._id;
            const failed = row.status === "failed";
            return (
              <View key={row._id} style={[styles.row, { backgroundColor: c.chipBg, borderColor: c.hairline }]}>
                <View style={styles.rowHead}>
                  <Icon name="Clock" size={14} color={failed ? AMBER : "rgba(255,255,255,0.7)"} />
                  <Text style={[styles.rowWhen, failed && { color: AMBER }]}>
                    {failed ? t("dmSchedule.notSent", { defaultValue: "Not sent" }) : whenLabel(row.sendAt)}
                  </Text>
                  {busy ? <ActivityIndicator size="small" color="rgba(255,255,255,0.6)" style={{ marginLeft: "auto" }} /> : null}
                </View>
                {failed && row.failureReason ? <Text style={styles.rowReason}>{row.failureReason}</Text> : null}

                {editing ? (
                  <View style={{ gap: 8, marginTop: 8 }}>
                    <TextInput
                      value={draft}
                      onChangeText={setDraft}
                      multiline
                      autoFocus
                      maxLength={5000}
                      accessibilityLabel={t("dmSchedule.editLabel", { defaultValue: "Edit message" })}
                      placeholderTextColor="rgba(255,255,255,0.4)"
                      style={[styles.editBox, { borderColor: c.hairline }]}
                    />
                    <View style={styles.editActions}>
                      <KitButton variant="quiet" label={t("common.cancel", { defaultValue: "Cancel" })} onPress={() => setEditingId(null)} style={{ flex: 1 }} />
                      <KitButton label={t("common.save", { defaultValue: "Save" })} onPress={() => saveEdit(row)} disabled={!draft.trim() || busy} style={{ flex: 1 }} />
                    </View>
                  </View>
                ) : (
                  <>
                    <Text style={[styles.rowText, row.unreadable && styles.rowTextMuted]}>
                      {row.unreadable ? t("dmSchedule.unreadable", { defaultValue: "Written on another device. It will still be sent." }) : row.text}
                    </Text>
                    <View style={styles.chips}>
                      {!row.unreadable ? chip(t("dmSchedule.edit", { defaultValue: "Edit" }), "Pencil", () => { setDraft(row.text); setEditingId(row._id); }, busy) : null}
                      {chip(t("dmSchedule.changeTime", { defaultValue: "Change time" }), "Clock", () => setMovingId(row._id), busy)}
                      {chip(t("dmSchedule.sendNow", { defaultValue: "Send now" }), "Send", () => { void run(row._id, () => updateScheduledDm(row._id, { sendAt: "now" })); }, busy)}
                      <Pressable
                        onPress={() => { void run(row._id, () => cancelScheduledDm(row._id), t("dmSchedule.deleted", { defaultValue: "Scheduled message deleted" })); }}
                        disabled={busy}
                        hitSlop={6}
                        accessibilityRole="button"
                        accessibilityLabel={t("common.delete", { defaultValue: "Delete" })}
                        style={({ pressed }) => [styles.chip, styles.chipIcon, { backgroundColor: c.chipBg, borderColor: c.hairline, borderWidth: c.isMinimal ? 1 : 0, opacity: busy ? 0.45 : pressed ? 0.8 : 1 }]}
                      >
                        <Icon name="Trash2" size={13} color="#FFFFFF" />
                      </Pressable>
                    </View>
                  </>
                )}
              </View>
            );
          })}

          {items.length > 0 ? (
            <Text style={styles.footnote}>
              {peerName
                ? t("dmSchedule.footnoteNamed", { defaultValue: "Times are in your time zone. {{name}} only sees a message once it is sent.", name: peerName })
                : t("dmSchedule.footnote", { defaultValue: "Times are in your time zone. Nobody sees a message until it is sent." })}
            </Text>
          ) : null}
        </ScrollView>
      </GlassModal>

      <ScheduleSheet
        visible={!!moving}
        onClose={() => setMovingId(null)}
        scheduledDate={moving && moving.status === "scheduled" ? new Date(moving.sendAt) : null}
        onSchedule={(date) => {
          if (!date || !moving) return;
          const id = moving._id;
          void run(id, () => updateScheduledDm(id, { sendAt: date }));
        }}
        kind="message"
        moving
        title={t("dmSchedule.whenTitle", { defaultValue: "Send when?" })}
      />
    </>
  );
}

const styles = StyleSheet.create({
  strip: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 16, paddingVertical: 9, borderTopWidth: StyleSheet.hairlineWidth },
  stripText: { flex: 1, color: "#A1A1AA", fontSize: 12 },
  stripStrong: { color: "#FFFFFF", fontSize: 12, fontWeight: "600" },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 12, paddingTop: 14, paddingBottom: 10 },
  close: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  title: { color: "#FFFFFF", fontSize: 16, fontWeight: "600" },
  body: { paddingHorizontal: 16, paddingBottom: 24, gap: 10 },
  empty: { alignItems: "center", gap: 10, paddingHorizontal: 24, paddingVertical: 40 },
  emptyTitle: { color: "#FFFFFF", fontSize: 14, fontWeight: "600" },
  emptyBody: { color: "rgba(255,255,255,0.6)", fontSize: 12, lineHeight: 18, textAlign: "center" },
  row: { borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, padding: 12 },
  rowHead: { flexDirection: "row", alignItems: "center", gap: 6 },
  rowWhen: { color: "#FFFFFF", fontSize: 12, fontWeight: "600" },
  rowReason: { color: AMBER, fontSize: 12, lineHeight: 17, marginTop: 4 },
  rowText: { color: "rgba(255,255,255,0.9)", fontSize: 14, lineHeight: 20, marginTop: 6 },
  rowTextMuted: { color: "rgba(255,255,255,0.5)", fontStyle: "italic" },
  chips: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6, marginTop: 10 },
  chip: { flexDirection: "row", alignItems: "center", gap: 6, height: 32, paddingHorizontal: 10, borderRadius: 10 },
  chipIcon: { width: 32, paddingHorizontal: 0, justifyContent: "center", marginLeft: "auto" },
  chipText: { color: "#FFFFFF", fontSize: 12, fontWeight: "600" },
  editBox: { minHeight: 76, maxHeight: 160, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8, color: "#FFFFFF", fontSize: 15, lineHeight: 20, textAlignVertical: "top", backgroundColor: "rgba(0,0,0,0.2)" },
  editActions: { flexDirection: "row", gap: 8 },
  footnote: { color: "rgba(255,255,255,0.5)", fontSize: 11, lineHeight: 16, textAlign: "center", paddingHorizontal: 4, paddingTop: 4 },
});
