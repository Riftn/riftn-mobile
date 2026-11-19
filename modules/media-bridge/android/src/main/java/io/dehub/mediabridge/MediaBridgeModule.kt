package io.dehub.mediabridge

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Hand-off point between MainActivity's key dispatch and JS. The activity
 * calls [emit] for every volume key press; the module forwards it while JS
 * is listening.
 */
object VolumeKeyEvents {
  @Volatile internal var listener: ((String) -> Unit)? = null

  fun emit(direction: String) {
    try { listener?.invoke(direction) } catch (_: Throwable) {}
  }
}

/**
 * Small native capabilities that arrived together in one store build:
 * hardware volume key presses (for "volume up unmutes the video") and the
 * flag that tells JS this binary can share its screen while live (the
 * mediaProjection service is switched on in MainApplication).
 */
class MediaBridgeModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("RiftnMediaBridge")
    Events("onVolumeKey")

    Constant("liveScreenShare") { true }

    // Android shows its own consent dialog from getDisplayMedia; nothing to open here.
    AsyncFunction("showBroadcastPicker") { false }

    OnStartObserving {
      VolumeKeyEvents.listener = { direction ->
        sendEvent("onVolumeKey", mapOf("direction" to direction))
      }
    }

    OnStopObserving {
      VolumeKeyEvents.listener = null
    }
  }
}
