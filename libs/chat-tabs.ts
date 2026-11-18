import { BUILTIN_CHAT_TABS, type ChatTabsState } from "../services/dm/dm.api";

export interface ChatTabView {
  id: string;
  name: string;
  emoji: string;
  builtin: boolean;
  hidden: boolean;
  chats: string[];
}

export const newTabId = () => `t_${Math.random().toString(36).slice(2, 10)}`;

/** The tabs in the person's order, built-ins included, nothing lost. Same as the website. */
export function orderedTabs(state: ChatTabsState, builtinName: (id: string) => string): ChatTabView[] {
  const byId = new Map<string, ChatTabView>();
  for (const id of BUILTIN_CHAT_TABS) byId.set(id, { id, name: builtinName(id), emoji: "", builtin: true, hidden: id !== "all" && state.hidden.includes(id), chats: [] });
  for (const t of state.tabs) byId.set(t.id, { id: t.id, name: t.name, emoji: t.emoji, builtin: false, hidden: false, chats: t.chats });
  const out: ChatTabView[] = [];
  for (const id of state.order) { const t = byId.get(id); if (t) { out.push(t); byId.delete(id); } }
  return [...out, ...byId.values()];
}

