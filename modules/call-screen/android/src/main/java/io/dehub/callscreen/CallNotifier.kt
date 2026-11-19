package io.dehub.callscreen

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.net.Uri
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.Person
import org.json.JSONArray
import org.json.JSONObject

/**
 * The incoming call notification: full screen on a locked phone, a call-style
 * heads-up with Answer and Decline otherwise. It rings with the Riftn ringtone
 * on repeat (FLAG_INSISTENT) until it is answered, declined, the caller hangs
 * up, or 45 seconds pass.
 */
object CallNotifier {
  const val CHANNEL = "calls_incoming"
  const val EXTRA_ACTION = "riftnCallAction"
  const val EXTRA_SESSION = "riftnCallSession"
  const val EXTRA_TYPE = "riftnCallType"
  const val ACTION_DECLINE = "io.dehub.callscreen.DECLINE"
  private const val PREFS = "riftn_call_screen"
  private const val PENDING = "pending"
  private const val RING_MS = 45_000L

  fun notificationId(sessionId: String) = 0x5249 + (sessionId.hashCode() and 0xFFFF)

  fun show(context: Context, sessionId: String, callerName: String, isVideo: Boolean) {
    ensureChannel(context)
    val launch = context.packageManager.getLaunchIntentForPackage(context.packageName) ?: return
    val type = if (isVideo) "video" else "audio"
    val open = activityIntent(context, launch, "incoming", sessionId, type, 1)
    val answer = activityIntent(context, launch, "answer", sessionId, type, 2)
    val decline = PendingIntent.getBroadcast(
      context,
      notificationId(sessionId) * 4 + 3,
      Intent(context, CallActionReceiver::class.java)
        .setAction(ACTION_DECLINE)
        .putExtra(EXTRA_SESSION, sessionId),
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
    val text = if (isVideo) "Incoming video call" else "Incoming voice call"
    val builder = NotificationCompat.Builder(context, CHANNEL)
      .setSmallIcon(smallIcon(context))
      .setContentTitle(callerName)
      .setContentText(text)
      .setCategory(NotificationCompat.CATEGORY_CALL)
      .setPriority(NotificationCompat.PRIORITY_MAX)
      .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
      .setOngoing(true)
      .setAutoCancel(false)
      .setTimeoutAfter(RING_MS)
      .setOnlyAlertOnce(true)
      .setContentIntent(open)
      .setFullScreenIntent(open, true)
    try {
      val caller = Person.Builder().setName(callerName).setImportant(true).build()
      builder.setStyle(NotificationCompat.CallStyle.forIncomingCall(caller, decline, answer).setIsVideo(isVideo))
    } catch (_: Throwable) {
      builder.addAction(0, "Decline", decline).addAction(0, "Answer", answer)
    }
    val notification = builder.build()
    notification.flags = notification.flags or Notification.FLAG_INSISTENT
    try {
      NotificationManagerCompat.from(context).notify(notificationId(sessionId), notification)
    } catch (_: SecurityException) {
      // Notifications are off for the app; nothing can ring.
    }
  }

  fun cancel(context: Context, sessionId: String) {
    NotificationManagerCompat.from(context).cancel(notificationId(sessionId))
  }

  private fun activityIntent(
    context: Context,
    launch: Intent,
    action: String,
    sessionId: String,
    type: String,
    slot: Int,
  ): PendingIntent {
    val intent = Intent(launch)
      .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
      .putExtra(EXTRA_ACTION, action)
      .putExtra(EXTRA_SESSION, sessionId)
      .putExtra(EXTRA_TYPE, type)
    return PendingIntent.getActivity(
      context,
      notificationId(sessionId) * 4 + slot,
      intent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
  }

  private fun ensureChannel(context: Context) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val manager = context.getSystemService(NotificationManager::class.java) ?: return
    if (manager.getNotificationChannel(CHANNEL) != null) return
    val channel = NotificationChannel(CHANNEL, "Incoming calls", NotificationManager.IMPORTANCE_HIGH).apply {
      description = "Rings for incoming voice and video calls"
      lockscreenVisibility = Notification.VISIBILITY_PUBLIC
      enableVibration(true)
      vibrationPattern = longArrayOf(0, 700, 300, 700, 1400)
      val sound = context.resources.getIdentifier("call_ring", "raw", context.packageName)
      if (sound != 0) {
        setSound(
          Uri.parse("android.resource://${context.packageName}/$sound"),
          AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build(),
        )
      }
    }
    manager.createNotificationChannel(channel)
  }

  private fun smallIcon(context: Context): Int {
    val res = context.resources
    val id = res.getIdentifier("notification_icon", "drawable", context.packageName)
    return if (id != 0) id else context.applicationInfo.icon
  }

  // Actions taken while JS was not running wait here until JS takes them.

  fun remember(context: Context, action: String, sessionId: String, type: String?) {
    val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    val list = try { JSONArray(prefs.getString(PENDING, "[]")) } catch (_: Throwable) { JSONArray() }
    list.put(
      JSONObject()
        .put("action", action)
        .put("sessionId", sessionId)
        .put("callType", type ?: "audio")
        .put("at", System.currentTimeMillis()),
    )
    prefs.edit().putString(PENDING, list.toString()).apply()
  }

  fun takePending(context: Context): List<Map<String, String>> {
    val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    val raw = prefs.getString(PENDING, "[]")
    prefs.edit().remove(PENDING).apply()
    val list = try { JSONArray(raw) } catch (_: Throwable) { return emptyList() }
    val now = System.currentTimeMillis()
    return (0 until list.length()).mapNotNull { index ->
      val item = list.optJSONObject(index) ?: return@mapNotNull null
      // A call action older than a couple of minutes is stale.
      if (now - item.optLong("at") > 120_000) return@mapNotNull null
      mapOf(
        "action" to item.optString("action"),
        "sessionId" to item.optString("sessionId"),
        "callType" to item.optString("callType", "audio"),
      )
    }
  }
}
