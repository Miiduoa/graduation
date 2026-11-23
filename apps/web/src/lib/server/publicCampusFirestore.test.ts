// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type App = { name: string; options: { projectId: string } };
const firebase = vi.hoisted(() => ({
  apps: [] as App[],
  initialize: vi.fn(),
  firestore: vi.fn(),
  emulator: vi.fn(),
  database: { reader: 'public-campus' },
}));
vi.mock('firebase/app', () => ({ getApps: () => firebase.apps, initializeApp: firebase.initialize }));
vi.mock('firebase/firestore', () => ({
  getFirestore: firebase.firestore,
  connectFirestoreEmulator: firebase.emulator,
}));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  firebase.apps = [];
  firebase.initialize.mockImplementation((options, name) => {
    const app = { options, name };
    firebase.apps.push(app);
    return app;
  });
  firebase.firestore.mockReturnValue(firebase.database);
  vi.stubEnv('NEXT_PUBLIC_FIREBASE_PROJECT_ID', 'demo-campus');
  vi.stubEnv('NEXT_PUBLIC_FIREBASE_API_KEY', 'public-test-key');
  vi.stubEnv('NEXT_PUBLIC_FIREBASE_APP_ID', 'public-test-app');
  vi.stubEnv('NEXT_PUBLIC_USE_FIREBASE_EMULATOR', 'false');
  vi.stubEnv('NEXT_PUBLIC_FIREBASE_EMULATOR_HOST', 'localhost');
  vi.stubEnv('NEXT_PUBLIC_FIREBASE_EMULATOR_FIRESTORE_PORT', '8080');
});
afterEach(() => vi.unstubAllEnvs());

describe('public campus Firebase client isolation', () => {
  it('creates a separate named app even when a default app already exists for the same project', async () => {
    const defaultApp = { name: '[DEFAULT]', options: { projectId: 'demo-campus' } };
    firebase.apps.push(defaultApp);
    const { publicCampusFirestore } = await import('./publicCampusFirestore');
    expect(publicCampusFirestore()).toBe(firebase.database);
    expect(firebase.initialize).toHaveBeenCalledExactlyOnceWith({
      projectId: 'demo-campus', apiKey: 'public-test-key', appId: 'public-test-app',
    }, 'nuni-public-campus-reader');
    expect(firebase.firestore).toHaveBeenCalledExactlyOnceWith(firebase.apps[1]);
    expect(firebase.firestore).not.toHaveBeenCalledWith(defaultApp);
    expect(publicCampusFirestore()).toBe(firebase.database);
    expect(firebase.firestore).toHaveBeenCalledOnce();
  });

  it('only reuses the exact named app with the configured public project', async () => {
    const namedApp = { name: 'nuni-public-campus-reader', options: { projectId: 'demo-campus' } };
    firebase.apps.push({ name: 'other-app', options: { projectId: 'demo-campus' } }, namedApp);
    const { publicCampusFirestore } = await import('./publicCampusFirestore');
    publicCampusFirestore();
    expect(firebase.initialize).not.toHaveBeenCalled();
    expect(firebase.firestore).toHaveBeenCalledExactlyOnceWith(namedApp);
  });

  it('rejects a named app for a different project before obtaining a database', async () => {
    firebase.apps.push({ name: 'nuni-public-campus-reader', options: { projectId: 'foreign-project' } });
    const { publicCampusFirestore } = await import('./publicCampusFirestore');
    expect(() => publicCampusFirestore()).toThrow('Public campus project mismatch');
    expect(firebase.firestore).not.toHaveBeenCalled();
  });

  it.each(['', 'project/other', 'https://foreign.invalid', 'project with spaces'])
    ('rejects unavailable or malformed project configuration: %s', async project => {
      vi.stubEnv('NEXT_PUBLIC_FIREBASE_PROJECT_ID', project);
      const { publicCampusFirestore } = await import('./publicCampusFirestore');
      expect(() => publicCampusFirestore()).toThrow('Public campus source unavailable');
      expect(firebase.initialize).not.toHaveBeenCalled();
      expect(firebase.firestore).not.toHaveBeenCalled();
    });

  it('only permits the local emulator for demo projects', async () => {
    vi.stubEnv('NEXT_PUBLIC_FIREBASE_PROJECT_ID', 'real-campus-project');
    vi.stubEnv('NEXT_PUBLIC_USE_FIREBASE_EMULATOR', 'true');
    const { publicCampusFirestore } = await import('./publicCampusFirestore');
    expect(() => publicCampusFirestore()).toThrow('Invalid public campus emulator');
    expect(firebase.initialize).not.toHaveBeenCalled();
    expect(firebase.emulator).not.toHaveBeenCalled();
  });

  it('connects the isolated demo reader to the configured emulator once', async () => {
    vi.stubEnv('NEXT_PUBLIC_USE_FIREBASE_EMULATOR', '1');
    const { publicCampusFirestore } = await import('./publicCampusFirestore');
    publicCampusFirestore();
    publicCampusFirestore();
    expect(firebase.emulator).toHaveBeenCalledExactlyOnceWith(firebase.database, 'localhost', 8080);
  });

  it.each(['0', '65536', '8080.5', 'not-a-port'])('rejects an invalid emulator port: %s', async port => {
    vi.stubEnv('NEXT_PUBLIC_USE_FIREBASE_EMULATOR', 'true');
    vi.stubEnv('NEXT_PUBLIC_FIREBASE_EMULATOR_FIRESTORE_PORT', port);
    const { publicCampusFirestore } = await import('./publicCampusFirestore');
    expect(() => publicCampusFirestore()).toThrow('Invalid public campus emulator');
    expect(firebase.emulator).not.toHaveBeenCalled();
  });
});
