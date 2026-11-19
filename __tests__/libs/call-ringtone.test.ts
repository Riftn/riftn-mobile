jest.mock('expo-audio', () => {
  const mockPlayer = { play: jest.fn(), pause: jest.fn(), seekTo: jest.fn(), currentTime: 0, loop: false, volume: 0 };
  return { createAudioPlayer: jest.fn(() => mockPlayer), mockPlayer };
});
jest.mock('expo-notifications', () => ({
  getPresentedNotificationsAsync: jest.fn(async () => [
    { request: { identifier: 'call-1', content: { data: { type: 'incoming_call' } } } },
    { request: { identifier: 'like-1', content: { data: { type: 'like' } } } },
  ]),
  dismissNotificationAsync: jest.fn(async () => undefined),
}));
jest.mock('react-native', () => ({
  Platform: { OS: 'android' },
  Vibration: { vibrate: jest.fn(), cancel: jest.fn() },
}));

import { Vibration } from 'react-native';
import * as Notifications from 'expo-notifications';
import { startCallRingtone, stopCallRingtone } from '../../libs/call-ringtone';

const player = (jest.requireMock('expo-audio') as any).mockPlayer;

describe('call ringtone', () => {
  it('loops the ring and repeats the buzz until stopped', async () => {
    startCallRingtone();
    expect(player.loop).toBe(true);
    expect(player.play).toHaveBeenCalledTimes(1);
    expect(Vibration.vibrate).toHaveBeenCalledWith(expect.any(Array), true);

    // Starting again while it rings does not stack a second ring.
    startCallRingtone();
    expect(player.play).toHaveBeenCalledTimes(1);

    await new Promise((r) => setTimeout(r, 0));
    expect(Notifications.dismissNotificationAsync).toHaveBeenCalledWith('call-1');
    expect(Notifications.dismissNotificationAsync).not.toHaveBeenCalledWith('like-1');

    stopCallRingtone();
    expect(player.pause).toHaveBeenCalled();
    expect(Vibration.cancel).toHaveBeenCalled();
  });
});
