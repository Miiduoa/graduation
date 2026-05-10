const {
  evaluateSsoConfiguration,
  getMissingSsoConfigFields,
  __test,
} = require('./providerRegistry');

const ORIGINAL_ENV = process.env;

function makeUnsignedJwt(payload) {
  return [
    Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url'),
    Buffer.from(JSON.stringify(payload)).toString('base64url'),
    'signature',
  ].join('.');
}

describe('SSO provider registry security', () => {
  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  test('requires OIDC issuer and JWKS metadata in preview/production readiness checks', () => {
    process.env.APP_ENV = 'preview';

    const missingFields = getMissingSsoConfigFields({
      provider: 'oidc',
      clientId: 'client-1',
      clientSecret: 'secret',
      authorizationEndpoint: 'https://idp.example/auth',
      tokenEndpoint: 'https://idp.example/token',
    });

    expect(missingFields).toEqual(['issuer', 'jwksUri']);
    expect(
      evaluateSsoConfiguration({
        setupStatus: 'live',
        ssoConfig: {
          provider: 'oidc',
          enabled: true,
          clientId: 'client-1',
          clientSecret: 'secret',
          authorizationEndpoint: 'https://idp.example/auth',
          tokenEndpoint: 'https://idp.example/token',
        },
      }),
    ).toMatchObject({
      reason: 'incomplete',
      isLoginReady: false,
      missingFields: ['issuer', 'jwksUri'],
    });
  });

  test('keeps local OIDC development fallback but still checks aud, iss, exp, and nonce', async () => {
    process.env.APP_ENV = 'development';
    const now = Math.floor(Date.now() / 1000);
    const ssoConfig = {
      provider: 'oidc',
      clientId: 'client-1',
      issuer: 'https://idp.example',
    };

    await expect(
      __test.verifyOidcIdToken({
        idToken: makeUnsignedJwt({
          sub: 'student-1',
          aud: 'client-1',
          iss: 'https://idp.example',
          exp: now + 60,
          nonce: 'nonce-1',
        }),
        ssoConfig,
        expectedNonce: 'nonce-1',
      }),
    ).resolves.toMatchObject({ sub: 'student-1' });

    await expect(
      __test.verifyOidcIdToken({
        idToken: makeUnsignedJwt({
          sub: 'student-1',
          aud: 'client-1',
          iss: 'https://idp.example',
          exp: now + 60,
          nonce: 'wrong-nonce',
        }),
        ssoConfig,
        expectedNonce: 'nonce-1',
      }),
    ).rejects.toThrow('OIDC nonce validation failed');

    await expect(
      __test.verifyOidcIdToken({
        idToken: makeUnsignedJwt({
          sub: 'student-1',
          aud: 'client-1',
          iss: 'https://idp.example',
          nonce: 'nonce-1',
        }),
        ssoConfig,
        expectedNonce: 'nonce-1',
      }),
    ).rejects.toThrow('OIDC id_token exp is required');
  });
});
