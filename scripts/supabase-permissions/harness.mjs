import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { createServer } from 'node:net';

export const here = fileURLToPath(new URL('./', import.meta.url));
export const repo = fileURLToPath(new URL('../../', import.meta.url));
export const upgradeBase = '20261008000000';
export const testJwtSecret = randomBytes(48).toString('hex');
export const psqlBinary = process.env.CAMPUS_TEST_PSQL || 'psql';

export function cleanEnvironment(extra = {}) {
  const env = { ...process.env };
  // Never inherit remote database/service targets or credential-selection settings.
  for (const key of Object.keys(env)) {
    if (/^(PG|PGRST_|SUPABASE_|DATABASE_URL$)/.test(key)) delete env[key];
  }
  return { ...env, ...extra };
}

export function execute(binary, args, options = {}) {
  const result = spawnSync(binary, args, {
    cwd: repo,
    env: cleanEnvironment(),
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    maxBuffer: 20 * 1024 * 1024,
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    if (result.stdout) process.stderr.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    throw new Error(`${binary} failed (exit ${result.status ?? result.signal})`);
  }
  if (options.display && result.stdout) process.stdout.write(result.stdout);
  return result.stdout || '';
}

export function assertLoopback(raw, protocols) {
  const url = new URL(raw);
  if (!protocols.includes(url.protocol)
      || !['127.0.0.1', '[::1]'].includes(url.hostname)
      || url.search || url.hash) {
    throw new Error('Only a literal loopback URL without query/fragment is allowed');
  }
  return url;
}

export function sql(url, { text, file, display = false }) {
  const args = ['-X', '--no-password', '--set', 'ON_ERROR_STOP=1', '--quiet', '--tuples-only', '--no-align', '--dbname', url];
  if (file) args.push('--file', file);
  return execute(psqlBinary, args, { input: text, display });
}

export function migrations() {
  return readdirSync(`${repo}/supabase/migrations`)
    .filter((name) => /^\d{14}_.+\.sql$/.test(name)).sort();
}

export function applyMigrations(url, names) {
  for (const name of names) {
    console.log(`Apply ${name}`);
    sql(url, { file: `${repo}/supabase/migrations/${name}` });
  }
}

export function seedFixtures(url) {
  sql(url, { file: `${here}/fixtures.sql` });
}

export function runSqlAssertions(url) {
  sql(url, { file: `${here}/assert-defaults.sql` });
  sql(url, { file: `${here}/assertions.sql`, display: true });
  sql(url, { file: `${repo}/supabase/tests/profile_role_authority.sql`, display: true });
}

export async function runApiAssertions({ databaseUrl, apiUrl, jwtSecret, anonKey = '' }) {
  assertLoopback(apiUrl, ['http:']);
  if (!jwtSecret || jwtSecret.length < 32) throw new Error('Missing local test JWT secret');
  // Keep the parent event loop free to drain PostgREST's logs and schema reloads.
  // A synchronous child can stall the HTTP server once its output pipe fills.
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--test', `${here}/api.test.mjs`], {
      cwd: repo,
      timeout: 120_000,
      stdio: ['ignore', 'inherit', 'inherit'],
      env: cleanEnvironment({
        CAMPUS_TEST_DATABASE_URL: databaseUrl,
        CAMPUS_TEST_API_URL: apiUrl,
        CAMPUS_TEST_JWT_SECRET: jwtSecret,
        CAMPUS_TEST_ANON_KEY: anonKey,
      }),
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => code === 0 ? resolve() : reject(new Error(`HTTP regression suite failed (${code ?? signal})`)));
  });
}

export async function withPostgrest(databaseUrl, callback) {
  const binary = process.env.CAMPUS_TEST_POSTGREST || 'postgrest';
  const version = execute(binary, ['--version']).trim();
  if (!/^PostgREST 16\.5\b/.test(version)) throw new Error(`Expected PostgREST 16.5; received ${version}`);
  const db = assertLoopback(databaseUrl, ['postgres:', 'postgresql:']);
  db.username = 'authenticator';
  db.password = 'isolated-test-only';
  const port = Number(process.env.CAMPUS_TEST_POSTGREST_PORT || 54329);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid test PostgREST port');
  // Refuse to query an unrelated process already listening on the chosen port.
  await new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(port, '127.0.0.1', () => probe.close(resolve));
  });
  const apiUrl = `http://127.0.0.1:${port}`;
  let output = '';
  const server = spawn(binary, [], {
    cwd: here,
    env: cleanEnvironment({
      PGRST_DB_URI: db.toString(),
      PGRST_DB_SCHEMAS: 'public',
      PGRST_DB_EXTRA_SEARCH_PATH: 'public,extensions',
      PGRST_DB_ANON_ROLE: 'anon',
      PGRST_JWT_SECRET: testJwtSecret,
      PGRST_SERVER_HOST: '127.0.0.1',
      PGRST_SERVER_PORT: String(port),
      PGRST_DB_POOL: '3',
      PGRST_LOG_LEVEL: 'warn',
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout.on('data', (data) => { output += data; });
  server.stderr.on('data', (data) => { output += data; });
  let launchError;
  server.on('error', (error) => { launchError = error; });
  try {
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      if (launchError) throw launchError;
      if (server.exitCode !== null) throw new Error(`PostgREST exited early: ${output}`);
      try {
        const response = await fetch(apiUrl, { signal: AbortSignal.timeout(1000) });
        if ([200, 401, 403, 404].includes(response.status)) { ready = true; break; }
      } catch { /* Database schema cache may still be loading. */ }
      await delay(100);
    }
    if (!ready) throw new Error(`PostgREST did not become ready: ${output}`);
    await callback(apiUrl);
  } finally {
    server.kill('SIGTERM');
    await Promise.race([
      new Promise((resolve) => server.once('exit', resolve)),
      delay(3000).then(() => server.kill('SIGKILL')),
    ]);
  }
}

export function requireSuites({ sqlOnly = false } = {}) {
  for (const name of ['assertions.sql', 'fixtures.sql', ...(sqlOnly ? [] : ['api.test.mjs'])]) {
    if (!existsSync(`${here}/${name}`)) throw new Error(`Required test suite missing: ${name}`);
  }
}

export const newDefaultsSql = () => readFileSync(`${here}/new-defaults.sql`, 'utf8');
