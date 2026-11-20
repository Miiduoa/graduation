import { accessSync, constants } from 'node:fs';
import { spawnSync } from 'node:child_process';

// 僅供一次性工作程序使用；不掛入 serving。
const verifier = '/opt/release/verify-migration-session.mjs';
let code = 1;
try {
  if (!process.env.MIGRATION_DATABASE_URL) throw new Error('migrator-not-configured');
  accessSync(verifier, constants.R_OK);
  let writable = true;
  try { accessSync(verifier, constants.W_OK); } catch { writable = false; }
  if (writable) throw new Error('verifier-is-writable');
  const result = spawnSync(process.execPath, [
    '--import', verifier, '/app/apps/api/dist/migrate.js',
  ], {
    cwd: '/app', stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: process.env.MIGRATION_DATABASE_URL },
  });
  code = Number.isInteger(result.status) ? result.status : 1;
} catch {
  console.error(JSON.stringify({ event: 'migration.job.precondition_failed' }));
}
console.log(JSON.stringify({ event: 'migration.job.exit', code }));
process.exitCode = code;
