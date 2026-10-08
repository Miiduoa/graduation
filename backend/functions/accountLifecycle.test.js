const { createAccountGuardedOnCall } = require('./accountLifecycle');

function setup(data, exists = true) {
  const get = jest.fn(async () => ({ exists, data: () => data }));
  const db = { collection: jest.fn(() => ({ doc: jest.fn(() => ({ get })) })) };
  const onCall = jest.fn((options, handler) => handler);
  return { get, onCall, guarded: createAccountGuardedOnCall({ onCall, getDb: () => db }) };
}
test.each([{ accountDeletionInProgress: true }, { status: 'deleted' }])(
  'blocks %j before the business handler',
  async (profile) => {
    const { guarded } = setup(profile);
    const handler = jest.fn();
    await expect(
      guarded({ region: 'asia-east1' }, handler)({ auth: { uid: 'alice' } }),
    ).rejects.toMatchObject({
      code: 'failed-precondition',
      details: { reason: 'account-deletion' },
    });
    expect(handler).not.toHaveBeenCalled();
  },
);
test('allows the explicit deletion retry without forwarding custom options to Firebase', async () => {
  const { guarded, get, onCall } = setup({ accountDeletionInProgress: true });
  const handler = jest.fn(async () => ({ success: true }));
  expect(
    await guarded(
      { region: 'asia-east1', allowClosingAccount: true },
      handler,
    )({ auth: { uid: 'alice' } }),
  ).toEqual({ success: true });
  expect(get).not.toHaveBeenCalled();
  expect(onCall).toHaveBeenCalledWith({ region: 'asia-east1' }, expect.any(Function));
});
test.each([true, false])(
  'preserves active and new-account behavior (exists %s)',
  async (exists) => {
    const { guarded } = setup({}, exists);
    const handler = jest.fn(async () => 'ok');
    expect(await guarded({}, handler)({ auth: { uid: 'alice' } })).toBe('ok');
  },
);
test('anonymous requests reach the existing handler authentication boundary', async () => {
  const { guarded, get } = setup({});
  expect(await guarded({}, async () => 'public')({})).toBe('public');
  expect(get).not.toHaveBeenCalled();
});
test('unavailable account source fails closed', async () => {
  const { guarded, get } = setup({});
  get.mockRejectedValueOnce(new Error('unavailable'));
  const handler = jest.fn();
  await expect(guarded({}, handler)({ auth: { uid: 'alice' } })).rejects.toThrow('unavailable');
  expect(handler).not.toHaveBeenCalled();
});
