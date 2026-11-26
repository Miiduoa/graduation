import type { Rewrite } from 'next/dist/lib/load-custom-routes';

export function firebaseEmulatorRequested(env: NodeJS.ProcessEnv = process.env): boolean {
  return ['1', 'true'].includes(env.NEXT_PUBLIC_USE_FIREBASE_EMULATOR || '') ||
    Boolean(env.FIREBASE_AUTH_EMULATOR_HOST || env.FIRESTORE_EMULATOR_HOST);
}

/** The full Web preview may use only a demo project and two loopback emulators. */
export function localFirebaseEmulatorConfig(env: NodeJS.ProcessEnv = process.env): {
  projectId: string; authHost: string; firestoreHost: string; sameOrigin: boolean;
} | null {
  if (!['development', 'test'].includes(env.NODE_ENV || '') ||
    !['1', 'true'].includes(env.NEXT_PUBLIC_USE_FIREBASE_EMULATOR || '') ||
    env.NEXT_PUBLIC_FIREBASE_EMULATOR_HOST !== '127.0.0.1') return null;
  const projectId = env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || '';
  if (!/^demo-[a-z0-9-]{1,24}$/.test(projectId) ||
    (env.GCLOUD_PROJECT && env.GCLOUD_PROJECT !== projectId) ||
    (env.GOOGLE_CLOUD_PROJECT && env.GOOGLE_CLOUD_PROJECT !== projectId)) return null;
  const sameOrigin = env.NEXT_PUBLIC_FIREBASE_EMULATOR_SAME_ORIGIN === 'true';
  for (const [serverName, browserName] of [
    ['FIREBASE_AUTH_EMULATOR_HOST', 'NEXT_PUBLIC_FIREBASE_EMULATOR_AUTH_PORT'],
    ['FIRESTORE_EMULATOR_HOST', 'NEXT_PUBLIC_FIREBASE_EMULATOR_FIRESTORE_PORT'],
  ]) {
    const host = env[serverName] || '';
    const match = /^127\.0\.0\.1:([1-9]\d{0,4})$/.exec(host);
    if (!match || Number(match[1]) > 65535 || (!sameOrigin && env[browserName] !== match[1]) ||
      // Admin SDK reads process.env itself; a supplied config must match it.
      process.env[serverName] !== host) return null;
  }
  const authHost = env.FIREBASE_AUTH_EMULATOR_HOST;
  const firestoreHost = env.FIRESTORE_EMULATOR_HOST;
  if (!authHost || !firestoreHost || authHost === firestoreHost) return null;
  return { projectId, authHost, firestoreHost, sameOrigin };
}

export function firebaseEmulatorRewrites(env: NodeJS.ProcessEnv = process.env): Rewrite[] {
  const config = localFirebaseEmulatorConfig(env);
  if (!config?.sameOrigin) return [];
  // Forward only the SDK login/refresh endpoints, never Auth's admin API.
  return [
    { source: '/identitytoolkit.googleapis.com/v1/:operation(accounts:signInWithPassword|accounts:lookup)',
      destination: `http://${config.authHost}/identitytoolkit.googleapis.com/v1/:operation` },
    { source: '/securetoken.googleapis.com/v1/token',
      destination: `http://${config.authHost}/securetoken.googleapis.com/v1/token` },
    { source: '/google.firestore.v1.Firestore/:path*',
      destination: `http://${config.firestoreHost}/google.firestore.v1.Firestore/:path*` },
  ];
}
