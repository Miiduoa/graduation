import CoreNFC
import ExpoModulesCore
import UIKit

public class CampusStudentCardNfcModule: Module {
  private let owner = UUID()
  private let lifetime = NfcModuleLifetime()

  public func definition() -> ModuleDefinition {
    Name("CampusStudentCardNfc")
    Events("onPresentationEnded")

    AsyncFunction("getCapabilities") { () -> [String: Bool] in
      let available = StudentCardNfcReader.available
      return ["canRead": available, "canPresent": false, "enabled": available]
    }.runOnQueue(.main)

    AsyncFunction("beginPresentation") { (_: String, _: Double, _: String, promise: Promise) in
      promise.reject("ERR_NFC_UNAVAILABLE", "Contactless presentation is unavailable on this device.")
    }.runOnQueue(.main)

    AsyncFunction("endPresentation") { }.runOnQueue(.main)

    AsyncFunction("readPresentation") { (promise: Promise) in
      guard self.lifetime.isAlive else {
        promise.reject("ERR_NFC_UNAVAILABLE", "NFC is unavailable.")
        return
      }
      StudentCardNfcReader.shared.read(owner: self.owner, promise: promise)
    }.runOnQueue(.main)

    AsyncFunction("cancelRead") {
      StudentCardNfcReader.shared.cancel(owner: self.owner)
    }.runOnQueue(.main)

    OnAppEntersBackground {
      let owner = self.owner
      DispatchQueue.main.async { StudentCardNfcReader.shared.cancel(owner: owner) }
    }
    OnDestroy { self.destroy() }
    OnAppContextDestroys { self.destroy() }
  }

  private func destroy() {
    lifetime.invalidate()
    let owner = self.owner
    DispatchQueue.main.async { StudentCardNfcReader.shared.cancel(owner: owner) }
  }
}

private final class NfcModuleLifetime {
  private let lock = NSLock()
  private var alive = true

  var isAlive: Bool {
    lock.lock()
    defer { lock.unlock() }
    return alive
  }

  func invalidate() {
    lock.lock()
    alive = false
    lock.unlock()
  }
}

private final class StudentCardNfcReader: NSObject, NFCTagReaderSessionDelegate {
  static let shared = StudentCardNfcReader()
  private static let aid = "F04E554E490101"
  private var owner: UUID?
  private var session: NFCTagReaderSession?
  private var pending: Promise?
  private var connecting = false
  private var deadline: TimeInterval = 0
  private var timeout: DispatchWorkItem?
  private var observers: [NSObjectProtocol] = []

  static var available: Bool {
    let identifiers = Bundle.main.object(
      forInfoDictionaryKey: "com.apple.developer.nfc.readersession.iso7816.select-identifiers"
    ) as? [String] ?? []
    let usage = Bundle.main.object(forInfoDictionaryKey: "NFCReaderUsageDescription") as? String ?? ""
    return NFCTagReaderSession.readingAvailable &&
      identifiers.contains { $0.uppercased() == aid } &&
      !usage.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
  }

  func read(owner: UUID, promise: Promise) {
    guard Self.available, UIApplication.shared.applicationState == .active,
          UIApplication.shared.isProtectedDataAvailable else {
      promise.reject("ERR_NFC_UNAVAILABLE", "NFC is unavailable.")
      return
    }
    guard session == nil else {
      promise.reject("ERR_NFC_BUSY", "An NFC operation is already in progress.")
      return
    }
    guard let reader = NFCTagReaderSession(pollingOption: .iso14443, delegate: self, queue: .main) else {
      promise.reject("ERR_NFC_UNAVAILABLE", "NFC is unavailable.")
      return
    }
    self.owner = owner
    session = reader
    pending = promise
    connecting = false
    deadline = ProcessInfo.processInfo.systemUptime + 20
    reader.alertMessage = "請將 iPhone 頂端靠近對方已開啟感應出示的 Android 手機。"
    for name in [UIApplication.didEnterBackgroundNotification,
                 UIApplication.protectedDataWillBecomeUnavailableNotification] {
      observers.append(NotificationCenter.default.addObserver(
        forName: name, object: nil, queue: .main
      ) { [weak self, weak reader] _ in
        guard let self, let reader else { return }
        self.finish(reader, code: "ERR_NFC_CANCELLED")
      })
    }
    let timer = DispatchWorkItem { [weak self, weak reader] in
      guard let self, let reader else { return }
      self.finish(reader, code: "ERR_NFC_READ_FAILED")
    }
    timeout = timer
    DispatchQueue.main.asyncAfter(deadline: .now() + 20, execute: timer)
    reader.begin()
  }

  func cancel(owner: UUID) {
    guard self.owner == owner, let session else { return }
    finish(session, code: "ERR_NFC_CANCELLED")
  }

  func tagReaderSessionDidBecomeActive(_ session: NFCTagReaderSession) { }

  func tagReaderSession(_ session: NFCTagReaderSession, didInvalidateWithError error: Error) {
    guard self.session === session else { return }
    let code: String
    if let readerError = error as? NFCReaderError,
       readerError.code == .readerSessionInvalidationErrorUserCanceled {
      code = "ERR_NFC_CANCELLED"
    } else if let readerError = error as? NFCReaderError,
              readerError.code == .readerErrorSecurityViolation ||
              readerError.code == .readerErrorUnsupportedFeature {
      code = "ERR_NFC_UNAVAILABLE"
    } else {
      code = "ERR_NFC_READ_FAILED"
    }
    finish(session, code: code, invalidate: false)
  }

  func tagReaderSession(_ session: NFCTagReaderSession, didDetect tags: [NFCTag]) {
    guard usable(session), !connecting else { return }
    guard tags.count == 1, case .iso7816(let card) = tags[0],
          card.initialSelectedAID.uppercased() == Self.aid else {
      finish(session, code: "ERR_NFC_INVALID")
      return
    }
    connecting = true
    session.connect(to: tags[0]) { [weak self] error in
      DispatchQueue.main.async {
        guard let self, self.usable(session) else { return }
        guard error == nil else {
          self.finish(session, code: "ERR_NFC_READ_FAILED")
          return
        }
        let command = NFCISO7816APDU(
          instructionClass: 0x00, instructionCode: 0xCA,
          p1Parameter: 0x00, p2Parameter: 0x00, data: Data(), expectedResponseLength: 32
        )
        card.sendCommand(apdu: command) { [weak self] data, sw1, sw2, error in
          DispatchQueue.main.async {
            guard let self, self.usable(session) else { return }
            guard error == nil, sw1 == 0x90, sw2 == 0x00 else {
              self.finish(session, code: "ERR_NFC_READ_FAILED")
              return
            }
            guard data.count == 32, let token = String(data: data, encoding: .ascii),
                  token.range(of: "^[A-Za-z0-9_-]{32}$", options: .regularExpression) != nil else {
              self.finish(session, code: "ERR_NFC_INVALID")
              return
            }
            session.alertMessage = "憑證已讀取，請回到 nuni 確認核對。"
            self.finish(session, token: token)
          }
        }
      }
    }
  }

  private func usable(_ session: NFCTagReaderSession) -> Bool {
    guard self.session === session, pending != nil else { return false }
    // The system NFC sheet may temporarily make the foreground app inactive.
    guard UIApplication.shared.applicationState != .background,
          UIApplication.shared.isProtectedDataAvailable else {
      finish(session, code: "ERR_NFC_CANCELLED")
      return false
    }
    guard ProcessInfo.processInfo.systemUptime < deadline else {
      finish(session, code: "ERR_NFC_READ_FAILED")
      return false
    }
    return true
  }

  private func finish(
    _ session: NFCTagReaderSession, token: String? = nil,
    code: String = "ERR_NFC_READ_FAILED", invalidate: Bool = true
  ) {
    guard self.session === session else { return }
    let promise = pending
    pending = nil
    timeout?.cancel()
    timeout = nil
    observers.forEach(NotificationCenter.default.removeObserver)
    observers.removeAll()
    connecting = false
    if invalidate {
      // Keep the session BUSY until Core NFC confirms invalidation.
      if promise != nil { session.invalidate() }
    } else {
      self.session = nil
      owner = nil
      deadline = 0
    }
    if let token { promise?.resolve(token) }
    else { promise?.reject(code, "NFC operation did not complete.") }
  }
}
