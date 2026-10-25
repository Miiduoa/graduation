'use strict';

const crypto = require('node:crypto');
const { initializeApp, cert, deleteApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { verifyRequestFirebaseUser } = require('./sessionSecurity');

function generateServiceAccount() {
  const { privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  });
  return {
    projectId: 'demo-campus-admin14',
    clientEmail: 'firebase-adminsdk-test@demo-campus-admin14.iam.gserviceaccount.com',
    privateKey,
  };
}

function encodeJwtPart(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function forgeUnsignedIdToken(projectId) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'none', typ: 'JWT' };
  const payload = {
    iss: `https://securetoken.google.com/${projectId}`,
    aud: projectId,
    auth_time: now,
    user_id: 'forged-user',
    sub: 'forged-user',
    iat: now,
    exp: now + 3600,
    firebase: { identities: {}, sign_in_provider: 'custom' },
  };
  return `${encodeJwtPart(header)}.${encodeJwtPart(payload)}.`;
}

function forgeSignedIdToken(privateKeyPem, projectId) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT', kid: 'forged-local-key' };
  const payload = {
    iss: `https://securetoken.google.com/${projectId}`,
    aud: projectId,
    auth_time: now,
    user_id: 'forged-user',
    sub: 'forged-user',
    iat: now,
    exp: now + 3600,
    firebase: { identities: {}, sign_in_provider: 'custom' },
  };
  const unsigned = `${encodeJwtPart(header)}.${encodeJwtPart(payload)}`;
  const signature = crypto.sign('sha256', Buffer.from(unsigned), privateKeyPem);
  return `${unsigned}.${signature.toString('base64url')}`;
}

describe('Admin 14 verifyIdToken', () => {
  const previousEmulator = process.env.FIREBASE_AUTH_EMULATOR_HOST;
  let app;
  let auth;
  let serviceAccount;

  beforeAll(() => {
    delete process.env.FIREBASE_AUTH_EMULATOR_HOST;
    serviceAccount = generateServiceAccount();
    app = initializeApp(
      {
        credential: cert({
          projectId: serviceAccount.projectId,
          clientEmail: serviceAccount.clientEmail,
          privateKey: serviceAccount.privateKey,
        }),
        projectId: serviceAccount.projectId,
      },
      'admin14-verify-id-token',
    );
    auth = getAuth(app);
  });

  afterAll(async () => {
    if (previousEmulator === undefined) {
      delete process.env.FIREBASE_AUTH_EMULATOR_HOST;
    } else {
      process.env.FIREBASE_AUTH_EMULATOR_HOST = previousEmulator;
    }
    if (app) await deleteApp(app);
  });

  test('rejects malformed tokens', async () => {
    await expect(auth.verifyIdToken('not-a-jwt')).rejects.toThrow(/id token|Decoding Firebase ID token/i);
    await expect(auth.verifyIdToken('')).rejects.toThrow();
    await expect(auth.verifyIdToken('aaa.bbb.ccc')).rejects.toThrow();
  });

  test('rejects unsigned and locally signed forged ID tokens', async () => {
    const unsigned = forgeUnsignedIdToken(serviceAccount.projectId);
    const signed = forgeSignedIdToken(serviceAccount.privateKey, serviceAccount.projectId);
    await expect(auth.verifyIdToken(unsigned)).rejects.toThrow();
    await expect(auth.verifyIdToken(signed)).rejects.toThrow();
  });

  test('session helper maps Admin 14 rejection to 401', async () => {
    const forged = forgeUnsignedIdToken(serviceAccount.projectId);
    await expect(
      verifyRequestFirebaseUser(
        { headers: { authorization: `Bearer ${forged}` } },
        (token) => auth.verifyIdToken(token),
      ),
    ).rejects.toMatchObject({
      statusCode: 401,
      message: 'Invalid Firebase ID token',
    });
  });
});
