import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const SHA = /^[a-f0-9]{40}$/;
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
    const before = parseFingerprint(alias.reviewed);
    const after = parseFingerprint(alias.observed);
    assert.ok(reviewed.has(alias.reviewed), 'Alias has no previously reviewed fingerprint');
    assert.notEqual(before.commit, after.commit, 'Alias must identify a different commit');
    assert.deepEqual([before.path, before.rule, before.line], [after.path, after.rule, after.line], 'An alias cannot change its path, rule or line');
    assert.ok(!expected.has(alias.observed), 'Duplicate or already reviewed alias');
    expected.add(alias.observed);
  }
  assert.deepEqual(ignoreEntries(candidate), expected, 'Candidate must preserve every original entry and add only the declared exact aliases');
  return manifest.aliases;
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
    const git = (...args) => execFileSync('git', args, { cwd: root, stdio: 'pipe' });
    git('init', '-q'); git('config', 'user.name', 'Scanner control'); git('config', 'user.email', 'scanner@example.invalid');
    git('add', '.'); git('commit', '-qm', 'Synthetic scanner positive control');
    const report = join(root, 'report.json');
    const result = spawnSync('gitleaks', ['git', '--redact', '--no-banner', '--log-opts=HEAD', '--exit-code=1', '--report-format=json', `--report-path=${report}`], { cwd: root, encoding: 'utf8', timeout: 30000 });
    assert.equal(result.status, 1, 'Scanner must reject a new marker despite the historical ignore list');
    const findings = JSON.parse(readFileSync(report, 'utf8'));
    assert.ok(findings.some((item) => item.RuleID === 'gcp-api-key' && item.File === 'apps/mobile/eas.json' && item.StartLine === 55), 'Same-path/same-line new commit must still be detected');
    console.log('Positive control passed: the default rule detects a new marker at the previously reviewed path and line.');
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
