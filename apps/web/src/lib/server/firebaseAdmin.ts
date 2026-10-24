const REQUIRED_PROJECT_ID = 'campus-one-tw';

type FirebaseAdmin = {
  verifyIdToken: (token: string) => Promise<{ uid: string } & Record<string, unknown>>;
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

function parseServiceAccount(raw: string): {
  project_id: string;
  client_email: string;
  private_key: string;
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
  };
}

async function initializeFirebaseAdmin(env: NodeJS.ProcessEnv): Promise<FirebaseAdmin | null> {
  initAttempts += 1;
  try {
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
    const { getAuth } = await import('firebase-admin/auth');
    const { getFirestore } = await import('firebase-admin/firestore');
    const app =
      getApps().length > 0
        ? getApps()[0]
        : initializeApp({
            credential: cert({
              projectId: account.project_id,
              clientEmail: account.client_email,
              privateKey: account.private_key,
            }),
            projectId: account.project_id,
          });
    const auth = getAuth(app);
    cached = {
      db: getFirestore(app),
      verifyIdToken: async (token: string) => {
        const decoded = await auth.verifyIdToken(token);
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
