import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const SHA = /^[a-f0-9]{40}$/;
// These two fixed, nonfunctional strings test that CLI errors do not echo
// private input. Their squash commits repeat the complete reviewed test blobs.
// The inventory is intentionally exact: another commit, line or file needs review.
const reviewedTestFixtures = Object.freeze([
  {
    reviewed: '86922724ef4de26b36b8e25ce96a751a9d5c7e9c:scripts/audit-group-post-visibility.test.cjs:generic-api-key:51',
    observed: '2a9bad18dd88a6873b08063df8b308e5df2cf9e0:scripts/audit-group-post-visibility.test.cjs:generic-api-key:51',
    reviewedBlob: '95536dff7ce30ef1e27d43182c816019977caf71',
  },
  {
    reviewed: '7a26c85c0fc3a68943ce1887fde8c371e76977f8:scripts/qa/course-study/compare.test.mjs:generic-api-key:494',
    observed: '66a88348a216bbeee31e332968ca8cc39e4eea70:scripts/qa/course-study/compare.test.mjs:generic-api-key:494',
    reviewedBlob: '03dcd5a143da8c61ac4400ff9b3525b0b87ad0c2',
  },
]);
// #616's main squash repeats the byte-identical, loopback-only emulator helper.
// This is one reviewed file identity, not another general script allowlist.
const reviewedTronclassEmulatorFixture = Object.freeze({
  reviewed: '220cb2e2d74f0847a7d0241878413097dd183d6b:scripts/test-env/verify-tronclass.cjs:generic-api-key:53',
  observed: '149cfbe2f806ee15da1985854b34dfe72a7e07d9:scripts/test-env/verify-tronclass.cjs:generic-api-key:53',
  reviewedBlob: 'd85bd50fa1d4f0b86a36247b316822831f0d375a',
});
const FINGERPRINT = /^([a-f0-9]{40}):([A-Za-z0-9_./-]+):([a-z0-9-]+):([1-9][0-9]*)$/;
export function parseFingerprint(value) {
  const match = typeof value === 'string' && value.match(FINGERPRINT);
  assert.ok(match && match[0] === value, 'A complete commit/path/rule/line fingerprint is required');
  const [, commit, path, rule, line] = match;
  assert.ok(!path.startsWith('/') && !path.split('/').some((part) => !part || part === '.' || part === '..'), 'Unsafe fingerprint path');
  return { commit, path, rule, line: Number(line) };
}
export function ignoreEntries(text) {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith('#'));
  lines.forEach(parseFingerprint);
  assert.equal(new Set(lines).size, lines.length, 'Duplicate ignore fingerprints');
  return new Set(lines);
}
export function blobSha(text) {
  const bytes = Buffer.from(text);
  return createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
}
export function validateAliases(manifest, baseline, candidate) {
  assert.equal(manifest.version, 1, 'Unsupported manifest version');
  assert.match(manifest.reviewBase, SHA);
  assert.match(manifest.reviewedIgnoreBlob, SHA);
  assert.equal(blobSha(baseline), manifest.reviewedIgnoreBlob, 'Reviewed baseline changed');
  assert.ok(Array.isArray(manifest.aliases) && manifest.aliases.length > 0 && manifest.aliases.length <= 100, 'Invalid alias count');
  const reviewed = ignoreEntries(baseline);
  const expected = new Set(reviewed);
  for (const alias of manifest.aliases) {
    assert.ok(reviewed.has(alias.reviewed), 'Alias has no previously reviewed fingerprint');
  }
  const fixtures = manifest.reviewedTestFixtures === undefined ? [] : manifest.reviewedTestFixtures;
  assert.ok(Array.isArray(fixtures) && fixtures.length <= reviewedTestFixtures.length, 'Invalid reviewed fixture count');
  for (const fixture of fixtures) {
    assert.ok(fixture && typeof fixture === 'object' && !Array.isArray(fixture), 'Invalid reviewed test fixture');
    const { reviewed, observed, reviewedBlob } = fixture;
    const pinned = reviewedTestFixtures.find((entry) => entry.observed === observed);
    assert.ok(pinned, 'Unknown reviewed test fixture');
    assert.deepEqual({ reviewed, observed, reviewedBlob }, pinned, 'Historical test fixture must keep its exact reviewed fingerprint and blob');
  }
  const emulatorFixture = manifest.reviewedTronclassEmulatorFixture;
  if (emulatorFixture !== undefined) {
    assert.ok(emulatorFixture && typeof emulatorFixture === 'object' && !Array.isArray(emulatorFixture), 'Invalid reviewed emulator fixture');
    const { reviewed, observed, reviewedBlob } = emulatorFixture;
    assert.deepEqual({ reviewed, observed, reviewedBlob }, reviewedTronclassEmulatorFixture, 'Only the reviewed TronClass squash fingerprint and complete blob are allowed');
  }
  const pairs = [...manifest.aliases, ...fixtures, ...(emulatorFixture ? [emulatorFixture] : [])];
  for (const alias of pairs) {
    const before = parseFingerprint(alias.reviewed);
    const after = parseFingerprint(alias.observed);
    assert.notEqual(before.commit, after.commit, 'Alias must identify a different commit');
    assert.deepEqual([before.path, before.rule, before.line], [after.path, after.rule, after.line], 'An alias cannot change its path, rule or line');
    assert.ok(!expected.has(alias.observed), 'Duplicate or already reviewed alias');
    expected.add(alias.observed);
  }
  assert.deepEqual(ignoreEntries(candidate), expected, 'Candidate must preserve every original entry and add only the declared exact aliases');
  return pairs;
}
export async function verifyAliases(aliases, resolveBlob) {
  const cache = new Map();
  const resolve = (fingerprint) => {
    const { commit, path } = parseFingerprint(fingerprint);
    const key = `${commit}:${path}`;
    if (!cache.has(key)) cache.set(key, Promise.resolve().then(() => resolveBlob(commit, path)));
    return cache.get(key);
  };
  const evidence = [];
  for (const alias of aliases) {
    const [before, after] = await Promise.all([resolve(alias.reviewed), resolve(alias.observed)]);
    assert.ok(SHA.test(before) && SHA.test(after), 'Missing or invalid Git blob identity');
    assert.equal(after, before, `Historical file differs from the reviewed blob: ${alias.observed}`);
    if (alias.reviewedBlob !== undefined) assert.equal(before, alias.reviewedBlob, 'Historical test fixture differs from its pinned review');
    evidence.push({ ...alias, identicalFileBlob: after });
  }
  return evidence;
}
async function githubBlob(commit, path) {
  const repository = process.env.GITHUB_REPOSITORY;
  assert.equal(repository, 'Miiduoa/graduation', 'Unexpected verification repository');
  const headers = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const url = `https://api.github.com/repos/${repository}/contents/${path.split('/').map(encodeURIComponent).join('/')}?ref=${commit}`;
  const response = await fetch(url, { headers, redirect: 'error', signal: AbortSignal.timeout(15000) });
  assert.ok(response.ok, `Historical blob lookup failed (HTTP ${response.status})`);
  const data = await response.json();
  assert.equal(data.type, 'file', 'Historical path is not a file');
  return data.sha;
}
export function summarizeFindings(findings) {
  assert.ok(Array.isArray(findings), 'Invalid scanner report');
  return { count: findings.length, findings: findings.map((finding) => ({ rule: finding.RuleID, file: finding.File, line: finding.StartLine, commit: finding.Commit })) };
}
function positiveControl() {
  const root = mkdtempSync(join(tmpdir(), 'campus-secret-scan-control-'));
  try {
    mkdirSync(join(root, 'apps/mobile'), { recursive: true });
    writeFileSync(join(root, '.gitleaksignore'), readFileSync('.gitleaksignore'));
    // Generated, nonfunctional test marker. Never print or upload its value.
    const marker = ['AIza', randomBytes(32).toString('base64url').slice(0, 35)].join('');
    writeFileSync(join(root, 'apps/mobile/eas.json'), ['{', ...Array(53).fill(''), `"apiKey": "${marker}"`, '}'].join('\n'));
    const manifest = JSON.parse(readFileSync('scripts/security/gitleaks-history-aliases.json', 'utf8'));
    const positions = (manifest.reviewedTestFixtures ?? []).map(({ observed }) => parseFingerprint(observed));
    if (manifest.reviewedTronclassEmulatorFixture) positions.push(parseFingerprint(manifest.reviewedTronclassEmulatorFixture.observed));
    for (const { path, line } of positions) {
      const file = join(root, path);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, [...Array(line - 1).fill(''), `const secret = '${randomBytes(32).toString('base64url')}';`, ''].join('\n'));
    }
    const git = (...args) => execFileSync('git', args, { cwd: root, stdio: 'pipe' });
    git('init', '-q'); git('config', 'user.name', 'Scanner control'); git('config', 'user.email', 'scanner@example.invalid');
    git('add', '.'); git('commit', '-qm', 'Synthetic scanner positive control');
    const report = join(root, 'report.json');
    const result = spawnSync('gitleaks', ['git', '--redact', '--no-banner', '--log-opts=HEAD', '--exit-code=1', '--report-format=json', `--report-path=${report}`], { cwd: root, encoding: 'utf8', timeout: 30000 });
    assert.equal(result.status, 1, 'Scanner must reject a new marker despite the historical ignore list');
    const findings = JSON.parse(readFileSync(report, 'utf8'));
    assert.ok(findings.some((item) => item.RuleID === 'gcp-api-key' && item.File === 'apps/mobile/eas.json' && item.StartLine === 55), 'Same-path/same-line new commit must still be detected');
    for (const { path, rule, line } of positions) {
      assert.ok(findings.some((item) => item.RuleID === rule && item.File === path && item.StartLine === line), 'New commit at a reviewed position must still be detected');
    }
    console.log(`Positive control passed: default rules detected new markers at all ${positions.length + 1} reviewed positions.`);
  } finally { rmSync(root, { recursive: true, force: true }); }
}
async function main() {
  if (process.argv[2] === 'positive-control') return positiveControl();
  if (process.argv[2] === 'summarize') {
    console.log(JSON.stringify(summarizeFindings(JSON.parse(readFileSync(process.argv[3], 'utf8'))), null, 2));
    return;
  }
  assert.equal(process.argv[2], 'verify', 'Use verify, summarize or positive-control');
  const manifest = JSON.parse(readFileSync('scripts/security/gitleaks-history-aliases.json', 'utf8'));
  assert.match(manifest.reviewBase, SHA);
  const baseline = execFileSync('git', ['show', `${manifest.reviewBase}:.gitleaksignore`], { encoding: 'utf8' });
  const aliases = validateAliases(manifest, baseline, readFileSync('.gitleaksignore', 'utf8'));
  const evidence = await verifyAliases(aliases, githubBlob);
  mkdirSync('security-evidence', { recursive: true });
  writeFileSync('security-evidence/verified-aliases.json', `${JSON.stringify({ reviewBase: manifest.reviewBase, count: evidence.length, evidence }, null, 2)}\n`);
  console.log(`Verified ${evidence.length} exact aliases against identical previously reviewed file blobs.`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => { console.error(`Security history verification failed: ${String(error.message).split('\n')[0]}`); process.exitCode = 1; });
}
