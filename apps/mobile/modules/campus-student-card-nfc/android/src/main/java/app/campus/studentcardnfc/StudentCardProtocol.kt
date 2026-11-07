package app.campus.studentcardnfc

/** A private ISO 7816 application for nuni readers. See PROTOCOL.md. */
internal class StudentCardProtocol(private val monotonicMillis: () -> Long) {
  private var token: ByteArray? = null
  private var deadline = 0L
  private var selected = false

  fun arm(value: String, expiresAt: Double, wallTimeMillis: Long): Long {
    require(TOKEN.matches(value) && expiresAt.isFinite() && expiresAt % 1.0 == 0.0)
    val remaining = expiresAt - wallTimeMillis.toDouble()
    if (remaining <= 0.0) throw ExpiredPresentationException()
    val duration = minOf(remaining, MAX_DURATION_MILLIS.toDouble()).toLong()
    clear()
    token = value.toByteArray(Charsets.US_ASCII)
    deadline = monotonicMillis() + duration
    return duration
  }

  fun isArmed(): Boolean = currentToken() != null

  fun clear() {
    token?.fill(0)
    token = null
    deadline = 0
    selected = false
  }

  fun resetSelection() {
    selected = false
  }

  fun respond(command: ByteArray): ByteArray {
    val value = currentToken() ?: return status(0x69, 0x85)
    if (command.size < 4) return status(0x67, 0x00)
    if (command[0] != 0.toByte()) return status(0x6E, 0x00)
    if (command[1] == 0xA4.toByte()) {
      selected = false
      if (command.size < 5 || command[2] != 0x04.toByte() ||
        command[3].toInt() !in listOf(0x00, 0x04, 0x08, 0x0C)
      ) return status(0x6A, 0x86)
      val length = command[4].toInt() and 0xFF
      if (command.size != 5 + length && command.size != 6 + length) {
        return status(0x67, 0x00)
      }
      if (!command.copyOfRange(5, 5 + length).contentEquals(AID)) {
        return status(0x6A, 0x82)
      }
      selected = true
      return status(0x90, 0x00)
    }
    if (command[1] != 0xCA.toByte()) return status(0x6D, 0x00)
    if (!command.contentEquals(READ)) return status(0x6A, 0x86)
    if (!selected) return status(0x69, 0x85)
    return value + status(0x90, 0x00)
  }

  private fun currentToken(): ByteArray? {
    if (token != null && monotonicMillis() >= deadline) clear()
    return token
  }

  companion object {
    const val AID_HEX = "F04E554E490101"
    const val MAX_DURATION_MILLIS = 60_000L
    private val TOKEN = Regex("^[A-Za-z0-9_-]{32}$")
    val AID: ByteArray get() = byteArrayOf(0xF0.toByte(), 0x4E, 0x55, 0x4E, 0x49, 0x01, 0x01)
    val SELECT: ByteArray get() = byteArrayOf(0x00, 0xA4.toByte(), 0x04, 0x00, 0x07) + AID + 0x00
    val READ: ByteArray get() = byteArrayOf(0x00, 0xCA.toByte(), 0x00, 0x00, 0x20)

    fun readToken(response: ByteArray): String? {
      if (response.size != 34 || response[32] != 0x90.toByte() || response[33] != 0.toByte()) {
        return null
      }
      val value = response.copyOfRange(0, 32).toString(Charsets.US_ASCII)
      return value.takeIf(TOKEN::matches)
    }

    private fun status(first: Int, second: Int) = byteArrayOf(first.toByte(), second.toByte())
  }
}

internal class ExpiredPresentationException : IllegalArgumentException()
