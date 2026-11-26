import {
  clearPushTokenCache,
  dismissReadMessageNotifications,
  getDefaultNotificationPreferences,
  mergePreferences,
  registerPushTokenWithBackend,
  unregisterCurrentDeviceToken,
  type NotificationPreferenceKey,
} from '../../services/push/push.service';

// push.service calls setNotificationHandler at module scope, so the mock has to
// carry it or the import throws before any test runs.
jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(),
  getPresentedNotificationsAsync: jest.fn(),
  dismissNotificationAsync: jest.fn(),
  AndroidImportance: { DEFAULT: 3, HIGH: 4, MAX: 5 },
  AndroidNotificationVisibility: { PUBLIC: 1 },
}));
jest.mock('expo-device', () => ({ isDevice: true }));
jest.mock('../../libs/api.client', () => ({
  apiClient: { get: jest.fn(), post: jest.fn(), delete: jest.fn() },
}));
jest.mock('../../libs/device', () => ({
  getDeviceId: jest.fn(async () => 'persistent-device-id'),
  getDeviceName: jest.fn(() => 'Galaxy S24'),
}));

jest.mock('../../modules/call-screen', () => ({
  getVoipToken: jest.fn(async () => null),
  callScreenSupported: () => true,
}));
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { getVoipToken } from '../../modules/call-screen';
import { apiClient } from '../../libs/api.client';
import { IS_APP_STORE_BUILD } from '../../config/storefront';

const ALL_KEYS: NotificationPreferenceKey[] = [
  'likes',
  'comments',
  'commentReplies',
  'mentions',
  'directMessages',
  'newFollowers',
  'tips',
  'subscriptions',
  'ppvPurchases',
  'milestones',
  'livestreamStart',
  'accountAlerts',
  'announcements',
];

describe('dismissing read message alerts', () => {
  const readThrough = 1770000000000;
  const message = { type: 'new_message', conversationId: 'chat-1', recipient: '0xABC' };
  const presented = jest.mocked(Notifications.getPresentedNotificationsAsync);
  const dismiss = jest.mocked(Notifications.dismissNotificationAsync);

  const alert = (identifier: string, data: object, date = readThrough, trigger: unknown = null) => ({
    date,
    request: { identifier, content: { data }, trigger },
  }) as Notifications.Notification;

  beforeEach(() => {
    presented.mockReset();
    dismiss.mockReset().mockResolvedValue(undefined);
  });

  it('dismisses only delivered alerts for this account and conversation through the read', async () => {
    const legacy = { type: 'new_message', deepLink: '/dm/chat-1?from=push', recipient: '0xabc' };
    presented.mockResolvedValue([
      alert('content', message),
      alert('android', {}, readThrough - 1, { remoteMessage: { data: { body: JSON.stringify(message) } } }),
      alert('ios', {}, readThrough - 1, { payload: { body: legacy } }),
      alert('other-chat', { ...message, conversationId: 'chat-2' }),
      alert('other-account', { ...message, recipient: '0xdef' }),
      alert('other-type', { ...message, type: 'dm_reaction' }),
      alert('unowned', { ...message, recipient: undefined }),
      alert('too-new', message, readThrough + 1),
      alert('undated', message, 0),
    ]);

    await dismissReadMessageNotifications('chat-1', '0xabc', readThrough, () => true);

    expect(dismiss.mock.calls).toEqual([['content'], ['android'], ['ios']]);
  });

  it('leaves alerts visible if the reader leaves while the tray is being queried', async () => {
    let current = true;
    presented.mockImplementation(async () => {
      current = false;
      return [alert('content', message)];
    });

    await dismissReadMessageNotifications('chat-1', '0xabc', readThrough, () => current);

    expect(dismiss).not.toHaveBeenCalled();
  });
});

describe('services/push.service notification preferences', () => {
  describe('getDefaultNotificationPreferences', () => {
    it('starts every type on, in-app and push alike', () => {
      const prefs = getDefaultNotificationPreferences();
      expect(prefs.inAppEnabled).toBe(true);
      expect(prefs.pushEnabled).toBe(true);
      for (const key of ALL_KEYS) {
        expect(prefs.inApp[key]).toBe(true);
        if (key !== 'announcements') expect(prefs.push[key]).toBe(true);
      }
    });

    // Marketing pushes wait for an explicit opt-in in the App Store build
    // (App Review 4.5.4); everywhere else they start on like the rest.
    it('starts push announcements off on iOS only', () => {
      expect(getDefaultNotificationPreferences().push.announcements).toBe(!IS_APP_STORE_BUILD);
    });

    // The defaults are never written at load, and the backend treats a missing
    // key as enabled. A default of `false` therefore describes something the
    // server is not doing, until an unrelated toggle saves the whole object and
    // makes it true. Push and in-app have to agree for that to stay harmless.
    it('agrees with the server rule that an absent key means enabled', () => {
      const { announcements: _announcements, ...push } = getDefaultNotificationPreferences().push;
      expect(Object.values(push).every(Boolean)).toBe(true);
      expect(Object.values(getDefaultNotificationPreferences().inApp).every(Boolean)).toBe(true);
    });

    it('leaves quiet hours off so nothing is suppressed by default', () => {
      expect(getDefaultNotificationPreferences().quietHours.enabled).toBe(false);
    });
  });

  describe('mergePreferences', () => {
    it('fills the gaps in a partially saved block instead of replacing it', () => {
      const merged = mergePreferences(getDefaultNotificationPreferences(), {
        inApp: { likes: false } as any,
      });
      expect(merged.inApp.likes).toBe(false);
      expect(merged.inApp.comments).toBe(true);
      expect(merged.inApp.announcements).toBe(true);
      expect(merged.push.likes).toBe(true);
    });

    it('keeps saved values across every block', () => {
      const merged = mergePreferences(getDefaultNotificationPreferences(), {
        pushEnabled: false,
        push: { tips: false } as any,
        quietHours: { enabled: true, start: 1 } as any,
      });
      expect(merged.pushEnabled).toBe(false);
      expect(merged.push.tips).toBe(false);
      expect(merged.push.likes).toBe(true);
      expect(merged.quietHours.enabled).toBe(true);
      expect(merged.quietHours.start).toBe(1);
      expect(merged.quietHours.end).toBe(8);
    });

    it('returns the defaults untouched for an empty or malformed blob', () => {
      const defaults = getDefaultNotificationPreferences();
      expect(mergePreferences(defaults, null)).toEqual(defaults);
      expect(mergePreferences(defaults, undefined)).toEqual(defaults);
      expect(mergePreferences(defaults, {})).toEqual(defaults);
    });

    it('preserves a key written by a newer client', () => {
      const merged = mergePreferences(getDefaultNotificationPreferences(), {
        inApp: { somethingNew: false } as any,
      });
      expect((merged.inApp as any).somethingNew).toBe(false);
      expect(merged.inApp.likes).toBe(true);
    });
  });
});

describe('services/push.service device identity', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    clearPushTokenCache();
  });

  it('registers an Expo token against the persistent device id', async () => {
    (apiClient.post as jest.Mock).mockResolvedValue({ success: true });

    await expect(
      registerPushTokenWithBackend('ExponentPushToken[stable-token]'),
    ).resolves.toBe(true);

    expect(apiClient.post).toHaveBeenCalledWith(
      '/push/token',
      expect.objectContaining({
        deviceId: 'persistent-device-id',
        deviceName: 'Galaxy S24',
      }),
      { isAuthRequired: true },
    );
  });

  it('registers a VoIP token that arrives during the original request', async () => {
    const token = 'ExponentPushToken[stable-token]';
    const os = Platform.OS;
    Platform.OS = 'ios';
    let complete!: (value: { success: boolean }) => void;
    let started!: () => void;
    const posted = new Promise<void>(resolve => { started = resolve; });
    const post = apiClient.post as jest.Mock;
    post.mockImplementationOnce(() => {
      started();
      return new Promise(resolve => { complete = resolve; });
    }).mockResolvedValue({ success: true });
    try {
      (getVoipToken as jest.Mock).mockResolvedValue(null);
      const first = registerPushTokenWithBackend(token);
      await posted;
      (getVoipToken as jest.Mock).mockResolvedValue('new-voip-token');
      const second = registerPushTokenWithBackend(token);
      const repeat = registerPushTokenWithBackend(token);
      complete({ success: true });
      expect(await Promise.all([first, second, repeat])).toEqual([true, true, true]);
      expect(post.mock.calls.map(([, payload]) => payload.voipToken)).toEqual([undefined, 'new-voip-token']);
    } finally {
      Platform.OS = os;
      (getVoipToken as jest.Mock).mockResolvedValue(null);
    }
  });

  it('drops queued registrations from the previous account after the cache is cleared', async () => {
    let complete!: (value: { success: boolean }) => void;
    let started!: () => void;
    const posted = new Promise<void>(resolve => { started = resolve; });
    const post = apiClient.post as jest.Mock;
    post.mockImplementationOnce(() => {
      started();
      return new Promise(resolve => { complete = resolve; });
    }).mockResolvedValue({ success: true });
    const initial = registerPushTokenWithBackend('ExponentPushToken[old]');
    await posted;
    const queued = registerPushTokenWithBackend('ExponentPushToken[stale]');
    clearPushTokenCache();
    const current = registerPushTokenWithBackend('ExponentPushToken[current]');
    complete({ success: true });
    expect(await Promise.all([initial, queued, current])).toEqual([false, false, true]);
    expect(post.mock.calls.map(([, payload]) => payload.token)).toEqual(['ExponentPushToken[old]', 'ExponentPushToken[current]']);
  });

  it('unregisters the same persistent device id', async () => {
    (apiClient.delete as jest.Mock).mockResolvedValue({ success: true });

    await expect(unregisterCurrentDeviceToken()).resolves.toBe(true);

    expect(apiClient.delete).toHaveBeenCalledWith(
      '/push/token/persistent-device-id',
      { isAuthRequired: true },
    );
  });
});
