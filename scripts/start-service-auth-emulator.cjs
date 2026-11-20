'use strict';

// Only the local browser fixture uses this process; it never reads cloud credentials.
const { AuthEmulator, SingleProjectMode } = require('firebase-tools/lib/emulator/auth');
const emulator = new AuthEmulator({
  projectId: 'demo-campus-services',
  host: '127.0.0.1',
  port: 9099,
  singleProjectMode: SingleProjectMode.ERROR,
});

async function stop() {
  await emulator.stop();
  process.exit(0);
}
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
emulator.start().then(() => {
  console.log('Auth fixture emulator: demo-campus-services at 127.0.0.1:9099');
}).catch((error) => {
  console.error(error.message);
  process.exit(1);
});
