import { confirmChatDelivery, roomMessageMatches, waitForChatRoom } from '../libs/chat-delivery';
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isAuthorBlocked, useBlockedAuthorsVersion } from "../libs/blocked-authors";
import { io, Socket } from "socket.io-client";
import { AppState, AppStateStatus } from "react-native";
import { useIsFocused } from "@react-navigation/native";
import env from "../config/env";
import { getAuthToken } from "../libs/auth.utils";
import { useUser, useAuthState } from "../context/AuthContext";
import { createLogger } from "../libs/logger";
import { toastError } from "../libs/toast";
import { chatRefusalText, isAuthRefusal, type ChatRefusalPayload } from "../libs/chat-refusal";
import { tokenRefreshManager } from "../libs/token-refresh";
import { t } from "i18next";
import type {
  LiveChatMessageData,
  LiveChatRoom,
  LiveChatUser,
  SendMessagePayload,
  LiveChatRoomJoinedPayload,
} from "../services/livechat.service";
import { getLiveChatMessages, getLiveChatOnlineCount, LIVE_CHAT_PAGE_SIZE as CHAT_PAGE_SIZE, loadInitialLiveChatMessages } from "../services/livechat.service";
import { normalizeMsg } from "../libs/livechat-normalize";
import { readRecentChat, writeRecentChat } from "../libs/livechat-cache";

const log = createLogger("LiveChat");

const MAX_CHAT_MESSAGES = 200;

/**
 * The access token, refreshed first when it is about to run out. Read for
 * every handshake and every send: a connection that came back from the
 * background with an expired token was taken as a guest by the server, and
 * every message failed with "Authentication required" until a restart.
 */
async function freshToken(): Promise<string | null> {
  await tokenRefreshManager.ensureFreshToken().catch(() => undefined);
  return getAuthToken();
}

const EVENTS = {
  // Client → Server
  JOIN: "livechat:joinRoom",
  LEAVE: "livechat:leaveRoom",
  SEND: "livechat:sendMessage",
  EDIT: "livechat:editMessage",
  DELETE: "livechat:deleteMessage",
  ADD_REACTION: "livechat:addReaction",
  REMOVE_REACTION: "livechat:removeReaction",
  TYPING: "livechat:typing",
  PING: "livechat:ping",
  // Server → Client
  ROOM_JOINED: "livechat:roomJoined",
  ROOM_LEFT: "livechat:roomLeft",
  NEW_MESSAGE: "livechat:newMessage",
  MESSAGE_EDITED: "livechat:messageEdited",
  MESSAGE_DELETED: "livechat:messageDeleted",
  REACTION_UPDATED: "livechat:reactionUpdated",
  USER_TYPING: "livechat:userTyping",
  USER_JOINED: "livechat:userJoined",
  USER_LEFT: "livechat:userLeft",
  ROOM_UPDATED: "livechat:roomUpdated",
  MESSAGE_PINNED: "livechat:messagePinned",
  MESSAGE_UNPINNED: "livechat:messageUnpinned",
  USER_BANNED: "livechat:userBanned",
  USER_UNBANNED: "livechat:userUnbanned",
  ERROR: "livechat:error",
  PONG: "livechat:pong",
  /** Sign an open connection in again with a fresh token. */
  AUTHENTICATE: "livechat:authenticate",
} as const;

/**
 * The chat opens on the newest 20 lines and reads 20 further back each time
 * the reader nears the top, until the start of the room.
 */
/** Lines read around a message opened from search. */
const CHAT_AROUND_SIZE = 40;

export interface UseLiveChatReturn {
  connected: boolean;
  joining: boolean;
  messages: LiveChatMessageData[];
  room: LiveChatRoom | null;
  myUser: LiveChatUser | null;
  isBanned: boolean;
  isModerator: boolean;
  /** Whether a line's sender can be timed out or banned by this viewer: platform moderators only by a super moderator. */
  canModerateUser: (address?: string | null) => boolean;
  /** Until when a stream creator's timeout keeps this viewer quiet in this room. */
  mutedUntil: number | null;
  canSend: boolean;
  typingUsers: LiveChatUser[];
  onlineCount: number;
  loadingMore: boolean;
  hasMore: boolean;
  sendMessage: (payload: SendMessagePayload) => Promise<boolean>;
  editMessage: (messageId: string, content: string) => Promise<boolean>;
  deleteMessage: (messageId: string) => void;
  addReaction: (messageId: string, emoji: string) => void;
  removeReaction: (messageId: string, emoji: string) => void;
  setTyping: (isTyping: boolean) => void;
  loadMoreMessages: () => Promise<void>;
  /**
   * True while the list shows an older stretch of the room, opened from
   * search, with newer lines still unread below it.
   */
  hasNewer: boolean;
  /** Show the room around one message. False when the message is gone. */
  jumpToMessage: (messageId: string) => Promise<boolean>;
  loadNewerMessages: () => Promise<void>;
  backToLatest: () => Promise<void>;
  reconnect: () => void;
  updateBannedList: (address: string, banned: boolean) => void;
}

/**
 * @param roomId The room to sit in. Omitted, the platform's global room —
 *   what the public chat has always used. A live post names its room
 *   `stream:<tokenId>`, the same key the web app joins for it, so a viewer on
 *   a phone and one in a browser are in one conversation. The livestream
 *   gateway's own room (`stream:<mongoId>`) is a different socket and a
 *   different store; the two never met, which is why a phone's messages were
 *   invisible from the web and vice versa.
 * @param options.requireRoom Set by any caller that belongs to one specific
 *   room and nothing else. Its room id arrives a moment after mount — a
 *   stream's is keyed on the post's tokenId, which is only known once the
 *   stream loads — and without this the hook spent that moment connected to
 *   the global room and painted the public chat under the stream. It then
 *   stayed there for good on any stream whose tokenId never resolved.
 */
export const useLiveChat = (
  roomId?: string,
  options?: { requireRoom?: boolean },
): UseLiveChatReturn => {
  const requireRoom = options?.requireRoom === true;
  const user = useUser();
  const roomIdRef = useRef<string | undefined>(roomId);
  roomIdRef.current = roomId;
  const joinPayload = () => (roomIdRef.current ? { roomId: roomIdRef.current } : undefined);
  const { isSignedIn } = useAuthState();
  const isFocused = useIsFocused();

  const [connected, setConnected] = useState(false);
  const [joining, setJoining] = useState(false);
  const [messages, setMessages] = useState<LiveChatMessageData[]>([]);
  // Simulator check only (scripts/ios-nav/tour.ts creates the set): lets the
  // check change the lines the way socket events would. Never set in the app.
  useEffect(() => {
    type Tap = (update: (prev: LiveChatMessageData[]) => LiveChatMessageData[]) => void;
    const taps = (globalThis as { __liveChatTaps?: Set<Tap> }).__liveChatTaps;
    if (!taps) return;
    const tap: Tap = (update) => setMessages(update);
    taps.add(tap);
    return () => { taps.delete(tap); };
  }, []);
  const [room, setRoom] = useState<LiveChatRoom | null>(null);
  const [myUser, setMyUser] = useState<LiveChatUser | null>(null);
  const [isBanned, setIsBanned] = useState(false);
  const [isModerator, setIsModerator] = useState(false);
  const [staff, setStaff] = useState<string[]>([]);
  const [isSuperModerator, setIsSuperModerator] = useState(false);
  const [canSend, setCanSend] = useState(false);
  /** Until when a stream timeout keeps this viewer quiet here, if one does. */
  const [mutedUntil, setMutedUntil] = useState<number | null>(null);
  const [typingUsers, setTypingUsers] = useState<LiveChatUser[]>([]);
  const [onlineCount, setOnlineCount] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [hasNewer, setHasNewer] = useState(false);
  /** Read inside socket handlers, which close over the first render. */
  const hasNewerRef = useRef(false);
  const loadingNewerRef = useRef(false);
  const setReadingHistory = (value: boolean) => { hasNewerRef.current = value; setHasNewer(value); };

  const socketRef = useRef<Socket | null>(null);
  /** Older pages the reader scrolled back for in this room. */
  const olderPagesRef = useRef(0);
  /** Latest access token, sent with each action so the server can sign a guest connection in. */
  const tokenRef = useRef<string | null>(null);
  const signInTriedRef = useRef<string | null>(null);
  const joinedRef = useRef(false);
  const pingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const myAddressRef = useRef<string>("");

  myAddressRef.current = (user?.walletAddress || user?.address || "").toLowerCase();

  // Connect socket
  useEffect(() => {
    if (!isSignedIn) return;
    // No room yet for a caller that only ever wants its own: wait, rather
    // than fall through to the global room.
    if (requireRoom && !roomId) {
      setJoining(true);
      return;
    }

    let cancelled = false;
    // A different room is a different conversation: swap in the public room's
    // last known lines (a stream starts empty) instead of leaving the old
    // room's on screen.
    setMessages(roomId ? [] : readRecentChat());
    setRoom(null);
    setHasMore(true);
    setReadingHistory(false);
    olderPagesRef.current = 0;
    setJoining(true); // Show loading immediately

    // History over plain HTTP, in parallel with the socket. The join's own copy
    // waits behind the socket handshake and the token read, which on a phone
    // network is several round trips; this one is one. Whichever lands first
    // paints, and the join always has the last word.
    loadInitialLiveChatMessages(roomId, myAddressRef.current)
      .then((res) => {
        if (cancelled || joinedRef.current || hasNewerRef.current || !res?.messages?.length) return;
        setMessages(res.messages.map(normalizeMsg).reverse());
        setHasMore(res.hasMore);
      })
      .catch((e) => log.debug("History prefetch failed:", e));

    const connect = async () => {
      const token = await getAuthToken();
      if (!token || cancelled) {
        setJoining(false);
        return;
      }

      const wsUrl = env.WEBSOCKET_URL || env.API_URL?.replace(/\/api$/, "");
      const socket = io(`${wsUrl}/livechat`, {
        // Read on every handshake, not once. The access token rotates every
        // fifteen minutes, so a reconnect later in a stream used to sign in
        // with a dead one and come back as a guest who could not send.
        auth: (cb) => {
          freshToken()
            .then((fresh) => { tokenRef.current = fresh || token; cb({ token: fresh || token }); })
            .catch(() => cb({ token }));
        },
        transports: ["polling", "websocket"],
        reconnection: true,
        // Never give up: a chat that stopped after fifteen tries stayed silent
        // until the app went to the background and back.
        reconnectionAttempts: Infinity,
        reconnectionDelay: 2000,
        reconnectionDelayMax: 10000,
        forceNew: true,
      });

      socketRef.current = socket;

      socket.on("connect", () => {
        if (cancelled) return;
        log.debug("Connected");
        setConnected(true);
        socket.emit(EVENTS.JOIN, joinPayload());
        setJoining(true);
      });

      socket.on("connect_error", (err) => {
        log.debug("Connect error:", err.message);
        if (!cancelled) setJoining(false);
      });

      socket.on("disconnect", (reason) => {
        log.debug("Disconnected:", reason);
        setConnected(false);
        joinedRef.current = false;
        setJoining(false);
        // The server closing us is the one drop Socket.IO does not retry by
        // itself. The re-join on connect brings back what was missed.
        if (reason === "io server disconnect" && !cancelled) {
          setTimeout(() => { if (!cancelled && !socket.connected) socket.connect(); }, 2000);
        }
      });

      socket.on(EVENTS.PONG, (data: any) => {
        if (data?.isBanned) setIsBanned(true);
        if (data?.user?.isModerator) setIsModerator(true);
        // Signed in here, a guest to the server: sign this connection back
        // in with a fresh token. Once per connection, so it cannot loop.
        if (data?.isAuthenticated === false && socket.id && signInTriedRef.current !== socket.id) {
          signInTriedRef.current = socket.id;
          freshToken()
            .then((fresh) => {
              if (!fresh || cancelled || !socket.connected) return;
              tokenRef.current = fresh;
              socket.emit(EVENTS.AUTHENTICATE, { token: fresh });
            })
            .catch(() => undefined);
        }
      });

      socket.on(EVENTS.ROOM_JOINED, (data: LiveChatRoomJoinedPayload) => {
        if (cancelled || (requireRoom && data.room?.roomId !== roomId)) return;
        log.debug("Room joined, messages:", data.messages?.length);
        // The pins ride in on the room rather than in `messages`, so they need
        // the same normalising or the pinned bar reads a blank author.
        setRoom(
          data.room
            ? { ...data.room, pinnedMessages: (data.room.pinnedMessages || []).map(normalizeMsg) }
            : data.room,
        );
        // A rejoin (network blip, app back from the background) brings the
        // newest page again; history the reader already scrolled back for
        // stays above it instead of being thrown away.
        const joined = (data.messages || []).map(normalizeMsg).reverse();
        // Reading an older stretch from search: a rejoin must not swap the
        // newest page in under the reader.
        if (!hasNewerRef.current) setMessages((prev) => {
          if (!olderPagesRef.current || !joined.length) return joined;
          const oldestJoined = Date.parse(joined[0].createdAt) || 0;
          const ids = new Set(joined.map((m) => m._id));
          const older = prev.filter((m) => !ids.has(m._id) && (Date.parse(m.createdAt) || 0) < oldestJoined);
          return [...older, ...joined];
        });
        setMyUser(data.yourUser);
        setIsBanned(data.isBanned);
        setCanSend(data.canSendMessages);
        setIsModerator(data.yourUser?.isModerator || false);
        setIsSuperModerator(!!data.yourUser?.isSuperModerator);
        setStaff(Array.isArray(data.staff) ? data.staff.map((a: unknown) => String(a).toLowerCase()) : []);
        setOnlineCount(data.onlineCount || data.room?.onlineCount || 0);
        // The join brings one page. A full page means older lines may exist;
        // this used to wait for 50, which the 20-line join never reaches, so
        // the chat stopped at its first page.
        if (!olderPagesRef.current && !hasNewerRef.current) setHasMore((data.messages?.length || 0) >= CHAT_PAGE_SIZE);
        joinedRef.current = true;
        setJoining(false);

        // Fetch accurate online count from REST (Redis counter). The endpoint
        // has no room dimension — it counts everybody on the platform chat —
        // so only the global room may read it. In a stream it was reporting
        // strangers as that stream's audience.
        if (roomIdRef.current) return;
        getLiveChatOnlineCount()
          .then((res) => { if (res?.count) setOnlineCount(res.count); })
          .catch(() => {});
      });

      socket.on(EVENTS.NEW_MESSAGE, (msg: LiveChatMessageData) => {
        // Not while an older stretch is open: the line would land right under
        // months-old ones. It is read when the reader comes back to the end.
        if (hasNewerRef.current) return;
        setMessages((prev) => {
          const next = [...prev, normalizeMsg(msg)];
          // History the reader scrolled back for is kept whole.
          if (olderPagesRef.current) return next;
          return next.length > MAX_CHAT_MESSAGES ? next.slice(-MAX_CHAT_MESSAGES) : next;
        });
      });

      socket.on(EVENTS.MESSAGE_EDITED, (raw: LiveChatMessageData) => {
        const msg = normalizeMsg(raw);
        setMessages((prev) =>
          prev.map((m) => (m._id === msg._id ? msg : m))
        );
      });

      socket.on(EVENTS.MESSAGE_DELETED, ({ messageId }: { messageId: string }) => {
        setMessages((prev) => prev.filter((m) => m._id !== messageId));
      });

      socket.on(EVENTS.REACTION_UPDATED, ({
        messageId,
        reactions,
      }: {
        messageId: string;
        reactions: Record<string, string[]>;
      }) => {
        setMessages((prev) =>
          prev.map((m) => (m._id === messageId ? { ...m, reactions } : m))
        );
      });

      socket.on(EVENTS.USER_TYPING, ({ user: u, isTyping }: { user: LiveChatUser; isTyping: boolean }) => {
        setTypingUsers((prev) => {
          if (isTyping) {
            if (prev.some((t) => t.address === u.address)) return prev;
            return [...prev, u];
          }
          return prev.filter((t) => t.address !== u.address);
        });
      });

      socket.on(EVENTS.USER_JOINED, ({ user: u }: { user: LiveChatUser }) => {
        setOnlineCount((prev) => prev + 1);
      });

      socket.on(EVENTS.USER_LEFT, ({ user: u }: { user: LiveChatUser }) => {
        setOnlineCount((prev) => Math.max(0, prev - 1));
        setTypingUsers((prev) => prev.filter((t) => t.address !== u.address));
      });

      // A stream creator's own moderation, for this room only. About this
      // viewer: they are timed out or banned here. About someone else: a
      // banned viewer's lines leave the room.
      socket.on("livechat:userModerated", (data: any) => {
        const address = String(data?.address || "").toLowerCase();
        if (!address || (data?.roomId && data.roomId !== roomIdRef.current)) return;
        if (address === myAddressRef.current) {
          if (data?.action === "ban") {
            setIsBanned(true);
            setCanSend(false);
          } else {
            setMutedUntil(Date.now() + (Number(data?.seconds) || 60) * 1000);
          }
          return;
        }
        if (data?.action === "ban") {
          setMessages((prev) => prev.filter((m) => (m.senderAddress || m.sender?.address || "").toLowerCase() !== address));
        }
      });

      socket.on(EVENTS.ROOM_UPDATED, (updatedRoom: LiveChatRoom) => {
        setRoom(updatedRoom);
      });

      socket.on(EVENTS.MESSAGE_PINNED, (raw: LiveChatMessageData) => {
        const msg = normalizeMsg(raw);
        setMessages((prev) =>
          prev.map((m) => (m._id === msg._id ? msg : m))
        );
        // Keep room.pinnedMessages in sync
        setRoom((prev) => {
          if (!prev) return prev;
          const existing = prev.pinnedMessages || [];
          const already = existing.some((p) => (p._id || (p as any).id) === msg._id);
          return {
            ...prev,
            pinnedMessages: already
              ? existing.map((p) => ((p._id || (p as any).id) === msg._id ? msg : p))
              : [...existing, msg],
          };
        });
      });

      socket.on(EVENTS.MESSAGE_UNPINNED, ({ messageId }: { messageId: string }) => {
        setMessages((prev) =>
          prev.map((m) =>
            m._id === messageId ? { ...m, isPinned: false, pinnedBy: undefined, pinnedAt: undefined } : m
          )
        );
        setRoom((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            pinnedMessages: (prev.pinnedMessages || []).filter(
              (p) => (p._id || (p as any).id) !== messageId
            ),
          };
        });
      });

      socket.on(EVENTS.USER_BANNED, ({ message }: { message: string }) => {
        setIsBanned(true);
        setCanSend(false);
      });

      socket.on(EVENTS.USER_UNBANNED, ({ message }: { message: string }) => {
        setIsBanned(false);
        setCanSend(true);
      });

      socket.on(EVENTS.ERROR, (data: ChatRefusalPayload = {}) => {
        const { message, code, isBanned: banned } = data;
        log.debug("Error:", message);
        // The send that got this signs in again and retries; only a session
        // that is really over is shown, by the send.
        if (isAuthRefusal(data)) return;
        if (code === "BANNED" || banned) {
          setIsBanned(true);
          setCanSend(false);
        }
        const text = chatRefusalText(data);
        if (text) toastError(text);
      });

      // Heartbeat ping
      pingIntervalRef.current = setInterval(() => {
        if (socket.connected) socket.emit(EVENTS.PING);
      }, 25000);
    };

    connect();

    return () => {
      cancelled = true;
      if (pingIntervalRef.current) {
        clearInterval(pingIntervalRef.current);
        pingIntervalRef.current = null;
      }
      const socket = socketRef.current;
      if (socket) {
        socket.emit(EVENTS.LEAVE);
        socket.removeAllListeners();
        socket.disconnect();
        socketRef.current = null;
      }
      joinedRef.current = false;
      setConnected(false);
      setJoining(false);
    };
    // A new room is a new socket: the gateway holds one room per connection.
  }, [isSignedIn, roomId, requireRoom]);

  // Keep the public room's last screenful for the next open. Stream rooms are
  // skipped: they are short-lived and one per stream, so they would only pile
  // up on the phone. Debounced, or a busy room would rewrite it on every
  // arrival; the room is read now, not when the timer fires, so a switch in
  // between cannot file one room's lines under another.
  useEffect(() => {
    if (messages.length === 0 || roomIdRef.current || hasNewerRef.current) return;
    const timer = setTimeout(() => writeRecentChat(undefined, messages), 2000);
    return () => clearTimeout(timer);
  }, [messages]);

  // Pause/resume on app background — reconnect + rejoin
  useEffect(() => {
    const handleAppState = (nextState: AppStateStatus) => {
      const socket = socketRef.current;
      if (!socket) return;
      if (nextState === "active") {
        if (!socket.connected) {
          socket.connect();
        } else if (!joinedRef.current) {
          socket.emit(EVENTS.JOIN, joinPayload());
          setJoining(true);
        }
      }
    };
    const sub = AppState.addEventListener("change", handleAppState);
    return () => sub.remove();
  }, []);

  const withToken = <T extends object>(body: T): T & { token?: string } =>
    tokenRef.current ? { ...body, token: tokenRef.current } : body;

  const sendMessage = useCallback(async (payload: SendMessagePayload): Promise<boolean> => {
    const socket = socketRef.current;
    const account = user?.walletAddress || user?.address;
    if (!socket || !account || (requireRoom && !roomId)) return false;
    if (!requireRoom && !socket.connected) return false;
    const isCurrent = () => socketRef.current === socket && roomIdRef.current === roomId &&
      myAddressRef.current === account.toLowerCase();
    let signedOut = false;
    // The token rides with the message: a connection the server took as a
    // guest is signed in again by the send itself.
    const deliver = async (token: string | null) => {
      if (!isCurrent()) return false;
      if (requireRoom && !(await waitForChatRoom(
        socket,
        () => isCurrent() && joinedRef.current,
        [EVENTS.ROOM_JOINED],
        () => socket.emit(EVENTS.JOIN, { roomId }),
      ))) {
        if (isCurrent()) toastError(t("liveChat.disconnected"));
        return false;
      }
      if (!isCurrent() || !socket.connected) return false;
      return confirmChatDelivery({
        listen: (event, handler) => {
          if (event === EVENTS.ERROR) {
            const onError = (data: ChatRefusalPayload) => { if (isAuthRefusal(data)) signedOut = true; handler(data); };
            socket.on(event, onError); return () => { socket.off(event, onError); };
          }
          socket.on(event, handler); return () => { socket.off(event, handler); };
        },
        emit: () => {
          const line = roomId ? { ...payload, roomId } : { ...payload };
          socket.emit(EVENTS.SEND, token ? { ...line, token } : line);
        },
        messageEvent: EVENTS.NEW_MESSAGE, errorEvent: EVENTS.ERROR,
        matches: message => roomMessageMatches(message, { account, content: payload.content ?? '', room: roomId, attachment: payload.audioUrl || payload.gif?.url || payload.media?.[0]?.url }),
      });
    };
    const token = await freshToken().catch(() => null);
    if (token) tokenRef.current = token;
    if (await deliver(token)) return true;
    if (!signedOut) return false;
    // Still refused as signed out: one real refresh, then once more, quietly.
    const renewed = await tokenRefreshManager.attemptRefresh().catch(() => null);
    if (renewed) {
      tokenRef.current = renewed;
      signedOut = false;
      if (await deliver(renewed)) return true;
    }
    if (signedOut || !renewed) {
      toastError(t("copy.de1ad7135e96", { defaultValue: "Your sign-in session expired. Please sign in again." }));
    }
    return false;
  }, [roomId, requireRoom, user?.walletAddress, user?.address]);

  const editMessage = useCallback(async (messageId: string, content: string): Promise<boolean> => {
    const socket = socketRef.current;
    const account = user?.walletAddress || user?.address;
    if (!socket?.connected || !account) return false;
    return confirmChatDelivery({
      listen: (event, handler) => { socket.on(event, handler); return () => { socket.off(event, handler); }; },
      emit: () => { socket.emit(EVENTS.EDIT, withToken({ messageId, content })); },
      messageEvent: EVENTS.MESSAGE_EDITED, errorEvent: EVENTS.ERROR,
      matches: message => roomMessageMatches(message, { account, content, room: roomIdRef.current, messageId }),
    });
  }, [user?.walletAddress, user?.address]);

  const deleteMessageFn = useCallback((messageId: string) => {
    socketRef.current?.emit(EVENTS.DELETE, withToken({ messageId }));
  }, []);

  const addReaction = useCallback((messageId: string, emoji: string) => {
    socketRef.current?.emit(EVENTS.ADD_REACTION, withToken({ messageId, emoji }));
  }, []);

  const removeReaction = useCallback((messageId: string, emoji: string) => {
    socketRef.current?.emit(EVENTS.REMOVE_REACTION, withToken({ messageId, emoji }));
  }, []);

  const setTyping = useCallback((isTyping: boolean) => {
    socketRef.current?.emit(EVENTS.TYPING, { isTyping });
    if (isTyping) {
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = setTimeout(() => {
        socketRef.current?.emit(EVENTS.TYPING, { isTyping: false });
      }, 3000);
    }
  }, []);

  const messagesRef = useRef<LiveChatMessageData[]>([]);
  messagesRef.current = messages;
  const hasMoreRef = useRef(true);
  hasMoreRef.current = hasMore;
  const loadingMoreRef = useRef(false);
  loadingMoreRef.current = loadingMore;

  const loadMoreMessages = useCallback(async () => {
    if (loadingMoreRef.current || !hasMoreRef.current || messagesRef.current.length === 0) return;
    setLoadingMore(true);
    try {
      const oldest = messagesRef.current[0];
      // Scoped to this room, or the page comes back full of global chat.
      const res = await getLiveChatMessages({
        before: oldest._id,
        limit: CHAT_PAGE_SIZE,
        roomId: roomIdRef.current,
      });
      if (res.messages.length > 0) {
        olderPagesRef.current += 1;
        setMessages((prev) => {
          const existingIds = new Set(prev.map((m) => m._id));
          const older = res.messages
            .map(normalizeMsg)
            .reverse()
            .filter((m) => !existingIds.has(m._id));
          return [...older, ...prev];
        });
      }
      setHasMore(res.hasMore);
    } catch (e) {
      log.debug("Failed to load more messages:", e);
    } finally {
      setLoadingMore(false);
    }
  }, []);

  const jumpToMessage = useCallback(async (messageId: string): Promise<boolean> => {
    if (messagesRef.current.some((m) => m._id === messageId)) return true;
    try {
      const res = await getLiveChatMessages({ around: messageId, limit: CHAT_AROUND_SIZE, roomId: roomIdRef.current });
      const rows = (res.messages || []).map(normalizeMsg).reverse();
      if (!rows.some((m) => m._id === messageId)) return false;
      olderPagesRef.current += 1;
      setReadingHistory(res.hasNewer === true);
      setMessages(rows);
      setHasMore(res.hasMore);
      return true;
    } catch (e) {
      log.debug("Failed to open a message:", e);
      return false;
    }
  }, []);

  const loadNewerMessages = useCallback(async () => {
    if (!hasNewerRef.current || loadingNewerRef.current || messagesRef.current.length === 0) return;
    loadingNewerRef.current = true;
    try {
      const newest = messagesRef.current[messagesRef.current.length - 1];
      const res = await getLiveChatMessages({ after: newest._id, limit: CHAT_AROUND_SIZE, roomId: roomIdRef.current });
      const rows = (res.messages || []).map(normalizeMsg).reverse();
      setMessages((prev) => {
        const have = new Set(prev.map((m) => m._id));
        return [...prev, ...rows.filter((m) => !have.has(m._id))];
      });
      if (!res.hasMore) setReadingHistory(false);
    } catch (e) {
      log.debug("Failed to load newer messages:", e);
    } finally {
      loadingNewerRef.current = false;
    }
  }, []);

  const backToLatest = useCallback(async () => {
    if (!hasNewerRef.current) return;
    try {
      const res = await getLiveChatMessages({ limit: CHAT_PAGE_SIZE, roomId: roomIdRef.current });
      olderPagesRef.current = 0;
      setReadingHistory(false);
      setMessages((res.messages || []).map(normalizeMsg).reverse());
      setHasMore(res.hasMore);
    } catch (e) {
      log.debug("Failed to return to the latest messages:", e);
    }
  }, []);

  const reconnect = useCallback(() => {
    const socket = socketRef.current;
    if (socket) {
      if (!socket.connected) {
        setJoining(true);
        socket.connect();
      } else if (!joinedRef.current) {
        setJoining(true);
        socket.emit(EVENTS.JOIN, joinPayload());
      }
    }
  }, []);

  const updateBannedList = useCallback((address: string, banned: boolean) => {
    if (!address) return;
    setRoom((prev) => {
      if (!prev) return prev;
      const addr = address.toLowerCase();
      const current = (prev.bannedUsers || []).filter(Boolean);
      if (banned) {
        if (current.some((a) => a?.toLowerCase() === addr)) return prev;
        return { ...prev, bannedUsers: [...current, address] };
      }
      return { ...prev, bannedUsers: current.filter((a) => a?.toLowerCase() !== addr) };
    });
  }, []);

  // Someone the user blocked disappears from the chat at once (App Store 1.2).
  const blockedVersion = useBlockedAuthorsVersion();
  const visibleMessages = useMemo(
    () => messages.filter((m) => !isAuthorBlocked(m.senderAddress)),
    // blockedVersion re-runs the filter when the block list changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [messages, blockedVersion],
  );

  const canModerateUser = useCallback(
    (address?: string | null) => !!address && (isSuperModerator || !staff.includes(address.toLowerCase())),
    [isSuperModerator, staff],
  );

  return {
    connected,
    joining,
    messages: visibleMessages,
    room,
    myUser,
    isBanned,
    isModerator,
    canModerateUser,
    mutedUntil,
    canSend,
    typingUsers,
    onlineCount,
    loadingMore,
    hasMore,
    sendMessage,
    editMessage,
    deleteMessage: deleteMessageFn,
    addReaction,
    removeReaction,
    setTyping,
    loadMoreMessages,
    hasNewer,
    jumpToMessage,
    loadNewerMessages,
    backToLatest,
    reconnect,
    updateBannedList,
  };
};
