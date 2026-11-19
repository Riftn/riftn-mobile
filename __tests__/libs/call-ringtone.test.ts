const mockPlayer = { play: jest.fn(), pause: jest.fn(), seekTo: jest.fn(), loop: false, volume: 0 };
const mockVibrate = jest.fn();
const mockCancel = jest.fn();
jest.mock('expo-audio', () => ({ createAudioPlayer: jest.fn(() => mockPlayer) }));
jest.mock('expo-notifications', () => ({
  getPresentedNotificationsAsync: jest.fn(() => Promise.resolve([])),
  dismissNotificationAsync: jest.fn(() => Promise.resolve()),
}));
jest.mock('react-native', () => ({ Vibration: { vibrate: (...a: unknown[]) => mockVibrate(...a), cancel: () => mockCancel() } }));

import { startCallRingtone, stopCallRingtone } from '../../libs/call-ringtone';

describe('incoming call ring', () => {
  it('loops the ringtone and buzzes until stopped', () => {
    startCallRingtone();
    expect(mockPlayer.loop).toBe(true);
    expect(mockPlayer.play).toHaveBeenCalledTimes(1);
    expect(mockVibrate).toHaveBeenCalledWith(expect.any(Array), true);

    // A second start while ringing does not restart it.
    startCallRingtone();
    expect(mockPlayer.play).toHaveBeenCalledTimes(1);

    stopCallRingtone();
    expect(mockPlayer.pause).toHaveBeenCalled();
    expect(mockCancel).toHaveBeenCalled();
  });
});
