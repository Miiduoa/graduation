package app.campus.googlecredential

import androidx.credentials.ClearCredentialStateRequest
import androidx.credentials.CredentialManager
import androidx.credentials.CustomCredential
import androidx.credentials.GetCredentialRequest
import androidx.credentials.exceptions.GetCredentialCancellationException
import androidx.credentials.exceptions.NoCredentialException
import com.google.android.libraries.identity.googleid.GetSignInWithGoogleOption
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

private class GoogleCredentialCancelledException(cause: Throwable? = null) :
  CodedException("Google account selection was cancelled.", cause)

private class GoogleCredentialNotFoundException(cause: Throwable? = null) :
  CodedException("No Google credential is available on this device.", cause)

private class GoogleCredentialActivityUnavailableException :
  CodedException("A foreground Android Activity is required for Google sign-in.")

private class GoogleCredentialInvalidRequestException :
  CodedException("The Google credential request is invalid.")

private class GoogleCredentialInvalidResponseException(cause: Throwable? = null) :
  CodedException("Google returned an unsupported or invalid credential.", cause)

private class GoogleCredentialFailedException(cause: Throwable) :
  CodedException("Google credential retrieval failed.", cause)

/**
 * Android-only bridge for Google's Credential Manager sign-in button flow.
 *
 * The JavaScript caller receives only the signed ID token. Provider errors,
 * credential payloads and account identifiers are deliberately never logged or
 * returned across the bridge.
 */
class CampusGoogleCredentialModule : Module() {
  private val requestMutex = Mutex()

  override fun definition() = ModuleDefinition {
    Name("CampusGoogleCredential")

    Function("isConfigured") { true }

    AsyncFunction("getIdToken") Coroutine { serverClientId: String, nonce: String ->
      validateRequest(serverClientId, nonce)
      requestMutex.withLock {
        val activity = appContext.currentActivity
          ?: throw GoogleCredentialActivityUnavailableException()
        val credentialManager = CredentialManager.create(activity)
        val googleOption = GetSignInWithGoogleOption.Builder(serverClientId)
          .setNonce(nonce)
          .build()
        val request = GetCredentialRequest.Builder()
          .addCredentialOption(googleOption)
          .build()

        val credential = try {
          credentialManager.getCredential(activity, request).credential
        } catch (error: GetCredentialCancellationException) {
          throw GoogleCredentialCancelledException(error)
        } catch (error: NoCredentialException) {
          throw GoogleCredentialNotFoundException(error)
        } catch (error: Throwable) {
          throw GoogleCredentialFailedException(error)
        }

        if (credential !is CustomCredential ||
          credential.type != GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL
        ) {
          throw GoogleCredentialInvalidResponseException()
        }

        val idToken = try {
          GoogleIdTokenCredential.createFrom(credential.data).idToken
        } catch (error: Throwable) {
          throw GoogleCredentialInvalidResponseException(error)
        }
        if (!isCompactJwt(idToken)) throw GoogleCredentialInvalidResponseException()
        mapOf("idToken" to idToken)
      }
    }

    AsyncFunction("clearCredentialState").Coroutine<Boolean> {
      requestMutex.withLock {
        val context = appContext.reactContext
          ?: throw GoogleCredentialActivityUnavailableException()
        try {
          CredentialManager.create(context).clearCredentialState(ClearCredentialStateRequest())
        } catch (error: Throwable) {
          throw GoogleCredentialFailedException(error)
        }
        true
      }
    }
  }

  private fun validateRequest(serverClientId: String, nonce: String) {
    val googleServerClient = Regex("^[0-9]+-[a-z0-9-]+\\.apps\\.googleusercontent\\.com$")
    val safeNonce = Regex("^[A-Za-z0-9_-]{32,128}$")
    if (!googleServerClient.matches(serverClientId) || !safeNonce.matches(nonce)) {
      throw GoogleCredentialInvalidRequestException()
    }
  }

  private fun isCompactJwt(value: String): Boolean {
    if (value.length !in 16..32768 || value.any(Char::isWhitespace)) return false
    val pieces = value.split('.')
    return pieces.size == 3 && pieces.all { it.isNotEmpty() }
  }
}
