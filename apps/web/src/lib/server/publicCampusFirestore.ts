import { getApps, initializeApp } from 'firebase/app';
import { connectFirestoreEmulator, getFirestore, type Firestore } from 'firebase/firestore';

const CLIENT_NAME = 'nuni-public-campus-reader';
let database: Firestore | undefined;

/**
 * A separate Firebase Client app, without Auth or Admin credentials. Reads keep
 * the public Firestore rules and cannot inherit a browser/school user's login.
 */
export function publicCampusFirestore(): Firestore {
  if (typeof window !== 'undefined') throw new Error('Server only');
  if (database) return database;
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID?.trim();
  if (!projectId || !/^[a-z0-9][a-z0-9-]{2,99}$/.test(projectId))
    throw new Error('Public campus source unavailable');
  const emulator = ['1', 'true'].includes(process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATOR || '');
  if (emulator && !projectId.startsWith('demo-')) throw new Error('Invalid public campus emulator');
  // A caller cannot choose an app, project, credential, URL, or bearer token.
  const app = getApps().find(candidate => candidate.name === CLIENT_NAME) ?? initializeApp({
    projectId,
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  }, CLIENT_NAME);
  if (app.options.projectId !== projectId) throw new Error('Public campus project mismatch');
  const db = getFirestore(app);
  if (emulator) {
    const host = process.env.NEXT_PUBLIC_FIREBASE_EMULATOR_HOST || 'localhost';
    const port = Number(process.env.NEXT_PUBLIC_FIREBASE_EMULATOR_FIRESTORE_PORT || '8080');
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid public campus emulator');
    connectFirestoreEmulator(db, host, port);
  }
  database = db;
  return db;
}
