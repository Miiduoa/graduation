import createAppConfig from '../../app.config';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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
  'EXPO_PUBLIC_AI_PROVIDER',
  'EXPO_PUBLIC_RELEASE_AI_PROVIDER',
  'EXPO_PUBLIC_GEMINI_API_KEY',
  'EAS_BUILD', 'EAS_BUILD_PLATFORM', 'EXPO_OS', 'GOOGLE_SERVICES_JSON', 'ANDROID_PACKAGE_NAME',
];

describe('Expo release configuration', () => {
  let original: Record<string, string | undefined>;
  let projectRoot: string;
  const resolveConfig = () => createAppConfig({ config: {}, projectRoot });

  beforeEach(() => {
    original = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
    projectRoot = mkdtempSync(join(tmpdir(), 'campus-config-'));
    for (const key of ['EAS_BUILD', 'EAS_BUILD_PLATFORM', 'EXPO_OS', 'GOOGLE_SERVICES_JSON', 'ANDROID_PACKAGE_NAME']) {
      delete process.env[key];
    }
    for (const [key, value] of Object.entries(releaseEnvironment)) {
      process.env[key] = value;
    }
    delete process.env.EXPO_PUBLIC_RELEASE_AI_PROVIDER;
    delete process.env.EXPO_PUBLIC_GEMINI_API_KEY;
    delete process.env.EXPO_PUBLIC_AI_PROVIDER;
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
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
    const config = resolveConfig();

    expect(config.extra.aiProvider).toBe('cloud');
    expect(config.extra.aiRuntimeMode).toBe('production-backend');
    expect(config.extra.geminiApiKey).toBe('');
  });

  it('rejects a client-side provider override in a release', () => {
    process.env.APP_ENV = 'preview';
    process.env.EXPO_PUBLIC_RELEASE_AI_PROVIDER = 'gemini';

    expect(resolveConfig).toThrow(
      'Release AI provider must be cloud',
    );
  });

  it('rejects a public Gemini key in a production build', () => {
    process.env.APP_ENV = 'production';
    process.env.EXPO_PUBLIC_GEMINI_API_KEY = 'should-not-ship';

    expect(resolveConfig).toThrow(
      'Remove EXPO_PUBLIC_GEMINI_API_KEY from release builds',
    );
  });

  it('accepts an explicit cloud provider in preview', () => {
    process.env.APP_ENV = 'preview';
    process.env.EXPO_PUBLIC_RELEASE_AI_PROVIDER = 'cloud';

    expect(createAppConfig({ config: {} }).extra.aiProvider).toBe('cloud');
  });

  it('keeps local AI experiments confined to development', () => {
    process.env.APP_ENV = 'development';
    process.env.EXPO_PUBLIC_AI_PROVIDER = 'gemini';
    process.env.EXPO_PUBLIC_GEMINI_API_KEY = 'development-only';

    const config = resolveConfig();

    expect(config.extra.aiProvider).toBe('gemini');
    expect(config.extra.geminiApiKey).toBe('development-only');
  });

  describe('Android FCM', () => {
    const project = { project_id: 'test-project', project_number: '123456' };
    const client = {
      client_info: { mobilesdk_app_id: '1:123456:android:abc123', android_client_info: { package_name: 'com.example.push' } },
      api_key: [{ current_key: 'synthetic-client-key' }],
    };
    beforeEach(() => {
      process.env.APP_ENV = 'production';
      process.env.ANDROID_PACKAGE_NAME = 'com.example.push';
      process.env.EAS_BUILD = 'true';
      process.env.EAS_BUILD_PLATFORM = 'android';
    });
    it('uses the EAS file, selects the matching package, and leaves only its path in Expo configuration', () => {
      const file = join(projectRoot, 'eas-file');
      process.env.GOOGLE_SERVICES_JSON = file;
      writeFileSync(join(projectRoot, 'google-services.json'), '{}');
      writeFileSync(file, JSON.stringify({ project_info: project, client: [{}, client] }));
      const config = resolveConfig();
      expect(config.android.googleServicesFile).toBe(file);
      expect(JSON.stringify(config)).not.toContain('synthetic-client-key');
    });
    it('loads the ignored local google-services.json relative to the Expo project', () => {
      writeFileSync(join(projectRoot, 'google-services.json'), JSON.stringify({ project_info: project, client: [client] }));
      expect(resolveConfig().android.googleServicesFile).toBe('./google-services.json');
    });
    it.each(['preview', 'production'])('requires a file on the %s Android build worker', (environment) => {
      process.env.APP_ENV = environment;
      expect(resolveConfig).toThrow(/Android release builds require/);
    });
    it('allows iOS workers, development builds and JS-only release checks to run independently', () => {
      process.env.EAS_BUILD_PLATFORM = 'ios';
      process.env.GOOGLE_SERVICES_JSON = join(projectRoot, 'android-only');
      expect(resolveConfig().android.googleServicesFile).toBeUndefined();
      process.env.EAS_BUILD_PLATFORM = 'android';
      delete process.env.EAS_BUILD;
      expect(resolveConfig().android.googleServicesFile).toBeUndefined();
      process.env.EAS_BUILD = 'true';
      process.env.APP_ENV = 'development';
      expect(resolveConfig().android.googleServicesFile).toBeUndefined();
    });
    it.each([
      { project_info: { ...project, project_id: 'other' }, client: [client] },
      { project_info: { ...project, project_number: '123457' }, client: [client] },
      { project_info: project, client: [{ ...client, client_info: { ...client.client_info, android_client_info: { package_name: 'com.example.other' } } }] },
      { project_info: project, client: [{ ...client, client_info: { ...client.client_info, mobilesdk_app_id: '1:123456:web:abc' } }] },
      { project_info: project, client: [{ ...client, api_key: [] }] },
      { type: 'service_account' },
    ])('rejects an unrelated or incomplete client configuration', (data) => {
      writeFileSync(join(projectRoot, 'google-services.json'), JSON.stringify(data));
      expect(resolveConfig).toThrow(/Android Firebase/);
    });
    it('omits malformed file contents from diagnostics', () => {
      writeFileSync(join(projectRoot, 'google-services.json'), 'private-fixture-data');
      expect(resolveConfig).toThrow('Android Firebase configuration must be a readable google-services.json file.');
    });
  });
});
