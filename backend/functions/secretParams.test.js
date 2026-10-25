'use strict';

const { readSecretValue } = require('./secretParams');

describe('readSecretValue', () => {
  const ORIGINAL = process.env.TDX_CLIENT_ID;

  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.TDX_CLIENT_ID;
    else process.env.TDX_CLIENT_ID = ORIGINAL;
  });

  test('prefers process.env over SecretParam.value (Fly secrets)', () => {
    process.env.TDX_CLIENT_ID = 'from-env';
    expect(readSecretValue({ value: () => 'from-param' }, 'TDX_CLIENT_ID')).toBe('from-env');
  });

  test('falls back to SecretParam.value when env is unset', () => {
    delete process.env.TDX_CLIENT_ID;
    expect(readSecretValue({ value: () => 'from-param' }, 'TDX_CLIENT_ID')).toBe('from-param');
  });

  test('returns empty string when SecretParam.value throws', () => {
    delete process.env.TDX_CLIENT_ID;
    expect(
      readSecretValue(
        {
          value() {
            throw new Error('secret is not bound in this process');
          },
        },
        'TDX_CLIENT_ID',
      ),
    ).toBe('');
  });
});
