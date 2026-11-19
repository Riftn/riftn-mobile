package io.dehub.mediabridge

import android.content.Context
import android.database.ContentObserver
import android.media.AudioManager
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.util.Log
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Hand-off point between MainActivity's key dispatch and JS. The activity
 * calls [emit] for every volume key press; the module forwards it.
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
 *
 * Volume up is caught two ways, because neither sees every press:
 * - the activity's key dispatch (MainActivity), which also sees a press at
 *   full volume but misses presses while a dialog window (a sheet or a
 *   modal player) has focus;
 * - the media volume going up, which is seen whatever window has focus.
 * Both are wired as soon as the module loads; a press seen twice just
 * unmutes twice.
 */
class MediaBridgeModule : Module() {
  private var observer: ContentObserver? = null
  private var lastVolume = -1
  private var lastEmit = 0L

  private fun emitUp(source: String) {
    val now = android.os.SystemClock.uptimeMillis()
    if (now - lastEmit < 150) return
    lastEmit = now
    Log.d(TAG, "volume up ($source)")
    try { sendEvent("onVolumeKey", mapOf("direction" to "up")) } catch (_: Throwable) {}
  }

  private fun startWatching() {
    VolumeKeyEvents.listener = { direction ->
      if (direction == "up") emitUp("key")
      else try { sendEvent("onVolumeKey", mapOf("direction" to direction)) } catch (_: Throwable) {}
    }
    if (observer != null) return
    val context = appContext.reactContext?.applicationContext ?: return
    val audio = context.getSystemService(Context.AUDIO_SERVICE) as? AudioManager ?: return
    lastVolume = audio.getStreamVolume(AudioManager.STREAM_MUSIC)
    val watcher = object : ContentObserver(Handler(Looper.getMainLooper())) {
      override fun onChange(selfChange: Boolean) {
        val volume = audio.getStreamVolume(AudioManager.STREAM_MUSIC)
        if (volume > lastVolume) emitUp("volume")
        lastVolume = volume
      }
    }
    context.contentResolver.registerContentObserver(Settings.System.CONTENT_URI, true, watcher)
    observer = watcher
    Log.d(TAG, "watching volume")
  }

  private fun stopWatching() {
    VolumeKeyEvents.listener = null
    val watcher = observer ?: return
    observer = null
    try { appContext.reactContext?.applicationContext?.contentResolver?.unregisterContentObserver(watcher) } catch (_: Throwable) {}
  }

  override fun definition() = ModuleDefinition {
    Name("RiftnMediaBridge")
    Events("onVolumeKey")

    Constant("liveScreenShare") { true }

    // Android shows its own consent dialog from getDisplayMedia; nothing to open here.
    AsyncFunction("showBroadcastPicker") { false }

    OnCreate { startWatching() }
    OnStartObserving { startWatching() }
    OnDestroy { stopWatching() }
  }

  companion object {
    private const val TAG = "RiftnMediaBridge"
  }
}
