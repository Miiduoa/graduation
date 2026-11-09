import 'server-only';
import { readFileStorageConfig } from './fileStorageConfig';

export const CLEANUP_INTERVAL_MS = 30 * 60_000;
const JITTER_MS = 60_000;
let started = false;

export function startPrivateFileCleanupScheduler(
  env: Record<string, string | undefined> = process.env,
  run = async () => {
    const [{ getFirebaseAdmin }, { getFileStorage }, { cleanupExpiredPrivateFileUploads }] =
      await Promise.all([import('./firebaseAdmin'), import('./fileStorage'), import('./privateFileUploads')]);
    const admin = await getFirebaseAdmin();
    const storage = getFileStorage();
    if (!admin || !storage) throw new Error('Cleanup unavailable');
    await cleanupExpiredPrivateFileUploads(admin.db, storage, Date.now(), 20);
  },
) {
  if (started || env.NEXT_RUNTIME !== 'nodejs' || !readFileStorageConfig(env)) return false;
  started = true;
  const schedule = () => {
    const timer = setTimeout(async () => {
      try { await run(); }
      catch { console.warn('Private file cleanup failed'); }
      finally { schedule(); }
    }, CLEANUP_INTERVAL_MS + Math.floor(Math.random() * JITTER_MS));
    timer.unref();
  };
  schedule();
  return true;
}
