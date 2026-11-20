package app.campus.studentcardnfc

import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class CampusStudentCardNfcModule : Module() {
  private val owner = Any()
  @Volatile private var destroyed = false

  override fun definition() = ModuleDefinition {
    Name("CampusStudentCardNfc")
    Events("onPresentationEnded")

    AsyncFunction("getCapabilities") {
      StudentCardNfcSession.capabilities(appContext.reactContext)
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("beginPresentation") { token: String, expiresAt: Double, presentationId: String ->
      requireAlive()
      StudentCardNfcSession.beginPresentation(
        owner, appContext.currentActivity, token, expiresAt, presentationId
      ) { endedId ->
        if (!destroyed) sendEvent("onPresentationEnded", mapOf("presentationId" to endedId))
      }
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("endPresentation") {
      StudentCardNfcSession.endPresentation(owner)
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("readPresentation") { promise: Promise ->
      requireAlive()
      StudentCardNfcSession.readPresentation(owner, appContext.currentActivity, promise)
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("cancelRead") {
      StudentCardNfcSession.cancelRead(owner)
    }.runOnQueue(Queues.MAIN)

    OnActivityEntersBackground { StudentCardNfcSession.invalidate(owner) }
    OnUserLeavesActivity { StudentCardNfcSession.invalidate(owner) }
    OnActivityDestroys { StudentCardNfcSession.invalidate(owner) }
    OnDestroy {
      destroyed = true
      StudentCardNfcSession.invalidate(owner)
    }
  }

  private fun requireAlive() {
    if (destroyed) throw CodedException("ERR_NFC_UNAVAILABLE", "NFC is unavailable.", null)
  }
}
