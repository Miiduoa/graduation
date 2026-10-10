jest.mock('expo', () => ({ requireOptionalNativeModule: jest.fn(() => null) }));

import { createNuniGoogleClient, type NuniGoogleNativeAdapter } from '../../services/nuniGoogle';

const clientId = '123456-testserver.apps.googleusercontent.com';
const nonce = 'a'.repeat(43);
const idToken = 'header.payload.signature';

function setup(platform = 'ios', configured = true) {
  const adapter: NuniGoogleNativeAdapter = {
    isConfigured: jest.fn(() => configured),
    getIdToken: jest.fn(async () => ({ idToken })),
    clearCredentialState: jest.fn(async () => true),
  };
  return { adapter, client: createNuniGoogleClient(adapter, platform) };
}

describe('Nuni native Google credentials', () => {
  it('passes the API audience and fresh transaction nonce unchanged', async () => {
    const { client, adapter } = setup();
    await expect(client.getIdToken({ clientId, nonce })).resolves.toEqual({
      kind: 'success',
      idToken,
    });
    expect(adapter.getIdToken).toHaveBeenCalledWith(clientId, nonce);
  });

  it('does not advertise unavailable native builds, unsupported platforms or missing iOS callbacks', async () => {
    expect(createNuniGoogleClient(null, 'ios').capability()).toEqual({
      available: false,
      reason: 'native-module-unavailable',
    });
    const { client, adapter } = setup('ios', false);
    expect(client.capability()).toEqual({ available: false, reason: 'ios-not-configured' });
    await expect(client.request(clientId, nonce)).rejects.toMatchObject({ code: 'NOT_CONFIGURED' });
    expect(adapter.getIdToken).not.toHaveBeenCalled();
    expect(setup('web').client.capability()).toEqual({
      available: false,
      reason: 'unsupported-platform',
    });
  });

  it.each(['GOOGLE_CREDENTIAL_CANCELLED', 'ERR_GOOGLE_CREDENTIAL_CANCELLED'])(
    'treats %s as cancellation and permits a new attempt',
    async (code) => {
      const { client, adapter } = setup('android');
      (adapter.getIdToken as jest.Mock).mockRejectedValueOnce({
        code,
        message: 'provider details',
      });
      await expect(client.getIdToken({ clientId, nonce })).resolves.toEqual({ kind: 'cancelled' });
      await expect(client.request(clientId, nonce)).resolves.toBe(idToken);
    },
  );

  it.each([
    ['wrong-audience', nonce],
    [clientId, 'short'],
    [clientId, 'a'.repeat(129)],
    [clientId, `${nonce} `],
  ])('rejects invalid audience/nonce before opening the provider', async (audience, challenge) => {
    const { client, adapter } = setup();
    await expect(client.request(audience, challenge)).rejects.toMatchObject({
      code: 'INVALID_REQUEST',
    });
    expect(adapter.getIdToken).not.toHaveBeenCalled();
  });

  it.each([null, '', 'token-without-segments', 'a.b.c secret', 'a'.repeat(32769)])(
    'rejects malformed native output',
    async (token) => {
      const { client, adapter } = setup();
      (adapter.getIdToken as jest.Mock).mockResolvedValue({ idToken: token });
      await expect(client.request(clientId, nonce)).rejects.toMatchObject({
        code: 'INVALID_RESPONSE',
      });
    },
  );

  it('does not leak native account details and releases the attempt after failure', async () => {
    const { client, adapter } = setup();
    (adapter.getIdToken as jest.Mock).mockRejectedValueOnce(
      new Error('private@example.com secret'),
    );
    await expect(client.request(clientId, nonce)).rejects.toMatchObject({
      code: 'FAILED',
      message: 'Google 登入沒有完成，請稍後再試。',
    });
    await expect(client.request(clientId, nonce)).resolves.toBe(idToken);
  });

  it('serializes sign-in and credential cleanup so an old account cannot overwrite an active attempt', async () => {
    const { client, adapter } = setup();
    let resolve!: (value: { idToken: string }) => void;
    (adapter.getIdToken as jest.Mock).mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const pending = client.request(clientId, nonce);
    await expect(client.request(clientId, nonce)).rejects.toMatchObject({ code: 'BUSY' });
    await expect(client.clearCredentialState()).rejects.toMatchObject({ code: 'BUSY' });
    expect(adapter.getIdToken).toHaveBeenCalledTimes(1);
    expect(adapter.clearCredentialState).not.toHaveBeenCalled();
    resolve({ idToken });
    await pending;
    await client.clearCredentialState();
    expect(adapter.clearCredentialState).toHaveBeenCalledTimes(1);
  });

  it('does not claim credential cleanup succeeded when the SDK failed', async () => {
    const { client, adapter } = setup();
    (adapter.clearCredentialState as jest.Mock).mockResolvedValue(false);
    await expect(client.clearCredentialState()).rejects.toMatchObject({ code: 'FAILED' });
  });
});
