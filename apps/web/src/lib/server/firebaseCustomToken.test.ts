import { createVerify, generateKeyPairSync } from 'node:crypto';
import { expect, it } from 'vitest';
import { decodeFirebaseCustomTokenPayload, signFirebaseCustomToken } from './firebaseCustomToken';

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
    aud: 'https://identitytoolkit.googleapis.com/google.identity.signin',
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
