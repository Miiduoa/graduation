const test = require('node:test');
const assert = require('node:assert/strict');
const { googleIosInfoPlist, checkGoogleIosInfoPlist } = require('./configure-nuni-google.cjs');

const client = '123456-iosclient.apps.googleusercontent.com';
const reversed = 'com.googleusercontent.apps.123456-iosclient';

test('adds the iOS callback while preserving bundle, campus links and other properties', () => {
  const original = {
    CFBundleIdentifier: 'com.example.existing',
    CFBundleURLTypes: [{ CFBundleURLName: 'campus', CFBundleURLSchemes: ['campus', 'existing'] }],
    NSCameraUsageDescription: 'camera',
  };
  const value = googleIosInfoPlist(original, client);
  assert.equal(value.CFBundleIdentifier, original.CFBundleIdentifier);
  assert.equal(value.NSCameraUsageDescription, 'camera');
  assert.deepEqual(value.CFBundleURLTypes[0], original.CFBundleURLTypes[0]);
  assert.deepEqual(value.CFBundleURLTypes[1], { CFBundleURLSchemes: [reversed] });
  assert.equal(value.GIDClientID, client);
  assert.equal(checkGoogleIosInfoPlist(value, client), true);
  assert.equal(original.GIDClientID, undefined);
  assert.deepEqual(googleIosInfoPlist(value, client), value);
});

test('replaces only the previously registered Google callback', () => {
  const value = googleIosInfoPlist(
    {
      GIDClientID: '123456-old.apps.googleusercontent.com',
      CFBundleURLTypes: [
        { CFBundleURLSchemes: ['campus', 'com.googleusercontent.apps.123456-old'] },
      ],
    },
    client,
  );
  assert.deepEqual(value.CFBundleURLTypes, [
    { CFBundleURLSchemes: ['campus'] },
    { CFBundleURLSchemes: [reversed] },
  ]);
});

test('check never pretends missing or mismatched configuration is available', () => {
  assert.equal(checkGoogleIosInfoPlist({}, ''), false);
  assert.throws(() => checkGoogleIosInfoPlist({ GIDClientID: client }, ''), /no matching/);
  assert.throws(() => checkGoogleIosInfoPlist({}, client), /differs/);
  assert.throws(() => checkGoogleIosInfoPlist({ GIDClientID: client }, client), /differs/);
  assert.throws(() => googleIosInfoPlist({}, 'https://wrong.example.com'), /registered Google iOS/);
});
