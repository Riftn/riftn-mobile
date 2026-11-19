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
    CallScreenModule.deliver(context, "decline", sessionId, null)
  }
}
