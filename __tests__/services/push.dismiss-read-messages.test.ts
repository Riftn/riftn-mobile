import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { dismissReadMessageNotifications } from '../../services/push/push.service';

jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(),
  getPresentedNotificationsAsync: jest.fn(),
  dismissNotificationAsync: jest.fn(),
}));
jest.mock('expo-device', () => ({ isDevice: true }));
jest.mock('../../libs/api.client', () => ({ apiClient: {} }));
jest.mock('../../libs/device', () => ({}));
jest.mock('../../modules/call-screen', () => ({}));
jest.mock('../../services/push/message-reply', () => ({ listenForReplies: jest.fn() }));

describe('dismissing read message alerts', () => {
  const readThrough = 1770000000000;
  const message = { type: 'new_message', conversationId: 'chat-1', recipient: '0xABC' };
  const originalPlatform = Platform.OS;
  const presented = jest.mocked(Notifications.getPresentedNotificationsAsync);
  const dismiss = jest.mocked(Notifications.dismissNotificationAsync);

  const alert = (identifier: string, data: object, date = readThrough, trigger: unknown = null) => ({
    date,
    request: { identifier, content: { data }, trigger },
  }) as Notifications.Notification;

  beforeEach(() => {
    Platform.OS = 'android';
    presented.mockReset();
    dismiss.mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => {
    Platform.OS = originalPlatform;
  });

  it('dismisses only delivered alerts for this account and conversation through the read', async () => {
    presented.mockResolvedValue([
      alert('content', message),
      alert('fcm-trigger', {}, readThrough - 1, { remoteMessage: { data: { body: JSON.stringify(message) } } }),
      alert('android-tray', { body: JSON.stringify(message) }),
      alert('other-chat', { ...message, conversationId: 'chat-2' }),
      alert('other-account', { ...message, recipient: '0xdef' }),
      alert('other-type', { ...message, type: 'dm_reaction' }),
      alert('unowned', { ...message, recipient: undefined }),
      alert('too-new', message, readThrough + 1),
      alert('undated', message, 0),
    ]);

    await dismissReadMessageNotifications('chat-1', '0xabc', readThrough, () => true);

    expect(dismiss.mock.calls).toEqual([['content'], ['fcm-trigger'], ['android-tray']]);
  });

  it('uses the iOS delivered date in seconds and recognizes the legacy chat link', async () => {
    Platform.OS = 'ios';
    const legacy = { type: 'new_message', deepLink: '/dm/chat-1?from=push', recipient: '0xabc' };
    presented.mockResolvedValue([
      alert('ios-older', {}, readThrough / 1_000 - 1, { payload: { body: legacy } }),
      alert('ios-newer', message, readThrough / 1_000 + 1),
    ]);

    await dismissReadMessageNotifications('chat-1', '0xabc', readThrough, () => true);

    expect(dismiss.mock.calls).toEqual([['ios-older']]);
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
