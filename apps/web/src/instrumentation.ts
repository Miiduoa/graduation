export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    try {
      const { startPrivateFileCleanupScheduler } = await import('./lib/server/privateFileCleanupScheduler');
      startPrivateFileCleanupScheduler();
    } catch {
      console.warn('Private file cleanup initialization failed');
    }
  }
}
