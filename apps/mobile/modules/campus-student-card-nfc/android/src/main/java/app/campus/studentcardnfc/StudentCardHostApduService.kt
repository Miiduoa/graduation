package app.campus.studentcardnfc

import android.nfc.cardemulation.HostApduService
import android.os.Bundle

class StudentCardHostApduService : HostApduService() {
  override fun processCommandApdu(commandApdu: ByteArray, extras: Bundle?): ByteArray =
    StudentCardNfcSession.respond(commandApdu)

  override fun onDeactivated(reason: Int) {
    StudentCardNfcSession.resetSelection()
  }

  override fun onDestroy() {
    StudentCardNfcSession.serviceDestroyed()
    super.onDestroy()
  }
}
