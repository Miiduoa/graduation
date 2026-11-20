const {
  getAppRuntimeEnv,
  isUniversalDevAccountsEnabled,
} = require('./securityUtils');

const ORIGINAL_ENV = process.env;

describe('security runtime flags', () => {
  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  test('production disables universal dev accounts even when explicitly enabled', () => {
    process.env.APP_ENV = 'production';
    process.env.UNIVERSAL_DEV_ACCOUNTS_ENABLED = 'true';

    expect(getAppRuntimeEnv()).toBe('production');
    expect(isUniversalDevAccountsEnabled()).toBe(false);
  });

  test('preview can enable universal dev accounts through server config', () => {
    process.env.APP_ENV = 'preview';
    process.env.UNIVERSAL_DEV_ACCOUNTS_ENABLED = 'true';

    expect(getAppRuntimeEnv()).toBe('preview');
    expect(isUniversalDevAccountsEnabled()).toBe(true);
  });
});
