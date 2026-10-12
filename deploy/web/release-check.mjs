import { readFile, writeFile, appendFile, mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export const APP = 'nuni-web';
export const ORIGIN = 'https://nuni.tw';
export const REPOSITORY = 'Miiduoa/graduation';
export const EXPECTED_MACHINES = ['683e513be2d358', '80e447b6140178'];
const SHA = /^[a-f0-9]{40}$/;
const IMAGE = /^registry\.fly\.io\/nuni-web@sha256:[a-f0-9]{64}$/;
const object = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const fail = (message) => { throw new Error(message); };
const json = async (file) => JSON.parse(await readFile(file, 'utf8'));
const save = (file, data) => writeFile(file, `${JSON.stringify(data, null, 2)}\n`);

export function validateTarget(env) {
  if (env.GITHUB_REPOSITORY !== REPOSITORY || env.GITHUB_REF !== 'refs/heads/main' ||
      env.CONFIRM_APP !== APP || !SHA.test(env.EXPECTED_RELEASE_SHA ?? '') ||
      env.EXPECTED_RELEASE_SHA !== env.GITHUB_SHA) fail('Wrong repository, branch, app confirmation, or source revision.');
  return env.EXPECTED_RELEASE_SHA;
}

export function validateFirebase(config) {
  if (!object(config) || config.projectId !== 'campus-one-tw') fail('Firebase project must be campus-one-tw.');
  const mapping = { apiKey: 'API_KEY', authDomain: 'AUTH_DOMAIN', projectId: 'PROJECT_ID',
    storageBucket: 'STORAGE_BUCKET', messagingSenderId: 'MESSAGING_SENDER_ID', appId: 'APP_ID' };
  for (const key of Object.keys(mapping)) {
    if (typeof config[key] !== 'string' || !config[key].trim() || /[\r\n]/.test(config[key]) ||
        /mock|placeholder|dummy/i.test(config[key])) fail(`Missing or invalid Firebase browser setting: ${key}`);
  }
  if (!/^AIza[A-Za-z0-9_-]{35}$/.test(config.apiKey) ||
      !['nuni.tw', 'campus-one-tw.firebaseapp.com'].includes(config.authDomain) ||
      !['campus-one-tw.firebasestorage.app', 'campus-one-tw.appspot.com'].includes(config.storageBucket) ||
      !/^\d+$/.test(config.messagingSenderId) ||
      !new RegExp(`^1:${config.messagingSenderId}:web:[a-f0-9]+$`).test(config.appId)) fail('Firebase browser settings do not match the approved project.');
  return Object.fromEntries(Object.entries(mapping).map(([key, suffix]) => [`NEXT_PUBLIC_FIREBASE_${suffix}`, config[key]]));
}

export function summarizeMachines(rows) {
  if (!Array.isArray(rows) || rows.length !== EXPECTED_MACHINES.length) fail('Machine count changed; refusing to resize or replace infrastructure.');
  const summary = rows.map((row) => {
    if (!object(row) || !EXPECTED_MACHINES.includes(row.id) || row.region !== 'nrt' || row.state !== 'started') fail('Unexpected or unhealthy machine.');
    const guest = row.config?.guest;
    if (guest?.cpu_kind !== 'shared' || guest?.cpus !== 1 || guest?.memory_mb !== 512) fail('Machine sizing differs from the approved existing machines.');
    const image = IMAGE.test(row.config?.image ?? '') ? row.config.image :
      row.image_ref?.registry === 'registry.fly.io' && row.image_ref?.repository === APP ?
        `registry.fly.io/${APP}@${row.image_ref.digest}` : '';
    if (!IMAGE.test(image)) fail('Cannot establish an immutable rollback image.');
    // Allowlist only: raw machine config may contain private values and is never an artifact.
    return { id: row.id, region: row.region, state: row.state, image,
      size: { cpu_kind: guest.cpu_kind, cpus: guest.cpus, memory_mb: guest.memory_mb } };
  }).sort((a, b) => a.id.localeCompare(b.id));
  if (new Set(summary.map((row) => row.id)).size !== EXPECTED_MACHINES.length) fail('Duplicate machine identifiers.');
  if (new Set(summary.map((row) => row.image)).size !== 1) fail('An existing rolling deployment is in progress; no changes made.');
  return summary;
}

export function requireStable(before, current) {
  if (JSON.stringify(before) !== JSON.stringify(current)) fail('Production changed during build; refusing to overwrite another release.');
}

export async function getJson(url, { fetcher = fetch, headers = {}, query } = {}) {
  const response = await fetcher(url, { method: query ? 'POST' : 'GET', cache: 'no-store',
    redirect: 'error', credentials: 'omit', signal: AbortSignal.timeout(15000),
    headers: { Accept: 'application/json', ...headers, ...(query ? { 'Content-Type': 'application/json' } : {}) },
    ...(query ? { body: JSON.stringify(query) } : {}) });
  if (!response.headers.get('content-type')?.includes('application/json')) fail('Expected a JSON response.');
  return { status: response.status, body: await response.json() };
}

export async function inspectPublic(expected, fetcher = fetch) {
  if (!SHA.test(expected ?? '')) fail('A full expected revision is required.');
  const health = await getJson(`${ORIGIN}/health/ready`, { fetcher });
  const webReady = health.status === 200 && health.body?.service === 'campus-one-web' &&
    health.body.status === 'ready' && health.body.legacy === 'ready' && health.body.revision === expected;
  const pages = [];
  for (const path of ['/', '/bus', '/login']) {
    const response = await fetcher(`${ORIGIN}${path}`, { cache: 'no-store', redirect: 'error',
      credentials: 'omit', signal: AbortSignal.timeout(15000) });
    const html = await response.text();
    pages.push({ path, status: response.status, html: response.headers.get('content-type')?.includes('text/html') === true,
      newBusPage: path !== '/bus' || ['學校站牌', '找我附近', '搜尋站名', '常用站牌'].every((text) => html.includes(text)),
      geolocationAllowed: path !== '/bus' || /geolocation=\(self\)/.test(response.headers.get('permissions-policy') ?? '') });
  }
  let transit = { status: 'network-error', stationCount: 0 };
  try {
    const result = await getJson(`${ORIGIN}/api/transit`, { fetcher, query: { action: 'campus', schoolId: 'pu' } });
    const body = result.body;
    if (result.status === 200 && body?.status === 'ready' && body.kind === 'stops' && Array.isArray(body.stops)) {
      transit = { status: body.stops.length ? 'stations-received' : 'no-stations', stationCount: body.stops.length };
    } else {
      const known = ['not-configured', 'invalid-query', 'rate-limited', 'upstream', 'network'];
      transit.status = body?.status === 'unavailable' && known.includes(body.reason) ? body.reason : 'invalid-response';
    }
  } catch { /* Preserve web outcome separately from a provider outage. */ }
  return { checkedAt: new Date().toISOString(), origin: ORIGIN, expectedRevision: expected,
    revision: SHA.test(health.body?.revision ?? '') ? health.body.revision : null,
    webDeployed: webReady && pages.every((page) => page.status === 200 && page.html && page.geolocationAllowed && page.newBusPage),
    pages, transit, browserControlsVerified: false, liveArrivalsVerified: false };
}

async function requireMainAndCi(env) {
  const expected = validateTarget(env);
  if (!env.GH_TOKEN) fail('GitHub read token missing.');
  const headers = { Authorization: `Bearer ${env.GH_TOKEN}`, 'X-GitHub-Api-Version': '2022-11-28' };
  const base = `https://api.github.com/repos/${REPOSITORY}`;
  const main = await getJson(`${base}/branches/main`, { headers });
  if (main.status !== 200 || main.body?.commit?.sha !== expected) fail('The main branch advanced; rerun against the new revision after its CI passes.');
  const runs = await getJson(`${base}/actions/workflows/ci.yml/runs?head_sha=${expected}&event=push&per_page=100`, { headers });
  const latest = Array.isArray(runs.body?.workflow_runs) ? runs.body.workflow_runs
    .filter((run) => run.head_sha === expected && run.event === 'push')
    .sort((a, b) => b.id - a.id)[0] : null;
  if (runs.status !== 200 || latest?.status !== 'completed' || latest?.conclusion !== 'success') fail('The latest full CI for this exact main revision has not passed.');
  console.log(`Verified source and successful CI for ${expected}.`);
}

async function main() {
  const [command, input, output] = process.argv.slice(2);
  const env = process.env;
  await mkdir('release-evidence', { recursive: true });
  if (command === 'gate') return requireMainAndCi(env);
  if (command === 'firebase') {
    // Firebase's documented public SDK config, not a service-account or refresh token.
    const response = await getJson('https://campus-one-tw.web.app/__/firebase/init.json');
    if (response.status !== 200) fail('Approved Firebase Hosting SDK configuration is unavailable.');
    const values = validateFirebase(response.body);
    if (!env.GITHUB_ENV) fail('GitHub environment file unavailable.');
    await appendFile(env.GITHUB_ENV, Object.entries(values).map(([key, value]) => `${key}=${value}\n`).join(''));
    console.log('Validated all six public Firebase browser settings for campus-one-tw; values not logged.');
    return;
  }
  if (command === 'snapshot') {
    const rows = summarizeMachines(await json(input));
    await save(output, rows);
    return;
  }
  if (command === 'stable') return requireStable(await json(input), await json(output));
  if (command === 'verify') {
    const report = await inspectPublic(env.EXPECTED_RELEASE_SHA);
    await save('release-evidence/public-check.json', report);
    if (env.GITHUB_STEP_SUMMARY) await appendFile(env.GITHUB_STEP_SUMMARY,
      `## Campus One Web release\n\nExpected: ${report.expectedRevision}\n\nObserved: ${report.revision ?? 'unknown'}\n\nWeb deployment verified: ${report.webDeployed}\n\nTransit station query: ${report.transit.status}\n\nLive arrivals and device geolocation require separate verification.\n`);
    if (!report.webDeployed) fail('Public Web verification did not pass. Inspect the evidence before any rollback.');
    return;
  }
  fail('Unknown release check command.');
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch((error) => {
  // Our deliberate guard errors contain no secret/provider response contents.
  console.error(error instanceof Error && !['TypeError', 'SyntaxError'].includes(error.name)
    ? error.message : 'Release check failed; inspect the step and retry.');
  process.exitCode = 1;
});
