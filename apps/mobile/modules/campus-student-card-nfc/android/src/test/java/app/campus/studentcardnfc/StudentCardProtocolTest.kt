package app.campus.studentcardnfc

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class StudentCardProtocolTest {
  private var elapsed = 1_000L
  private val wallTime = 1_800_000_000_000L
  private val token = "a".repeat(30) + "_-"
  private val protocol = StudentCardProtocol { elapsed }

  private fun arm(duration: Long = 60_000L) =
    protocol.arm(token, (wallTime + duration).toDouble(), wallTime)

  private fun assertStatus(first: Int, second: Int, response: ByteArray) {
    assertArrayEquals(byteArrayOf(first.toByte(), second.toByte()), response)
  }

  @Test fun requiresAnExplicitPresentation() {
    assertStatus(0x69, 0x85, protocol.respond(StudentCardProtocol.SELECT))
    assertStatus(0x69, 0x85, protocol.respond(StudentCardProtocol.READ))
    assertFalse(protocol.isArmed())
  }

  @Test fun selectsThePrivateApplicationAndReturnsOnlyTheToken() {
    arm()
    assertStatus(0x90, 0x00, protocol.respond(StudentCardProtocol.SELECT))
    val response = protocol.respond(StudentCardProtocol.READ)
    assertEquals(34, response.size)
    assertEquals(token, StudentCardProtocol.readToken(response))
    assertEquals("F04E554E490101", StudentCardProtocol.AID.joinToString("") { "%02X".format(it) })
    assertEquals(StudentCardProtocol.AID_HEX, "F04E554E490101")
  }

  @Test fun acceptsSelectResponseOptionsAndOptionalShortLe() {
    arm()
    for (p2 in listOf(0x00, 0x04, 0x08, 0x0C)) {
      val select = StudentCardProtocol.SELECT.copyOf().apply { this[3] = p2.toByte() }
      for (command in listOf(select, select.dropLast(1).toByteArray(), select.copyOf().apply { this[lastIndex] = 0x20 })) {
        assertStatus(0x90, 0x00, protocol.respond(command))
        assertEquals(token, StudentCardProtocol.readToken(protocol.respond(StudentCardProtocol.READ)))
      }
    }
  }

  @Test fun requiresSelectionBeforeReading() {
    arm()
    assertStatus(0x69, 0x85, protocol.respond(StudentCardProtocol.READ))
    protocol.respond(StudentCardProtocol.SELECT)
    protocol.resetSelection()
    assertTrue(protocol.isArmed())
    assertStatus(0x69, 0x85, protocol.respond(StudentCardProtocol.READ))
    protocol.respond(StudentCardProtocol.SELECT)
    assertEquals(token, StudentCardProtocol.readToken(protocol.respond(StudentCardProtocol.READ)))
  }

  @Test fun rejectsAnUnknownApplicationAndClearsPreviousSelection() {
    arm()
    protocol.respond(StudentCardProtocol.SELECT)
    val other = StudentCardProtocol.SELECT.copyOf().apply { this[5] = 0xE0.toByte() }
    assertStatus(0x6A, 0x82, protocol.respond(other))
    assertStatus(0x69, 0x85, protocol.respond(StudentCardProtocol.READ))
  }

  @Test fun rejectsMalformedAndUnsupportedCommandsWithoutReturningData() {
    arm()
    for (size in 0..3) assertStatus(0x67, 0x00, protocol.respond(ByteArray(size)))
    assertStatus(0x6E, 0x00, protocol.respond(byteArrayOf(1, 0, 0, 0)))
    assertStatus(0x6D, 0x00, protocol.respond(byteArrayOf(0, 0, 0, 0)))
    assertStatus(0x6A, 0x86, protocol.respond(StudentCardProtocol.SELECT.copyOf().apply { this[2] = 0 }))
    assertStatus(0x6A, 0x86, protocol.respond(StudentCardProtocol.SELECT.copyOf().apply { this[3] = 1 }))
    assertStatus(0x67, 0x00, protocol.respond(StudentCardProtocol.SELECT.copyOf().apply { this[4] = 0x7F }))
    assertStatus(0x67, 0x00, protocol.respond(StudentCardProtocol.SELECT + byteArrayOf(0)))
    protocol.respond(StudentCardProtocol.SELECT)
    assertStatus(0x6A, 0x86, protocol.respond(StudentCardProtocol.READ.copyOf().apply { this[4] = 0x21 }))
    assertStatus(0x6A, 0x86, protocol.respond(StudentCardProtocol.READ + byteArrayOf(0)))
  }

  @Test fun acceptsOnlyExactAsciiBase64urlTokens() {
    for (value in listOf("", "a".repeat(31), "a".repeat(33), "a".repeat(31) + "=",
      "a".repeat(31) + "+", "a".repeat(31) + "\n", "a".repeat(31) + "學")) {
      assertThrows(IllegalArgumentException::class.java) {
        protocol.arm(value, (wallTime + 60_000).toDouble(), wallTime)
      }
      assertFalse(protocol.isArmed())
    }
  }

  @Test fun rejectsNonIntegralAndNonFiniteExpiries() {
    for (expiry in listOf(Double.NaN, Double.POSITIVE_INFINITY, Double.NEGATIVE_INFINITY, wallTime + 0.5)) {
      assertThrows(IllegalArgumentException::class.java) { protocol.arm(token, expiry, wallTime) }
      assertFalse(protocol.isArmed())
    }
  }

  @Test fun rejectsAlreadyExpiredTokens() {
    for (expiry in listOf(wallTime, wallTime - 1)) {
      assertThrows(ExpiredPresentationException::class.java) {
        protocol.arm(token, expiry.toDouble(), wallTime)
      }
    }
  }

  @Test fun clampsUntrustedFutureExpiriesToSixtySeconds() {
    assertEquals(60_000L, arm(600_000L))
    elapsed += 59_999
    assertTrue(protocol.isArmed())
    elapsed++
    assertFalse(protocol.isArmed())
    assertStatus(0x69, 0x85, protocol.respond(StudentCardProtocol.SELECT))
  }

  @Test fun expiresOnTheMonotonicClockAtTheExactBoundary() {
    assertEquals(10L, arm(10))
    protocol.respond(StudentCardProtocol.SELECT)
    elapsed += 9
    assertEquals(token, StudentCardProtocol.readToken(protocol.respond(StudentCardProtocol.READ)))
    elapsed++
    assertStatus(0x69, 0x85, protocol.respond(StudentCardProtocol.READ))
    assertFalse(protocol.isArmed())
  }

  @Test fun clearingAPresentationRemovesItsCredentialAndSelection() {
    arm()
    protocol.respond(StudentCardProtocol.SELECT)
    protocol.clear()
    assertFalse(protocol.isArmed())
    assertStatus(0x69, 0x85, protocol.respond(StudentCardProtocol.READ))
    arm()
    assertStatus(0x69, 0x85, protocol.respond(StudentCardProtocol.READ))
  }

  @Test fun aReplacementStartsWithANewSelectionAndDeadline() {
    arm()
    protocol.respond(StudentCardProtocol.SELECT)
    elapsed += 50_000
    val replacement = "b".repeat(32)
    protocol.arm(replacement, (wallTime + 1_000).toDouble(), wallTime)
    assertStatus(0x69, 0x85, protocol.respond(StudentCardProtocol.READ))
    protocol.respond(StudentCardProtocol.SELECT)
    assertEquals(replacement, StudentCardProtocol.readToken(protocol.respond(StudentCardProtocol.READ)))
    elapsed += 1_000
    assertFalse(protocol.isArmed())
  }

  @Test fun validatesStatusLengthAndAlphabetFromTheReader() {
    val valid = token.toByteArray(Charsets.US_ASCII) + byteArrayOf(0x90.toByte(), 0)
    assertEquals(token, StudentCardProtocol.readToken(valid))
    for (response in listOf(
      valid.dropLast(1).toByteArray(), valid + byteArrayOf(0),
      valid.copyOf().apply { this[32] = 0x69 },
      valid.copyOf().apply { this[33] = 0x01 },
      valid.copyOf().apply { this[0] = 0xFF.toByte() },
      valid.copyOf().apply { this[0] = 0x20 }
    )) assertNull(StudentCardProtocol.readToken(response))
  }
}
