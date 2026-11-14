package app.campus.studentcardnfc

import android.app.Activity
import android.app.KeyguardManager
import android.content.BroadcastReceiver
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.nfc.NfcAdapter
import android.nfc.NfcManager
import android.nfc.Tag
import android.nfc.cardemulation.CardEmulation
import android.nfc.tech.IsoDep
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.os.SystemClock
import android.view.View
import android.view.ViewGroup
import android.view.ViewTreeObserver
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleOwner
import com.facebook.react.bridge.ReactContext
import com.facebook.react.views.modal.ReactModalHostView
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import java.lang.ref.WeakReference
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

/** One process-wide NFC owner also prevents an old JS instance from clearing a newer session. */
internal object StudentCardNfcSession {
  private const val READ_TIMEOUT_MILLIS = 20_000L
  private val main = Handler(Looper.getMainLooper())
  private val io = Executors.newCachedThreadPool { task ->
    Thread(task, "nuni-student-card-nfc").apply { isDaemon = true }
  }
  private val protocol = StudentCardProtocol(SystemClock::elapsedRealtime)
  private var owner: Any? = null
  private var activity: WeakReference<Activity>? = null
  private var adapter: NfcAdapter? = null
  private var preferred = false
  private var reading: ReadRequest? = null
  private var timeout: Runnable? = null
  private var receiverContext: Context? = null
  private var watchedView: View? = null
  private var presentationEnded: (() -> Unit)? = null
  private val focusListener = ViewTreeObserver.OnWindowFocusChangeListener { focused ->
    if (!focused) stopActive("CANCELLED")
  }
  private val attachListener = object : View.OnAttachStateChangeListener {
    override fun onViewAttachedToWindow(view: View) = Unit

    override fun onViewDetachedFromWindow(view: View) {
      if (watchedView === view) stopActive("CANCELLED")
    }
  }
  private val stateReceiver = object : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
      if (intent.action == Intent.ACTION_SCREEN_OFF ||
        (intent.action == NfcAdapter.ACTION_ADAPTER_STATE_CHANGED &&
          intent.getIntExtra(NfcAdapter.EXTRA_ADAPTER_STATE, NfcAdapter.STATE_OFF) != NfcAdapter.STATE_ON)
      ) stopActive("CANCELLED")
    }
  }

  private class ReadRequest(val promise: Promise) {
    val deadline = SystemClock.elapsedRealtime() + READ_TIMEOUT_MILLIS
    val cancelled = AtomicBoolean(false)
    val claimed = AtomicBoolean(false)
    var connection: IsoDep? = null // Accessed under synchronized(request).
  }

  fun capabilities(context: Context?): Map<String, Boolean> {
    val device = context?.getSystemService(NfcManager::class.java)?.defaultAdapter
    val supported = device != null &&
      context?.packageManager?.hasSystemFeature(PackageManager.FEATURE_NFC) == true
    return mapOf(
      "canRead" to supported,
      "canPresent" to (supported &&
        context?.packageManager?.hasSystemFeature(PackageManager.FEATURE_NFC_HOST_CARD_EMULATION) == true),
      "enabled" to (device?.isEnabled == true)
    )
  }

  fun beginPresentation(
    nextOwner: Any,
    foreground: Activity?,
    token: String,
    expiresAt: Double,
    presentationId: String,
    onEnded: (String) -> Unit
  ) {
    val target = requireForeground(foreground)
    val device = requireAdapter(target)
    if (!target.packageManager.hasSystemFeature(PackageManager.FEATURE_NFC_HOST_CARD_EMULATION)) {
      throw failure("UNAVAILABLE")
    }
    if (owner != null) throw failure("BUSY")
    val started = SystemClock.elapsedRealtime()
    val duration = try {
      protocol.arm(token, expiresAt, System.currentTimeMillis())
    } catch (_: ExpiredPresentationException) {
      throw failure("EXPIRED")
    } catch (_: IllegalArgumentException) {
      throw failure("INVALID")
    }
    try {
      watch(nextOwner, target, device)
      preferred = CardEmulation.getInstance(device).setPreferredService(
        target, ComponentName(target, StudentCardHostApduService::class.java)
      )
      if (!preferred || !foregroundUnlocked(target)) throw failure("UNAVAILABLE")
      if (!protocol.isArmed()) throw failure("EXPIRED")
      presentationEnded = { onEnded(presentationId) }
      timeout = Runnable { if (owner === nextOwner && reading == null) release() }
      main.postDelayed(timeout!!, maxOf(0L, duration - (SystemClock.elapsedRealtime() - started)))
    } catch (error: Exception) {
      release()
      throw if (error is CodedException) error else failure("UNAVAILABLE")
    }
  }

  fun endPresentation(expectedOwner: Any) {
    if (owner === expectedOwner && reading == null) release()
  }

  fun readPresentation(nextOwner: Any, foreground: Activity?, promise: Promise) {
    val target = requireForeground(foreground)
    val device = requireAdapter(target)
    if (owner != null) throw failure("BUSY")
    val request = ReadRequest(promise)
    try {
      watch(nextOwner, target, device)
      reading = request
      timeout = Runnable { finishRead(request, code = "READ_FAILED") }
      main.postDelayed(timeout!!, READ_TIMEOUT_MILLIS)
      device.enableReaderMode(target, { tag ->
        main.post { readTag(request, tag) }
      }, NfcAdapter.FLAG_READER_NFC_A or NfcAdapter.FLAG_READER_SKIP_NDEF_CHECK, null)
    } catch (_: Exception) {
      if (reading === request) finishRead(request, code = "UNAVAILABLE")
      else {
        release()
        promise.reject(failure("UNAVAILABLE"))
      }
    }
  }

  fun cancelRead(expectedOwner: Any) {
    if (owner === expectedOwner) reading?.let { finishRead(it, code = "CANCELLED") }
  }

  fun invalidate(expectedOwner: Any) {
    if (Looper.myLooper() == Looper.getMainLooper()) {
      if (owner === expectedOwner) stopActive("CANCELLED")
    } else {
      main.post { if (owner === expectedOwner) stopActive("CANCELLED") }
    }
  }

  fun respond(command: ByteArray): ByteArray {
    if (owner == null || reading != null) return byteArrayOf(0x69, 0x85.toByte())
    if (!foregroundUnlocked(activity?.get()) || adapter?.isEnabled != true) {
      release()
      return byteArrayOf(0x69, 0x85.toByte())
    }
    val response = protocol.respond(command)
    if (!protocol.isArmed()) release()
    return response
  }

  fun resetSelection() = protocol.resetSelection()

  fun serviceDestroyed() {
    if (reading == null) release()
  }

  private fun readTag(request: ReadRequest, tag: Tag) {
    if (reading !== request || !request.claimed.compareAndSet(false, true)) return
    if (!foregroundUnlocked(activity?.get())) {
      finishRead(request, code = "CANCELLED")
      return
    }
    io.execute {
      var connection: IsoDep? = null
      try {
        val transport = IsoDep.get(tag) ?: throw failure("INVALID")
        connection = transport
        synchronized(request) {
          if (request.cancelled.get()) return@execute
          request.connection = transport
        }
        transport.timeout = 3_000
        transport.connect()
        if (request.cancelled.get()) return@execute
        val selected = transport.transceive(StudentCardProtocol.SELECT)
        if (selected.size < 2 || selected[selected.size - 2] != 0x90.toByte() ||
          selected.last() != 0.toByte()
        ) throw failure("READ_FAILED")
        if (request.cancelled.get()) return@execute
        val token = StudentCardProtocol.readToken(transport.transceive(StudentCardProtocol.READ))
          ?: throw failure("INVALID")
        main.post { finishRead(request, token = token) }
      } catch (_: Exception) {
        main.post { finishRead(request, code = "READ_FAILED") }
      } finally {
        synchronized(request) { request.connection = null }
        try { connection?.close() } catch (_: Exception) { }
      }
    }
  }

  private fun finishRead(request: ReadRequest, token: String? = null, code: String = "READ_FAILED") {
    if (reading !== request) return
    val allowed = foregroundUnlocked(activity?.get()) && adapter?.isEnabled == true
    val expired = SystemClock.elapsedRealtime() >= request.deadline
    release()
    if (token != null && allowed && !expired) request.promise.resolve(token)
    else request.promise.reject(failure(if (expired) "READ_FAILED" else if (token != null) "CANCELLED" else code))
  }

  private fun stopActive(code: String) {
    val request = reading
    if (request != null) finishRead(request, code = code) else release()
  }

  private fun watch(nextOwner: Any, target: Activity, device: NfcAdapter) {
    owner = nextOwner
    activity = WeakReference(target)
    adapter = device
    val context = target.applicationContext
    val filter = IntentFilter(Intent.ACTION_SCREEN_OFF).apply {
      addAction(NfcAdapter.ACTION_ADAPTER_STATE_CHANGED)
    }
    if (Build.VERSION.SDK_INT >= 33) {
      // These are protected system broadcasts. NFC uses its own privileged UID.
      context.registerReceiver(stateReceiver, filter, Context.RECEIVER_EXPORTED)
    } else {
      @Suppress("DEPRECATION")
      context.registerReceiver(stateReceiver, filter)
    }
    receiverContext = context
    watchedView = focusedWindow(target) ?: throw failure("UNAVAILABLE")
    watchedView?.viewTreeObserver?.addOnWindowFocusChangeListener(focusListener)
    watchedView?.addOnAttachStateChangeListener(attachListener)
  }

  private fun release() {
    val notifyPresentationEnded = presentationEnded
    presentationEnded = null
    timeout?.let(main::removeCallbacks)
    timeout = null
    protocol.clear()
    val request = reading
    reading = null
    request?.cancelled?.set(true)
    if (request != null) {
      val connection = synchronized(request) {
        request.connection.also { request.connection = null }
      }
      // close() interrupts transceive on another thread, keeping cancellation off the UI thread.
      if (connection != null) io.execute { try { connection.close() } catch (_: Exception) { } }
    }
    val target = activity?.get()
    if (target != null) {
      if (request != null) {
        try { adapter?.disableReaderMode(target) } catch (_: Exception) { }
      }
      if (preferred) {
        try { adapter?.let { CardEmulation.getInstance(it).unsetPreferredService(target) } }
        catch (_: Exception) { }
      }
    }
    preferred = false
    watchedView?.viewTreeObserver?.takeIf { it.isAlive }?.removeOnWindowFocusChangeListener(focusListener)
    watchedView?.removeOnAttachStateChangeListener(attachListener)
    watchedView = null
    receiverContext?.let { try { it.unregisterReceiver(stateReceiver) } catch (_: Exception) { } }
    receiverContext = null
    owner = null
    activity = null
    adapter = null
    // The JS runtime may already be gone, but native state must still finish clearing.
    try { notifyPresentationEnded?.invoke() } catch (_: Exception) { }
  }

  private fun requireForeground(target: Activity?): Activity {
    if (!foregroundUnlocked(target)) throw failure("UNAVAILABLE")
    return target!!
  }

  private fun foregroundUnlocked(target: Activity?): Boolean {
    if (target == null || target.isFinishing || target.isDestroyed) return false
    val lifecycle = (target as? LifecycleOwner)?.lifecycle ?: return false
    if (!lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED)) return false
    if (target.getSystemService(PowerManager::class.java)?.isInteractive != true ||
      target.getSystemService(KeyguardManager::class.java)?.isDeviceLocked != false
    ) return false
    val window = watchedView ?: focusedWindow(target) ?: return false
    return window.isAttachedToWindow && window.hasWindowFocus()
  }

  private fun focusedWindow(target: Activity): View? {
    val root = target.window.decorView
    // React Native Modal owns a separate Dialog window while its Activity stays resumed.
    val windows = mutableListOf<View>()
    collectModalWindows(root, target, windows)
    // A showing Modal may still be acquiring focus. Do not bind to its outgoing Activity window.
    if (windows.isEmpty()) windows.add(root)
    return windows.firstOrNull { it.isAttachedToWindow && it.hasWindowFocus() }
  }

  private fun collectModalWindows(view: View, target: Activity, windows: MutableList<View>) {
    if (view is ReactModalHostView && (view.context as? ReactContext)?.currentActivity === target) {
      val dialog = view.dialog
      if (dialog != null && dialog.isShowing) {
        dialog.window?.decorView?.let(windows::add)
      }
    }
    if (view is ViewGroup) {
      for (index in 0 until view.childCount) {
        val child = view.getChildAt(index) ?: continue
        collectModalWindows(child, target, windows)
      }
    }
  }

  private fun requireAdapter(target: Activity): NfcAdapter {
    val device = target.getSystemService(NfcManager::class.java)?.defaultAdapter
      ?: throw failure("UNAVAILABLE")
    if (!device.isEnabled) throw failure("DISABLED")
    return device
  }

  private fun failure(code: String) = CodedException("ERR_NFC_$code", "NFC operation did not complete.", null)
}
