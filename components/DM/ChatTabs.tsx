import React, { useEffect, useRef, useState } from "react";
import { Alert, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, Text, TextInput, TouchableOpacity, View } from "react-native";
import { Image } from "expo-image";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import Icon from "../ui/Icon";
import { MAX_CHAT_TAB_NAME } from "../../services/dm/dm.api";
import type { ChatTabView } from "../../hooks/useChatTabs";

/*
 * Tabs above the chat list: All, Direct, Groups, Requests and the tabs
 * a person makes. Same tabs as riftn.com/chat (saved to the account).
 * Hold a tab for its options.
 */

const CHIP = { height: 32, borderRadius: 16, paddingHorizontal: 12, flexDirection: "row" as const, alignItems: "center" as const, gap: 6 };
// The open tab gets a glowing white line under its label, same as the web
// tabs on Messages and /chat (no filled pill).
const BEAM = { position: "absolute" as const, left: 12, right: 12, bottom: 0, height: 2, borderRadius: 2, backgroundColor: "#fff", shadowColor: "#fff", shadowOpacity: 0.9, shadowRadius: 5, shadowOffset: { width: 0, height: 0 } };
// Android has no coloured shadows, so a soft wider band fakes the glow.
const HALO = { position: "absolute" as const, left: 8, right: 8, bottom: -2, height: 6, borderRadius: 3, backgroundColor: "rgba(255,255,255,0.16)" };
const SHEET_BG = "#0e0e10";

export function ChatTabBar({ tabs, active, unread, onSelect, onNew, onManage, onHold, bare }: {
  tabs: ChatTabView[];
  active: string;
  unread: Record<string, number>;
  onSelect: (id: string) => void;
  onNew: () => void;
  onManage: () => void;
  onHold: (tab: ChatTabView) => void;
  /** Only the chips: new tab and edit tabs live in the Messages menu, pinned beside the row. */
  bare?: boolean;
}) {
  const { t } = useTranslation();
  const scroller = useRef<ScrollView>(null);
  const xs = useRef<Record<string, number>>({});
  useEffect(() => {
    const x = xs.current[active];
    if (x !== undefined) scroller.current?.scrollTo({ x: Math.max(0, x - 40), animated: true });
  }, [active]);
  return (
    <ScrollView
      ref={scroller}
      horizontal
      showsHorizontalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={bare
        ? { paddingLeft: 12, paddingRight: 18, gap: 4, alignItems: "center" }
        : { paddingHorizontal: 12, paddingTop: 4, paddingBottom: 8, gap: 4, alignItems: "center" }}
      style={bare ? { flex: 1 } : { flexGrow: 0 }}
      testID="chat-tabs"
    >
      {tabs.filter((x) => !x.hidden).map((tab) => {
        const on = tab.id === active;
        const n = unread[tab.id] || 0;
        return (
          <Pressable
            key={tab.id}
            testID={`chat-tab-${tab.id}`}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            onLayout={(e) => { xs.current[tab.id] = e.nativeEvent.layout.x; }}
            onPress={() => onSelect(tab.id)}
            onLongPress={() => onHold(tab)}
            delayLongPress={350}
            style={CHIP}
          >
            {on && Platform.OS === "android" && <View pointerEvents="none" style={HALO} />}
            {on && <View pointerEvents="none" testID="chat-tab-beam" style={BEAM} />}
            {!!tab.emoji && <Text style={{ fontSize: 13 }}>{tab.emoji}</Text>}
            <Text style={{ color: on ? "#fff" : "#A1A1AA", fontSize: 13, fontWeight: "600" }} numberOfLines={1}>{tab.name}</Text>
            {n > 0 && (
              <View style={{ minWidth: 18, height: 18, borderRadius: 6, paddingHorizontal: 5, alignItems: "center", justifyContent: "center", backgroundColor: on ? "#fff" : "rgba(255,255,255,0.09)" }}>
                <Text style={{ color: on ? "#0b0b0c" : "#D4D4D8", fontSize: 11, fontWeight: "700", fontVariant: ["tabular-nums"] }}>{n > 99 ? "99+" : String(n)}</Text>
              </View>
            )}
          </Pressable>
        );
      })}
      {!bare && (<>
      <TouchableOpacity testID="chat-tab-new" onPress={onNew} accessibilityRole="button" accessibilityLabel={t("chatTabs.new", { defaultValue: "New tab" })}
        style={[CHIP, { width: 32, paddingHorizontal: 0, justifyContent: "center" }]}>
        <Icon name="Plus" size={16} color="#71717A" />
      </TouchableOpacity>
      <TouchableOpacity testID="chat-tab-manage" onPress={onManage} accessibilityRole="button" accessibilityLabel={t("chatTabs.edit", { defaultValue: "Edit tabs" })}
        style={[CHIP, { width: 32, paddingHorizontal: 0, justifyContent: "center" }]}>
        <Icon name="SlidersHorizontal" size={16} color="#71717A" />
      </TouchableOpacity>
      </>)}
    </ScrollView>
  );
}

/** A bottom sheet over everything. */
function Sheet({ visible, title, onClose, children, footer }: { visible: boolean; title?: string; onClose: () => void; children: React.ReactNode; footer?: React.ReactNode }) {
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <Pressable style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.55)" }} onPress={onClose} />
        <View style={{ maxHeight: "88%", backgroundColor: SHEET_BG, borderTopLeftRadius: 26, borderTopRightRadius: 26, borderWidth: 1, borderColor: "rgba(255,255,255,0.1)", paddingBottom: Math.max(14, insets.bottom) }}>
          <View style={{ alignSelf: "center", width: 40, height: 5, borderRadius: 3, backgroundColor: "rgba(255,255,255,0.2)", marginTop: 8 }} />
          {!!title && (
            <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 20, paddingTop: 14, paddingBottom: 8 }}>
              <Text style={{ flex: 1, color: "#fff", fontSize: 18, fontWeight: "700" }}>{title}</Text>
              <TouchableOpacity onPress={onClose} hitSlop={8} accessibilityRole="button" accessibilityLabel={t("common.close", { defaultValue: "Close" })}>
                <Icon name="X" size={18} color="#A1A1AA" />
              </TouchableOpacity>
            </View>
          )}
          <ScrollView style={{ paddingHorizontal: 20 }} keyboardShouldPersistTaps="handled">{children}</ScrollView>
          {footer && <View style={{ flexDirection: "row", gap: 10, paddingHorizontal: 20, paddingTop: 12 }}>{footer}</View>}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function Btn({ label, onPress, kind = "ghost", disabled, testID, flex = true, children }: { label?: string; onPress: () => void; kind?: "white" | "ghost" | "red"; disabled?: boolean; testID?: string; flex?: boolean; children?: React.ReactNode }) {
  const bg = kind === "white" ? "#F4F4F5" : kind === "red" ? "rgba(239,68,68,0.15)" : "rgba(255,255,255,0.08)";
  const fg = kind === "white" ? "#000" : kind === "red" ? "#fca5a5" : "#fff";
  return (
    <TouchableOpacity testID={testID} onPress={onPress} disabled={disabled} accessibilityRole="button"
      style={{ flex: flex ? 1 : undefined, height: 44, borderRadius: 12, paddingHorizontal: 16, flexDirection: "row", gap: 8, alignItems: "center", justifyContent: "center", backgroundColor: bg, opacity: disabled ? 0.35 : 1 }}>
      {children}
      {!!label && <Text style={{ color: fg, fontSize: 14, fontWeight: "700" }}>{label}</Text>}
    </TouchableOpacity>
  );
}

export interface TabCandidate {
  id: string;
  name: string;
  avatar?: string;
  /** A bundled image (Public Chat's logo). */
  source?: number;
  kind: string;
  round?: boolean;
}

const EMOJIS = ["💼", "🤝", "🎧", "🎮", "💸", "📈", "🔥", "⭐", "🏠", "🎬", "🌙", "🧪"];

export function ChatTabEditor({ visible, initial, candidates, onSave, onDelete, onClose }: {
  visible: boolean;
  initial: { id?: string; name: string; emoji: string; chats: string[] } | null;
  candidates: TabCandidate[];
  onSave: (tab: { name: string; emoji: string; chats: string[] }) => void;
  onDelete?: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const editing = !!initial?.id;
  const [name, setName] = useState("");
  const [emoji, setEmoji] = useState("");
  const [chats, setChats] = useState<string[]>([]);
  const [q, setQ] = useState("");
  const [emojiOpen, setEmojiOpen] = useState(false);
  useEffect(() => {
    if (!visible) return;
    setName(initial?.name ?? ""); setEmoji(initial?.emoji ?? ""); setChats(initial?.chats ?? []); setQ(""); setEmojiOpen(false);
  }, [visible, initial]);
  const ql = q.trim().toLowerCase();
  const shown = candidates.filter((c) => !ql || c.name.toLowerCase().includes(ql));
  const ok = name.trim().length > 0;
  const save = () => { if (ok) onSave({ name: name.trim(), emoji, chats }); };
  const toggle = (id: string) => setChats((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  const suggestions = [
    t("chatTabs.sFriends", { defaultValue: "Friends" }), t("chatTabs.sWork", { defaultValue: "Work" }),
    t("chatTabs.sTrading", { defaultValue: "Trading" }), t("chatTabs.sCreators", { defaultValue: "Creators" }),
    t("chatTabs.sGaming", { defaultValue: "Gaming" }),
  ];
  return (
    <Sheet
      visible={visible}
      title={editing ? t("chatTabs.editTab", { defaultValue: "Edit tab" }) : t("chatTabs.new", { defaultValue: "New tab" })}
      onClose={onClose}
      footer={(
        <>
          {editing && onDelete && <Btn kind="red" flex={false} onPress={onDelete} testID="chat-tab-delete"><Icon name="Trash2" size={16} color="#fca5a5" /></Btn>}
          <Btn label={t("common.cancel", { defaultValue: "Cancel" })} onPress={onClose} />
          <Btn kind="white" testID="chat-tab-save" disabled={!ok} onPress={save}
            label={editing ? t("common.save", { defaultValue: "Save" }) : t("chatTabs.create", { defaultValue: "Create tab" })} />
        </>
      )}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10, height: 48, borderRadius: 14, paddingHorizontal: 10, backgroundColor: "rgba(255,255,255,0.06)", borderWidth: 1, borderColor: "rgba(255,255,255,0.22)" }}>
        <TouchableOpacity onPress={() => setEmojiOpen((o) => !o)} accessibilityRole="button" accessibilityLabel={t("chatTabs.emoji", { defaultValue: "Pick an emoji" })}
          style={{ width: 32, height: 32, borderRadius: 9, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.08)" }}>
          {emoji ? <Text style={{ fontSize: 17 }}>{emoji}</Text> : <Icon name="Plus" size={15} color="#A1A1AA" />}
        </TouchableOpacity>
        <TextInput
          testID="chat-tab-name"
          value={name}
          onChangeText={setName}
          maxLength={MAX_CHAT_TAB_NAME}
          autoFocus={!editing}
          onSubmitEditing={save}
          returnKeyType="done"
          placeholder={t("chatTabs.namePlaceholder", { defaultValue: "Tab name" })}
          placeholderTextColor="#71717A"
          style={{ flex: 1, color: "#fff", fontSize: 16, fontWeight: "600" }}
        />
        <Text style={{ color: "#71717A", fontSize: 12 }}>{`${[...name].length}/${MAX_CHAT_TAB_NAME}`}</Text>
      </View>
      {emojiOpen && (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
          {EMOJIS.map((e) => (
            <TouchableOpacity key={e} onPress={() => { setEmoji(e); setEmojiOpen(false); }}
              style={{ width: 38, height: 38, borderRadius: 11, alignItems: "center", justifyContent: "center", backgroundColor: emoji === e ? "rgba(255,255,255,0.15)" : "rgba(255,255,255,0.05)", borderWidth: emoji === e ? 1.5 : 0, borderColor: "#fff" }}>
              <Text style={{ fontSize: 18 }}>{e}</Text>
            </TouchableOpacity>
          ))}
          <TouchableOpacity onPress={() => { setEmoji(""); setEmojiOpen(false); }} accessibilityLabel={t("chatTabs.noEmoji", { defaultValue: "No emoji" })}
            style={{ width: 38, height: 38, borderRadius: 11, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.05)" }}>
            <Icon name="X" size={15} color="#A1A1AA" />
          </TouchableOpacity>
        </View>
      )}
      {!editing && (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 12 }}>
          {suggestions.map((s) => (
            <TouchableOpacity key={s} onPress={() => setName(s)} style={{ height: 30, borderRadius: 15, paddingHorizontal: 11, justifyContent: "center", backgroundColor: "rgba(255,255,255,0.05)", borderWidth: 1, borderColor: "rgba(255,255,255,0.1)" }}>
              <Text style={{ color: "#D4D4D8", fontSize: 12.5, fontWeight: "600" }}>{s}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}
      <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 20, marginBottom: 8 }}>
        <Text style={{ color: "#71717A", fontSize: 11, fontWeight: "700", letterSpacing: 1.5 }}>{t("chatTabs.chatsInTab", { defaultValue: "Chats in this tab" }).toUpperCase()}</Text>
        <Text style={{ color: "#D4D4D8", fontSize: 12 }}>{t("chatTabs.picked", { defaultValue: "{{n}} picked", n: chats.length })}</Text>
      </View>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, height: 40, borderRadius: 12, paddingHorizontal: 12, backgroundColor: "rgba(255,255,255,0.05)" }}>
        <Icon name="Search" size={15} color="#71717A" />
        <TextInput value={q} onChangeText={setQ} placeholder={t("messages.searchConversations")} placeholderTextColor="#71717A" style={{ flex: 1, color: "#fff", fontSize: 14 }} />
      </View>
      <View style={{ marginTop: 6, paddingBottom: 6 }}>
        {shown.map((c) => {
          const on = chats.includes(c.id);
          return (
            <TouchableOpacity key={c.id} testID={`chat-tab-pick-${c.id}`} onPress={() => toggle(c.id)} activeOpacity={0.7}
              style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 8 }}>
              <View style={{ width: 40, height: 40, borderRadius: c.round ? 20 : 9, overflow: "hidden", backgroundColor: "rgba(255,255,255,0.08)", alignItems: "center", justifyContent: "center" }}>
                {c.source !== undefined ? <Image source={c.source} style={{ width: 26, height: 26 }} contentFit="contain" />
                  : c.avatar ? <Image source={{ uri: c.avatar }} style={{ width: 40, height: 40 }} contentFit="cover" />
                  : <Text style={{ color: "#fff", fontWeight: "700", fontSize: 15 }}>{c.name.slice(0, 1).toUpperCase()}</Text>}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: "#fff", fontSize: 15, fontWeight: "600" }} numberOfLines={1}>{c.name}</Text>
                <Text style={{ color: "#71717A", fontSize: 12.5 }}>{c.kind}</Text>
              </View>
              <View style={{ width: 22, height: 22, borderRadius: 11, alignItems: "center", justifyContent: "center", backgroundColor: on ? "#F4F4F5" : "transparent", borderWidth: on ? 0 : 1.5, borderColor: "#52525B" }}>
                {on && <Icon name="Check" size={13} color="#000" />}
              </View>
            </TouchableOpacity>
          );
        })}
      </View>
    </Sheet>
  );
}

export function ChatTabsManager({ visible, tabs, canAdd, onReorder, onHide, onEdit, onDelete, onNew, onClose }: {
  visible: boolean;
  tabs: ChatTabView[];
  canAdd: boolean;
  onReorder: (ids: string[]) => void;
  onHide: (id: string, hidden: boolean) => void;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
  onNew: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const ids = tabs.map((x) => x.id);
  const move = (id: string, to: number) => {
    if (to < 1 || to >= ids.length) return;
    const next = ids.filter((x) => x !== id);
    next.splice(to, 0, id);
    onReorder(next);
  };
  return (
    <Sheet visible={visible} title={t("chatTabs.edit", { defaultValue: "Edit tabs" })} onClose={onClose}
      footer={<Btn kind="white" label={t("common.done", { defaultValue: "Done" })} onPress={onClose} />}>
      <Text style={{ color: "#71717A", fontSize: 13, marginBottom: 12 }}>{t("chatTabs.editHintApp", { defaultValue: "Use the arrows to reorder. Hidden tabs keep their chats." })}</Text>
      {tabs.map((tab, i) => (
        <View key={tab.id} testID={`chat-tab-row-${tab.id}`} style={{ flexDirection: "row", alignItems: "center", gap: 4, marginBottom: 6, paddingVertical: 8, paddingLeft: 12, paddingRight: 4, borderRadius: 12, backgroundColor: "rgba(255,255,255,0.03)", borderWidth: 1, borderColor: "rgba(255,255,255,0.06)", opacity: tab.hidden ? 0.6 : 1 }}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: "#fff", fontSize: 14.5, fontWeight: "600" }} numberOfLines={1}>{tab.emoji ? `${tab.emoji} ${tab.name}` : tab.name}</Text>
            <Text style={{ color: "#71717A", fontSize: 12 }}>
              {tab.builtin ? t("chatTabs.builtIn", { defaultValue: "Built in" }) : t("chatTabs.chatCount", { defaultValue: "{{n}} chats", n: tab.chats.length })}
            </Text>
          </View>
          {i === 0 ? (
            <Text style={{ color: "#52525B", fontSize: 10.5, fontWeight: "700", letterSpacing: 1, paddingHorizontal: 8 }}>{t("chatTabs.alwaysOn", { defaultValue: "Always on" }).toUpperCase()}</Text>
          ) : (
            <>
              <TouchableOpacity onPress={() => move(tab.id, i - 1)} disabled={i <= 1} style={{ padding: 8, opacity: i <= 1 ? 0.25 : 1 }} accessibilityLabel={t("chatTabs.moveUp", { defaultValue: "Move up" })}><Icon name="ArrowUp" size={16} color="#A1A1AA" /></TouchableOpacity>
              <TouchableOpacity onPress={() => move(tab.id, i + 1)} disabled={i >= tabs.length - 1} style={{ padding: 8, opacity: i >= tabs.length - 1 ? 0.25 : 1 }} accessibilityLabel={t("chatTabs.moveDown", { defaultValue: "Move down" })}><Icon name="ArrowDown" size={16} color="#A1A1AA" /></TouchableOpacity>
              {tab.builtin ? (
                <TouchableOpacity testID={`chat-tab-hide-${tab.id}`} onPress={() => onHide(tab.id, !tab.hidden)} style={{ padding: 8 }} accessibilityLabel={tab.hidden ? t("chatTabs.show", { defaultValue: "Show tab" }) : t("chatTabs.hide", { defaultValue: "Hide tab" })}>
                  <Icon name={tab.hidden ? "EyeOff" : "Eye"} size={16} color="#D4D4D8" />
                </TouchableOpacity>
              ) : (
                <>
                  <TouchableOpacity onPress={() => onEdit(tab.id)} style={{ padding: 8 }} accessibilityLabel={t("chatTabs.renameEdit", { defaultValue: "Rename and edit" })}><Icon name="Pencil" size={16} color="#D4D4D8" /></TouchableOpacity>
                  <TouchableOpacity onPress={() => onDelete(tab.id)} style={{ padding: 8 }} accessibilityLabel={t("chatTabs.delete", { defaultValue: "Delete tab" })}><Icon name="Trash2" size={16} color="#f87171" /></TouchableOpacity>
                </>
              )}
            </>
          )}
        </View>
      ))}
      {canAdd && (
        <View style={{ marginTop: 6, marginBottom: 6 }}>
          <Btn flex={false} onPress={onNew} label={t("chatTabs.new", { defaultValue: "New tab" })}><Icon name="Plus" size={15} color="#fff" /></Btn>
        </View>
      )}
    </Sheet>
  );
}

/** Options for one tab (hold it), or the tabs one chat is in ("Add to tab"). */
export function ChatTabActions({ visible, title, rows, onClose }: {
  visible: boolean;
  title: string;
  rows: { key: string; label: string; icon?: string; emoji?: string; checked?: boolean; destructive?: boolean; disabled?: boolean; onPress: () => void }[];
  onClose: () => void;
}) {
  return (
    <Sheet visible={visible} title={title} onClose={onClose}>
      <View style={{ paddingBottom: 6 }}>
        {rows.map((r) => (
          <TouchableOpacity key={r.key} testID={`chat-tab-action-${r.key}`} disabled={r.disabled} onPress={() => { onClose(); setTimeout(r.onPress, 250); }} activeOpacity={0.6}
            style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 13, opacity: r.disabled ? 0.35 : 1 }}>
            <View style={{ width: 22, alignItems: "center" }}>
              {r.emoji ? <Text style={{ fontSize: 16 }}>{r.emoji}</Text> : r.icon ? <Icon name={r.icon as any} size={18} color={r.destructive ? "#f87171" : "#A1A1AA"} /> : null}
            </View>
            <Text style={{ flex: 1, color: r.destructive ? "#f87171" : "#F4F4F5", fontSize: 15, fontWeight: "500" }} numberOfLines={1}>{r.label}</Text>
            {r.checked && <Icon name="Check" size={17} color="#fff" />}
          </TouchableOpacity>
        ))}
      </View>
    </Sheet>
  );
}

/** Ask before deleting a tab. Its chats stay in All. */
export function confirmDeleteTab(t: (k: string, o?: any) => string, tab: ChatTabView, onConfirm: () => void) {
  Alert.alert(
    t("chatTabs.deleteTitle", { defaultValue: "Delete “{{name}}”?", name: tab.name }),
    t("chatTabs.deleteBody", { defaultValue: "The tab goes away. Its chats stay in All and keep their messages." }),
    [
      { text: t("common.cancel", { defaultValue: "Cancel" }), style: "cancel" },
      { text: t("chatTabs.delete", { defaultValue: "Delete tab" }), style: "destructive", onPress: onConfirm },
    ],
  );
}
