import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const SHA = /^[a-f0-9]{40}$/;
// #616's main squash repeats the byte-identical, loopback-only emulator helper.
// This is one reviewed file identity, not another general script allowlist.
const reviewedTronclassEmulatorFixture = Object.freeze({
  reviewed: '220cb2e2d74f0847a7d0241878413097dd183d6b:scripts/test-env/verify-tronclass.cjs:generic-api-key:53',
  observed: '149cfbe2f806ee15da1985854b34dfe72a7e07d9:scripts/test-env/verify-tronclass.cjs:generic-api-key:53',
  reviewedBlob: 'd85bd50fa1d4f0b86a36247b316822831f0d375a',
});
const podfilePath = 'apps/mobile/ios/Podfile.lock';
const podfileCommits = [
  'a818d9e02eb57cadd7fe0a0041a1fedba452e8a4',
  '08d3aa3e283b506e8e462f7aa6e1b771112e59a2',
];
const podfileBlob = 'cc00b26c76ebcc84c2081162a6ffae7e070f4e2a';
// SHA-1 of the published CocoaPods spec JSON bytes at each immutable source.
const reviewedPodspecs = [
  {
    name: 'AppAuth',
    line: 2526,
    checksum: '3a08d0739dfbebc98104f5baa69d23201122bfd9',
    source: 'https://github.com/CocoaPods/Specs/blob/8f48a332201cea6c31eeeeda4f148deaada2b548/Specs/b/b/9/AppAuth/2.1.0/AppAuth.podspec.json',
  },
  {
    name: 'GTMAppAuth',
    line: 2573,
    checksum: '9566e1a3451fd6967b58188fa15286fb6ae7914f',
    source: 'https://github.com/CocoaPods/Specs/blob/fd8ca834492e570dddaffabba6a5a1c12b5e92c3/Specs/2/c/c/GTMAppAuth/5.0.0/GTMAppAuth.podspec.json',
  },
];
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
export function validateAliases(manifest, baseline, candidate, readHistoricalPodfile) {
  assert.equal(manifest.version, 1, 'Unsupported manifest version');
  assert.match(manifest.reviewBase, SHA);
  assert.match(manifest.reviewedIgnoreBlob, SHA);
  assert.equal(blobSha(baseline), manifest.reviewedIgnoreBlob, 'Reviewed baseline changed');
  assert.ok(Array.isArray(manifest.aliases) && manifest.aliases.length > 0 && manifest.aliases.length <= 100, 'Invalid alias count');
  const reviewed = ignoreEntries(baseline);
  const expected = new Set(reviewed);
  if (readHistoricalPodfile) {
    for (const commit of podfileCommits) {
      const historicalPodfile = readHistoricalPodfile(commit);
      assert.equal(blobSha(historicalPodfile), podfileBlob, 'Historical lockfile differs from the reviewed blob');
      const lines = historicalPodfile.split('\n');
      for (const { name, line, checksum } of reviewedPodspecs) {
        assert.equal(lines[line - 1], `  ${name}: ${checksum}`, 'Historical line must match the reviewed public podspec checksum');
        expected.add(`${commit}:${podfilePath}:generic-api-key:${line}`);
      }
    }
  }
  for (const alias of manifest.aliases) {
    assert.ok(reviewed.has(alias.reviewed), 'Alias has no previously reviewed fingerprint');
  }
  const fixtures = manifest.reviewedTestFixtures ?? [];
  assert.ok(Array.isArray(fixtures) && fixtures.length <= 2, 'Invalid reviewed fixture count');
  for (const fixture of fixtures) {
    const { path, rule } = parseFingerprint(fixture.reviewed);
    assert.ok(path.startsWith('scripts/') && /\.test\.[cm]js$/.test(path) && rule === 'generic-api-key', 'Fixture must be an exact finding in a test script');
    assert.match(fixture.reviewedBlob, SHA, 'A reviewed test fixture requires a pinned Git blob');
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
    const { reviewedTestFixtures, reviewedTronclassEmulatorFixture: emulatorFixture } = JSON.parse(readFileSync('scripts/security/gitleaks-history-aliases.json', 'utf8'));
    const fixturePositions = reviewedTestFixtures.map(({ observed }) => parseFingerprint(observed));
    if (emulatorFixture) fixturePositions.push(parseFingerprint(emulatorFixture.observed));
    const podPositions = reviewedPodspecs.map(({ line }) => ({ path: podfilePath, rule: 'generic-api-key', line }));
    const positions = [...fixturePositions, ...podPositions];
    const files = new Map();
    for (const { path, line } of positions) {
      if (!files.has(path)) files.set(path, []);
      files.get(path)[line - 1] = `const secret = '${randomBytes(32).toString('base64url')}';`;
    }
    for (const [path, lines] of files) {
      const file = join(root, path);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, lines.join('\n') + '\n');
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
  const readHistoricalPodfile = (commit) => execFileSync('git', ['show', `${commit}:${podfilePath}`], { encoding: 'utf8' });
  const aliases = validateAliases(manifest, baseline, readFileSync('.gitleaksignore', 'utf8'), readHistoricalPodfile);
  const evidence = await verifyAliases(aliases, githubBlob);
  mkdirSync('security-evidence', { recursive: true });
  writeFileSync('security-evidence/verified-podspecs.json', JSON.stringify({ commits: podfileCommits, path: podfilePath, blob: podfileBlob, podspecs: reviewedPodspecs }, null, 2) + '\n');
  writeFileSync('security-evidence/verified-aliases.json', `${JSON.stringify({ reviewBase: manifest.reviewBase, count: evidence.length, evidence }, null, 2)}\n`);
  console.log(`Verified ${evidence.length} exact fingerprints against their reviewed file blobs.`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => { console.error(`Security history verification failed: ${String(error.message).split('\n')[0]}`); process.exitCode = 1; });
}
