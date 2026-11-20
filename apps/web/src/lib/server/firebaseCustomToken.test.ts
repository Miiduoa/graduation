import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createVerify, generateKeyPairSync } from 'node:crypto';
import { expect, it } from 'vitest';
import {
  FIREBASE_CUSTOM_TOKEN_AUDIENCE,
  decodeFirebaseCustomTokenPayload,
  signFirebaseCustomToken,
} from './firebaseCustomToken';

function testAccount() {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  return {
    account: {
      client_email: 'firebase-adminsdk@campus-one-tw.iam.gserviceaccount.com',
      private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
      private_key_id: 'test-key',
    },
    publicKey,
  };
}

function decodeJwtHeader(token: string): Record<string, unknown> {
  const [header] = token.split('.');
  if (!header) throw new Error('invalid-token');
  return JSON.parse(Buffer.from(header, 'base64url').toString('utf8')) as Record<string, unknown>;
}

function firebaseAdminCustomTokenAudience(): string {
  const adminMain = createRequire(import.meta.url).resolve('firebase-admin');
  const source = readFileSync(join(dirname(adminMain), 'auth/token-generator.js'), 'utf8');
  const match = source.match(/FIREBASE_AUDIENCE = '([^']+)'/);
  if (!match?.[1]) throw new Error('missing-admin-audience');
  return match[1];
}

it('signs a custom token locally with school claims', () => {
  const { account, publicKey } = testAccount();
  const token = signFirebaseCustomToken(account, 'pu-1110700321', {
    schoolId: 'pu',
    role: 'student',
  }, 1_700_000_000);
  const payload = decodeFirebaseCustomTokenPayload(token);
  expect(payload).toMatchObject({
    iss: account.client_email,
    sub: account.client_email,
    aud: FIREBASE_CUSTOM_TOKEN_AUDIENCE,
    uid: 'pu-1110700321',
    claims: { schoolId: 'pu', role: 'student' },
    iat: 1_700_000_000,
    exp: 1_700_003_600,
  });
  const [header, body, signature] = token.split('.');
  const verifier = createVerify('RSA-SHA256');
  verifier.update(`${header}.${body}`);
  verifier.end();
  expect(verifier.verify(publicKey, signature, 'base64url')).toBe(true);
});

it('uses the same custom-token audience as firebase-admin', () => {
  const { account } = testAccount();
  const token = signFirebaseCustomToken(account, 'pu-1110700321');
  const adminAudience = firebaseAdminCustomTokenAudience();
  expect(adminAudience).toBe(
    'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit',
  );
  expect(FIREBASE_CUSTOM_TOKEN_AUDIENCE).toBe(adminAudience);
  expect(decodeFirebaseCustomTokenPayload(token).aud).toBe(adminAudience);
});

it('matches Firebase custom token header and registered claims', () => {
  const { account } = testAccount();
  const issuedAt = 1_700_000_000;
  const token = signFirebaseCustomToken(account, 'pu-1110700321', { schoolId: 'pu' }, issuedAt);
  const header = decodeJwtHeader(token);
  const payload = decodeFirebaseCustomTokenPayload(token);
  expect(header).toMatchObject({ alg: 'RS256', typ: 'JWT', kid: 'test-key' });
  expect(payload.iss).toBe(account.client_email);
  expect(payload.sub).toBe(account.client_email);
  expect(payload.uid).toBe('pu-1110700321');
  expect(payload.iat).toBe(issuedAt);
  expect(payload.exp).toBe(issuedAt + 3600);
  expect(Number(payload.exp) - Number(payload.iat)).toBeLessThanOrEqual(3600);
});

it('keeps teacher claims in the token payload', () => {
  const { account } = testAccount();
  const token = signFirebaseCustomToken(account, 'pu-t-changyi', {
    schoolId: 'pu',
    role: 'teacher',
  });
  expect(decodeFirebaseCustomTokenPayload(token).claims).toEqual({
    schoolId: 'pu',
    role: 'teacher',
  });
});
