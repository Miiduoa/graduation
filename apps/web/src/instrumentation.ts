export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    try {
      const { startPrivateFileCleanupScheduler } = await import('./lib/server/privateFileCleanupScheduler');
      startPrivateFileCleanupScheduler();
    } catch {
      console.warn('Private file cleanup initialization failed');
    }
    try {
      const { startTronClassPlatformClosureScheduler } = await import('./lib/server/tronClassPlatformClosureScheduler');
      startTronClassPlatformClosureScheduler();
    } catch {
      console.warn('TronClass platform account cleanup initialization failed');
    }
    try {
      const { startTronClassRetentionScheduler } = await import('./lib/server/tronClassRetentionScheduler');
      startTronClassRetentionScheduler();
    } catch {
      console.warn('TronClass retention cleanup initialization failed');
    }
  }
}
