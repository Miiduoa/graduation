import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { APP, EXPECTED_MACHINES } from './release-check.mjs';

// Runs inside each Web machine. Only a fixed success/failure marker leaves it.
export async function probeCareerRuntime(mode, options = {}) {
  let timer;
  try {
    await Promise.race([
      (async () => {
        if (mode === 'settings') {
          const env = options.env ?? process.env;
          const account = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_JSON ?? '');
          if (account?.project_id !== 'campus-one-tw' ||
              typeof account.client_email !== 'string' || !account.client_email ||
              typeof account.private_key !== 'string' || !account.private_key) throw new Error();
          const requireFromWeb = options.requireFromWeb ??
            (await import('node:module')).createRequire('/app/apps/web/server.js');
          const { cert, initializeApp } = requireFromWeb('firebase-admin/app');
          const { getFirestore } = requireFromWeb('firebase-admin/firestore');
          const app = initializeApp({ projectId: account.project_id, credential: cert({
            projectId: account.project_id, clientEmail: account.client_email,
            privateKey: account.private_key.replace(/\\n/g, '\n'),
          }) }, 'career-release-preflight');
          // A missing document is valid: the route uses the existing default choices.
          await getFirestore(app).doc('schools/pu/settings/careerSources').get();
        } else if (mode === 'feed') {
          const fetcher = options.fetcher ?? fetch;
          for (const school of ['pu', 'tw-pu']) {
            const response = await fetcher(`http://127.0.0.1:${process.env.PORT || 8080}/career/data?school=${school}`, {
              cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(15000),
            });
            const feed = await response.json();
            if (response.status !== 200 || feed?.supported !== true || feed.sourceSettingsStale !== false ||
                !Array.isArray(feed.announcements) || !Array.isArray(feed.jobs)) throw new Error();
          }
        } else throw new Error();
      })(),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error()), options.timeoutMs ?? (mode === 'settings' ? 5000 : 20000)); }),
    ]);
    return { ready: true };
  } catch {
    return { ready: false };
  } finally {
    clearTimeout(timer);
  }
}

export function checkCareerMachines(rows, mode, execute = execFileSync) {
  if (!['settings', 'feed'].includes(mode) || !Array.isArray(rows) || rows.length !== EXPECTED_MACHINES.length ||
      new Set(rows.map((row) => row?.id)).size !== EXPECTED_MACHINES.length ||
      !rows.every((row) => EXPECTED_MACHINES.includes(row?.id) && row.state === 'started')) {
    throw new Error('Unexpected career release probe target.');
  }
  const program = `(${probeCareerRuntime.toString()})(${JSON.stringify(mode)}).then(r=>{console.log('CAREER_RELEASE:'+JSON.stringify(r));process.exit(r.ready?0:1)})`;
  const command = `node -e '${program.replaceAll("'", "'\\''")}'`;
  return rows.map(({ id }) => {
    try {
      const result = JSON.parse(execute('flyctl', ['machine', 'exec', id, '--app', APP,
        '--timeout', '30', '--json', command], {
        encoding: 'utf8', timeout: 40000, maxBuffer: 65536, stdio: ['ignore', 'pipe', 'pipe'],
      }));
      if (result.exit_code !== undefined && result.exit_code !== 0) throw new Error();
      const markers = result.stdout.split(/\r?\n/).filter((line) => line.startsWith('CAREER_RELEASE:'));
      if (markers.length !== 1 || markers[0] !== 'CAREER_RELEASE:{"ready":true}') throw new Error();
      return { machineId: id, ready: true };
    } catch {
      // Never surface raw CLI/SDK output, credentials, or settings in logs/artifacts.
      throw new Error('Career release probe failed; verify Web runtime credentials and settings access before release.');
    }
  });
}

async function main() {
  const [mode, input, output] = process.argv.slice(2);
  const rows = JSON.parse(await readFile(input, 'utf8'));
  const machines = checkCareerMachines(rows, mode);
  await writeFile(output, JSON.stringify({ mode, machines }, null, 2) + '\n');
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(() => {
  console.error('Career release gate failed; no credentials or settings were recorded.');
  process.exitCode = 1;
});
