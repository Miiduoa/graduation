import fs from 'fs';
import path from 'path';

import createAppConfig from '../../app.config';
import appJson from '../../app.json';

const releaseEnvironment = {
  EXPO_PUBLIC_FIREBASE_API_KEY: 'firebase-public-test-key',
  EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN: 'test.firebaseapp.com',
  EXPO_PUBLIC_FIREBASE_PROJECT_ID: 'test-project',
  EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET: 'test-project.appspot.com',
  EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: '123456',
  EXPO_PUBLIC_FIREBASE_APP_ID: '1:123456:web:test',
  EXPO_PUBLIC_EAS_PROJECT_ID: '00000000-0000-4000-8000-000000000000',
  EXPO_PUBLIC_LEGAL_BASE_URL: 'https://example.com/legal',
  EXPO_PUBLIC_ERROR_REPORTING_ENDPOINT: 'https://example.com/errors',
  EXPO_PUBLIC_GOOGLE_MAPS_API_KEY: 'public-maps-test-key',
  EXPO_PUBLIC_RELEASED_SCHOOL_IDS: 'sample-school',
};

const keys = [
  ...Object.keys(releaseEnvironment),
  'APP_ENV',
  'ANDROID_VERSION_CODE',
  'EXPO_PUBLIC_AI_PROVIDER',
  'EXPO_PUBLIC_RELEASE_AI_PROVIDER',
  'EXPO_PUBLIC_GEMINI_API_KEY',
];

const releaseConfig = { android: { versionCode: 9 } };

describe('Expo release AI configuration', () => {
  let original: Record<string, string | undefined>;

  beforeEach(() => {
    original = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
    for (const [key, value] of Object.entries(releaseEnvironment)) {
      process.env[key] = value;
    }
    delete process.env.EXPO_PUBLIC_RELEASE_AI_PROVIDER;
    delete process.env.EXPO_PUBLIC_GEMINI_API_KEY;
    delete process.env.EXPO_PUBLIC_AI_PROVIDER;
    delete process.env.ANDROID_VERSION_CODE;
  });

  afterEach(() => {
    for (const key of keys) {
      const value = original[key];
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  it.each(['preview', 'production'])('%s uses the backend provider', (environment) => {
    process.env.APP_ENV = environment;
    process.env.EXPO_PUBLIC_AI_PROVIDER = 'gemini';
    const config = createAppConfig({ config: releaseConfig });

    expect(config.extra.aiProvider).toBe('cloud');
    expect(config.extra.aiRuntimeMode).toBe('production-backend');
    expect(config.extra.geminiApiKey).toBe('');
  });

  it('rejects a client-side provider override in a release', () => {
    process.env.APP_ENV = 'preview';
    process.env.EXPO_PUBLIC_RELEASE_AI_PROVIDER = 'gemini';

    expect(() => createAppConfig({ config: releaseConfig })).toThrow(
      'Release AI provider must be cloud',
    );
  });

  it('rejects a public Gemini key in a production build', () => {
    process.env.APP_ENV = 'production';
    process.env.EXPO_PUBLIC_GEMINI_API_KEY = 'should-not-ship';

    expect(() => createAppConfig({ config: releaseConfig })).toThrow(
      'Remove EXPO_PUBLIC_GEMINI_API_KEY from release builds',
    );
  });

  it('accepts an explicit cloud provider in preview', () => {
    process.env.APP_ENV = 'preview';
    process.env.EXPO_PUBLIC_RELEASE_AI_PROVIDER = 'cloud';

    expect(createAppConfig({ config: releaseConfig }).extra.aiProvider).toBe('cloud');
  });

  it('keeps local AI experiments confined to development', () => {
    process.env.APP_ENV = 'development';
    process.env.EXPO_PUBLIC_AI_PROVIDER = 'gemini';
    process.env.EXPO_PUBLIC_GEMINI_API_KEY = 'development-only';

    const config = createAppConfig({ config: {} });

    expect(config.extra.aiProvider).toBe('gemini');
    expect(config.extra.geminiApiKey).toBe('development-only');
  });
});

describe('Android activity recognition and versionCode', () => {
  let original: Record<string, string | undefined>;

  beforeEach(() => {
    original = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
    for (const [key, value] of Object.entries(releaseEnvironment)) {
      process.env[key] = value;
    }
    delete process.env.EXPO_PUBLIC_RELEASE_AI_PROVIDER;
    delete process.env.EXPO_PUBLIC_GEMINI_API_KEY;
    delete process.env.EXPO_PUBLIC_AI_PROVIDER;
    delete process.env.ANDROID_VERSION_CODE;
  });

  afterEach(() => {
    for (const key of keys) {
      const value = original[key];
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  it('blocks ACTIVITY_RECOGNITION declared by expo-sensors', () => {
    const sensorsRoot = path.dirname(require.resolve('expo-sensors/package.json'));
    const manifest = fs.readFileSync(
      path.join(sensorsRoot, 'android/src/main/AndroidManifest.xml'),
      'utf8',
    );
    expect(manifest).toContain('android.permission.ACTIVITY_RECOGNITION');

    process.env.APP_ENV = 'production';
    const config = createAppConfig({ config: appJson.expo });

    expect(config.android.versionCode).toBeGreaterThan(8);
    expect(config.android.blockedPermissions).toEqual(
      expect.arrayContaining([
        'android.permission.ACTIVITY_RECOGNITION',
        'com.google.android.gms.permission.ACTIVITY_RECOGNITION',
      ]),
    );
    expect(config.android.permissions.join(',')).not.toMatch(/ACTIVITY_RECOGNITION/i);
  });

  it('rejects a release versionCode of 8 or lower', () => {
    process.env.APP_ENV = 'production';

    expect(() => createAppConfig({ config: { android: { versionCode: 8 } } })).toThrow(
      'ANDROID_VERSION_CODE must be greater than 8',
    );
  });
});
