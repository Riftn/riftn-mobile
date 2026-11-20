import React, { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Text, TextInput, TouchableOpacity, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Icon from "../ui/Icon";
import Avatar from "../common/Avatar";
import { getAvatarUrl } from "../../libs/misc";
import { storage } from "../../libs/storage";
import { normalizeMsg } from "../../libs/livechat-normalize";
import {
  searchLiveChat,
  type LiveChatMessageData,
  type LiveChatSearchPerson,
  type LiveChatSearchResponse,
} from "../../services/livechat.service";

import { formatCount } from '../../libs/format-count';
/** Where a chat's search reads from: the public chat by default, or a group's table. */
export type ChatSearchSource = (params: { q?: string; from?: string; before?: string }) => Promise<LiveChatSearchResponse>;

/*
 * Search inside the public chat, in one box.
 *
 * Type a word and the room's whole history is searched. Type a name and the
 * people who match come first; picking one turns them into a tag in the box,
 * lists everything they said, and typing on searches inside that. A result
 * opens the chat on that line, and a small pill steps through the rest.
 * Same flow as the web chat search.
 */

export interface ChatSearchPerson {
  address: string;
  name: string;
  avatarUrl?: string;
  messageCount?: number;
}

export const chatSearchPerson = (p: {
  address: string;
  displayName?: string;
  username?: string;
  avatarUrl?: string;
  messageCount?: number;
}): ChatSearchPerson => ({
  address: p.address,
  name: p.displayName || p.username || `${p.address.slice(0, 6)}…`,
  avatarUrl: p.avatarUrl,
  messageCount: p.messageCount,
});

const RECENT_KEY = "livechat:search:recent";
const RECENT_MAX = 5;

function readRecent(): string[] {
  try {
    const raw = JSON.parse(storage.getString(RECENT_KEY) || "[]");
    return Array.isArray(raw) ? raw.filter((v) => typeof v === "string").slice(0, RECENT_MAX) : [];
  } catch {
    return [];
  }
}

/** Remember a search that led somewhere, newest first. */
export function rememberChatSearch(text: string) {
  const q = text.trim();
  if (q.length < 2) return;
  try {
    const next = [q, ...readRecent().filter((v) => v.toLowerCase() !== q.toLowerCase())].slice(0, RECENT_MAX);
    storage.set(RECENT_KEY, JSON.stringify(next));
  } catch {
    // The search still works, it is just not remembered.
  }
}

interface SearchState {
  results: LiveChatMessageData[];
  people: ChatSearchPerson[];
  total: number | null;
  hasMore: boolean;
  loading: boolean;
  loadingMore: boolean;
  failed: boolean;
}

const EMPTY: SearchState = { results: [], people: [], total: null, hasMore: false, loading: false, loadingMore: false, failed: false };

/** The room's matches for what is in the box, re-read as it changes. */
export function useChatSearch(enabled: boolean, text: string, from: string | null, source: ChatSearchSource = searchLiveChat) {
  const [state, setState] = useState<SearchState>(EMPTY);
  const run = useRef(0);
  const q = text.trim();

  useEffect(() => {
    if (!enabled) {
      run.current += 1;
      setState(EMPTY);
      return;
    }
    const mine = ++run.current;
    setState((s) => ({ ...s, loading: true, failed: false }));
    // Typing waits a beat; opening the box or picking a person does not.
    const timer = setTimeout(async () => {
      try {
        const page = await source({ q, from: from ?? undefined });
        if (run.current !== mine) return;
        setState({
          results: (page.messages || []).map(normalizeMsg),
          people: (page.people || []).map((p: LiveChatSearchPerson) => chatSearchPerson(p)),
          total: page.total ?? null,
          hasMore: !!page.hasMore,
          loading: false,
          loadingMore: false,
          failed: false,
        });
      } catch {
        if (run.current === mine) setState({ ...EMPTY, failed: true });
      }
    }, q ? 260 : 0);
    return () => clearTimeout(timer);
  }, [enabled, q, from, source]);

  const stateRef = useRef(state);
  stateRef.current = state;
  const loadMore = useCallback(async (): Promise<LiveChatMessageData[]> => {
    const now = stateRef.current;
    const last = now.results[now.results.length - 1];
    if (!last || !now.hasMore || now.loadingMore) return [];
    const mine = run.current;
    setState((s) => ({ ...s, loadingMore: true }));
    try {
      const page = await source({ q, from: from ?? undefined, before: last._id });
      if (run.current !== mine) return [];
      const rows = (page.messages || []).map(normalizeMsg);
      setState((s) => ({ ...s, results: [...s.results, ...rows], hasMore: !!page.hasMore, loadingMore: false }));
      return rows;
    } catch {
      if (run.current === mine) setState((s) => ({ ...s, loadingMore: false }));
      return [];
    }
  }, [q, from, source]);

  return { ...state, loadMore };
}

export type ChatSearch = ReturnType<typeof useChatSearch>;

/** The typed words picked out wherever they appear in a line. */
function Highlight({ text, query }: { text: string; query: string }) {
  const q = query.trim();
  if (!q) return <>{text}</>;
  const lower = text.toLowerCase();
  const needle = q.toLowerCase();
  const parts: React.ReactNode[] = [];
  let at = 0;
  for (let hit = lower.indexOf(needle); hit !== -1; hit = lower.indexOf(needle, at)) {
    if (hit > at) parts.push(text.slice(at, hit));
    parts.push(
      <Text key={hit} style={{ backgroundColor: "#FCD34D", color: "#000000" }}>
        {text.slice(hit, hit + q.length)}
      </Text>,
    );
    at = hit + q.length;
  }
  if (at < text.length) parts.push(text.slice(at));
  return <>{parts}</>;
}

const Face = ({ person, size = 36 }: { person: ChatSearchPerson; size?: number }) => (
  <Avatar uri={getAvatarUrl(person.avatarUrl || "")} size={size} name={person.name} />
);

const shortDate = (iso: string, lang?: string) => {
  const d = new Date(iso);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString(lang || undefined, sameYear ? { day: "numeric", month: "short" } : { day: "numeric", month: "short", year: "numeric" });
};

const SectionLabel = ({ children, count }: { children: React.ReactNode; count?: React.ReactNode }) => (
  <View className="flex-row items-center justify-between px-4 pt-3 pb-1">
    <Text className="text-white/50 text-[11px] font-semibold uppercase" style={{ letterSpacing: 0.6 }}>{children}</Text>
    {count != null ? <Text className="text-white/50 text-[11px] font-semibold">{typeof count === "number" || typeof count === "string" ? formatCount(count) : count}</Text> : null}
  </View>
);

interface LiveChatSearchProps {
  text: string;
  person: ChatSearchPerson | null;
  search: ChatSearch;
  /** The result the chat was last opened on, tinted when the list comes back. */
  activeId: string | null;
  onText: (text: string) => void;
  onPickPerson: (person: ChatSearchPerson | null) => void;
  onOpenResult: (index: number) => void;
  onClose: () => void;
}

/** The search box and what it found, over the whole chat screen. */
export default function LiveChatSearch({ text, person, search, activeId, onText, onPickPerson, onOpenResult, onClose }: LiveChatSearchProps) {
  const { t, i18n } = useTranslation();
  const insets = useSafeAreaInsets();
  const inputRef = useRef<TextInput>(null);
  const [recent] = useState(readRecent);
  const q = text.trim();
  const idle = !q && !person;
  const firstName = person?.name.split(" ")[0] ?? "";

  const waiting = search.loading && !search.results.length && !search.people.length;
  const nothing = !search.loading && !idle && !search.results.length && !(search.people.length && !person);
  const showPeople = !idle && !person && search.people.length > 0;

  const messageLabel = (m: LiveChatMessageData) => {
    if (m.content?.trim()) return <Highlight text={m.content} query={q} />;
    if (m.messageType === "gif") return "GIF";
    if (m.messageType === "audio" || m.messageType === "voice") return t("chatSearch.voice", { defaultValue: "Voice message" });
    return t("chatSearch.photo", { defaultValue: "Photo" });
  };

  const header = idle ? (
    <>
      {recent.length ? (
        <>
          <SectionLabel>{t("chatSearch.recent", { defaultValue: "Recent searches" })}</SectionLabel>
          {recent.map((r) => (
            <TouchableOpacity key={r} onPress={() => onText(r)} activeOpacity={0.7} accessibilityRole="button" className="flex-row items-center px-4 py-3" style={{ gap: 12 }}>
              <Icon name="Search" size={16} color="#71717A" />
              <Text numberOfLines={1} className="text-white/85 text-sm flex-1">{r}</Text>
            </TouchableOpacity>
          ))}
        </>
      ) : null}
      {search.people.length ? (
        <SectionLabel count={search.people.length}>{t("chatSearch.peopleHere", { defaultValue: "People in this chat" })}</SectionLabel>
      ) : waiting ? (
        <View className="py-8 items-center"><ActivityIndicator size="small" color="rgba(255,255,255,0.4)" /></View>
      ) : null}
      {!search.people.length && !recent.length && !waiting ? (
        <Text className="text-white/50 text-sm text-center px-6 pt-10">{t("chatSearch.hint", { defaultValue: "Type a word or a name." })}</Text>
      ) : null}
    </>
  ) : waiting ? (
    <View className="py-10 items-center"><ActivityIndicator size="small" color="rgba(255,255,255,0.4)" /></View>
  ) : search.failed || nothing ? (
    <View className="items-center px-6 pt-16">
      <Icon name="Search" size={40} color="rgba(255,255,255,0.18)" />
      <Text className="text-white text-sm font-semibold mt-3">
        {search.failed ? t("chatSearch.failed", { defaultValue: "Search could not load" }) : t("publicChat.noResults")}
      </Text>
    </View>
  ) : (
    <>
      {showPeople ? (
        <>
          <SectionLabel>{t("chatSearch.people", { defaultValue: "People" })}</SectionLabel>
          {search.people.map((p) => (
            <TouchableOpacity key={p.address} onPress={() => onPickPerson(p)} activeOpacity={0.7} accessibilityRole="button" className="flex-row items-center px-4 py-2" style={{ gap: 12 }}>
              <Face person={p} />
              <View className="flex-1">
                <Text numberOfLines={1} className="text-white text-sm font-semibold"><Highlight text={p.name} query={q.replace(/^@+/, "")} /></Text>
                <Text numberOfLines={1} className="text-white/60 text-xs">{t("chatSearch.seeCount", { defaultValue: "See their {{count}} messages", count: p.messageCount ?? 0 })}</Text>
              </View>
            </TouchableOpacity>
          ))}
        </>
      ) : null}
      {search.results.length ? (
        <SectionLabel count={showPeople && search.total != null ? search.total : undefined}>
          {showPeople
            ? t("chatSearch.messages", { defaultValue: "Messages" })
            : q
              ? t("chatSearch.results", { defaultValue: "{{count}} results", count: search.total ?? search.results.length })
              : t("chatSearch.messagesCount", { defaultValue: "{{count}} messages", count: search.total ?? search.results.length })}
        </SectionLabel>
      ) : null}
    </>
  );

  const showRows = !idle && !waiting && !search.failed && !nothing;

  return (
    <View className="bg-theme-background" style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0, paddingTop: insets.top, zIndex: 30 }}>
      <View className="flex-row items-center px-3 py-2 border-b border-white/10" style={{ gap: 6 }}>
        <TouchableOpacity onPress={onClose} accessibilityRole="button" accessibilityLabel={t("chatSearch.close", { defaultValue: "Close search" })} style={{ width: 36, height: 40, alignItems: "center", justifyContent: "center" }}>
          <Icon name="ArrowLeft" size={22} color="#A1A1AA" />
        </TouchableOpacity>
        <View className="flex-1 flex-row items-center rounded-full border border-white/10 bg-white/5" style={{ minHeight: 40, paddingLeft: 6, paddingRight: 10, gap: 6 }}>
          {person ? (
            <TouchableOpacity
              onPress={() => onPickPerson(null)}
              accessibilityRole="button"
              accessibilityLabel={t("chatSearch.removePerson", { defaultValue: "Search everyone" })}
              activeOpacity={0.8}
              className="flex-row items-center rounded-full bg-white"
              style={{ maxWidth: "48%", paddingVertical: 3, paddingLeft: 3, paddingRight: 8, gap: 6 }}
            >
              <Face person={person} size={22} />
              <Text numberOfLines={1} className="text-black text-xs font-semibold" style={{ flexShrink: 1 }}>{firstName}</Text>
              <Icon name="X" size={12} color="#000000" />
            </TouchableOpacity>
          ) : (
            <View style={{ marginLeft: 6 }}><Icon name="Search" size={16} color="#71717A" /></View>
          )}
          <TextInput
            ref={inputRef}
            autoFocus
            value={text}
            onChangeText={onText}
            onKeyPress={(e) => {
              // An empty box and Backspace lifts the person tag, like any tag field.
              if (e.nativeEvent.key === "Backspace" && !text && person) onPickPerson(null);
            }}
            returnKeyType="search"
            autoCapitalize="none"
            autoCorrect={false}
            placeholder={person
              ? t("chatSearch.placeholderPerson", { defaultValue: "Search {{name}}'s messages", name: firstName })
              : t("chatSearch.placeholder", { defaultValue: "Search messages or people" })}
            placeholderTextColor="#71717A"
            accessibilityLabel={t("publicChat.searchMessages")}
            className="flex-1 text-white text-sm"
            style={{ paddingVertical: 8 }}
          />
          {text ? (
            <TouchableOpacity onPress={() => { onText(""); inputRef.current?.focus(); }} accessibilityRole="button" accessibilityLabel={t("chatSearch.clear", { defaultValue: "Clear" })} hitSlop={8}>
              <Icon name="X" size={16} color="#71717A" />
            </TouchableOpacity>
          ) : null}
        </View>
      </View>

      {idle ? (
        <FlatList
          data={search.people}
          keyExtractor={(p) => p.address}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          ListHeaderComponent={header}
          initialNumToRender={20}
          contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
          renderItem={({ item: p }) => (
            <TouchableOpacity onPress={() => onPickPerson(p)} activeOpacity={0.7} accessibilityRole="button" accessibilityLabel={p.name} className="flex-row items-center px-4 py-2" style={{ gap: 12 }}>
              <Face person={p} />
              <View className="flex-1">
                <Text numberOfLines={1} className="text-white text-sm font-semibold">{p.name}</Text>
                <Text numberOfLines={1} className="text-white/60 text-xs">{t("chatSearch.messagesCount", { defaultValue: "{{count}} messages", count: p.messageCount ?? 0 })}</Text>
              </View>
            </TouchableOpacity>
          )}
        />
      ) : (
      <FlatList
        data={showRows ? search.results : []}
        keyExtractor={(m) => m._id}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        ListHeaderComponent={header}
        onEndReached={() => { void search.loadMore(); }}
        onEndReachedThreshold={0.6}
        contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
        ListFooterComponent={search.loadingMore ? <View className="py-3 items-center"><ActivityIndicator size="small" color="rgba(255,255,255,0.4)" /></View> : null}
        renderItem={({ item: m, index }) => {
          const who = chatSearchPerson({ ...(m.sender || {}), address: m.sender?.address || m.senderAddress });
          return (
            <TouchableOpacity
              onPress={() => onOpenResult(index)}
              activeOpacity={0.7}
              accessibilityRole="button"
              className={`flex-row items-center px-4 py-2 ${activeId === m._id ? "bg-white/10" : ""}`}
              style={{ gap: 12 }}
            >
              <Face person={who} />
              <View className="flex-1">
                <View className="flex-row items-baseline justify-between" style={{ gap: 8 }}>
                  <Text numberOfLines={1} className="text-white text-sm font-semibold" style={{ flexShrink: 1 }}>{who.name}</Text>
                  <Text className="text-white/50 text-[11px]">{shortDate(m.createdAt, i18n.language)}</Text>
                </View>
                <Text numberOfLines={1} className="text-white/75 text-sm">{messageLabel(m)}</Text>
              </View>
            </TouchableOpacity>
          );
        }}
      />
      )}
    </View>
  );
}

/* ── Stepping through results once the chat is on one ────────────────── */

interface LiveChatSearchPillProps {
  position: number;
  total: number;
  busy: boolean;
  canOlder: boolean;
  canNewer: boolean;
  onList: () => void;
  onOlder: () => void;
  onNewer: () => void;
  onClose: () => void;
}

export function LiveChatSearchPill({ position, total, busy, canOlder, canNewer, onList, onOlder, onNewer, onClose }: LiveChatSearchPillProps) {
  const { t } = useTranslation();
  const step = { width: 36, height: 36, alignItems: "center" as const, justifyContent: "center" as const };
  return (
    <View
      className="flex-row items-center rounded-full bg-white"
      style={{ padding: 4, shadowColor: "#000", shadowOpacity: 0.35, shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, elevation: 8 }}
    >
      <TouchableOpacity onPress={onList} style={step} accessibilityRole="button" accessibilityLabel={t("chatSearch.backToResults", { defaultValue: "Back to results" })}>
        <Icon name="List" size={18} color="#000000" />
      </TouchableOpacity>
      <View style={{ minWidth: 76, alignItems: "center", paddingHorizontal: 4 }}>
        {busy
          ? <ActivityIndicator size="small" color="#000000" />
          : <Text className="text-black text-xs font-semibold" style={{ fontVariant: ["tabular-nums"] }}>{t("chatSearch.position", { defaultValue: "{{current}} of {{total}}", current: position, total })}</Text>}
      </View>
      <TouchableOpacity onPress={onOlder} disabled={!canOlder || busy} style={[step, { opacity: !canOlder || busy ? 0.35 : 1 }]} accessibilityRole="button" accessibilityLabel={t("chatSearch.older", { defaultValue: "Older result" })}>
        <Icon name="ChevronUp" size={18} color="#000000" />
      </TouchableOpacity>
      <TouchableOpacity onPress={onNewer} disabled={!canNewer || busy} style={[step, { opacity: !canNewer || busy ? 0.35 : 1 }]} accessibilityRole="button" accessibilityLabel={t("chatSearch.newer", { defaultValue: "Newer result" })}>
        <Icon name="ChevronDown" size={18} color="#000000" />
      </TouchableOpacity>
      <TouchableOpacity onPress={onClose} style={step} accessibilityRole="button" accessibilityLabel={t("chatSearch.close", { defaultValue: "Close search" })}>
        <Icon name="X" size={16} color="#000000" />
      </TouchableOpacity>
    </View>
  );
}
