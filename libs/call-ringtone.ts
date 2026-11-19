/**
 * Call ringtone
 * =============
 * The sound and buzz of an incoming call while its screen is up. Before this
 * the incoming-call screen was silent, so a call on an open phone was easy to
 * miss, and one that arrived while the phone was locked was a single
 * notification ding.
 *
 * Loops assets/sounds/call-ring.wav (scripts/render-call-tones.py) and repeats
 * a ring-shaped vibration until stopped. Follows the iPhone ring/silent switch
 * like any ringtone. Also clears the "Incoming call" notifications the ring
 * pushes left in the tray, since the call is on screen now.
 *
 * Never throws: a missing sound must not break answering the call.
 *
 * @module libs/call-ringtone
 */

import { Platform, Vibration } from "react-native";
import { createAudioPlayer, type AudioPlayer } from "expo-audio";
import * as Notifications from "expo-notifications";

let player: AudioPlayer | null = null;
let ringing = false;

/** On 1 s, off 1.2 s: reads as a phone ringing rather than a buzz. */
const VIBRATION = Platform.OS === "android" ? [0, 1000, 1200] : [0, 1000];

async function clearCallNotifications(): Promise<void> {
  try {
    const shown = await Notifications.getPresentedNotificationsAsync();
    await Promise.all(
      shown
        .filter((n) => (n.request?.content?.data as any)?.type === "incoming_call")
        .map((n) => Notifications.dismissNotificationAsync(n.request.identifier)),
    );
  } catch {
    // Nothing to clear, or the module is unavailable; the ring still plays.
  }
}

/** Start ringing. Calling it again while ringing does nothing. */
export function startCallRingtone(): void {
  if (ringing) return;
  ringing = true;
  void clearCallNotifications();
  try {
    if (!player) player = createAudioPlayer(require("../assets/sounds/call-ring.wav"));
    player.loop = true;
    player.volume = 1;
    if (player.currentTime > 0) player.seekTo(0);
    player.play();
  } catch {
    // Sound unavailable; the vibration still rings.
  }
  try {
    // iOS ignores the pattern and repeat flag beyond one buzz per call, so
    // the timer below keeps it going there.
    Vibration.vibrate(VIBRATION, Platform.OS === "android");
  } catch {
    // No vibrator.
  }
  if (Platform.OS === "ios") {
    const buzz = () => {
      if (!ringing) return;
      try { Vibration.vibrate(); } catch { /* no vibrator */ }
      setTimeout(buzz, 2200);
    };
    setTimeout(buzz, 2200);
  }
}

/** Stop ringing: answered, declined, missed or cancelled by the caller. */
export function stopCallRingtone(): void {
  if (!ringing) return;
  ringing = false;
  try { Vibration.cancel(); } catch { /* no vibrator */ }
  try {
    player?.pause();
    player?.seekTo(0);
  } catch {
    // Already released.
  }
}
