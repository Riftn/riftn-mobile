package io.dehub.callscreen

import android.app.ActivityManager
import com.google.firebase.messaging.RemoteMessage
import expo.modules.notifications.service.ExpoFirebaseMessagingService
import org.json.JSONObject

/**
 * Takes incoming call pushes before expo-notifications does. With the app in
 * the background or closed, a call rings as a full screen call instead of a
 * one-beep notification. With the app open, the app's own call screen rings,
 * so the push goes on to expo-notifications as before. Every other push is
 * untouched.
 */
class CallMessagingService : ExpoFirebaseMessagingService() {
  override fun onMessageReceived(remoteMessage: RemoteMessage) {
    val data = remoteMessage.data
    val body = try { data["body"]?.let { JSONObject(it) } } catch (_: Throwable) { null }
    val type = body?.optString("type")
    val sessionId = body?.optString("sessionId").orEmpty()
    if (sessionId.isNotEmpty()) {
      when (type) {
        "incoming_call_end" -> {
          CallNotifier.cancel(applicationContext, sessionId)
          return
        }
        "incoming_call" -> if (!appInForeground()) {
          // Repeat rings of the same call only refresh it, without a new sound.
          CallNotifier.show(
            applicationContext,
            sessionId,
            data["title"]?.takeIf { it.isNotBlank() } ?: "Riftn",
            body.optString("callType") == "video",
          )
          return
        }
      }
    }
    super.onMessageReceived(remoteMessage)
  }

  private fun appInForeground(): Boolean {
    val state = ActivityManager.RunningAppProcessInfo()
    ActivityManager.getMyMemoryState(state)
    return state.importance <= ActivityManager.RunningAppProcessInfo.IMPORTANCE_FOREGROUND
  }
}
