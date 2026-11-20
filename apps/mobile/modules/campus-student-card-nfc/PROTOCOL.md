# Student-card NFC transport

This module exchanges a short-lived nuni student-card token through a private ISO 7816 application. The receiving app redeems the token through the student-card verification API and shows the server result.

## Device roles

- Android devices with NFC and host card emulation can present a token while the app is visible and the device is unlocked.
- Android NFC devices and iPhones with Core NFC can actively read a presentation.
- iPhone presentation requires a separate issuer integration and Apple NFC & SE Platform entitlement.
- Campus doors, library systems, and issuer-managed wallets require their operator's reader protocol and credentials.

## Application identifier

`F04E554E490101` is a seven-byte, unregistered, proprietary application identifier for this project. Its first byte uses the private `F` prefix. Deployments with managed reader infrastructure should coordinate identifiers with the operator.

## Commands

| Operation          | Command                                  | Successful response                      |
| ------------------ | ---------------------------------------- | ---------------------------------------- |
| Select application | `00 A4 04 00 07 F0 4E 55 4E 49 01 01 00` | `90 00`                                  |
| Read token         | `00 CA 00 00 20`                         | 32 ASCII token bytes followed by `90 00` |

SELECT accepts P2 values `00`, `04`, `08`, and `0C`, with an optional one-byte Le. This accommodates the automatic SELECT issued by Core NFC. READ requires a successful SELECT during the current RF connection.

Token bytes use the alphabet `A–Z`, `a–z`, `0–9`, `_`, and `-`. iOS returns the response body separately from SW1 and SW2. Android includes both status bytes in the received array.

| Status  | Meaning                                                              |
| ------- | -------------------------------------------------------------------- |
| `69 85` | Presentation unavailable, expired, or application selection required |
| `67 00` | Incorrect command length                                             |
| `6A 82` | Unknown application                                                  |
| `6A 86` | Unsupported command parameters                                       |
| `6D 00` | Unsupported instruction                                              |
| `6E 00` | Unsupported instruction class                                        |

## Lifetime

The presentation token lives only in process memory. Android caps its lifetime at 60 seconds using elapsed real time. Backgrounding, focus loss, device lock, NFC shutdown, and module destruction clear the token and foreground service preference. An RF disconnect resets application selection and permits another attempt within the remaining lifetime.

Android binds each operation to its focused Activity or app-owned React Native Modal window. A showing Modal must acquire focus before NFC starts. Losing that window's focus or attachment ends the operation. After a successful presentation starts, `onPresentationEnded` reports its local `presentationId` once when native state is cleared. The ID lets the UI ignore an earlier presentation's event.

Read and presentation modes share one native owner. Reads time out after 20 seconds. Cancellation settles the pending promise, and session identity checks reject late completion from an earlier attempt. iOS keeps a closing reader session busy until Core NFC reports invalidation. A temporary inactive state caused by system UI is accepted while an iOS read is in progress. Backgrounding and protected-data unavailability cancel it.

The transport carries an opaque bearer token. Server expiry, current membership checks, and atomic single-use redemption determine the verification result.

## Validation

From the repository root, run `node --test apps/mobile/modules/campus-student-card-nfc/native-config.test.cjs` for cross-platform configuration checks.

After Android prebuild, run `./gradlew :campus-student-card-nfc:compileDebugKotlin :campus-student-card-nfc:testDebugUnitTest` from `apps/mobile/android`. `StudentCardProtocolTest` exercises the actual Kotlin protocol with an injected clock.

Build iOS with Xcode or the repository's native CI. Test Android-to-Android and Android-to-iPhone on physical NFC devices, including cancellation, backgrounding, device lock, NFC disabled, expiry, and repeated server redemption.

## Platform references

- [Android host card emulation](https://developer.android.com/develop/connectivity/nfc/hce)
- [Android HostApduService and private AIDs](https://developer.android.com/reference/android/nfc/cardemulation/HostApduService)
- [Android NFC reader mode](<https://developer.android.com/reference/android/nfc/NfcAdapter#enableReaderMode(android.app.Activity,android.nfc.NfcAdapter.ReaderCallback,int,android.os.Bundle)>)
- [Apple NFCTagReaderSession](https://developer.apple.com/documentation/corenfc/nfctagreadersession)
- [Apple NFC & SE Platform](https://developer.apple.com/support/nfc-se-platform/)
