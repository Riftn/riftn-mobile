package io.dehub.callscreen

import android.content.Context
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.lang.ref.WeakReference

class CallScreenModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("RiftnCallScreen")
    Events("onCallAction")

    Constant("supported") { true }

    AsyncFunction("getVoipToken") { null as String? }

    AsyncFunction("completeDecline") { workId: String, success: Boolean ->
      DeclineCallWorker.acknowledge(workId, success)
    }

    AsyncFunction("takePendingActions") {
      val context = appContext.reactContext?.applicationContext ?: return@AsyncFunction emptyList<Map<String, String>>()
      CallNotifier.takePending(context)
    }

    /** The call ended or was answered in the app: stop ringing, stop showing over the lock screen. */
    AsyncFunction("endCall") { sessionId: String ->
      appContext.reactContext?.applicationContext?.let { CallNotifier.cancel(it, sessionId) }
      CallActivityListener.releaseLock()
    }

    AsyncFunction("requestUnlock") {
      CallActivityListener.requestUnlock()
    }

    OnStartObserving { listening = WeakReference(this@CallScreenModule) }
    OnStopObserving { if (listening?.get() === this@CallScreenModule) listening = null }
  }

  companion object {
    @Volatile private var listening: WeakReference<CallScreenModule>? = null

    /** Hands a call action to JS now if it is listening, otherwise keeps it until JS asks. */
    fun deliver(context: Context, action: String, sessionId: String, type: String?) {
      val module = listening?.get()
      if (module != null) {
        try {
          module.sendEvent(
            "onCallAction",
            mapOf("action" to action, "sessionId" to sessionId, "callType" to (type ?: "audio")),
          )
          return
        } catch (_: Throwable) {
          // Fall through and keep it for later.
        }
      }
      if (action != "decline") CallNotifier.remember(context, action, sessionId, type)
    }
  }
}
