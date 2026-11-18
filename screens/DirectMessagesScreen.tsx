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
import UnreadCountChip from "../components/DM/UnreadCountChip";
import CreateCommunitySheet from "../components/Communities/CreateCommunitySheet";
import { getUserCommunities } from "../services/communities.service";
import { chatsFromMemberships } from "../libs/community-kinds";
import { useChatPrefs } from "../hooks/useChatPrefs";
import { roomChatId } from "../services/dm/dm.api";
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
const renderPullScroll = (props: React.ComponentProps<typeof PullRefreshScrollView>) => <PullRefreshScrollView {...props} />;

const SEPARATOR = { height: 1, backgroundColor: "rgba(255,255,255,0.07)" } as const;
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
  const { byId: chatPrefs, update: updateChatPref } = useChatPrefs(!!myAddress);
  const groupChats = useMemo(() => {
    const q = query.trim().toLowerCase();
    return chatsFromMemberships(memberships, (id) => !!chatPrefs.get(roomChatId(id))?.listedAt)
      .filter((c) => !q || c.name.toLowerCase().includes(q));
  }, [memberships, query, chatPrefs]);
  const openGroupChat = useCallback((c: Community, invite = false) => {
    if (chatPrefs.get(roomChatId(c.id))?.markedUnread) void updateChatPref(roomChatId(c.id), { unread: false });
    navigation.navigate(ScreenNames.CommunityDetail as any, { slug: c.slug, tab: "chat", ...(invite ? { invite: true } : {}) });
  }, [navigation, chatPrefs, updateChatPref]);
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
  const inRequests = showRequests && !query.trim();

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
    const scoped = q ? list : list.filter((c) => !!c.isRequest === showRequests);
    return scoped
      .filter((c) => !pendingDeletes.has(c._id))
      .filter((c) => !isAuthorBlocked(getOtherParticipant(c, myUserId, myAddress)?.address))
      .sort(
        (a, b) =>
          +new Date(b.updatedAt || b.lastMessageAt || 0) -
          +new Date(a.updatedAt || a.lastMessageAt || 0),
      );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversations, query, myUserId, myAddress, pendingDeletes, blockedVersion, showRequests]);

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
  const deleteConv = useCallback(
    (conv: DmConversation | null) => {
      if (!conv) return;
      const id = conv._id;
      scheduleDelete(id, async () => {
        try {
          await deleteConversation(id, myAddress);
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

  const handleCtxBlock = useCallback(
    () => blockConvUser(ctxUser),
    [blockConvUser, ctxUser],
  );

  const handleCtxDelete = useCallback(
    () => deleteConv(ctxConv),
    [deleteConv, ctxConv],
  );

  const handleCtxSelectMany = useCallback(() => {
    if (ctxConv) setBulkIds(new Set([ctxConv._id]));
  }, [ctxConv]);

  const ws = useWebSocketApi();
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
    navigation.navigate(ScreenNames.LiveChat as any);
  }, [navigation]);

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

  const publicChatItem = useMemo(
    () => inRequests ? (
      <>
        <TouchableOpacity
          onPress={() => setShowRequests(false)}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel={t("common.goBack")}
          testID="requests-back"
          className="flex-row items-center px-4 pt-4 pb-2 gap-2"
        >
          <Icon name="ChevronLeft" size={18} color="#A1A1AA" />
          <Text className="text-theme-neutrals-100 text-[15px] font-semibold">
            {t("dmRequests.title", { defaultValue: "Requests" })}
          </Text>
        </TouchableOpacity>
        <Text className="text-theme-neutrals-400 text-[13px] px-4 pb-3" style={{ lineHeight: 18 }}>
          {t("dmRequests.hint", { defaultValue: "Messages from people you don't follow. Accept one, reply or follow them and the chat moves to your inbox." })}
        </Text>
        <View style={SEPARATOR} />
      </>
    ) : (
      <>
      <TouchableOpacity
        onPress={handleOpenLiveChat}
        activeOpacity={0.7}
        className="flex-row items-center px-4 py-4 gap-3"
      >
        {/* Logo styled like Avatar size={48} */}
        <View
          style={{ width: 48, height: 48, borderRadius: Math.round(48 * 0.16) }}
          className="dark-surface bg-black items-center justify-center overflow-hidden"
        >
          <Image
            source={require("../assets/web-icons/dehub-logo-compact.png")}
            style={{ width: 32, height: 32 }}
            contentFit="contain"
          />
        </View>

        {/* Name + preview (matches ConversationItem layout) */}
        <View className="flex-1 justify-center">
          <View className="flex-row items-center gap-1.5">
            <Text className="text-theme-neutrals-100 text-[15px] font-semibold" numberOfLines={1}>
              {t("publicChat.title")}
            </Text>
          </View>
          <View className="flex-row items-center gap-1 mt-0.5">
            <Text className="text-theme-neutrals-400 text-[14px] flex-1" numberOfLines={1}>
              {t("publicChat.subtitle")}
            </Text>
          </View>
        </View>
        {publicUnread > 0 && (
          <View style={{ minWidth: 20, height: 20, paddingHorizontal: 6, borderRadius: 10, backgroundColor: "#ef4444", alignItems: "center", justifyContent: "center" }}>
            <Text style={{ color: "#ffffff", fontSize: 12, fontWeight: "700" }}>
              {publicUnread > 99 ? "99+" : publicUnread}
            </Text>
          </View>
        )}
      </TouchableOpacity>
      <View style={SEPARATOR} />
      {groupChats.map((c) => (
        <React.Fragment key={c.id}>
          <GroupChatRow
            community={c}
            onPress={() => (picking ? toggleBulk(roomChatId(c.id)) : openGroupChat(c))}
            onLongPress={() => (picking ? toggleBulk(roomChatId(c.id)) : setBulkIds(new Set([roomChatId(c.id)])))}
            selecting={picking}
            checked={!!bulkIds?.has(roomChatId(c.id))}
            markedUnread={!!chatPrefs.get(roomChatId(c.id))?.markedUnread}
          />
          <View style={SEPARATOR} />
        </React.Fragment>
      ))}
      {requestChats.length > 0 && !query.trim() && (
        <>
          <TouchableOpacity
            onPress={() => setShowRequests(true)}
            activeOpacity={0.7}
            accessibilityRole="button"
            testID="requests-open"
            className="flex-row items-center px-4 py-4 gap-3"
          >
            <View
              style={{ width: 48, height: 48, borderRadius: Math.round(48 * 0.16), backgroundColor: "rgba(127,127,127,0.16)" }}
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
          <View style={SEPARATOR} />
        </>
      )}
      </>
    ),
    [handleOpenLiveChat, publicUnread, t, groupChats, openGroupChat, inRequests, requestChats.length, requestUnread, query, picking, bulkIds, chatPrefs, toggleBulk],
  );

  const itemSeparator = useCallback(() => <View style={SEPARATOR} />, []);

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
          data={filtered}
          keyExtractor={keyExtractor}
          renderItem={renderItem}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingBottom: picking ? 150 : 80 }}
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

        <ConversationContextMenu
          visible={!!ctxConv}
          conversation={ctxConv}
          otherUser={ctxUser}
          onClose={closeCtx}
          onOpenChat={handleCtxOpenChat}
          onBlock={handleCtxBlock}
          onDelete={handleCtxDelete}
          onSelectMany={handleCtxSelectMany}
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
