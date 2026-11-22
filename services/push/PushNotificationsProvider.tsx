import React, { useEffect, useRef, useCallback, useState } from 'react';
import { openChatMention } from "../../libs/openChatMention";
import * as Notifications from 'expo-notifications';
import NetInfo from '@react-native-community/netinfo';
import { AppState, AppStateStatus, Linking } from 'react-native';
import { useNavigation, NavigationProp } from '@react-navigation/native';
import { useUser, useAuthState, useAuthActions } from '../../context/AuthContext';
import { usePublicChatAlerts } from '../../hooks/usePublicChatAlerts';
import { usePublicChatReadSync } from '../../hooks/usePublicChatReadSync';
import { ScreenNames } from '../../navigation/ScreenNames';
import {
  registerForPushNotifications,
  registerPushTokenWithBackend,
  clearPushTokenCache,
  isValidExpoPushToken,
  clearBadge,
  getNotificationPermissionStatus,
} from './push.service';
import NotificationPermissionPrompt from '../../components/NotificationPermissionPrompt';
import { createLogger } from '../../libs/logger';
import { openInApp } from '../../libs/links.utils';
import { NotificationType, NotificationCategory } from '../enums/notification.enums';
import { storage } from '../../libs/storage';
import { toastWarning } from '../../libs/toast';
import { t } from 'i18next';
import { getNotifications, markNotificationAsRead } from '../user.service';
import { prefetchNotifications } from '../../libs/notifications-cache';
import { countUnreadNotifications, extractNotificationItems, incrementUnreadCount, notificationsMatchingTap } from '../../libs/notifications.unread';
import { emitProfileDeepLink } from '../../libs/deeplink.events';
import { openCustomPush } from '../../libs/custom-notification-route';
import { readNotificationData as readTapData } from '../../libs/push-tap-data';
import { noteNotificationMoment } from '../../libs/review-prompt';
import { useOnboarding } from '../../context/OnboardingChecklistContext';
import { listProfiles } from '../../libs/profiles';

const logger = createLogger('PushProvider');

// Persisted so a cold start can tell a fresh notification tap apart from the
// stale response Android replays on every launch via getLastNotificationResponseAsync.
const LAST_HANDLED_RESPONSE_KEY = 'push.lastHandledResponseId';

// When the user last said "Not now" to the branded pre-prompt. Declining ours
// never reaches the OS, so we are free to ask again — just not soon.
const SOFT_ASK_DECLINED_AT_KEY = 'push.softAskDeclinedAt';
const SOFT_ASK_COOLDOWN_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

// The OS dialog used to fire one second after sign-in, landing on top of the
// welcome copy a new user is still reading. The pre-prompt waits until they
// have had time with the app instead — and, counting from the moment the
// username and walkthrough-offer modals are out of the way, long enough that
// a walkthrough sheet opened from that offer is not immediately covered.
const SOFT_ASK_DELAY_MS = 20_000;

// How long a "notifications are blocked" notice stays away once shown. Long
// enough not to nag, short enough that it resurfaces for someone who meant to
// fix it and forgot.
const BLOCKED_NOTICE_KEY = 'push.blockedNoticeAt';
const BLOCKED_NOTICE_COOLDOWN_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * Say when the OS is refusing notifications outright.
 *
 * A hard denial cannot be undone from inside the app, so the soft-ask has
 * nothing to offer and correctly stays quiet. Staying *silent* is the bug:
 * an account whose preferences ask for push then receives nothing, forever,
 * with no way to find out short of opening Settings and reading the banner.
 * Nobody opens Settings to check whether a thing they believe works still
 * works. So: once a fortnight, with the one control that can change it.
 *
 * Reuses the strings the Settings banner already carries, so this adds no
 * untranslated copy.
 */
function noticePushBlocked(wantsPush: boolean): void {
  // Somebody who turned push off is not missing anything.
  if (!wantsPush) return;
  const shownAt = storage.getNumber(BLOCKED_NOTICE_KEY);
  if (shownAt && Date.now() - shownAt < BLOCKED_NOTICE_COOLDOWN_MS) return;
  storage.set(BLOCKED_NOTICE_KEY, Date.now());
  toastWarning(t('settings.pushNotificationsDisabled'), {
    description: t('settings.tapEnableSystemSettings'),
    actionLabel: t('nav.settings'),
    onActionPress: () => {
      void Linking.openSettings();
    },
    duration: 12_000,
  });
}

export interface NotificationData {
  type: NotificationType;
  category: NotificationCategory;
  deepLink?: string;
  /** Address of the account the push was sent to. */
  recipient?: string;
  // Content-related
  tokenId?: number;
  postType?: 'video' | 'feed-images' | 'feed-simple';
  commentId?: string;
  parentCommentId?: string;
  // Actor-related  
  actorAddress?: string;
  actorUsername?: string;
  // Monetization
  amount?: number;
  currency?: string;
  bountyType?: 'viewer' | 'commentor';
  planId?: string;
  // Community chat
  communitySlug?: string;
  // Livestream
  streamId?: string;
  // Messages
  conversationId?: string;
  conversationType?: 'dm' | 'group';
  senderName?: string;
  // Milestone
  milestone?: string;
  // System
  articleUrl?: string;
  broadcastId?: string;
  // Aggregation
  aggregatedCount?: number;
  // Moderation (in-app metadata)
  moderationType?: string;
  // Quote post reference
  quoteTokenId?: number;
  // Games with friends (game_turn)
  game?: 'chess' | 'okey';
  gameId?: string;
}

/**
 * Types that can navigate to content
 */
const CONTENT_NAVIGABLE_TYPES = new Set([
  NotificationType.LIKE,
  NotificationType.COMMENT,
  NotificationType.COMMENT_REPLY,
  NotificationType.COMMENT_LIKE,
  NotificationType.REPOST,
  NotificationType.TIP,
  NotificationType.PPV_PURCHASE,
  NotificationType.BOUNTY_AVAILABLE,
  NotificationType.BOUNTY_CLAIMED,
  NotificationType.VIDEO_MILESTONE,
  NotificationType.MENTION,
]);

/**
 * Types that navigate to user profile
 */
const PROFILE_NAVIGABLE_TYPES = new Set([
  NotificationType.FOLLOWING,
  NotificationType.FOLLOW_REQUEST_ACCEPTED,
]);

/**
 * Types that are not navigable - just open notifications
 */
const NON_NAVIGABLE_TYPES = new Set([
  NotificationType.DISLIKE,
  NotificationType.SYSTEM,
  NotificationType.ACCOUNT_WARNING,
  NotificationType.VIDEO_REMOVAL,
]);

/**
 * A platform announcement names the page it is about in `articleUrl`, which the
 * admin broadcast puts in both the in-app row's metadata and the push payload.
 * NotificationScreen has always opened it on a row tap; a push tap fell through
 * to NON_NAVIGABLE_TYPES and dumped the user on the notifications list, so the
 * two taps on the same announcement went to different places.
 *
 * Same three types the row handles, and only http(s) — the value is
 * admin-authored, but openInApp prefixes a bare scheme onto anything, so an
 * unfiltered value would decide for itself what it opens.
 */
const ANNOUNCEMENT_TYPES = new Set([
  NotificationType.SYSTEM,
  NotificationType.ACCOUNT_WARNING,
  NotificationType.VIDEO_REMOVAL,
]);

function announcementUrl(data: NotificationData): string | null {
  if (!ANNOUNCEMENT_TYPES.has(data.type as NotificationType)) return null;
  const url = typeof data.articleUrl === 'string' ? data.articleUrl.trim() : '';
  return /^https?:\/\//i.test(url) ? url : null;
}

/**
 * The in-app new_message row carries its conversation only as a `/dm/<id>`
 * deep link, and the push payload can arrive the same way with no
 * conversationId. Stops at `/`, `?` or `#` so a query is not read as the id.
 */
function conversationIdFromDeepLink(deepLink: unknown): string | undefined {
  if (typeof deepLink !== 'string') return undefined;
  return deepLink.match(/\/dm\/([^/?#]+)/)?.[1];
}

type NavigateArgs = unknown[];

/** The App's navigation container, read late: App imports this file. */
function appNavigationRef(): any {
  try {
    return require('../../App').navigationRef;
  } catch {
    return null;
  }
}

/** The screen a navigate() call is meant to end on (the tab, for Root). */
function expectedScreen(args: NavigateArgs | null): string | undefined {
  if (!args?.length) return undefined;
  const [first, params] = args as [any, any];
  const name = typeof first === 'string' ? first : first?.name;
  const inner = typeof first === 'string' ? params : first?.params;
  if (name === ScreenNames.Root && typeof inner?.screen === 'string') return inner.screen;
  return typeof name === 'string' ? name : undefined;
}

/**
 * Runs `run` once the navigator has a screen on it. A tap that wakes the app
 * arrives while it is still starting, and a navigate() sent before the stack
 * exists is dropped without a word, which left people on Home.
 */
function whenNavigatorReady(run: () => void, waitedMs = 0): void {
  const ref = appNavigationRef();
  const ready = !!ref?.isReady?.() && !!ref.getCurrentRoute?.();
  if (ready || waitedMs >= 8000) {
    run();
    return;
  }
  setTimeout(() => whenNavigatorReady(run, waitedMs + 150), 150);
}

interface PushNotificationsProviderProps {
  children: React.ReactNode;
}

export const PushNotificationsProvider: React.FC<PushNotificationsProviderProps> = ({ children }) => {
  // Public chat is opt-in and paced by the reader — see the hook. It lives
  // here rather than on the chat screen because the whole point is being told
  // while you are somewhere else.
  usePublicChatAlerts();
  usePublicChatReadSync();
  const navigation = useNavigation<NavigationProp<any>>();
  const user = useUser();
  const { isSignedIn, needsUsername } = useAuthState();
  const { patchUser, switchToProfile } = useAuthActions();
  const switchToProfileRef = useRef(switchToProfile);
  switchToProfileRef.current = switchToProfile;
  const isFullySignedIn = isSignedIn && !needsUsername;
  const isFullySignedInRef = useRef(isFullySignedIn);
  isFullySignedInRef.current = isFullySignedIn;
  // A new member's walkthrough offer is a modal of its own; the pre-prompt
  // waits until it has been answered rather than stacking on top of it.
  const onboarding = useOnboarding();
  const onboardingOfferPending = !!onboarding && (onboarding.loading || onboarding.shouldOffer);
  const userAddress = user?.walletAddress || user?.address;
  // A plain boolean, not the prefs object: this feeds a useCallback dep array,
  // and an object identity there is how the unread-count render loop started.
  // Absent means enabled, matching the backend's own rule.
  const wantsPush = ((user as any)?.notificationPreferences?.pushEnabled) !== false;
  
  // Refs for subscriptions
  const notificationListener = useRef<Notifications.Subscription | null>(null);
  const responseListener = useRef<Notifications.Subscription | null>(null);
  const tokenRefreshListener = useRef<Notifications.Subscription | null>(null);
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);
  const hasRegisteredRef = useRef(false);
  const registeredForRef = useRef<string | null>(null);
  const isRegisteringRef = useRef(false);
  const pushTokenRef = useRef<string | null>(null);
  // Store pending navigation to execute after auth completes
  const pendingNavigationRef = useRef<NotificationData | null>(null);
  const wasSignedInRef = useRef(false);
  // Track if cold-start notification has been checked
  const coldStartCheckedRef = useRef(false);
  // Track the last processed notification identifier to avoid double-handling
  const lastProcessedIdRef = useRef<string | null>(null);
  // Branded pre-prompt shown ahead of the un-styleable OS permission dialog
  const [softAskVisible, setSoftAskVisible] = useState(false);
  const softAskHandledRef = useRef(false);

  // patchUser is read through a ref rather than taken as a dependency. It is
  // rebuilt whenever the auth context re-renders, and this callback drives an
  // effect: depending on it directly turns the poll below into a loop that
  // fetches, patches, re-renders and fetches again as fast as the API answers.
  const patchUserRef = useRef(patchUser);
  patchUserRef.current = patchUser;
  const lastUnreadCountRef = useRef<number | null>(null);

  const userAddressRef = useRef(userAddress);
  userAddressRef.current = userAddress;
  const warmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Deferred a few seconds so it never competes with the launch or the feed's
  // first page; deduped inside prefetchNotifications.
  const warmNotificationList = useCallback(() => {
    if (warmTimerRef.current) clearTimeout(warmTimerRef.current);
    warmTimerRef.current = setTimeout(() => {
      warmTimerRef.current = null;
      void prefetchNotifications(userAddressRef.current);
    }, 3000);
  }, []);
  useEffect(() => () => {
    if (warmTimerRef.current) clearTimeout(warmTimerRef.current);
  }, []);

  const refreshUnreadCount = useCallback(async () => {
    if (!isFullySignedIn) return;

    const address = userAddressRef.current;
    try {
      // The backend defaults to unread-only. Fetch enough rows to support the
      // app's 99+ badge without downloading notification history.
      const response = await getNotifications({ limit: 100 });
      if (!address || userAddressRef.current !== address || !isFullySignedInRef.current) return;
      const unread = countUnreadNotifications(response);
      // patchUser always builds a new user object, so writing an unchanged
      // count still re-renders every consumer of the auth context.
      if (unread === lastUnreadCountRef.current) return;
      lastUnreadCountRef.current = unread;
      // Something new (or the first count this session): warm the bell
      // drawer's list so it opens on current rows instead of a skeleton.
      warmNotificationList();
      await patchUserRef.current({ notificationCount: unread });
    } catch (error) {
      logger.warn('Unread notification refresh failed', error);
    }
  }, [isFullySignedIn, warmNotificationList]);

  // Opening a push means its bell row was seen: mark the matching rows read
  // and recount, so the red bell badge doesn't stay lit on Home afterwards.
  const markTappedReadRef = useRef<(data: NotificationData) => void>(() => {});
  markTappedReadRef.current = (data: NotificationData) => {
    setTimeout(() => {
      void (async () => {
        try {
          const rows = extractNotificationItems(await getNotifications({ limit: 100 })) as Array<{ _id?: string; id?: string; read?: boolean }>;
          const hits = notificationsMatchingTap(rows, data as any);
          await Promise.all(hits.map((row) => {
            const id = String(row._id ?? row.id ?? '');
            return id ? markNotificationAsRead(id).catch(() => null) : null;
          }));
        } catch (error) {
          logger.warn('Could not mark tapped notification read', error as any);
        }
        // Always write the server's count after a tap: the badge may hold a
        // local +1 from a push that arrived while the app was open, and the
        // count itself may not have changed (Requests / stage / community
        // pushes are not in the API list), which the dedupe below would skip.
        lastUnreadCountRef.current = null;
        void refreshUnreadCount();
      })();
    }, 1500);
  };

  // Read through refs so the handler keeps one identity for the whole run. It
  // used to be rebuilt whenever auth or the user changed, and a rebuild in the
  // first moments after launch cancelled the cold-start check below for good:
  // the tap that opened the app was thrown away and the app sat on Home.
  const navigationLatestRef = useRef(navigation);
  navigationLatestRef.current = navigation;
  const routeNotificationTapRef = useRef<((data: NotificationData, coldStart: boolean) => void) | null>(null);

  const handleNotificationNavigation = useCallback((data: NotificationData, responseId?: string, opts?: { coldStart?: boolean }) => {
    const isFullySignedIn = isFullySignedInRef.current;
    // Guard: Don't navigate if no valid notification type
    if (!data?.type) {
      logger.debug('Skipping navigation - no notification type', { data });
      return;
    }

    // Guard: Avoid double-processing the same notification
    if (responseId && lastProcessedIdRef.current === responseId) {
      logger.debug('Skipping duplicate notification response', { responseId });
      return;
    }
    if (responseId) {
      lastProcessedIdRef.current = responseId;
      storage.set(LAST_HANDLED_RESPONSE_KEY, responseId);
    }

    // Guard: If user isn't fully signed in, store for later
    if (!isFullySignedIn) {
      logger.debug('User not authenticated, storing pending navigation', { type: data.type });
      pendingNavigationRef.current = data;
      return;
    }

    const route = () => whenNavigatorReady(() => {
      routeNotificationTapRef.current?.(data, !!opts?.coldStart);
      markTappedReadRef.current(data);
    });

    // A push sent to another account saved on this phone opens as that
    // account: switch first, then open the tap once the switch has settled.
    const recipient = typeof data.recipient === 'string' ? data.recipient.toLowerCase() : '';
    const current = (userAddressRef.current || '').toLowerCase();
    if (recipient && current && recipient !== current) {
      void (async () => {
        try {
          const profile = (await listProfiles()).find((p) => (p.address || '').toLowerCase() === recipient && !!p.session);
          if (profile && (await switchToProfileRef.current(profile.id))) {
            setTimeout(route, 600);
            return;
          }
        } catch (error) {
          logger.warn('Could not switch to the notified account', error as any);
        }
        route();
      })();
      return;
    }

    route();
  }, []);

  const routeNotificationTap = (data: NotificationData, coldStart: boolean) => {
    const userAddress = userAddressRef.current;
    const { type, tokenId, postType, commentId, actorAddress, actorUsername, streamId, conversationId } = data;

    logger.info('Handling notification tap', { type, tokenId, commentId });

    // Every navigate below goes through this, so the tap knows where it was
    // meant to land and can check it got there.
    let sentTo: NavigateArgs | null = null;
    const rootNavigation = navigationLatestRef.current;
    const navigation = {
      navigate: (...args: NavigateArgs) => {
        sentTo = args;
        return (rootNavigation.navigate as any)(...args);
      },
    } as unknown as NavigationProp<any>;

    try {
      // An announcement carrying a link goes to the link. Notifications first,
      // so dismissing the in-app browser leaves the user on the row that sent
      // them there rather than on whatever screen the tap interrupted.
      const articleUrl = announcementUrl(data);
      if (articleUrl) {
        navigation.navigate(ScreenNames.Notifications);
        openInApp(articleUrl);
        return;
      }

      // Raised locally by usePublicChatAlerts, never by the backend: the
      // platform chat has no push type of its own, and a fan-out per chat
      // message would be the wrong shape for a firehose anyway. Handled before the
      // switch, and compared as a string, because both narrow `type` to the
      // union the backend sends and this value is not in it.
      if ((type as string) === 'public_chat') {
        navigation.navigate(ScreenNames.LiveChat);
        return;
      }

      // Opening the app is the whole job: the call provider polls for a
      // ringing session on foreground and raises the incoming-call screen over
      // whatever is showing. Navigating anywhere would only move it.
      if ((type as string) === 'incoming_call') {
        return;
      }

      // Requests board, governance, DAO, bounties, stages, communities, mini
      // apps: rows that live in Supabase, relayed as pushes by the API. They
      // open the same place their row in the list does, and mark it read.
      if (openCustomPush(navigation.navigate as any, data as any, userAddress)) {
        return;
      }

      // Non-navigable types - just open notifications screen
      if (NON_NAVIGABLE_TYPES.has(type as NotificationType)) {
        navigation.navigate(ScreenNames.Notifications);
        return;
      }

      switch (type) {
        case NotificationType.FOLLOWING:
          // One new follower opens that person, the same as their row in the
          // list does; a grouped "N people followed you" opens the list.
          if (!(Number(data.aggregatedCount) > 1) && (actorUsername || actorAddress)) {
            emitProfileDeepLink((actorUsername || actorAddress) as string);
          } else if (userAddress) {
            navigation.navigate(ScreenNames.FollowList, {
              address: userAddress,
              initialTab: 'followers',
              isOwnProfile: true,
              newCount: data.aggregatedCount,
            });
          } else {
            navigation.navigate(ScreenNames.Notifications);
          }
          break;

        case NotificationType.FOLLOW_REQUEST:
          // Follow request → notifications screen (has accept/reject buttons)
          navigation.navigate(ScreenNames.Notifications);
          break;

        case NotificationType.FOLLOW_REQUEST_ACCEPTED:
          // "X accepted your request" opens X, as the row does.
          if (actorUsername || actorAddress) {
            emitProfileDeepLink((actorUsername || actorAddress) as string);
          } else if (userAddress) {
            navigation.navigate(ScreenNames.FollowList, {
              address: userAddress,
              initialTab: 'following',
              isOwnProfile: true,
            });
          } else {
            navigation.navigate(ScreenNames.Notifications);
          }
          break;

        case NotificationType.LIKE:
          if (tokenId) {
            navigation.navigate(ScreenNames.FeedDetail, { tokenId });
          } else {
            navigation.navigate(ScreenNames.Notifications);
          }
          break;

        case NotificationType.COMMENT:
        case NotificationType.COMMENT_REPLY:
        // Sent instead of COMMENT_REPLY when the post's creator answered. It
        // had no case, so its push opened the notifications list.
        case NotificationType.CREATOR_COMMENT_REPLY:
        case NotificationType.COMMENT_LIKE:
          if (tokenId) {
            navigation.navigate(ScreenNames.FeedDetail, { tokenId, commentId });
          } else {
            navigation.navigate(ScreenNames.Notifications);
          }
          break;

        case NotificationType.MENTION:
          // Tagged in a bio: open that profile.
          if ((data as any).mentionContext === 'bio' && (actorUsername || actorAddress)) {
            emitProfileDeepLink((actorUsername || actorAddress) as string);
            break;
          }
          // A tag in live or public chat opens that chat, not a post page.
          if (openChatMention(navigation.navigate as any, { mentionContext: (data as any).mentionContext, tokenId })) break;
          if (tokenId) {
            navigation.navigate(ScreenNames.FeedDetail, { tokenId, commentId });
          } else {
            navigation.navigate(ScreenNames.Notifications);
          }
          break;

        case NotificationType.REPOST:
          if (tokenId) {
            navigation.navigate(ScreenNames.FeedDetail, { tokenId });
          } else {
            navigation.navigate(ScreenNames.Notifications);
          }
          break;

        case NotificationType.QUOTE:
          if (data.quoteTokenId) {
            navigation.navigate(ScreenNames.FeedDetail, { tokenId: data.quoteTokenId });
          } else if (tokenId) {
            navigation.navigate(ScreenNames.FeedDetail, { tokenId });
          } else {
            navigation.navigate(ScreenNames.Notifications);
          }
          break;

        case NotificationType.TIP:
          // A tip on a post opens that post, the same place the row in the
          // list opens; a tip with no post (a chat tip) opens the tipper.
          //
          // Not ScreenNames.Profile: that screen is the signed-in user's own
          // profile and reads no params, so passing an address here opened
          // your own profile instead of the tipper's. The sheet is what shows
          // somebody else, and emitting is how the deep-link path reaches it —
          // it waits for navigation state to settle first, which matters most
          // from a cold start out of a notification tap.
          if (tokenId) {
            navigation.navigate(ScreenNames.FeedDetail, { tokenId, commentId });
          } else {
            const actor = actorUsername || actorAddress;
            if (actor) emitProfileDeepLink(actor);
            else navigation.navigate(ScreenNames.Notifications);
          }
          break;

        // Same targets as the rows in the list. These all fell to the default
        // and opened the notifications list instead of the thing they name.
        case NotificationType.SIGNAL_FLARE:
        case NotificationType.FRACTION_OFFER:
        case NotificationType.FRACTION_OFFER_ACCEPTED:
        case NotificationType.FRACTION_OFFER_REJECTED:
        case NotificationType.FRACTION_PURCHASED:
          if (tokenId) navigation.navigate(ScreenNames.FeedDetail, { tokenId });
          else navigation.navigate(ScreenNames.Notifications);
          break;

        case NotificationType.USERNAME_OFFER:
        case NotificationType.USERNAME_OFFER_ACCEPTED:
        case NotificationType.USERNAME_OFFER_DECLINED:
          navigation.navigate(ScreenNames.Usernames, { tab: 'offers' });
          break;

        case NotificationType.BADGE_TIER_UP:
        case NotificationType.BADGE_TIER_DOWN:
          navigation.navigate(ScreenNames.Dpay, { initialTab: 'stake' });
          break;

        case NotificationType.BOUNTY_AVAILABLE:
        case NotificationType.BOUNTY_CLAIMED:
        case NotificationType.PPV_PURCHASE:
          if (tokenId) {
            navigation.navigate(ScreenNames.FeedDetail, { tokenId });
          } else {
            navigation.navigate(ScreenNames.Notifications);
          }
          break;

        case NotificationType.SUBSCRIPTION:
          // New subscriber opens the subscriber, as the row does.
          if (actorUsername || actorAddress) {
            emitProfileDeepLink((actorUsername || actorAddress) as string);
          } else {
            navigation.navigate(ScreenNames.Notifications);
          }
          break;

        case NotificationType.VIDEO_MILESTONE:
          if (tokenId) {
            navigation.navigate(ScreenNames.FeedDetail, { tokenId });
          } else {
            navigation.navigate(ScreenNames.Notifications);
          }
          break;

        case NotificationType.LIVESTREAM_START:
          if (streamId || tokenId) {
            // A tokenId is the post, not the stream; the viewer looks the stream up.
            navigation.navigate(ScreenNames.LiveViewer, streamId
              ? { streamId, ...(tokenId ? { tokenId } : {}) }
              : { tokenId });
          } else {
            navigation.navigate(ScreenNames.Notifications);
          }
          break;

        // Your move in correspondence chess, or your turn at an Okey table.
        case 'game_turn' as NotificationType: {
          const link = typeof data.deepLink === 'string' ? data.deepLink : '';
          const gameId = typeof data.gameId === 'string' && data.gameId
            ? data.gameId
            : link.match(/[?&](?:game|table)=([^&#]+)/)?.[1];
          if (data.game === 'okey' || link.includes('/arcade/okey')) {
            navigation.navigate(ScreenNames.Okey, gameId ? { table: gameId } : undefined);
          } else {
            navigation.navigate(ScreenNames.CorrespondenceChess, gameId ? { game: gameId } : undefined);
          }
          break;
        }

        // Grouped community chat: straight to that community's chat.
        case 'community_chat' as NotificationType:
          if (typeof data.communitySlug === 'string' && data.communitySlug) {
            navigation.navigate(ScreenNames.CommunityDetail, { slug: data.communitySlug, tab: 'chat' });
          } else {
            navigation.navigate(ScreenNames.Notifications);
          }
          break;

        case NotificationType.NEW_MESSAGE: {
          const chatId = conversationId || conversationIdFromDeepLink(data.deepLink);
          if (chatId) {
            navigation.navigate(ScreenNames.Chat, { conversationId: chatId });
          } else {
            // The DM list is a tab inside Root (navigation/BottomTabNavigator.tsx),
            // not an App-stack route. A bare navigate(DM) from a pushed page
            // reached the App stack, matched nothing and was dropped silently,
            // so the app came forward on the same page. Naming Root reaches the
            // tab; `pop` goes back to the existing Root instead of stacking a
            // second tab navigator on top of the current page.
            navigation.navigate(ScreenNames.Root, { screen: ScreenNames.DM }, { pop: true });
          }
          break;
        }

        // Badge lending. The delegation panel is the only place a loan can be
        // seen or ended, and it sits on the Assets tab of settings.
        case NotificationType.BADGE_DELEGATED:
        case NotificationType.BADGE_DELEGATION_ENDED:
        case NotificationType.BADGE_DELEGATION_CHANGED:
          navigation.navigate(ScreenNames.AccountSettings, { initialTab: 'assets' });
          break;

        default:
          // A type this build does not know yet still names its post.
          if (tokenId) navigation.navigate(ScreenNames.FeedDetail, { tokenId, commentId });
          else navigation.navigate(ScreenNames.Notifications);
          break;
      }
    } catch (error) {
      logger.error('Navigation failed', error);
      // Fallback to notifications screen
      try {
        navigation.navigate(ScreenNames.Notifications);
      } catch (e) {
        // Ignore - navigation not ready
      }
    }
    confirmLanding(String(type), sentTo, coldStart);
  };
  routeNotificationTapRef.current = routeNotificationTap;

  /**
   * Checks the tap really ended where it was sent. A launch from a closed app
   * still has its first screen settling underneath the logo, and anything that
   * puts Home back on top in that window undoes the tap; one more navigate puts
   * it right. One log row per tap says where it landed, so a wrong landing
   * shows up in the logs instead of only in a report.
   */
  const confirmLanding = (type: string, sentTo: NavigateArgs | null, coldStart: boolean) => {
    const expected = expectedScreen(sentTo);
    let retried = false;
    const landed = () => appNavigationRef()?.getCurrentRoute?.()?.name as string | undefined;
    const putRight = () => {
      if (coldStart && expected && sentTo && landed() !== expected) {
        retried = true;
        try {
          (navigationLatestRef.current.navigate as any)(...sentTo);
        } catch {}
      }
    };
    setTimeout(() => {
      putRight();
      // A slow launch can still be swapping stacks at the first check.
      setTimeout(putRight, 1500);
      setTimeout(() => {
        try {
          require('../../libs/errorReporter').reportError('PushTap', ['notification tap landed'], {
            level: 'info',
            metadata: { type, expected: expected ?? null, landed: landed() ?? null, coldStart, retried },
          });
        } catch {}
      }, 3000);
    }, 1500);
  };

  const registerPushToken = useCallback(async () => {
    // Guard: Already registered or registration in progress
    if (hasRegisteredRef.current || isRegisteringRef.current || !isFullySignedIn) return;
    
    // Guard: Need user address for backend registration
    if (!userAddress) {
      logger.debug('Waiting for user address before push registration');
      return;
    }

    isRegisteringRef.current = true;

    try {
      // Service layer handles caching and deduplication
      const token = await registerForPushNotifications();
      if (!token) {
        isRegisteringRef.current = false;
        return;
      }

      pushTokenRef.current = token;

      // Service layer handles backend deduplication
      logger.info('Registering push token with backend', { userAddress: userAddress.slice(0, 10) + '...' });
      // Only a confirmed save counts. A failed call (offline, server busy)
      // used to mark this phone done for the whole run, so it got no pushes
      // until the app was restarted.
      hasRegisteredRef.current = await registerPushTokenWithBackend(token);
    } catch (error) {
      logger.error('Push registration failed', error);
    } finally {
      isRegisteringRef.current = false;
    }
  }, [isFullySignedIn, userAddress]);

  /**
   * Decide whether to raise the branded pre-prompt.
   *
   * Permission already granted is the common case for a returning user: just
   * register, no UI at all. A hard OS-level denial (`canAskAgain === false`)
   * cannot be undone from inside the app, so asking again would be theatre.
   * Everything else gets our own modal first, and only a yes there reaches
   * `registerForPushNotifications`, which is what triggers the OS dialog.
   */
  const maybeAskForPushPermission = useCallback(async () => {
    if (hasRegisteredRef.current || isRegisteringRef.current) return;
    if (softAskHandledRef.current) return;

    const { granted, canAskAgain } = await getNotificationPermissionStatus();

    if (granted) {
      softAskHandledRef.current = true;
      registerPushToken();
      return;
    }

    if (!canAskAgain) {
      logger.debug('Notification permission denied at OS level; not prompting');
      softAskHandledRef.current = true;
      noticePushBlocked(wantsPush);
      return;
    }

    const declinedAt = storage.getNumber(SOFT_ASK_DECLINED_AT_KEY);
    if (declinedAt && Date.now() - declinedAt < SOFT_ASK_COOLDOWN_MS) {
      logger.debug('Pre-prompt still in cooldown');
      softAskHandledRef.current = true;
      return;
    }

    softAskHandledRef.current = true;
    setSoftAskVisible(true);
  }, [registerPushToken, wantsPush]);

  const registerPushTokenRef = useRef(registerPushToken);
  registerPushTokenRef.current = registerPushToken;

  const handleSoftAskAllow = useCallback(() => {
    setSoftAskVisible(false);
    storage.delete(SOFT_ASK_DECLINED_AT_KEY);
    // This is the call that raises the OS dialog — now that the user has
    // opted in, and with our modal already out of the way.
    registerPushToken();
  }, [registerPushToken]);

  const handleSoftAskDecline = useCallback(() => {
    setSoftAskVisible(false);
    storage.set(SOFT_ASK_DECLINED_AT_KEY, Date.now());
  }, []);

  useEffect(() => {
    const wasSignedIn = wasSignedInRef.current;
    wasSignedInRef.current = isFullySignedIn;
    // Handle pending navigation after auth completes (cold-start stored pending).
    // Checked before the soft-ask branch below: that branch returns early on
    // the very transition this replay exists for (first sign-in of the run),
    // so a push tapped while signed out was never followed.
    if (isFullySignedIn && pendingNavigationRef.current) {
      const pendingData = pendingNavigationRef.current;
      pendingNavigationRef.current = null;
      // Small delay to ensure navigation is ready
      // A tap held until sign-in is a launch tap: the session was still being
      // restored and the app stack is only now replacing the sign-in screens,
      // which can put Home back over the chat. Treat it as a cold start so the
      // landing is checked and the navigate repeated.
      setTimeout(() => {
        handleNotificationNavigation(pendingData, undefined, { coldStart: true });
      }, 500);
    }

    // Switching to another saved account keeps the app signed in, so the
    // phone has to be registered again under the new owner.
    if (userAddress && registeredForRef.current && registeredForRef.current !== userAddress) {
      hasRegisteredRef.current = false;
      softAskHandledRef.current = false;
      clearPushTokenCache();
    }
    registeredForRef.current = userAddress ?? null;

    // Ask once the user is settled in the app, not the instant auth resolves.
    if (isFullySignedIn && userAddress && !onboardingOfferPending && !hasRegisteredRef.current) {
      const timer = setTimeout(() => {
        maybeAskForPushPermission();
      }, SOFT_ASK_DELAY_MS);
      return () => clearTimeout(timer);
    }

    // Reset registration flag when user signs out
    if (!isFullySignedIn) {
      hasRegisteredRef.current = false;
      isRegisteringRef.current = false;
      pushTokenRef.current = null;
      // Only a real sign-out drops a held tap. While the session is still
      // being restored this effect re-runs on every auth field that arrives
      // (address, username check), and clearing here threw away the tap that
      // opened the app, so it came up on Home instead of the chat.
      if (wasSignedIn) pendingNavigationRef.current = null;
      softAskHandledRef.current = false;
      setSoftAskVisible(false);
    }
  }, [isFullySignedIn, userAddress, onboardingOfferPending, maybeAskForPushPermission, handleNotificationNavigation]);

  // When the app is launched from a killed state by tapping a notification,
  // addNotificationResponseReceivedListener may fire before this component
  // mounts or the event can be lost entirely. We use
  // getLastNotificationResponseAsync() to retrieve it on mount.

  const handleNotificationNavigationRef = useRef(handleNotificationNavigation);
  handleNotificationNavigationRef.current = handleNotificationNavigation;

  useEffect(() => {
    if (coldStartCheckedRef.current) return;

    const checkColdStartNotification = async () => {
      // Marked here, not when the timer is set: an effect re-run that clears
      // the timer must not also stop the check from ever happening.
      if (coldStartCheckedRef.current) return;
      coldStartCheckedRef.current = true;
      try {
        const lastResponse = await Notifications.getLastNotificationResponseAsync();
        if (!lastResponse) return;

        const data = readTapData(lastResponse.notification) as unknown as NotificationData | null;
        if (!data?.type) return;

        // notification.date is the DELIVERY time, not the tap time — an age
        // check here silently drops taps on any notification older than the
        // window (the common case for messages). Dedup by response id instead:
        // skip only if this exact response was already handled, this session
        // or a previous one.
        const responseId = lastResponse.notification.request.identifier;
        if (storage.getString(LAST_HANDLED_RESPONSE_KEY) === responseId) {
          logger.debug('Cold-start notification already handled', { responseId });
          return;
        }
        logger.info('Processing cold-start notification', { type: data.type, responseId });
        // One row per notification launch, so a slow or stuck one can be read
        // back from the logs (none of this path reported anything before).
        try {
          require('../../libs/errorReporter').reportError('PushColdStart', ['notification opened the app'], {
            level: 'info',
            metadata: { type: data.type, signedIn: isFullySignedInRef.current },
          });
        } catch {}
        handleNotificationNavigationRef.current(data, responseId, { coldStart: true });
      } catch (error) {
        logger.error('Failed to check cold-start notification', error);
      }
    };

    // Small delay to ensure navigation container is fully mounted and ready
    const timer = setTimeout(checkColdStartNotification, 750);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    // Handle foreground notifications
    notificationListener.current = Notifications.addNotificationReceivedListener(
      (notification) => {
        logger.debug('Notification received in foreground', {
          title: notification.request.content.title,
        });
        // Foreground pushes do not trigger auth enrichment, so update the
        // in-app badge immediately. The periodic/server refresh below remains
        // authoritative and corrects aggregation or duplicate delivery.
        if (isFullySignedIn) {
          // The badge now differs from the last count written, so the next
          // refresh must write again even if the server number is the same.
          lastUnreadCountRef.current = null;
          void patchUser((current) => ({
            notificationCount: incrementUnreadCount(current.notificationCount),
          }));
          const type = (notification.request.content.data as Partial<NotificationData> | undefined)?.type;
          void noteNotificationMoment(type);
        }
        // Notification will be shown by the OS based on setNotificationHandler config
      }
    );

    // Handle notification tap (foreground and background — but NOT cold-start)
    responseListener.current = Notifications.addNotificationResponseReceivedListener(
      (response) => {
        const data = readTapData(response.notification) as unknown as NotificationData;
        const responseId = response.notification.request.identifier;
        
        // Only process if we have valid notification data with a type
        if (data?.type) {
          logger.info('User tapped notification', { type: data.type, responseId });
          handleNotificationNavigation(data, responseId);
        } else {
          logger.debug('Ignoring notification response without valid type', { data });
        }
      }
    );

    // Handle token refresh - service layer handles deduplication
    tokenRefreshListener.current = Notifications.addPushTokenListener(async () => {
      // The phone's own token changed: drop the cached one so Expo is asked
      // again and the server learns the new route.
      clearPushTokenCache();
      const expoToken = await registerForPushNotifications();
      if (expoToken && isValidExpoPushToken(expoToken)) {
        pushTokenRef.current = expoToken;

        if (isFullySignedIn && userAddress) {
          try {
            // Service layer handles backend deduplication
            await registerPushTokenWithBackend(expoToken);
          } catch (error) {
            logger.error('Failed to re-register refreshed token', error);
          }
        }
      }
    });

    return () => {
      if (notificationListener.current) {
        notificationListener.current.remove();
      }
      if (responseListener.current) {
        responseListener.current.remove();
      }
      if (tokenRefreshListener.current) {
        tokenRefreshListener.current.remove();
      }
    };
  }, [handleNotificationNavigation, isFullySignedIn, patchUser, userAddress]);

  // Keep the home bell and navigation badge fresh even when push permission is
  // denied or a delivery is missed. This also replaces the auth-time snapshot,
  // which otherwise remains stale for the entire session.
  //
  // Only while the app is on screen: on iOS the interval kept hitting
  // /api/notification every minute in the background (Android freezes JS
  // timers, so there it only produced a burst on resume). The foreground
  // handler below refreshes once on return, so nothing is missed.
  useEffect(() => {
    if (!isFullySignedIn) return;
    void refreshUnreadCount();
    let interval: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (interval) return;
      interval = setInterval(() => void refreshUnreadCount(), 120_000);
    };
    const stop = () => {
      if (!interval) return;
      clearInterval(interval);
      interval = null;
    };
    let wasOffline = false;
    const stopNetwork = NetInfo.addEventListener(({ isConnected, isInternetReachable }) => {
      if (isConnected === false || isInternetReachable === false) {
        wasOffline = true;
      } else if (wasOffline && isConnected === true && isInternetReachable === true) {
        wasOffline = false;
        if (AppState.currentState === 'active') void refreshUnreadCount();
      }
    });
    if (AppState.currentState === 'active') start();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') start();
      else stop();
    });
    return () => {
      stop();
      stopNetwork();
      sub.remove();
    };
  }, [isFullySignedIn, refreshUnreadCount]);

  useEffect(() => {
    const handleAppStateChange = (nextState: AppStateStatus) => {
      if (appStateRef.current.match(/inactive|background/) && nextState === 'active') {
        // App came to foreground: refresh the in-app count before clearing the
        // OS-level app icon badge. The two indicators have separate lifecycles.
        void refreshUnreadCount();
        clearBadge();
        // A registration that failed earlier (offline at launch) tries again
        // here. Only when permission is already granted: no prompt on resume.
        if (!hasRegisteredRef.current && softAskHandledRef.current) {
          void getNotificationPermissionStatus()
            .then(({ granted }) => { if (granted) void registerPushTokenRef.current(); })
            .catch(() => {});
        }
      }
      appStateRef.current = nextState;
    };

    // A cold start never fires the change above, so the icon kept its number.
    clearBadge();
    const subscription = AppState.addEventListener('change', handleAppStateChange);
    return () => subscription.remove();
  }, [refreshUnreadCount]);

  return (
    <>
      {children}
      <NotificationPermissionPrompt
        visible={softAskVisible}
        onAllow={handleSoftAskAllow}
        onDecline={handleSoftAskDecline}
      />
    </>
  );
};

export default PushNotificationsProvider;
