package io.dehub.callscreen

import android.app.Activity
import android.app.KeyguardManager
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Bundle
import expo.modules.core.interfaces.Package
import expo.modules.core.interfaces.ReactActivityLifecycleListener
import java.lang.ref.WeakReference

class CallScreenPackage : Package {
  override fun createReactActivityLifecycleListeners(activityContext: Context): List<ReactActivityLifecycleListener> =
    listOf(CallActivityListener)
}

/**
 * Opens the app from the call notification. A full screen launch on a locked
 * phone shows the app's ringing screen over the lock screen; Answer asks the
 * person to unlock, then joins. Showing over the lock screen ends with the call.
 */
object CallActivityListener : ReactActivityLifecycleListener {
  private var activity: WeakReference<Activity>? = null

  override fun onCreate(activity: Activity, savedInstanceState: Bundle?) {
    this.activity = WeakReference(activity)
    handle(activity, activity.intent)
  }

  override fun onResume(activity: Activity) {
    this.activity = WeakReference(activity)
  }

  override fun onNewIntent(intent: Intent?): Boolean {
    val current = activity?.get() ?: return false
    intent ?: return false
    handle(current, intent)
    return false
  }

  private fun handle(activity: Activity, intent: Intent?) {
    intent ?: return
    val action = intent.getStringExtra(CallNotifier.EXTRA_ACTION) ?: return
    val sessionId = intent.getStringExtra(CallNotifier.EXTRA_SESSION) ?: return
    val type = intent.getStringExtra(CallNotifier.EXTRA_TYPE)
    intent.removeExtra(CallNotifier.EXTRA_ACTION)
    // The app's own call screen takes over the ringing from here.
    CallNotifier.cancel(activity.applicationContext, sessionId)
    when (action) {
      "incoming" -> {
        showOverLock(activity, true)
        CallScreenModule.deliver(activity.applicationContext, "incoming", sessionId, type)
      }
      "answer" -> {
        requestUnlock()
        CallScreenModule.deliver(activity.applicationContext, "answer", sessionId, type)
      }
    }
  }

  fun requestUnlock() {
    val current = activity?.get() ?: return
    current.runOnUiThread {
      val keyguard = current.getSystemService(Context.KEYGUARD_SERVICE) as? KeyguardManager
      if (keyguard?.isKeyguardLocked == true && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        keyguard.requestDismissKeyguard(current, null)
      }
      showOverLock(current, false)
    }
  }

  fun releaseLock() {
    val current = activity?.get() ?: return
    current.runOnUiThread { showOverLock(current, false) }
  }

  @Suppress("DEPRECATION")
  private fun showOverLock(activity: Activity, show: Boolean) {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
      activity.setShowWhenLocked(show)
      activity.setTurnScreenOn(show)
    } else {
      val flags = android.view.WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
        android.view.WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
      if (show) activity.window.addFlags(flags) else activity.window.clearFlags(flags)
    }
  }
}
