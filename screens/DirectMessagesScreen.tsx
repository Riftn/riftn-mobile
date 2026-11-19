import { usePerfProbe, perfMark } from "../libs/perfTrace";
import { useSurfaceDraft } from '../hooks/useSurfaceDraft';
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  FlatList,
  Text,
  TouchableOpacity,
  View,
  KeyboardAvoidingView,
  Platform,
  Alert,
  BackHandler,
  type TextInput,
} from "react-native";
import { DeHubRefreshMark } from "../components/Feed/DeHubRefreshControl";
import PullRefreshArea, { PullRefreshScrollView } from "../components/Feed/PullRefreshArea";

import { Image } from "expo-image";
import { PillDrawerAutoFocus } from "../components/page/PillHeader";
import ScreenHeader from "../components/ScreenHeader";
import Icon from "../components/ui/Icon";
import DeferredTextInput from "../components/ui/DeferredTextInput";
import LoadErrorState from "../components/ui/LoadErrorState";
import { useNavigation } from "@react-navigation/native";
import { ScreenNames } from "../navigation/ScreenNames";
import NewDMModal from "../components/DM/NewDMModal";
import ChatSearchDiscover from "../components/DM/ChatSearchDiscover";
import GroupChatRow from "../components/DM/GroupChatRow";
import { ChatCard, useChatListSpacing } from "../components/DM/ChatCard";
import UnreadCountChip from "../components/DM/UnreadCountChip";
import DeleteMessageSheet, { type DeleteRequest, type DeleteScope } from "../components/DM/DeleteMessageSheet";
import { usePublicChatLastLine, useRoomChatSummaries } from "../hooks/useRoomChatSummaries";
import { roomPreviewLine } from "../libs/room-chat-read";
import { formatShortAgo } from "../libs/date.util";
import ReactionAlertBadge, { reactionAlertLine } from "../components/DM/ReactionAlertBadge";
import CreateCommunitySheet from "../components/Communities/CreateCommunitySheet";
import { getUserCommunities } from "../services/communities.service";
import { chatsFromMemberships } from "../libs/community-kinds";
import { useChatPrefs } from "../hooks/useChatPrefs";
import { PUBLIC_CHAT_PREF_ID, roomChatId } from "../services/dm/dm.api";
import { useQuery } from "@tanstack/react-query";
import type { Community } from "../types/community";
import DMSettingsModal from "../components/DM/DMSettingsModal";
import DMSettingsMenu from "../components/DM/DMSettingsMenu";
import ConversationItem from "../components/DM/ConversationItem";
import ConversationContextMenu from "../components/DM/ConversationContextMenu";
import { useUser, useAuthState, type User } from "../context/AuthContext";
import { useUserProfileSheet } from "../context/UserProfileSheetContext";
import { truncateAddress } from "../libs/strings.util";
import { toastInfo, toastSuccess, toastError } from "../libs/toast";
import { toast } from "sonner-native";
import { scheduleDelete, undoDelete, usePendingDeletes, UNDO_WINDOW_MS } from "../libs/undoable-delete";
import { blockUser } from "../services/block.service";
import { isAuthorBlocked, useBlockedAuthorsVersion } from "../libs/blocked-authors";
import { deleteConversation, getDmUserStatus, addFreeAccess, removeFreeAccess, type DmUserStatus } from "../services/dm/dm.api";
import SignInGate from "../components/auth/SignInGate";
import type {
  DmConversation,
  DmUser,
} from "../services/dm/dm.types";
import { getOtherParticipant } from "../services/dm/dm.types";
import { useDmContacts, dmActions } from "../store/dm.store";
import { useKeyboardOffset } from "../hooks/useKeyboardLayout";
import { useDMContext } from "../context/DMContext";
import { FIELD_TEXT } from "../theme/inputs";
import { useAppTheme } from "../context/ThemeContext";
import { SEARCH_INPUT_CLEAR, useSearchFieldMaterial } from '../hooks/useSearchFieldMaterial';
import { usePublicChatUnreadCount } from "../hooks/usePublicChatUnread";
import { themeIconUrl } from '../theme/icons';
import BulkChatBar from "../components/DM/BulkChatBar";
import { sendToMany } from "../services/dm/bulk-reply";
import { useWebSocketApi } from "../context/WebSocketContext";
import { DMSocketEvent } from "../services/enums/dm-socket-events.enum";
import { useTabBarHide } from "../context/TabBarHideContext";
import { useChatTabs } from "../hooks/useChatTabs";
import { ChatTabActions, ChatTabBar, ChatTabEditor, ChatTabsManager, confirmDeleteTab, type TabCandidate } from "../components/DM/ChatTabs";
import { PUBLIC_CHAT_TAB_ID } from "../services/dm/dm.api";
import { getAvatarUrl } from "../libs/misc";
const renderPullScroll = (props: React.ComponentProps<typeof PullRefreshScrollView>) => <PullRefreshScrollView {...props} />;

// Cards sit apart; no divider lines (design B).
const SEARCH_ACTION = { width: 28, height: 28, borderRadius: 6, alignItems: "center", justifyContent: "center" } as const;

const DirectMessagesInner: React.FC = () => {
  usePerfProbe("DirectMessages");
  const { t } = useTranslation();
  const { theme } = useAppTheme();
  const searchField = useSearchFieldMaterial();
  const navigation = useNavigation<any>();
  const user = useUser();
  const publicUnread = usePublicChatUnreadCount();
  const { isSignedIn, needsUsername } = useAuthState();

  const { contactsLoading, contactsError, refreshContacts } = useDMContext();
  const conversations = useDmContacts();
  // The conversations the inbox first has are drawn as they are; only one that
  // arrives after that fades in. Fading every row on the first open made the
  // whole list read as still loading.
  const firstIdsRef = useRef<Set<string> | null>(null);
  const searchInputRef = useRef<TextInput>(null);
  if (firstIdsRef.current === null && conversations.length > 0) {
    firstIdsRef.current = new Set(conversations.map((c) => c._id));
  }
  const pendingDeletes = usePendingDeletes();
  const { showUserProfile } = useUserProfileSheet();
  // The KeyboardAvoidingView below is this screen's outermost element, so the
  // only chrome above it is the root SafeAreaView's own inset.
  const keyboardOffset = useKeyboardOffset();

  const myUserId = (user as any)?.id as string | undefined;
  const myAddress = (
    (user as any)?.walletAddress || (user as any)?.address || ""
  ).toLowerCase();

  const [query, setQuery] = useSurfaceDraft("screens/DirectMessagesScreen.tsx:query", "");
  const [menuVisible, setMenuVisible] = useState(false);
  const [newChatKind, setNewChatKind] = useState<"group" | "channel" | null>(null);
  const { data: memberships } = useQuery({
    queryKey: ["communities", "user", myAddress],
    queryFn: () => getUserCommunities(myAddress),
    enabled: !!myAddress,
    staleTime: 30_000,
  });
  // Communities join the list when the member chose Show in Chats (the same
  // setting the website reads).
  const { byId: chatPrefs, update: updateChatPref, seeReactions, refresh: refreshChatPrefs } = useChatPrefs(!!myAddress);
  const publicReactions = chatPrefs.get(PUBLIC_CHAT_PREF_ID)?.reactions ?? null;
  const groupChats = useMemo(() => {
    const q = query.trim().toLowerCase();
    return chatsFromMemberships(memberships, (id) => !!chatPrefs.get(roomChatId(id))?.listedAt)
      .filter((c) => !q || c.name.toLowerCase().includes(q));
  }, [memberships, query, chatPrefs]);
  const openGroupChat = useCallback((c: Community, invite = false) => {
    if (chatPrefs.get(roomChatId(c.id))?.markedUnread) void updateChatPref(roomChatId(c.id), { unread: false });
    seeReactions(roomChatId(c.id));
    navigation.navigate(ScreenNames.CommunityDetail as any, { slug: c.slug, tab: "chat", ...(invite ? { invite: true } : {}) });
  }, [navigation, chatPrefs, updateChatPref, seeReactions]);
  const [dnd, setDnd] = useState(false);
  const [newDmVisible, setNewDmVisible] = useState(false);
  const [dmSettingsVisible, setDmSettingsVisible] = useState(false);

  // Own DM status (for creator features like free access toggle)
  const [myDmStatus, setMyDmStatus] = useState<DmUserStatus | null>(null);

  // Conversation context menu state
  const [ctxConv, setCtxConv] = useState<DmConversation | null>(null);
  const [ctxUser, setCtxUser] = useState<DmUser | undefined>(undefined);

  // Fetch own DM status
  useEffect(() => {
    if (!myAddress) return;
    getDmUserStatus(myAddress)
      .then((s) => { if (s) setMyDmStatus(s); })
      .catch(() => {});
  }, [myAddress]);

  // A conversation with someone the viewer blocked leaves the list at once.
  const blockedVersion = useBlockedAuthorsVersion();

  const [showRequests, setShowRequests] = useState(false);
  const requestChats = useMemo(
    () => conversations.filter((c) => c.isRequest && !pendingDeletes.has(c._id)
      && !isAuthorBlocked(getOtherParticipant(c, myUserId, myAddress)?.address)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [conversations, pendingDeletes, myUserId, myAddress, blockedVersion],
  );
  const requestUnread = requestChats.reduce((n, c) => n + (c.unreadCount || 0), 0);
  // The last request was accepted or deleted: nothing left to show here.
  const noRequestsLeft = requestChats.length === 0;
  useEffect(() => { if (noRequestsLeft) setShowRequests(false); }, [noRequestsLeft]);

  /*
   * Tabs at the top of the list: All, Unread, Direct, Communities, Requests
   * and the person's own tabs, the same ones riftn.com/chat shows. A search
   * looks through everything, so the tabs step aside while one is typed.
   */
  const chatTabs = useChatTabs(!!myAddress);
  const [activeTabRaw, setActiveTab] = useState("all");
  const tabsOn = !!myAddress && !query.trim();
  const activeTabView = chatTabs.tabs.find((x) => x.id === activeTabRaw && !x.hidden);
  const activeTab = tabsOn && activeTabView ? activeTabView.id : "all";
  const customTab = tabsOn && activeTabView && !activeTabView.builtin ? activeTabView : null;
  const requestsTabShown = !chatTabs.tabs.find((x) => x.id === "requests")?.hidden;
  useEffect(() => {
    if (noRequestsLeft && !contactsLoading && activeTabRaw === "requests") setActiveTab("all");
  }, [noRequestsLeft, contactsLoading, activeTabRaw]);
  const [tabEditor, setTabEditor] = useState<{ id?: string; preset?: string[] } | null>(null);
  const [tabManager, setTabManager] = useState(false);
  const [tabActions, setTabActions] = useState<{ kind: "tab"; id: string } | { kind: "chat"; id: string } | null>(null);
  const requestsMode = showRequests || activeTab === "requests";
  const inRequests = requestsMode && !query.trim();
  // Unread keeps chats with something new; Groups keeps
  // groups, channels and community chats.
  const tabFilter: "all" | "unread" | "groups" = !query.trim() && !inRequests
    ? (activeTab === "unread" ? "unread" : activeTab === "communities" ? "groups" : "all")
    : "all";
  const convInTab = useCallback((c: DmConversation) =>
    customTab ? customTab.chats.includes(c._id) : true, [customTab]);
  const roomInTab = useCallback((c: { id: string }) =>
    activeTab === "direct" ? false : customTab ? customTab.chats.includes(roomChatId(c.id)) : true, [activeTab, customTab]);
  const publicInTab = activeTab === "direct" || activeTab === "communities" ? false : customTab ? customTab.chats.includes(PUBLIC_CHAT_TAB_ID) : true;

  // Filtered & sorted conversations
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q
      ? conversations.filter((c) => {
          const other = getOtherParticipant(c, myUserId, myAddress);
          const title = (
            other?.displayName ||
            other?.username ||
            other?.address ||
            ""
          ).toLowerCase();
          const preview =
            c.messages?.[0]?.content?.toLowerCase() || "";
          return title.includes(q) || preview.includes(q);
        })
      : conversations;
    // First messages from people you don't follow wait under Requests. A
    // search looks through both, so a request is never unfindable.
    const scoped = q ? list : list.filter((c) => !!c.isRequest === requestsMode);
    return scoped
      .filter((c) => !pendingDeletes.has(c._id))
      .filter((c) => !isAuthorBlocked(getOtherParticipant(c, myUserId, myAddress)?.address))
      .sort(
        (a, b) =>
          +new Date(b.updatedAt || b.lastMessageAt || 0) -
          +new Date(a.updatedAt || a.lastMessageAt || 0),
      );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversations, query, myUserId, myAddress, pendingDeletes, blockedVersion, requestsMode]);

  const convHasUnread = useCallback(
    (c: DmConversation) => (c.unreadCount || 0) > 0 || !!chatPrefs.get(c._id)?.markedUnread || !!chatPrefs.get(c._id)?.reactions,
    [chatPrefs],
  );
  const shown = useMemo(
    () => (tabFilter === "groups" ? [] : tabFilter === "unread" ? filtered.filter(convHasUnread) : filtered).filter((c) => inRequests || convInTab(c)),
    [filtered, tabFilter, convHasUnread, convInTab, inRequests],
  );
  // Newest line + unread number for each group row, and General Chat's newest line.
  const roomSummaries = useRoomChatSummaries(groupChats.map((c) => c.id), isSignedIn ? myAddress : null);
  const publicLastLine = usePublicChatLastLine(!!isSignedIn);
  const shownGroups = useMemo(
    () => (tabFilter === "unread" ? groupChats.filter((c) => !!chatPrefs.get(roomChatId(c.id))?.markedUnread || !!chatPrefs.get(roomChatId(c.id))?.reactions || (roomSummaries[c.id]?.unread ?? 0) > 0) : groupChats).filter(roomInTab),
    [groupChats, tabFilter, chatPrefs, roomInTab, roomSummaries],
  );
  const roomsUnread = groupChats.reduce((n, c) => n + (roomSummaries[c.id]?.unread ?? 0), 0);
  const inboxUnreadChats = useMemo(
    () => conversations.filter((c) => !c.isRequest && !pendingDeletes.has(c._id) && convHasUnread(c)).length
      + groupChats.filter((c) => !!chatPrefs.get(roomChatId(c.id))?.markedUnread || !!chatPrefs.get(roomChatId(c.id))?.reactions).length,
    [conversations, pendingDeletes, convHasUnread, groupChats, chatPrefs],
  );

  // Rows waiting out their undo window count as gone, so swiping away the last
  // one lands on the real empty state rather than "no matches".
  const hasConversations = (conversations || []).some((c) => !pendingDeletes.has(c._id));
  // People you already have a chat with; a chat search that misses suggests others.
  const knownAddresses = useMemo(
    () => new Set((conversations || []).map((c) => (getOtherParticipant(c, myUserId, myAddress)?.address || "").toLowerCase()).filter(Boolean)),
    [conversations, myUserId, myAddress],
  );


  const openMenu = useCallback(() => setMenuVisible(true), []);
  const closeMenu = useCallback(() => setMenuVisible(false), []);
  const toggleDnd = useCallback(() => setDnd((p) => !p), []);
  const openNewDM = useCallback(() => {
    closeMenu();
    setNewDmVisible(true);
  }, [closeMenu]);
  const openDmSettings = useCallback(() => {
    closeMenu();
    setDmSettingsVisible(true);
  }, [closeMenu]);


  /*
   * Picking several chats at once: hold a chat, choose Select, then tap
   * others. The bar at the foot marks them read or unread, sends one reply to
   * all of them, or deletes them. null = not picking. Group and community
   * chats are keyed by their settings id (roomChatId), DMs by their own id.
   */
  const [bulkIds, setBulkIds] = useState<Set<string> | null>(null);
  const picking = bulkIds !== null;
  const pickingRef = useRef(false);
  pickingRef.current = picking;
  const toggleBulk = useCallback((id: string) => setBulkIds((prev) => {
    const next = new Set(prev ?? []);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  }), []);
  const endPicking = useCallback(() => setBulkIds(null), []);
  // Switching between the inbox and Requests, or searching, starts fresh.
  useEffect(() => { setBulkIds(null); }, [showRequests]);
  // Android back leaves picking before it leaves the screen.
  useEffect(() => {
    if (!picking) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => { setBulkIds(null); return true; });
    return () => sub.remove();
  }, [picking]);
  // The bar takes the bottom nav's place while picking, as in Photos and Mail.
  const tabBarHide = useTabBarHide();
  useEffect(() => {
    if (!tabBarHide) return;
    tabBarHide.value = picking ? -100 : 0;
  }, [picking, tabBarHide]);
  useEffect(() => () => { if (tabBarHide) tabBarHide.value = 0; }, [tabBarHide]);

  const handleConvLongPress = useCallback(
    (conv: DmConversation, otherUser: DmUser | undefined) => {
      if (pickingRef.current) { toggleBulk(conv._id); return; }
      setCtxConv(conv);
      setCtxUser(otherUser);
    },
    [toggleBulk],
  );

  const handleAvatarPress = useCallback(
    (otherUser: DmUser | undefined) => {
      const id = otherUser?.username || otherUser?.address;
      if (id) showUserProfile(id, { source: "dm-list" });
    },
    [showUserProfile],
  );

  const closeCtx = useCallback(() => {
    setCtxConv(null);
    setCtxUser(undefined);
  }, []);

  const handleCtxOpenChat = useCallback(() => {
    if (!ctxConv) return;
    const title =
      ctxUser?.displayName ||
      ctxUser?.username ||
      truncateAddress(ctxUser?.address || "");
    navigation.navigate(ScreenNames.Chat as any, {
      conversationId: ctxConv._id,
      title,
    });
  }, [ctxConv, ctxUser, navigation]);

  /*
   * Block and delete are reachable two ways now — the long-press menu and the
   * left swipe on the row — so both take their target as an argument instead of
   * reading whatever the menu happens to have selected.
   */
  // Both are one swipe away and neither can be taken back from here, so each
  // asks first.
  const blockConvUser = useCallback((user: DmUser | undefined) => {
    const addr = user?.address;
    if (!addr) return;
    const name = user?.displayName || user?.username || t("dm.userFallback");
    Alert.alert(t("common.blockUserTitle"), t("common.blockUserDesc", { name }), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("common.block"),
        style: "destructive",
        onPress: async () => {
          try {
            await blockUser(addr, "Blocked from DM list");
            toastSuccess(t("postOptions.blockedUser", { name }));
          } catch (e) {
            toastError(e, t("dm.failedToBlock"));
          }
        },
      },
    ]);
  }, [t]);

  // The row goes at once, with Undo in the toast; the real delete runs when
  // that window closes. A confirm dialog after every swipe defeated the point
  // of swiping, and a mistaken swipe is exactly what Undo is for.
  const deleteConvNow = useCallback(
    (conv: DmConversation | null, scope: DeleteScope = "me") => {
      if (!conv) return;
      const id = conv._id;
      scheduleDelete(id, async () => {
        try {
          await deleteConversation(id, myAddress, { forEveryone: scope === "everyone" });
          dmActions.removeConversation(id);
        } catch (e) {
          toastError(e, t("dm.failedToDeleteConversation"));
        }
      });
      const toastId = toastSuccess(t("toasts.conversation_deleted"), {
        duration: UNDO_WINDOW_MS,
        actionLabel: t("common.undo"),
        onActionPress: () => {
          undoDelete(id);
          toast.dismiss(toastId);
        },
      });
    },
    [myAddress, t],
  );

  // Deleting a whole chat asks first: Delete for me, Delete for both (1:1
  // chats), or Cancel. Same sheet as deleting a message. Opened a beat after
  // the hold menu closes: iOS won't raise a modal over a closing one.
  const [chatDeleteRequest, setChatDeleteRequest] = useState<DeleteRequest | null>(null);
  const deleteConv = useCallback(
    (conv: DmConversation | null, afterMenu = false) => {
      if (!conv) return;
      const peer = getOtherParticipant(conv, myUserId, myAddress);
      const open = () => setChatDeleteRequest({
        subject: "chat",
        count: 1,
        canDeleteForEveryone: (conv.participants?.length ?? 0) <= 2,
        oneToOne: true,
        peerName: peer?.displayName || peer?.username || null,
        onDelete: (scope) => deleteConvNow(conv, scope),
      });
      if (afterMenu) setTimeout(open, 250); else open();
    },
    [deleteConvNow, myUserId, myAddress],
  );

  const handleCtxBlock = useCallback(
    () => blockConvUser(ctxUser),
    [blockConvUser, ctxUser],
  );

  const handleCtxDelete = useCallback(
    () => deleteConv(ctxConv, true),
    [deleteConv, ctxConv],
  );

  const handleCtxSelectMany = useCallback(() => {
    if (ctxConv) setBulkIds(new Set([ctxConv._id]));
  }, [ctxConv]);

  const ws = useWebSocketApi();
  // Someone reacted to one of your DMs: the list's reaction badges refresh now.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const off = ws.on(DMSocketEvent.ReactionUpdated, (payload: { added?: string; by?: string }) => {
      if (!payload?.added || !payload.by || payload.by.toLowerCase() === (myAddress || "").toLowerCase()) return;
      clearTimeout(timer);
      timer = setTimeout(refreshChatPrefs, 600);
    });
    return () => { clearTimeout(timer); off?.(); };
  }, [ws, myAddress, refreshChatPrefs]);
  // The other person deleted a 1:1 chat for both of you: it leaves the list.
  useEffect(() => {
    const off = ws.on(DMSocketEvent.ConversationDeleted, (payload: { dmId?: string; forEveryone?: boolean }) => {
      if (payload?.forEveryone && payload.dmId) dmActions.removeConversation(payload.dmId);
    });
    return () => { off?.(); };
  }, [ws]);
  // Only chats still on screen count (one may have been deleted meanwhile).
  const bulkChats = useMemo(
    () => (bulkIds ? filtered.filter((c) => bulkIds.has(c._id)) : []),
    [bulkIds, filtered],
  );
  const bulkRooms = useMemo(
    () => (bulkIds && !inRequests ? groupChats.filter((c) => bulkIds.has(roomChatId(c.id))) : []),
    [bulkIds, groupChats, inRequests],
  );
  const bulkCount = bulkChats.length + bulkRooms.length;
  const bulkAllUnread = bulkCount > 0
    && bulkChats.every((c) => (c.unreadCount || 0) > 0 || !!chatPrefs.get(c._id)?.markedUnread)
    && bulkRooms.every((c) => !!chatPrefs.get(roomChatId(c.id))?.markedUnread);

  const bulkToggleUnread = useCallback(() => {
    const unread = !bulkAllUnread;
    for (const c of bulkChats) {
      if (!unread && (c.unreadCount || 0) > 0) {
        // Mark read clears the server's count too, the same way opening the chat does.
        ws.emitAuthed(DMSocketEvent.markAsRead, { dmId: c._id });
        dmActions.markAllRead(c._id, myUserId);
      }
      if (unread || chatPrefs.get(c._id)?.markedUnread) void updateChatPref(c._id, { unread });
    }
    for (const c of bulkRooms) void updateChatPref(roomChatId(c.id), { unread });
    setBulkIds(null);
  }, [bulkAllUnread, bulkChats, bulkRooms, chatPrefs, updateChatPref, ws, myUserId]);

  const bulkDelete = useCallback(() => {
    const ids = bulkChats.map((c) => c._id);
    if (!ids.length) return;
    for (const id of ids) {
      scheduleDelete(id, async () => {
        try {
          await deleteConversation(id, myAddress);
          dmActions.removeConversation(id);
        } catch (e) {
          toastError(e, t("dm.failedToDeleteConversation"));
        }
      });
    }
    const toastId = toastSuccess(
      ids.length === 1
        ? t("toasts.conversation_deleted")
        : t("chatBulk.deleted", { defaultValue: "{{count}} chats deleted", count: ids.length }),
      {
        duration: UNDO_WINDOW_MS,
        actionLabel: t("common.undo"),
        onActionPress: () => {
          ids.forEach((id) => undoDelete(id));
          toast.dismiss(toastId);
        },
      },
    );
    setBulkIds(null);
  }, [bulkChats, myAddress, t]);

  const bulkReply = useCallback(async (text: string): Promise<number> => {
    if (!myAddress || !myUserId) return 0;
    const u = user as any;
    const { ok, total } = await sendToMany(
      bulkChats.map((c) => c._id),
      bulkRooms.map((c) => c.id),
      {
        userId: myUserId,
        address: myAddress,
        username: u?.username,
        displayName: u?.displayName,
        avatarUrl: u?.avatarImageUrl || u?.avatarUrl,
        badgeBalance: u?.badgeBalance,
      },
      text,
    );
    if (ok === total && ok > 0) {
      toastSuccess(t("chatBulk.sent", { defaultValue: "Sent to {{count}} chats", count: ok }));
      setBulkIds(null);
    } else if (ok > 0) {
      toastError(t("chatBulk.partSent", { defaultValue: "Sent to {{ok}} of {{total}} chats", ok, total }));
      setBulkIds(null);
    } else {
      toastError(t("chatBulk.notSent", { defaultValue: "Could not send. Try again." }));
    }
    return ok;
  }, [bulkChats, bulkRooms, myAddress, myUserId, user, t]);

  const handleSwipeBlock = useCallback(
    (_conv: DmConversation, user: DmUser | undefined) => blockConvUser(user),
    [blockConvUser],
  );

  const handleSwipeDelete = useCallback(
    (conv: DmConversation) => deleteConv(conv),
    [deleteConv],
  );

  const handleCtxToggleFreeAccess = useCallback(async () => {
    const addr = (ctxUser?.address || "").toLowerCase();
    if (!addr) return;
    const currentlyFree = !!(myDmStatus?.freeAccessUsers?.some(
      (a: string) => a.toLowerCase() === addr,
    ));
    try {
      if (currentlyFree) {
        await removeFreeAccess(addr);
        setMyDmStatus((prev) =>
          prev ? { ...prev, freeAccessUsers: (prev.freeAccessUsers || []).filter((a) => a.toLowerCase() !== addr) } : prev,
        );
        toastSuccess(t("dm.removedFreeAccess", { name: ctxUser?.displayName || ctxUser?.username || t("dm.userFallback") }));
      } else {
        await addFreeAccess(addr);
        setMyDmStatus((prev) =>
          prev ? { ...prev, freeAccessUsers: [...(prev.freeAccessUsers || []), addr] } : prev,
        );
        toastSuccess(t("dm.grantedFreeAccess", { name: ctxUser?.displayName || ctxUser?.username || t("dm.userFallback") }));
      }
    } catch (e) {
      toastError(e, t("dm.failedToUpdateFreeAccess"));
    }
  }, [ctxUser, myDmStatus]);

  const handleOpenConversation = useCallback(
    (conv: DmConversation, otherUser: DmUser | undefined) => {
      if (pickingRef.current) { toggleBulk(conv._id); return; }
      perfMark("chat:open");
      if (chatPrefs.get(conv._id)?.markedUnread) void updateChatPref(conv._id, { unread: false });
      const title =
        otherUser?.displayName ||
        otherUser?.username ||
        truncateAddress(otherUser?.address || "");
      navigation.navigate(ScreenNames.Chat as any, {
        conversationId: conv._id,
        title,
      });
    },
    [navigation, chatPrefs, updateChatPref, toggleBulk],
  );

  const startDMWith = useCallback(
    (u: User) => {
      const addr = (
        (u as any).walletAddress || (u as any).address || ""
      ).toLowerCase();
      const selfAddr = myAddress;
      if (addr && addr === selfAddr) {
        toastInfo(t("dm.cantMessageYourself"));
        return;
      }
      const title =
        (u as any).displayName || (u as any).username || truncateAddress(addr);
      // Check existing conversation
      const existing = conversations.find((c: DmConversation) =>
        c.participants?.some(
          (p) =>
            (p.participant?.address || "").toLowerCase() === addr,
        ),
      );
      if (existing) {
        navigation.navigate(ScreenNames.Chat as any, {
          conversationId: existing._id,
          title,
          focusComposer: true,
        });
      } else {
        navigation.navigate(ScreenNames.Chat as any, {
          targetAddress: addr,
          title,
          targetUser: u,
          focusComposer: true,
        });
      }
    },
    [navigation, conversations, myAddress],
  );


  const handleOpenLiveChat = useCallback(() => {
    seeReactions(PUBLIC_CHAT_PREF_ID);
    navigation.navigate(ScreenNames.LiveChat as any);
  }, [navigation, seeReactions]);

  const openSettings = useCallback(() => {
    openMenu();
  }, [openMenu]);

  const renderItem = useCallback(
    ({ item }: { item: DmConversation }) => (
      <ConversationItem
        conversation={item}
        myUserId={myUserId}
        myAddress={myAddress}
        onPress={handleOpenConversation}
        onLongPress={handleConvLongPress}
        onAvatarPress={handleAvatarPress}
        onDelete={handleSwipeDelete}
        onBlock={handleSwipeBlock}
        animateIn={!!firstIdsRef.current && !firstIdsRef.current.has(item._id)}
        selecting={picking}
        checked={!!bulkIds?.has(item._id)}
        markedUnread={!!chatPrefs.get(item._id)?.markedUnread}
        reactions={chatPrefs.get(item._id)?.reactions}
      />
    ),
    [
      picking,
      bulkIds,
      chatPrefs,
      myUserId,
      myAddress,
      handleOpenConversation,
      handleConvLongPress,
      handleAvatarPress,
      handleSwipeDelete,
      handleSwipeBlock,
    ],
  );

  const keyExtractor = useCallback(
    (item: DmConversation) => item._id,
    [],
  );

  // Unread chats per tab, for the counts on the tab row.
  const inbox = useMemo(
    () => conversations.filter((c) => !c.isRequest && !pendingDeletes.has(c._id)),
    [conversations, pendingDeletes],
  );
  const tabUnread = useMemo(() => {
    const sum = (list: DmConversation[]) => list.reduce((n, c) => n + (c.unreadCount || 0), 0);
    const out: Record<string, number> = {
      all: sum(inbox) + publicUnread + roomsUnread,
      unread: sum(inbox) + publicUnread + roomsUnread,
      direct: sum(inbox),
      communities: roomsUnread,
      requests: requestUnread,
    };
    for (const tab of chatTabs.tabs) {
      if (tab.builtin) continue;
      out[tab.id] = sum(inbox.filter((c) => tab.chats.includes(c._id))) + (tab.chats.includes(PUBLIC_CHAT_TAB_ID) ? publicUnread : 0);
    }
    return out;
  }, [inbox, publicUnread, requestUnread, chatTabs.tabs, roomsUnread]);
  // An empty Requests tab stays out of the row.
  const tabRowTabs = requestChats.length
    ? chatTabs.tabs
    : chatTabs.tabs.map((x) => (x.id === "requests" && activeTab !== "requests" ? { ...x, hidden: true } : x));
  const tabCandidates = useMemo<TabCandidate[]>(() => [
    { id: PUBLIC_CHAT_TAB_ID, name: t("publicChat.title"), source: require("../assets/web-icons/dehub-logo-compact.png"), kind: t("chatTabs.kindPublic", { defaultValue: "Public" }) },
    ...chatsFromMemberships(memberships, (id) => !!chatPrefs.get(roomChatId(id))?.listedAt).map((c) => ({
      id: roomChatId(c.id),
      name: c.name,
      avatar: (c as any).avatar_url || undefined,
      kind: (c as any).kind === "channel" ? t("chatTabs.kindChannel", { defaultValue: "Channel" })
        : (c as any).kind === "group" ? t("chatTabs.kindGroup", { defaultValue: "Group" })
        : t("chatTabs.kindCommunity", { defaultValue: "Community" }),
    })),
    ...inbox.map((c) => {
      const other = getOtherParticipant(c, myUserId, myAddress);
      const avatar = getAvatarUrl(other?.avatarImageUrl);
      return {
        id: c._id,
        name: other?.displayName || other?.username || truncateAddress(other?.address || "") || t("settings.unknown"),
        avatar: avatar && avatar !== "default-avatar" ? avatar : undefined,
        kind: t("chatTabs.kindDirect", { defaultValue: "Direct" }),
        round: true,
      };
    }),
  ], [t, memberships, chatPrefs, inbox, myUserId, myAddress]);
  const tabBeingEdited = tabEditor?.id ? chatTabs.tabs.find((x) => x.id === tabEditor.id) : undefined;
  const tabEditorInitial = useMemo(() => (tabEditor
    ? tabBeingEdited
      ? { id: tabBeingEdited.id, name: tabBeingEdited.name, emoji: tabBeingEdited.emoji, chats: tabBeingEdited.chats }
      : { name: "", emoji: "", chats: tabEditor.preset ?? [] }
    : null), [tabEditor, tabBeingEdited]);
  const askDeleteTab = useCallback((id: string) => {
    const tab = chatTabs.tabs.find((x) => x.id === id);
    if (!tab) return;
    confirmDeleteTab(t, tab, () => {
      void chatTabs.remove(id);
      if (activeTabRaw === id) setActiveTab("all");
      toastSuccess(t("chatTabs.deleted", { defaultValue: "Deleted {{name}}", name: tab.name }));
    });
  }, [chatTabs, t, activeTabRaw]);
  const moveCustomTab = (id: string, by: -1 | 1) => {
    const ids = chatTabs.tabs.map((x) => x.id);
    const customIds = chatTabs.tabs.filter((x) => !x.builtin).map((x) => x.id);
    const other = customIds[customIds.indexOf(id) + by];
    if (!other) return;
    const a = ids.indexOf(id), b = ids.indexOf(other);
    [ids[a], ids[b]] = [ids[b], ids[a]];
    void chatTabs.reorder(ids);
  };
  const heldTab = tabActions?.kind === "tab" ? chatTabs.tabs.find((x) => x.id === tabActions.id) : undefined;
  const customTabs = chatTabs.tabs.filter((x) => !x.builtin);
  const tabActionsTitle = heldTab
    ? (heldTab.emoji ? `${heldTab.emoji} ${heldTab.name}` : heldTab.name)
    : t("chatTabs.addToTab", { defaultValue: "Add to tab" });
  const tabActionRows = !tabActions ? [] : heldTab ? (heldTab.builtin ? [
    ...(heldTab.id !== "all" ? [{ key: "hide", icon: "EyeOff", label: t("chatTabs.hide", { defaultValue: "Hide tab" }), onPress: () => { void chatTabs.setHidden(heldTab.id, true); if (activeTabRaw === heldTab.id) setActiveTab("all"); } }] : []),
    { key: "manage", icon: "SlidersHorizontal", label: t("chatTabs.edit", { defaultValue: "Edit tabs" }), onPress: () => setTabManager(true) },
  ] : [
    { key: "edit", icon: "Pencil", label: t("chatTabs.renameEdit", { defaultValue: "Rename and edit" }), onPress: () => setTabEditor({ id: heldTab.id }) },
    { key: "add", icon: "Plus", label: t("chatTabs.addChats", { defaultValue: "Add chats" }), onPress: () => setTabEditor({ id: heldTab.id }) },
    { key: "left", icon: "ChevronLeft", label: t("chatTabs.moveLeft", { defaultValue: "Move left" }), disabled: customTabs[0]?.id === heldTab.id, onPress: () => moveCustomTab(heldTab.id, -1) },
    { key: "right", icon: "ChevronRight", label: t("chatTabs.moveRight", { defaultValue: "Move right" }), disabled: customTabs[customTabs.length - 1]?.id === heldTab.id, onPress: () => moveCustomTab(heldTab.id, 1) },
    { key: "delete", icon: "Trash2", destructive: true, label: t("chatTabs.delete", { defaultValue: "Delete tab" }), onPress: () => askDeleteTab(heldTab.id) },
  ]) : [
    ...customTabs.map((tab) => ({
      key: tab.id,
      emoji: tab.emoji || "•",
      label: tab.name,
      checked: tab.chats.includes(tabActions.id),
      onPress: () => {
        const had = tab.chats.includes(tabActions.id);
        void chatTabs.toggleChat(tab.id, tabActions.id);
        toastSuccess(had
          ? t("chatTabs.removedFrom", { defaultValue: "Removed from {{name}}", name: tab.name })
          : t("chatTabs.addedTo", { defaultValue: "Added to {{name}}", name: tab.name }));
      },
    })),
    { key: "new", icon: "Plus", label: t("chatTabs.newWith", { defaultValue: "New tab…" }), onPress: () => setTabEditor({ preset: [tabActions.id] }) },
  ];

  // Cards sit 10px apart; the plain list has no gap, a line under each chat (Settings → Appearance).
  const chatSpacing = useChatListSpacing();
  const SEPARATOR = useMemo(() => ({ height: chatSpacing.gap }), [chatSpacing.gap]);

  const publicChatItem = useMemo(
    () => (
      <>
      {tabsOn && (
        <ChatTabBar
          tabs={tabRowTabs}
          active={activeTab}
          unread={tabUnread}
          onSelect={(id) => { setShowRequests(false); setActiveTab(id); }}
          onNew={() => setTabEditor({})}
          onManage={() => setTabManager(true)}
          onHold={(tab) => setTabActions({ kind: "tab", id: tab.id })}
        />
      )}
      <View style={SEPARATOR} />
      {inRequests ? (
        <>
          <Text className="text-theme-neutrals-400 text-[13px] px-1" style={{ lineHeight: 18 }}>
            {t("dmRequests.hint", { defaultValue: "Messages from people you don't follow. Accept one, reply or follow them and the chat moves to your inbox." })}
          </Text>
          <View style={SEPARATOR} />
        </>
      ) : (
      <>
      {(tabFilter === "all" || (tabFilter === "unread" && (publicUnread > 0 || !!publicReactions))) && publicInTab && (
      <>
      <ChatCard unread={publicUnread > 0 || !!publicReactions}>
      <TouchableOpacity
        onPress={handleOpenLiveChat}
        activeOpacity={0.7}
        className="flex-row items-center pl-3 pr-3.5 py-3 gap-3"
        style={{ minHeight: 72 }}
      >
        {/* Logo styled like the chat avatars */}
        <View
          style={{ width: 44, height: 44, borderRadius: 12 }}
          className="dark-surface bg-black items-center justify-center overflow-hidden"
        >
          <Image
            source={require("../assets/web-icons/dehub-logo-compact.png")}
            style={{ width: 30, height: 30 }}
            contentFit="contain"
          />
        </View>

        {/* Name + preview (matches ConversationItem layout) */}
        <View className="flex-1 justify-center">
          <View className="flex-row items-center gap-1.5">
            <Text className="text-theme-neutrals-100 text-[15px] font-semibold flex-shrink" numberOfLines={1}>
              {t("publicChat.title")}
            </Text>
            {publicLastLine && (
              <Text testID="room-last-at" className="text-[12.5px] text-theme-neutrals-500" style={{ marginLeft: "auto", fontVariant: ["tabular-nums"] }}>
                {formatShortAgo(publicLastLine.created_at)}
              </Text>
            )}
            <ReactionAlertBadge reactions={publicReactions} />
            {/* Same white number as a private chat. */}
            <UnreadCountChip count={publicUnread} />
          </View>
          <View className="flex-row items-center gap-1 mt-0.5">
            {publicReactions ? (
              <Text testID="reaction-alert-line" className="text-white text-[14px] font-bold flex-1" numberOfLines={1}>
                {reactionAlertLine(t as any, publicReactions, { named: true })}
              </Text>
            ) : publicLastLine && roomPreviewLine(publicLastLine, myAddress, t as any) ? (
            <Text testID="room-preview" className={`text-white text-[14px] flex-1 ${publicUnread > 0 ? "font-bold" : "font-normal"}`} numberOfLines={1}>
              {roomPreviewLine(publicLastLine, myAddress, t as any)}
            </Text>
            ) : (
            <Text className="text-theme-neutrals-400 text-[14px] flex-1" numberOfLines={1}>
              {t("publicChat.subtitle")}
            </Text>
            )}
          </View>
        </View>
      </TouchableOpacity>
      </ChatCard>
      <View style={SEPARATOR} />
      </>
      )}
      {shownGroups.map((c) => (
        <React.Fragment key={c.id}>
          <GroupChatRow
            community={c}
            onPress={() => (picking ? toggleBulk(roomChatId(c.id)) : openGroupChat(c))}
            onLongPress={() => (picking ? toggleBulk(roomChatId(c.id)) : setBulkIds(new Set([roomChatId(c.id)])))}
            selecting={picking}
            checked={!!bulkIds?.has(roomChatId(c.id))}
            markedUnread={!!chatPrefs.get(roomChatId(c.id))?.markedUnread}
            reactions={chatPrefs.get(roomChatId(c.id))?.reactions}
            summary={roomSummaries[c.id]}
            me={myAddress}
          />
          <View style={SEPARATOR} />
        </React.Fragment>
      ))}
      {requestChats.length > 0 && !query.trim() && tabFilter === "all" && !customTab && activeTab !== "direct" && (!tabsOn || !requestsTabShown) && (
        <>
          <ChatCard unread={requestUnread > 0}>
          <TouchableOpacity
            onPress={() => setShowRequests(true)}
            activeOpacity={0.7}
            accessibilityRole="button"
            testID="requests-open"
            className="flex-row items-center pl-3 pr-3.5 py-3 gap-3"
            style={{ minHeight: 72 }}
          >
            <View
              style={{ width: 44, height: 44, borderRadius: 12, backgroundColor: "rgba(127,127,127,0.16)" }}
              className="items-center justify-center"
            >
              <Icon name="Mail" size={22} color="#A1A1AA" />
            </View>
            <View className="flex-1 justify-center">
              <Text className="text-theme-neutrals-100 text-[15px] font-semibold" numberOfLines={1}>
                {t("dmRequests.title", { defaultValue: "Requests" })}
              </Text>
              <Text className="text-theme-neutrals-400 text-[14px] mt-0.5" numberOfLines={1}>
                {t("dmRequests.rowHint", { defaultValue: "{{n}} from people you don't follow", n: requestChats.length })}
              </Text>
            </View>
            {requestUnread > 0 && <UnreadCountChip count={requestUnread} />}
          </TouchableOpacity>
          </ChatCard>
          <View style={SEPARATOR} />
        </>
      )}
      </>
      )}
      </>
    ),
    [handleOpenLiveChat, publicUnread, publicLastLine, roomSummaries, myAddress, t, shownGroups, openGroupChat, inRequests, requestChats.length, requestUnread, query, picking, bulkIds, chatPrefs, toggleBulk, tabsOn, tabRowTabs, activeTab, tabUnread, tabFilter, publicInTab, customTab, requestsTabShown, SEPARATOR],
  );

  const itemSeparator = useCallback(() => <View style={SEPARATOR} />, [SEPARATOR]);

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      keyboardVerticalOffset={Platform.OS === "ios" ? keyboardOffset : 0}
      style={{ flex: 1 }}
    >
      <View className="flex-1 bg-theme-neutrals-900">
        <ScreenHeader
          appearance="island"
          icon="messages"
          title={t("messages.title")}
          canGoBack={false}
          rightContent={
            <>
              <TouchableOpacity onPress={openNewDM} style={SEARCH_ACTION} hitSlop={4}
                accessibilityRole="button" accessibilityLabel={t("dm.newDm")}>
                <Icon name="Plus" size={16} color="#A1A1AA" />
              </TouchableOpacity>
              <TouchableOpacity onPress={openSettings} style={SEARCH_ACTION} hitSlop={4}
                accessibilityRole="button" accessibilityLabel={t("settings.title")}>
                <Icon name="Settings" size={16} color="#A1A1AA" />
              </TouchableOpacity>
            </>
          }
        >
          <PillDrawerAutoFocus inputRef={searchInputRef} />
          <View className="flex-row items-center" style={[{ height: 36, borderRadius: 8 }, searchField.surface]}>
            <View className="pl-3 pr-2"><Icon name="Search" size={16} color="#71717A" /></View>
            <DeferredTextInput ref={searchInputRef} value={query} onChangeText={setQuery}
              placeholder={t("messages.searchConversations")} placeholderTextColor="#71717A"
              className="flex-1 text-white text-sm" returnKeyType="search" style={[FIELD_TEXT, SEARCH_INPUT_CLEAR]} onFocus={searchField.onFocus} onBlur={searchField.onBlur} />
            {/* Refresh sits quietly inside the search field; new message and
                settings are on the pill. */}
            <View className="flex-row items-center pr-1">
              <TouchableOpacity onPress={refreshContacts} disabled={!!contactsLoading}
                style={[SEARCH_ACTION, { opacity: contactsLoading ? 0.5 : 1 }]} hitSlop={4}
                accessibilityRole="button" accessibilityLabel={t("dao.refresh")}>
                <Icon name="RefreshCw" size={16} color="#71717A" />
              </TouchableOpacity>
            </View>
          </View>
        </ScreenHeader>

        {/* A pull at the top of the list lowers it and refreshes (PullRefreshArea):
            the hidden native spinner showed nothing and needed a very long pull. */}
        <PullRefreshArea refreshing={!!contactsLoading} onRefresh={refreshContacts}>
        <FlatList
          data={shown}
          keyExtractor={keyExtractor}
          renderItem={renderItem}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingHorizontal: chatSpacing.inset, paddingTop: 6, paddingBottom: picking ? 150 : 80 }}
          extraData={bulkIds}
          className="flex-1"
          ListHeaderComponent={publicChatItem}
          renderScrollComponent={renderPullScroll}
          ListEmptyComponent={
            query.trim().length >= 2 && groupChats.length === 0 ? (
              <ChatSearchDiscover
                query={query}
                myAddress={myAddress}
                knownAddresses={knownAddresses}
                onMessageUser={startDMWith}
                onNewChat={openNewDM}
                onNewGroup={() => setNewChatKind("group")}
              />
            ) : tabFilter === "groups" ? null : customTab ? (
              !publicInTab && !shownGroups.length ? (
                <View className="items-center mt-12 px-8" testID="chat-tab-empty">
                  <Text style={{ fontSize: 26, marginBottom: 10 }}>{customTab.emoji || "🗂️"}</Text>
                  <Text className="text-theme-neutrals-100 text-base font-semibold">
                    {t("chatTabs.emptyTitle", { defaultValue: "{{name}} is empty", name: customTab.name })}
                  </Text>
                  <Text className="text-theme-neutrals-400 text-sm mt-1 text-center">
                    {t("chatTabs.emptyBody", { defaultValue: "Add chats here and they stay in All too." })}
                  </Text>
                  <TouchableOpacity onPress={() => setTabEditor({ id: customTab.id })} accessibilityRole="button" className="mt-4 px-5 py-2.5 rounded-xl bg-white">
                    <Text className="text-black text-sm font-bold">{t("chatTabs.addChats", { defaultValue: "Add chats" })}</Text>
                  </TouchableOpacity>
                </View>
              ) : null
            ) : hasConversations ? (
              <View className="items-center mt-10">
                <Text className="text-theme-neutrals-400">{t("dm.noConversationsFound")}</Text>
              </View>
            ) : contactsError ? (
              <LoadErrorState message={t("messages.failedToLoad")} onRetry={refreshContacts} />
            ) : contactsLoading ? null : (
              <View className="items-center mt-16 px-8">
                <View className="w-16 h-16 items-center justify-center mb-4">
                  <Image source={{ uri: themeIconUrl(theme, 'messages') }} style={{ width: 64, height: 64 }} contentFit="contain" cachePolicy="disk" />
                </View>
                <Text className="text-theme-neutrals-400 text-base font-medium mb-1">
                  {t("dm.noConversationsYet")}
                </Text>
                <TouchableOpacity onPress={openNewDM} accessibilityRole="button" className="mt-3 px-5 py-2 rounded-xl bg-theme-neutrals-800">
                  <Text className="text-theme-neutrals-100 text-sm font-medium">{t("dm.newDm")}</Text>
                </TouchableOpacity>
              </View>
            )
          }
          ItemSeparatorComponent={itemSeparator}
          showsVerticalScrollIndicator={false}
        />
        </PullRefreshArea>

        <DMSettingsMenu
          visible={menuVisible}
          onClose={closeMenu}
          onNewDM={openNewDM}
          onOpenDmSettings={openDmSettings}
          dnd={dnd}
          onToggleDnd={toggleDnd}
        />


        <CreateCommunitySheet
          kind={newChatKind ?? "group"}
          visible={!!newChatKind}
          walletAddress={myAddress}
          onClose={() => setNewChatKind(null)}
          onCreated={(c) => openGroupChat(c, true)}
        />

        <DeleteMessageSheet request={chatDeleteRequest} onClose={() => setChatDeleteRequest(null)} />

        <NewDMModal
          open={newDmVisible}
          onOpenChange={setNewDmVisible}
          onSelect={startDMWith}
          onGroup={() => setNewChatKind("group")}
          onChannel={() => setNewChatKind("channel")}
        />

        <DMSettingsModal
          open={dmSettingsVisible}
          onOpenChange={setDmSettingsVisible}
        />

        <ChatTabEditor
          visible={!!tabEditor}
          initial={tabEditorInitial}
          candidates={tabCandidates}
          onClose={() => setTabEditor(null)}
          onDelete={tabBeingEdited ? () => { const tab = tabBeingEdited; setTabEditor(null); setTimeout(() => askDeleteTab(tab.id), 300); } : undefined}
          onSave={(tab) => {
            if (tabBeingEdited) void chatTabs.update(tabBeingEdited.id, tab);
            else {
              if (!chatTabs.canAdd) { toastError(t("chatTabs.tooMany", { defaultValue: "You can have up to 10 tabs" })); return; }
              setActiveTab(chatTabs.create(tab));
            }
            setTabEditor(null);
          }}
        />
        <ChatTabsManager
          visible={tabManager && !tabEditor}
          tabs={chatTabs.tabs}
          canAdd={chatTabs.canAdd}
          onReorder={(ids) => void chatTabs.reorder(ids)}
          onHide={(id, hidden) => { void chatTabs.setHidden(id, hidden); if (hidden && activeTabRaw === id) setActiveTab("all"); }}
          onEdit={(id) => setTabEditor({ id })}
          onDelete={askDeleteTab}
          onNew={() => setTabEditor({})}
          onClose={() => setTabManager(false)}
        />
        <ChatTabActions
          visible={!!tabActions}
          title={tabActionsTitle}
          rows={tabActionRows}
          onClose={() => setTabActions(null)}
        />

        <ConversationContextMenu
          visible={!!ctxConv}
          conversation={ctxConv}
          otherUser={ctxUser}
          onClose={closeCtx}
          onOpenChat={handleCtxOpenChat}
          onBlock={handleCtxBlock}
          onDelete={handleCtxDelete}
          onSelectMany={handleCtxSelectMany}
          onAddToTab={ctxConv && !ctxConv.isRequest ? () => setTabActions({ kind: "chat", id: ctxConv._id }) : undefined}
          onToggleFreeAccess={handleCtxToggleFreeAccess}
          peerHasFreeAccess={
            !!(myDmStatus?.freeAccessUsers?.some(
              (a: string) => a.toLowerCase() === (ctxUser?.address || "").toLowerCase(),
            ))
          }
          isCreator={!!(myDmStatus?.perMessageFee && myDmStatus.perMessageFee > 0)}
        />
      </View>
      {picking && (
        <BulkChatBar
          count={bulkCount}
          deletableCount={bulkChats.length}
          allUnread={bulkAllUnread}
          onToggleUnread={bulkToggleUnread}
          onDelete={bulkDelete}
          onReply={bulkReply}
          onCancel={endPicking}
        />
      )}
      <DeHubRefreshMark refreshing={!!contactsLoading} />
    </KeyboardAvoidingView>
  );
};

const DirectMessagesScreen: React.FC = () => (
  <SignInGate>
    <DirectMessagesInner />
  </SignInGate>
);

export default DirectMessagesScreen;
