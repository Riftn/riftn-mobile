/**
 * The sound and buzz of an incoming call.
 *
 * The incoming-call screen used to appear in silence, so a phone on the desk
 * never told anyone a call was coming. While the screen is up this loops a
 * short ringtone and buzzes in a ring rhythm; answering, declining or the call
 * ending stops both.
 *
 * The ringtone follows the phone's own silent switch on iPhone (the buzz
 * still comes), the same as a normal call.
 */
import { Vibration } from "react-native";
import { createAudioPlayer, type AudioPlayer } from "expo-audio";
import * as Notifications from "expo-notifications";

/** Buzz, rest, buzz, long rest: the rhythm people read as a phone ringing. */
const RING_BUZZ = [0, 700, 300, 700, 1400];

let player: AudioPlayer | null = null;
let ringing = false;

/** The call screen is up, so the "Incoming call" notifications in the tray are done with. */
async function clearCallNotifications(): Promise<void> {
  try {
    const shown = await Notifications.getPresentedNotificationsAsync();
    await Promise.all(
      shown
        .filter((n) => (n.request?.content?.data as { type?: string } | undefined)?.type === "incoming_call")
        .map((n) => Notifications.dismissNotificationAsync(n.request.identifier)),
    );
  } catch {
    // Nothing to clear; the ring still plays.
  }
}

export function startCallRingtone(): void {
  if (ringing) return;
  ringing = true;
  void clearCallNotifications();
  try {
    Vibration.vibrate(RING_BUZZ, true);
  } catch {
    // A phone with no motor still gets the sound.
  }
  try {
    if (!player) player = createAudioPlayer(require("../assets/sounds/ringtone.wav"));
    player.loop = true;
    player.volume = 1;
    player.seekTo(0);
    player.play();
  } catch {
    // The call screen still shows; a failed sound must never block a call.
  }
}

export function stopCallRingtone(): void {
  if (!ringing) return;
  ringing = false;
  try { Vibration.cancel(); } catch { /* nothing to stop */ }
  try {
    player?.pause();
    player?.seekTo(0);
  } catch {
    // Already stopped.
  }
}
