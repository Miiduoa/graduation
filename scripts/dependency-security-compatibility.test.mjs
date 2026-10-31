import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { URL } from 'node:url';
import { test } from 'node:test';
import { createRequire } from 'node:module';

// Resolve through Expo so these checks exercise the same dependencies as mobile builds.
const mobileRequire = createRequire(new URL('../apps/mobile/package.json', import.meta.url));
const { getAssetData, getAssetSize } = mobileRequire('@expo/metro/metro/Assets');
const signing = mobileRequire('@expo/code-signing-certificates');

test('Metro parses image buffers and scaled files after removing image-size', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'metro-security-assets-'));
  try {
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="32"></svg>',
    );
    assert.deepEqual(getAssetSize('svg', svg, 'icon.svg'), { width: 48, height: 32 });
    const filename = path.join(directory, 'icon@2x.svg');
    await writeFile(filename, svg);
    const data = await getAssetData(filename, 'assets/icon@2x.svg', [], 'ios', '/assets');
    assert.equal(data.width, 24);
    assert.equal(data.height, 16);
    assert.deepEqual(data.scales, [2]);
    assert.deepEqual(data.files, [filename]);
    assert.throws(() => getAssetSize('png', Buffer.alloc(0), 'empty.png'), /empty file/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('Expo signing supports certificate and PEM round trips with upgraded node-forge', () => {
  // Ephemeral test material stays in memory and never uses an existing credential.
  const keys = signing.generateKeyPair();
  const roundTripKeys = signing.convertKeyPairPEMToKeyPair(signing.convertKeyPairToPEM(keys));
  const certificate = signing.generateSelfSignedCodeSigningCertificate({
    keyPair: roundTripKeys,
    validityNotBefore: new Date(Date.now() - 60_000),
    validityNotAfter: new Date(Date.now() + 3_600_000),
    commonName: 'dependency-compatibility-test',
  });
  const parsed = signing.convertCertificatePEMToCertificate(
    signing.convertCertificateToCertificatePEM(certificate),
  );
  signing.validateSelfSignedCertificate(parsed, roundTripKeys);
  const signature = signing.signBufferRSASHA256AndVerify(
    roundTripKeys.privateKey,
    parsed,
    Buffer.from('local compatibility check'),
  );
  assert.ok(Buffer.from(signature, 'base64').length > 0);
  const csr = signing.convertCSRPEMToCSR(
    signing.convertCSRToCSRPEM(signing.generateCSR(roundTripKeys, 'dependency-compatibility-test')),
  );
  assert.equal(csr.verify(), true);
});
