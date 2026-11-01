// Preload from the candidate's /app working directory; use its pinned pg module.
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
const require = createRequire(resolve('apps/api/dist/migrate.js'));
const { Client } = require('pg');
const originalQuery = Client.prototype.query;
const checked = new WeakSet();
Client.prototype.query = function (...args) {
  const result = originalQuery.apply(this, args);
  if (typeof args[0] !== 'string' || args[0].trim().toUpperCase() !== 'BEGIN' || checked.has(this)) {
    return result;
  }
  return result.then(async (value) => {
    // This is the very client/transaction used by the runner, before any DDL.
    const { rows } = await originalQuery.call(this,
      "SELECT name, setting, unit FROM pg_settings WHERE name IN ('lock_timeout', 'statement_timeout', 'idle_in_transaction_session_timeout') ORDER BY name");
    const expected = { lock_timeout: '5000', statement_timeout: '60000', idle_in_transaction_session_timeout: '90000' };
    if (rows.length !== 3 || rows.some(row => row.unit !== 'ms' || row.setting !== expected[row.name])) {
      throw new Error('Migration session timeout verification failed');
    }
    checked.add(this);
    console.log(JSON.stringify({ event: 'migration.session_timeouts_verified', settings: rows }));
    return value;
  });
};
