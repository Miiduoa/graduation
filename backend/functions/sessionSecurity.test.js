const {
  assertSessionOwner,
  getBearerToken,
  isLocalMockAuthAllowed,
  verifyRequestFirebaseUser,
} = require('./sessionSecurity');

const ORIGINAL_ENV = process.env;

describe('session security helpers', () => {
  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  test('extracts bearer tokens from request headers', () => {
    expect(getBearerToken({ headers: { authorization: 'Bearer token-123' } })).toBe('token-123');
    expect(getBearerToken({ get: () => 'bearer token-456' })).toBe('token-456');
    expect(getBearerToken({ headers: { authorization: 'Basic abc' } })).toBeNull();
  });

  test('verifies Firebase ID tokens from Authorization', async () => {
    const verifyIdToken = jest.fn(async (token) => ({ uid: `uid-for-${token}` }));

    await expect(
      verifyRequestFirebaseUser({ headers: { authorization: 'Bearer firebase-token' } }, verifyIdToken),
    ).resolves.toEqual({ uid: 'uid-for-firebase-token' });
    expect(verifyIdToken).toHaveBeenCalledWith('firebase-token');
  });

  test('rejects missing or invalid Firebase ID tokens', async () => {
    await expect(verifyRequestFirebaseUser({ headers: {} }, jest.fn())).rejects.toMatchObject({
      statusCode: 401,
      message: 'Missing Firebase ID token',
    });

    await expect(
      verifyRequestFirebaseUser(
        { headers: { authorization: 'Bearer bad-token' } },
        jest.fn(async () => {
          throw new Error('bad token');
        }),
      ),
    ).rejects.toMatchObject({
      statusCode: 401,
      message: 'Invalid Firebase ID token',
    });
  });

  test('requires owner-bound sessions outside explicit local mock development', () => {
    process.env.APP_ENV = 'preview';
    process.env.ALLOW_LOCAL_MOCK_AUTH = 'true';

    expect(() => assertSessionOwner({ ownerUid: 'user-1' }, 'user-1')).not.toThrow();
    expect(() => assertSessionOwner({ ownerUid: 'user-2' }, 'user-1')).toThrow(
      'Session does not belong to the authenticated user',
    );
    expect(() => assertSessionOwner({ ownerUid: null }, 'user-1')).toThrow(
      'Session is missing owner binding',
    );
  });

  test('allows ownerless sessions only in local mock development', () => {
    process.env.APP_ENV = 'development';
    process.env.ALLOW_LOCAL_MOCK_AUTH = 'true';

    expect(isLocalMockAuthAllowed()).toBe(true);
    expect(() => assertSessionOwner({ ownerUid: null }, 'user-1')).not.toThrow();
  });
});
