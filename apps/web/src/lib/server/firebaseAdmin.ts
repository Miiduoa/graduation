import type { ServiceAccountSigner } from './firebaseCustomToken';
import { firebaseEmulatorRequested, localFirebaseEmulatorConfig } from './firebaseEmulatorConfig';

const REQUIRED_PROJECT_ID = 'campus-one-tw';
const EMULATOR_APP_NAME = 'campus-one-web-emulator';

type FirebaseAdmin = {
  messaging?: import('firebase-admin/messaging').Messaging;
  verifyIdToken: (
    token: string,
    checkRevoked?: boolean,
  ) => Promise<{ uid: string } & Record<string, unknown>>;
  db: import('firebase-admin/firestore').Firestore;
};

let cached: FirebaseAdmin | null | undefined;
let inflight: Promise<FirebaseAdmin | null> | null = null;
let initAttempts = 0;

export function resetFirebaseAdminForTests(): void {
  cached = undefined;
  inflight = null;
  initAttempts = 0;
}

export function firebaseAdminInitAttemptsForTests(): number {
  return initAttempts;
}

export function hasServiceAccountJson(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(String(env.FIREBASE_SERVICE_ACCOUNT_JSON || '').trim());
}

export function parseServiceAccount(raw: string): {
  project_id: string;
  client_email: string;
  private_key: string;
  private_key_id?: string;
} | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const record = parsed as Record<string, unknown>;
  if (
    typeof record.project_id !== 'string' ||
    !record.project_id ||
    typeof record.client_email !== 'string' ||
    !record.client_email ||
    typeof record.private_key !== 'string' ||
    !record.private_key
  ) {
    return null;
  }
  return {
    project_id: record.project_id,
    client_email: record.client_email,
    private_key: record.private_key.includes('\\n')
      ? record.private_key.replace(/\\n/g, '\n')
      : record.private_key,
    ...(typeof record.private_key_id === 'string' && record.private_key_id
      ? { private_key_id: record.private_key_id }
      : {}),
  };
}

export function readServiceAccountSigner(
  env: NodeJS.ProcessEnv = process.env,
): ServiceAccountSigner | null {
  const raw = String(env.FIREBASE_SERVICE_ACCOUNT_JSON || '').trim();
  if (!raw) return null;
  const account = parseServiceAccount(raw);
  if (!account || account.project_id !== REQUIRED_PROJECT_ID) return null;
  return {
    client_email: account.client_email,
    private_key: account.private_key,
    ...(account.private_key_id ? { private_key_id: account.private_key_id } : {}),
  };
}

async function initializeFirebaseAdmin(env: NodeJS.ProcessEnv): Promise<FirebaseAdmin | null> {
  initAttempts += 1;
  try {
    if (firebaseEmulatorRequested(env)) {
      const emulator = localFirebaseEmulatorConfig(env);
      if (!emulator) {
        cached = null;
        return null;
      }
      const { projectId } = emulator;
      // Both SDKs use their local emulator transport. Do not read or parse
      // FIREBASE_SERVICE_ACCOUNT_JSON on this path, or reuse a production app.
      const { getApps, initializeApp } = await import('firebase-admin/app');
      const { getAuth } = await import('firebase-admin/auth');
      const { getFirestore } = await import('firebase-admin/firestore');
      const existing = getApps().find((app) => app.name === EMULATOR_APP_NAME);
      if (existing && existing.options.projectId !== projectId) {
        cached = null;
        return null;
      }
      const app = existing ?? initializeApp({ projectId }, EMULATOR_APP_NAME);
      const auth = getAuth(app);
      cached = {
        db: getFirestore(app),
        verifyIdToken: async (token: string, checkRevoked?: boolean) => {
          const decoded = await auth.verifyIdToken(token, checkRevoked === true);
          return decoded as { uid: string } & Record<string, unknown>;
        },
      };
      return cached;
    }
    const raw = String(env.FIREBASE_SERVICE_ACCOUNT_JSON || '').trim();
    if (!raw) {
      cached = null;
      return null;
    }
    const account = parseServiceAccount(raw);
    if (!account || account.project_id !== REQUIRED_PROJECT_ID) {
      cached = null;
      return null;
    }
    const { cert, getApps, initializeApp } = await import('firebase-admin/app');
    const { getMessaging } = await import('firebase-admin/messaging');
    const { getAuth } = await import('firebase-admin/auth');
    const { getFirestore } = await import('firebase-admin/firestore');
    const existing = getApps().find((app) => app.name === '[DEFAULT]');
    if (existing && existing.options.projectId !== REQUIRED_PROJECT_ID) {
      cached = null;
      return null;
    }
    const app = existing ?? initializeApp({
      credential: cert({
        projectId: account.project_id,
        clientEmail: account.client_email,
        privateKey: account.private_key,
      }),
      projectId: account.project_id,
    });
    const auth = getAuth(app);
    cached = {
      messaging: getMessaging(app),
      db: getFirestore(app),
      verifyIdToken: async (token: string, checkRevoked?: boolean) => {
        const decoded = await auth.verifyIdToken(token, checkRevoked === true);
        return decoded as { uid: string } & Record<string, unknown>;
      },
    };
    return cached;
  } catch {
    cached = null;
    return null;
  }
}

/**
 * Lazy Admin SDK. Missing, invalid, or failed credentials return null so the
 * website still boots; callers must answer 503 尚未啟用. Failures are remembered
 * and not retried. Never log the JSON or include key material in errors.
 */
export async function getFirebaseAdmin(
  env: NodeJS.ProcessEnv = process.env,
): Promise<FirebaseAdmin | null> {
  if (cached !== undefined) return cached;
  if (inflight) return inflight;
  inflight = initializeFirebaseAdmin(env);
  try {
    return await inflight;
  } finally {
    inflight = null;
  }
}
