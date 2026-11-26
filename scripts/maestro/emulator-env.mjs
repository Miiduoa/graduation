import assert from 'node:assert/strict';
import process from 'node:process';
import { assertMaestroEmulatorConfig } from '../../apps/mobile/e2e/emulatorConfig.ts';

export function emulatorEnvironment(env = process.env) {
  assertMaestroEmulatorConfig({
    appEnv: env.APP_ENV, maestro: env.EXPO_PUBLIC_MAESTRO,
    useEmulator: env.EXPO_PUBLIC_USE_FIREBASE_EMULATOR,
    projectId: env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
    host: env.EXPO_PUBLIC_FIREBASE_EMULATOR_HOST,
    authPort: env.EXPO_PUBLIC_FIREBASE_EMULATOR_AUTH_PORT,
    firestorePort: env.EXPO_PUBLIC_FIREBASE_EMULATOR_FIRESTORE_PORT,
    allowMockAuth: env.EXPO_PUBLIC_ALLOW_LOCAL_MOCK_AUTH === 'false' ? false : undefined,
    universalDevAccounts: env.EXPO_PUBLIC_ENABLE_UNIVERSAL_DEV_ACCOUNTS === 'false' ? false : undefined,
  });
  assert.equal(env.TEST_PROJECT_ID, 'demo-campus-one');
  assert.equal(env.FIREBASE_AUTH_EMULATOR_HOST, '127.0.0.1:19291');
  assert.equal(env.FIRESTORE_EMULATOR_HOST, '127.0.0.1:18291');
  return { project: env.TEST_PROJECT_ID, auth: env.FIREBASE_AUTH_EMULATOR_HOST, firestore: env.FIRESTORE_EMULATOR_HOST };
}
