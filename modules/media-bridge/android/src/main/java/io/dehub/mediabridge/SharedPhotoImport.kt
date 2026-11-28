package io.dehub.mediabridge

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.webkit.MimeTypeMap
import java.io.File
import java.io.IOException
import java.util.UUID
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

object SharedPhotoImport {
  private const val maxBytes = 42_069_000
  private val worker = Executors.newSingleThreadExecutor()
  private val main = Handler(Looper.getMainLooper())
  private val failed = AtomicBoolean()
  @Volatile internal var listener: (() -> Unit)? = null

  @Suppress("DEPRECATION")
  fun receive(context: Context, intent: Intent?) {
    if (intent == null || intent.action != Intent.ACTION_SEND || intent.type?.startsWith("image/") != true) return
    val app = context.applicationContext
    val source = runCatching {
      intent.getParcelableExtra<Uri>(Intent.EXTRA_STREAM)
        ?: intent.clipData?.takeIf { it.itemCount == 1 }?.getItemAt(0)?.uri
    }.getOrNull()
    worker.execute {
      try {
        if (source?.scheme != "content") throw IOException("Expected a shared content URI")
        val mime = app.contentResolver.getType(source) ?: intent.type
        if (mime?.startsWith("image/") != true) throw IOException("Expected a shared image")
        val extension = MimeTypeMap.getSingleton().getExtensionFromMimeType(mime)
          ?: throw IOException("Unsupported image type")
        val inbox = File(app.cacheDir, "SharedPhotos/Inbox").apply { mkdirs() }
        val id = "${System.currentTimeMillis()}-${UUID.randomUUID()}"
        val staging = File.createTempFile("share-", ".tmp", inbox.parentFile!!)
        try {
          val input = app.contentResolver.openInputStream(source) ?: throw IOException("Photo unavailable")
          input.use { stream ->
            staging.outputStream().use { output ->
              val buffer = ByteArray(64 * 1024)
              var total = 0
              while (true) {
                val count = stream.read(buffer)
                if (count == -1) break
                total += count
                if (total > maxBytes) throw IOException("Photo exceeds upload limit")
                output.write(buffer, 0, count)
              }
              if (total == 0) throw IOException("Empty photo")
            }
          }
          if (!staging.renameTo(File(inbox, "$id.$extension"))) throw IOException("Unable to queue photo")
        } finally {
          staging.delete()
        }
      } catch (_: Exception) {
        failed.set(true)
      }
      main.post { listener?.invoke() }
    }
  }

  @Synchronized
  internal fun take(context: Context): Map<String, String>? {
    val root = File(context.cacheDir, "SharedPhotos")
    val pending = File(root, "Inbox").listFiles()?.minByOrNull { it.name }
      ?: return if (failed.getAndSet(false)) mapOf("kind" to "error") else null
    val attachments = File(root, "Attachments").apply { mkdirs() }
    val file = File(attachments, pending.name)
    if (!pending.renameTo(file)) return mapOf("kind" to "error")
    val result = mutableMapOf("kind" to "photo", "id" to file.nameWithoutExtension, "uri" to Uri.fromFile(file).toString())
    MimeTypeMap.getSingleton().getMimeTypeFromExtension(file.extension)?.let { result["mimeType"] = it }
    return result
  }
}
