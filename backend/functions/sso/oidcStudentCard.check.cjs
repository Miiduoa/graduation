const assert = require('node:assert/strict');
const { test } = require('node:test');
const { __test } = require('./providerRegistry');

test('verifies the issuing school and reads only its explicit student_id', async (t) => {
  const { generateKeyPair, exportJWK, SignJWT } = await import('jose');
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const issuer = 'https://identity.example.edu.tw';
  const ssoConfig = { issuer, jwksUri: issuer + '/keys', clientId: 'campus-one' };
  const jwk = { ...(await exportJWK(publicKey)), kid: 'school-key', alg: 'RS256' };
  t.mock.method(globalThis, 'fetch', async () => globalThis.Response.json({ keys: [jwk] }));

  async function verify(attributes) {
    const idToken = await new SignJWT({ iss: issuer, nonce: 'fresh', ...attributes })
      .setProtectedHeader({ kid: jwk.kid, alg: 'RS256' })
      .setSubject('user')
      .setAudience(ssoConfig.clientId)
      .setExpirationTime('1m')
      .sign(privateKey);
    return __test.verifyOidcIdToken({ idToken, ssoConfig, expectedNonce: 'fresh' });
  }

  assert.equal(
    (await verify({ student_id: 'S00123', employee_id: 'E999' })).campusCardStudentId,
    'S00123',
  );
  assert.equal(
    (await verify({ employee_id: 'E999', campusCardStudentId: 'forged' })).campusCardStudentId,
    undefined,
  );
  await assert.rejects(
    verify({ student_id: 'S00123', iss: 'https://other.example.edu.tw' }),
    /iss/,
  );
});
