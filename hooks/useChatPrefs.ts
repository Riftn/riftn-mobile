import { useCallback, useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getChatPrefs, setChatPref, type ChatPref } from "../services/dm/dm.api";
import { toastError } from "../libs/toast";
import { translateCopy as _translateCopy } from "../i18n/copy";
import { setEncryptedChats } from "../libs/dm-e2ee/encrypt-choice";

const KEY = ["dm-chat-prefs"] as const;

type Patch = {
  pinned?: boolean; archived?: boolean; unread?: boolean; listed?: boolean; encrypted?: boolean;
  /** ISO time, 'forever', or null to unmute. */
  mutedUntil?: string | null;
};

const FOREVER = "2999-12-31T00:00:00.000Z";

/** True while this chat's mute is still running. */
export function isPrefMuted(pref?: ChatPref | null): boolean {
  return !!pref?.mutedUntil && new Date(pref.mutedUntil).getTime() > Date.now();
}

/**
 * Your own chat settings, saved on the server so they follow you between
 * devices (the same store the website uses). Changes show at once and roll
 * back if the save fails.
 */
export function useChatPrefs(enabled = true) {
  const queryClient = useQueryClient();
  // Polls so reactions to your messages show in the list without a reload.
  const { data } = useQuery({ queryKey: KEY, queryFn: getChatPrefs, enabled, staleTime: 60_000, refetchInterval: 30_000 });

  // Sending reads "Encrypt chat" from here (see encrypt-choice).
  useEffect(() => { if (data) setEncryptedChats(data); }, [data]);

  const byId = useMemo(() => {
    const map = new Map<string, ChatPref>();
    for (const p of data ?? []) map.set(p.conversationId, p);
    return map;
  }, [data]);

  const update = useCallback(async (id: string, patch: Patch) => {
    const before = queryClient.getQueryData<ChatPref[]>(KEY) ?? [];
    const prev = before.find((p) => p.conversationId === id);
    const now = new Date().toISOString();
    const next: ChatPref = {
      ...(prev ?? { conversationId: id, pinnedAt: null, archivedAt: null, mutedUntil: null, markedUnread: false }),
      ...(patch.pinned !== undefined ? { pinnedAt: patch.pinned ? now : null } : {}),
      ...(patch.archived !== undefined ? { archivedAt: patch.archived ? now : null } : {}),
      ...(patch.unread !== undefined ? { markedUnread: patch.unread } : {}),
      ...(patch.listed !== undefined ? { listedAt: patch.listed ? now : null } : {}),
      ...(patch.encrypted !== undefined ? { encryptedAt: patch.encrypted ? now : null } : {}),
      ...(patch.mutedUntil !== undefined ? { mutedUntil: patch.mutedUntil === "forever" ? FOREVER : patch.mutedUntil } : {}),
    };
    const after = [...before.filter((p) => p.conversationId !== id), next];
    queryClient.setQueryData<ChatPref[]>(KEY, after);
    if (patch.encrypted !== undefined) setEncryptedChats(after);
    try {
      await setChatPref(id, patch);
    } catch {
      queryClient.setQueryData<ChatPref[]>(KEY, before);
      setEncryptedChats(before);
      toastError(_translateCopy("chatMenu.saveFailed", { defaultValue: "Couldn't save that, try again" }));
    }
  }, [queryClient]);

  /** Clear a chat's waiting reactions (it is open). Quiet: only calls out when there are some. */
  const seeReactions = useCallback((id: string) => {
    if (!byId.get(id)?.reactions) return;
    queryClient.setQueryData<ChatPref[]>(KEY, (cur = []) => cur.map((p) => (p.conversationId === id ? { ...p, reactions: null } : p)));
    setChatPref(id, { seenReactions: true }).catch(() => undefined);
  }, [byId, queryClient]);

  /** Someone reacted: fetch the list's badges now. */
  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: KEY });
  }, [queryClient]);

  return { byId, update, seeReactions, refresh };
}
