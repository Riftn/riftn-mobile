package io.dehub.callscreen

import android.os.Build
import android.content.Context
import androidx.work.Constraints
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.Operation
import androidx.work.OutOfQuotaPolicy
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import com.facebook.react.ReactApplication
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.UiThreadUtil
import com.facebook.react.jstasks.HeadlessJsTaskConfig
import com.facebook.react.jstasks.HeadlessJsTaskContext
import java.util.concurrent.CompletableFuture
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit
import java.util.UUID

/** WorkManager retains the decline until the wallet-scoped update is acknowledged. */
class DeclineCallWorker(context: Context, params: WorkerParameters) : Worker(context, params) {
  override fun doWork(): Result {
    val session = inputData.getString("sessionId") ?: return Result.failure()
    if (System.currentTimeMillis() - inputData.getLong("declinedAt", 0L) > TimeUnit.DAYS.toMillis(1)) return Result.success()
    val host = (applicationContext as ReactApplication).reactHost ?: return Result.retry()
    val attempt = UUID.randomUUID().toString()
    val ack = CompletableFuture<Boolean>()
    pending[attempt] = ack
    return try {
      if (!host.start().waitForCompletion(40, TimeUnit.SECONDS)) return Result.retry()
      val context = host.currentReactContext ?: return Result.retry()
      UiThreadUtil.runOnUiThread {
        try {
          val data = Arguments.createMap().apply {
            putString("sessionId", session)
            putString("workId", attempt)
          }
          HeadlessJsTaskContext.getInstance(context).startTask(
            HeadlessJsTaskConfig("RiftnDeclineCall", data, 45000L, true)
          )
        } catch (_: Exception) { ack.complete(false) }
      }
      if (ack.get(45, TimeUnit.SECONDS)) Result.success() else Result.retry()
    } catch (_: Exception) {
      Result.retry()
    } finally {
      pending.remove(attempt)
    }
  }

  companion object {
    private val pending = ConcurrentHashMap<String, CompletableFuture<Boolean>>()

    fun enqueue(context: Context, session: String): Operation {
      val work = OneTimeWorkRequestBuilder<DeclineCallWorker>()
        .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
        .setInputData(workDataOf("sessionId" to session, "declinedAt" to System.currentTimeMillis()))
        .apply { if (Build.VERSION.SDK_INT >= 31) setExpedited(OutOfQuotaPolicy.RUN_AS_NON_EXPEDITED_WORK_REQUEST) }
        .build()
      return WorkManager.getInstance(context).enqueueUniqueWork("riftn-call-decline-" + session, ExistingWorkPolicy.KEEP, work)
    }

    fun acknowledge(attempt: String, success: Boolean) { pending[attempt]?.complete(success) }
  }
}
