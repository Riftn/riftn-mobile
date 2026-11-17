import { useCallback, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getChatPrefs, setChatPref, type ChatPref } from "../services/dm/dm.api";
import { toastError } from "../libs/toast";
import { translateCopy as _translateCopy } from "../i18n/copy";

const KEY = ["dm-chat-prefs"] as const;

type Patch = { pinned?: boolean; archived?: boolean; unread?: boolean; listed?: boolean };

/**
 * Your own chat settings, saved on the server so they follow you between
 * devices (the same store the website uses). Changes show at once and roll
 * back if the save fails.
 */
export function useChatPrefs(enabled = true) {
  const queryClient = useQueryClient();
  const { data } = useQuery({ queryKey: KEY, queryFn: getChatPrefs, enabled, staleTime: 60_000 });

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
    };
    queryClient.setQueryData<ChatPref[]>(KEY, [...before.filter((p) => p.conversationId !== id), next]);
    try {
      await setChatPref(id, patch);
    } catch {
      queryClient.setQueryData<ChatPref[]>(KEY, before);
      toastError(_translateCopy("chatMenu.saveFailed", { defaultValue: "Couldn't save that, try again" }));
    }
  }, [queryClient]);

  return { byId, update };
}
