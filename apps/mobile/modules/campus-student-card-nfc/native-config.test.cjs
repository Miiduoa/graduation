/* global require, __dirname */
/* eslint-disable @typescript-eslint/no-require-imports -- Node test runner loads CommonJS tooling. */
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { createRequire } = require('node:module');
const { test } = require('node:test');

const appRoot = resolve(__dirname, '../..');
const appRequire = createRequire(resolve(appRoot, 'package.json'));
const expoRequire = createRequire(appRequire.resolve('expo/package.json'));
const pluginRequire = createRequire(expoRequire.resolve('@expo/config-plugins'));
const plistModule = pluginRequire('@expo/plist');
const plist = plistModule.default ?? plistModule;
const read = (file) => readFileSync(resolve(__dirname, file), 'utf8');
const readApp = (file) => readFileSync(resolve(appRoot, file), 'utf8');
const aid = 'F04E554E490101';
const kotlin = read('android/src/main/java/app/campus/studentcardnfc/StudentCardProtocol.kt');
const session = read('android/src/main/java/app/campus/studentcardnfc/StudentCardNfcSession.kt');
const android = read('android/src/main/java/app/campus/studentcardnfc/CampusStudentCardNfcModule.kt');
const swift = read('ios/CampusStudentCardNfcModule.swift');
const manifest = read('android/src/main/AndroidManifest.xml');

test('the private application identifier agrees across both native platforms and app configuration', () => {
  assert.match(aid, /^F[0-9A-F]{11,31}$/);
  assert.equal(aid.length % 2, 0);
  assert.ok(kotlin.includes(`AID_HEX = "${aid}"`));
  assert.ok(swift.includes(`let aid = "${aid}"`));
  const apdu = read('android/src/main/res/xml/campus_student_card_apdu.xml');
  assert.match(apdu, new RegExp(`<aid-filter android:name="${aid}"`));
  assert.equal((apdu.match(/<aid-filter /g) || []).length, 1);
  const info = plist.parse(readApp('ios/mobile/Info.plist'));
  assert.deepEqual(info['com.apple.developer.nfc.readersession.iso7816.select-identifiers'], [aid]);
  assert.ok(readApp('app.config.ts').includes(`'com.apple.developer.nfc.readersession.iso7816.select-identifiers': ['${aid}']`));
});

test('native entry points expose the same five methods', () => {
  const methods = (source) => [...source.matchAll(/AsyncFunction\("([^"]+)"\)/g)].map((match) => match[1]).sort();
  const expected = ['beginPresentation', 'cancelRead', 'endPresentation', 'getCapabilities', 'readPresentation'];
  assert.deepEqual(methods(android), expected);
  assert.deepEqual(methods(swift), expected);
  assert.ok(android.includes('Name("CampusStudentCardNfc")'));
  assert.ok(swift.includes('Name("CampusStudentCardNfc")'));
});

test('Android NFC watches the focused app-owned Modal and clears on focus loss or detachment', () => {
  assert.match(session, /view is ReactModalHostView && \(view\.context as\? ReactContext\)\?\.currentActivity === target/);
  assert.match(session, /dialog != null && dialog\.isShowing/);
  assert.match(session, /dialog\.window\?\.decorView\?\.let\(windows::add\)/);
  assert.match(session, /if \(windows\.isEmpty\(\)\) windows\.add\(root\)/);
  assert.match(session, /windows\.firstOrNull \{ it\.isAttachedToWindow && it\.hasWindowFocus\(\) \}/);
  assert.match(session, /watchedView = focusedWindow\(target\) \?: throw failure\("UNAVAILABLE"\)/);
  assert.match(session, /val window = watchedView \?: focusedWindow\(target\) \?: return false/);
  assert.match(session, /return window\.isAttachedToWindow && window\.hasWindowFocus\(\)/);
  assert.match(session, /if \(!focused\) stopActive\("CANCELLED"\)/);
  assert.match(session, /if \(watchedView === view\) stopActive\("CANCELLED"\)/);
  assert.match(session, /addOnWindowFocusChangeListener\(focusListener\)/);
  assert.match(session, /removeOnWindowFocusChangeListener\(focusListener\)/);
  assert.match(session, /addOnAttachStateChangeListener\(attachListener\)/);
  assert.match(session, /removeOnAttachStateChangeListener\(attachListener\)/);
  assert.doesNotMatch(session, /target\.hasWindowFocus\(\)/);
});

test('native presentation end events carry the local session id after ownership is cleared', () => {
  assert.match(android, /Events\("onPresentationEnded"\)/);
  assert.match(swift, /Events\("onPresentationEnded"\)/);
  assert.match(android, /expiresAt: Double, presentationId: String/);
  assert.match(android, /sendEvent\("onPresentationEnded", mapOf\("presentationId" to endedId\)\)/);
  assert.match(session, /presentationEnded = \{ onEnded\(presentationId\) \}/);
  assert.ok(session.indexOf('if (!protocol.isArmed()) throw failure("EXPIRED")') <
    session.indexOf('presentationEnded = { onEnded(presentationId) }'));
  const release = session.slice(session.indexOf('private fun release()'));
  assert.ok(release.indexOf('presentationEnded = null') < release.indexOf('notifyPresentationEnded?.invoke()'));
  assert.ok(release.indexOf('owner = null') < release.indexOf('notifyPresentationEnded?.invoke()'));
});

test('Android hardware remains optional and the HCE service requires the system binding permission', () => {
  assert.match(manifest, /<uses-permission android:name="android\.permission\.NFC"/);
  for (const feature of ['android.hardware.nfc', 'android.hardware.nfc.hce']) {
    assert.ok(manifest.includes(`android:name="${feature}" android:required="false"`));
  }
  assert.match(manifest, /android:permission="android\.permission\.BIND_NFC_SERVICE"/);
  assert.match(manifest, /android\.nfc\.cardemulation\.action\.HOST_APDU_SERVICE/);
  assert.match(manifest, /@xml\/campus_student_card_apdu/);
  const apdu = read('android/src/main/res/xml/campus_student_card_apdu.xml');
  assert.match(apdu, /android:requireDeviceUnlock="true"/);
  assert.match(apdu, /android:requireDeviceScreenOn="true"/);
  assert.match(apdu, /android:category="other"/);
});

test('iOS includes the reader capability and a user-facing usage explanation', () => {
  const info = plist.parse(readApp('ios/mobile/Info.plist'));
  const entitlements = plist.parse(readApp('ios/mobile/mobile.entitlements'));
  assert.ok(info.NFCReaderUsageDescription.trim().length > 0);
  assert.deepEqual(entitlements['com.apple.developer.nfc.readersession.formats'], ['TAG']);
  assert.ok(readApp('app.config.ts').includes("'com.apple.developer.nfc.readersession.formats': ['TAG']"));
  assert.match(read('ios/CampusStudentCardNfc.podspec'), /s\.frameworks = 'CoreNFC'/);
  assert.match(swift, /"canPresent": false/);
});

test('the new native runtime is synchronized with tracked iOS and production preparation', () => {
  const production = require('../../scripts/prepare-native-release.cjs').production;
  const updates = plist.parse(readApp('ios/mobile/Supporting/Expo.plist'));
  const preview = 'campus-preview-native-photo-pdf-widget-live-nfc-3';
  assert.equal(production.runtimeVersion, 'campus-one-native-photo-pdf-widget-live-nfc-3');
  assert.equal(updates.EXUpdatesRuntimeVersion, preview);
  assert.ok(readApp('app.config.ts').includes(`'${production.runtimeVersion}'`));
  assert.ok(readApp('app.config.ts').includes(`'${preview}'`));
});

test('Expo autolinking names the implemented Android and iOS modules', () => {
  const config = JSON.parse(read('expo-module.config.json'));
  assert.deepEqual(config.platforms, ['ios', 'android']);
  assert.deepEqual(config.ios.modules, ['CampusStudentCardNfcModule']);
  assert.deepEqual(config.android.modules, ['app.campus.studentcardnfc.CampusStudentCardNfcModule']);
  assert.match(read('android/build.gradle'), /namespace 'app\.campus\.studentcardnfc'/);
});
