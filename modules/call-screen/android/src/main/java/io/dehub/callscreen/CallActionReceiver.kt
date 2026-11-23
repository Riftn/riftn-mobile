package io.dehub.callscreen

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/** Decline on the call notification: stop ringing and let the app tell the caller. */
class CallActionReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action != CallNotifier.ACTION_DECLINE) return
    val sessionId = intent.getStringExtra(CallNotifier.EXTRA_SESSION) ?: return
    CallNotifier.cancel(context, sessionId)
    // The enqueue itself writes asynchronously. Keep the receiver alive until
    // WorkManager commits it, even if the notification was the only live UI.
    val pending = goAsync()
    try {
      val queued = DeclineCallWorker.enqueue(context, sessionId).result
      queued.addListener({
        try {
          queued.get()
        } catch (_: Exception) {
          CallNotifier.remember(context, "decline", sessionId, null)
        } finally {
          pending.finish()
        }
      }, { task -> task.run() })
    } catch (_: Exception) {
      try {
        CallNotifier.remember(context, "decline", sessionId, null)
      } finally {
        pending.finish()
      }
    }
    CallScreenModule.deliver(context, "decline", sessionId, null)
  }
}
