import { useCallback, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toastError } from "../libs/toast";
import {
  DEFAULT_CHAT_TABS, MAX_CHAT_TABS, getChatTabs, saveChatTabs,
  type ChatTab, type ChatTabsState,
} from "../services/dm/dm.api";

const KEY = ["dm-chat-tabs"] as const;

export type { ChatTabView } from "../libs/chat-tabs";
import { newTabId, orderedTabs } from "../libs/chat-tabs";

/**
 * Your Chat tabs, saved to your account (the same store the website uses).
 * Changes show at once and roll back if the save fails.
 */
export function useChatTabs(enabled = true) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { data } = useQuery({ queryKey: KEY, queryFn: getChatTabs, enabled, staleTime: 60_000 });
  const state = data ?? DEFAULT_CHAT_TABS;

  const commit = useCallback(async (change: (s: ChatTabsState) => ChatTabsState) => {
    const before = queryClient.getQueryData<ChatTabsState>(KEY) ?? DEFAULT_CHAT_TABS;
    const next = change(before);
    queryClient.setQueryData<ChatTabsState>(KEY, next);
    try {
      const saved = await saveChatTabs(next);
      if (saved) queryClient.setQueryData<ChatTabsState>(KEY, saved);
    } catch {
      queryClient.setQueryData<ChatTabsState>(KEY, before);
      toastError(t("chatTabs.saveFailed", { defaultValue: "Couldn't save your tabs, try again" }));
    }
  }, [queryClient, t]);

  const builtinName = useCallback((id: string) => ({
    all: t("chatTabs.all", { defaultValue: "All" }),
    unread: t("messagesTabs.unread", { defaultValue: "Unread" }),
    direct: t("chatTabs.direct", { defaultValue: "Direct" }),
    communities: t("chatTabs.communities", { defaultValue: "Communities" }),
    requests: t("chatTabs.requests", { defaultValue: "Requests" }),
  } as Record<string, string>)[id] ?? id, [t]);

  const tabs = useMemo(() => orderedTabs(state, builtinName), [state, builtinName]);

  const api = useMemo(() => ({
    canAdd: state.tabs.length < MAX_CHAT_TABS,
    create: (tab: Omit<ChatTab, "id">) => {
      const id = newTabId();
      void commit((s) => ({ ...s, tabs: [...s.tabs, { ...tab, id }], order: [...s.order.filter((x) => x !== id), id] }));
      return id;
    },
    update: (id: string, patch: Partial<Omit<ChatTab, "id">>) =>
      commit((s) => ({ ...s, tabs: s.tabs.map((x) => (x.id === id ? { ...x, ...patch } : x)) })),
    remove: (id: string) =>
      commit((s) => ({ ...s, tabs: s.tabs.filter((x) => x.id !== id), order: s.order.filter((x) => x !== id) })),
    toggleChat: (tabId: string, chatId: string) =>
      commit((s) => ({
        ...s,
        tabs: s.tabs.map((x) => (x.id !== tabId ? x : {
          ...x, chats: x.chats.includes(chatId) ? x.chats.filter((c) => c !== chatId) : [...x.chats, chatId],
        })),
      })),
    setHidden: (id: string, hidden: boolean) =>
      commit((s) => ({ ...s, hidden: hidden ? [...new Set([...s.hidden, id])] : s.hidden.filter((x) => x !== id) })),
    reorder: (ids: string[]) => commit((s) => ({ ...s, order: ids })),
  }), [commit, state.tabs.length]);

  return { tabs, state, ...api };
}
