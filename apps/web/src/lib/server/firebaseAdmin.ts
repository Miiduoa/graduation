type FirebaseAdmin = {
  verifyIdToken: (token: string) => Promise<{ uid: string } & Record<string, unknown>>;
  db: import('firebase-admin/firestore').Firestore;
};

let cached: FirebaseAdmin | null | undefined;

export function resetFirebaseAdminForTests(): void {
  cached = undefined;
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

/**
 * Lazy Admin SDK. Missing or invalid credentials return null so the website
 * still boots; callers must answer 503 尚未啟用. Never log the JSON.
 */
export async function getFirebaseAdmin(
  env: NodeJS.ProcessEnv = process.env,
): Promise<FirebaseAdmin | null> {
  if (cached !== undefined) return cached;
  const raw = String(env.FIREBASE_SERVICE_ACCOUNT_JSON || '').trim();
  if (!raw) {
    cached = null;
    return null;
  }
  const account = parseServiceAccount(raw);
  if (!account) {
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
}
