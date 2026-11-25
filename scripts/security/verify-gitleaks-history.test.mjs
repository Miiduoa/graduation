import assert from 'node:assert/strict';
import test from 'node:test';
import { blobSha, parseFingerprint, summarizeFindings, validateAliases, verifyAliases } from './verify-gitleaks-history.mjs';

const oldCommit = 'a'.repeat(40), newCommit = 'b'.repeat(40);
const reviewed = `${oldCommit}:fixtures/example.txt:generic-api-key:17`;
const observed = `${newCommit}:fixtures/example.txt:generic-api-key:17`;
const baseline = `# Original review\n${reviewed}\n`;
const candidate = baseline + observed + '\n';
const manifest = () => ({ version: 1, reviewBase: oldCommit, reviewedIgnoreBlob: blobSha(baseline), aliases: [{ reviewed, observed }] });

test('allows only a complete, same-position historical alias', () => {
  assert.equal(validateAliases(manifest(), baseline, candidate).length, 1);
});
for (const value of ['fixtures/example.txt:generic-api-key:17', `${newCommit}:../escape:key:1`, `${newCommit}:/absolute:key:1`, `${newCommit}:fixtures/*:key:1`, `${newCommit}:fixtures//file:key:1`, `${newCommit}:file:key:0`, `${newCommit}:file:key:1\nextra`, `${newCommit}:file:key:1\n`]) {
  test(`rejects non-exact fingerprint ${JSON.stringify(value)}`, () => assert.throws(() => parseFingerprint(value)));
}
for (const suffix of ['different.txt:generic-api-key:17', 'fixtures/example.txt:gcp-api-key:17', 'fixtures/example.txt:generic-api-key:18']) {
  test(`rejects changed fingerprint position ${suffix}`, () => {
    const m = manifest(); m.aliases[0].observed = `${newCommit}:${suffix}`;
    assert.throws(() => validateAliases(m, baseline, baseline + m.aliases[0].observed + '\n'));
  });
}
test('rejects changes to the pinned reviewed baseline', () => assert.throws(() => validateAliases(manifest(), baseline + '# changed\n', candidate)));
test('rejects a new finding with no prior reviewed fingerprint', () => {
  const m = manifest(); m.aliases[0].reviewed = `${'c'.repeat(40)}:fixtures/example.txt:generic-api-key:17`;
  assert.throws(() => validateAliases(m, baseline, candidate));
});
test('rejects removal of an existing exception', () => assert.throws(() => validateAliases(manifest(), baseline, observed + '\n')));
test('rejects an undeclared extra exception', () => assert.throws(() => validateAliases(manifest(), baseline, candidate + `${'c'.repeat(40)}:other.txt:generic-api-key:1\n`)));
test('rejects duplicate aliases and duplicate ignore entries', () => {
  const m = manifest(); m.aliases.push(m.aliases[0]);
  assert.throws(() => validateAliases(m, baseline, candidate));
  assert.throws(() => validateAliases(manifest(), baseline, candidate + observed + '\n'));
});
test('requires identical complete file blobs', async () => {
  const evidence = await verifyAliases(manifest().aliases, async () => 'c'.repeat(40));
  assert.equal(evidence[0].identicalFileBlob, 'c'.repeat(40));
  await assert.rejects(verifyAliases(manifest().aliases, async (commit) => commit));
});
test('a newly reviewed fixture exempts only its observed commit and must match its pinned complete blob', async () => {
  const fixture = {
    reviewed: `${oldCommit}:scripts/example.test.mjs:generic-api-key:51`,
    observed: `${newCommit}:scripts/example.test.mjs:generic-api-key:51`,
    reviewedBlob: 'c'.repeat(40),
  };
  const m = { ...manifest(), reviewedTestFixtures: [fixture] };
  const ignore = candidate + fixture.observed + '\n';
  const pairs = validateAliases(m, baseline, ignore);
  assert.equal((await verifyAliases(pairs, async () => fixture.reviewedBlob)).length, 2);
  await assert.rejects(verifyAliases(pairs, async () => 'd'.repeat(40)), /pinned review/);
  assert.throws(() => validateAliases(m, baseline, ignore + fixture.reviewed + '\n'));
  assert.throws(() => validateAliases({ ...manifest(), aliases: [fixture] }, baseline, ignore), /no previously reviewed fingerprint/);
  for (const change of [
    { reviewedBlob: undefined },
    { reviewed: fixture.reviewed.replace('.test.mjs', '.mjs') },
    { observed: fixture.observed.replace(':51', ':52') },
    { observed: fixture.reviewed },
  ]) {
    assert.throws(() => validateAliases({ ...m, reviewedTestFixtures: [{ ...fixture, ...change }] }, baseline, ignore));
  }
});
test('fails closed on missing blobs or lookup failures', async () => {
  await assert.rejects(verifyAliases(manifest().aliases, async () => undefined));
  await assert.rejects(verifyAliases(manifest().aliases, async () => { throw new Error('unavailable'); }));
});
test('allows only the reviewed TronClass main squash and requires its complete source blob', async () => {
  const fixture = {
    reviewed: '220cb2e2d74f0847a7d0241878413097dd183d6b:scripts/test-env/verify-tronclass.cjs:generic-api-key:53',
    observed: '149cfbe2f806ee15da1985854b34dfe72a7e07d9:scripts/test-env/verify-tronclass.cjs:generic-api-key:53',
    reviewedBlob: 'd85bd50fa1d4f0b86a36247b316822831f0d375a',
  };
  const m = { ...manifest(), reviewedTronclassEmulatorFixture: fixture };
  const ignore = candidate + fixture.observed + '\n';
  const pairs = validateAliases(m, baseline, ignore);
  const resolve = async (_commit, path) => path === 'scripts/test-env/verify-tronclass.cjs' ? fixture.reviewedBlob : 'c'.repeat(40);
  assert.equal((await verifyAliases(pairs, resolve)).length, 2);
  await assert.rejects(verifyAliases(pairs, async () => 'c'.repeat(40)), /pinned review/);
  await assert.rejects(verifyAliases(pairs, async (commit, path) => commit.startsWith('149cf') ? 'd'.repeat(40) : resolve(commit, path)), /differs from the reviewed blob/);
  assert.throws(() => validateAliases(m, baseline, ignore + fixture.reviewed + '\n'));
  for (const change of [
    { reviewed: fixture.reviewed.replace(/^.{40}/, oldCommit) },
    { observed: fixture.observed.replace(/^.{40}/, newCommit) },
    { reviewed: fixture.reviewed.replace('verify-tronclass.cjs', 'another.cjs'), observed: fixture.observed.replace('verify-tronclass.cjs', 'another.cjs') },
    { reviewed: fixture.reviewed.replace(':53', ':54'), observed: fixture.observed.replace(':53', ':54') },
    { reviewed: fixture.reviewed.replace(':generic-api-key:', ':gcp-api-key:'), observed: fixture.observed.replace(':generic-api-key:', ':gcp-api-key:') },
    { reviewedBlob: undefined },
    { reviewedBlob: 'c'.repeat(40) },
  ]) {
    const altered = { ...fixture, ...change };
    assert.throws(() => validateAliases({ ...m, reviewedTronclassEmulatorFixture: altered }, baseline, candidate + altered.observed + '\n'), /Only the reviewed TronClass/);
  }
  for (const invalid of [null, [], 'invalid']) {
    assert.throws(() => validateAliases({ ...m, reviewedTronclassEmulatorFixture: invalid }, baseline, ignore), /Invalid reviewed emulator/);
  }
  assert.throws(() => validateAliases({ ...manifest(), reviewedTestFixtures: [fixture] }, baseline, ignore), /test script/);
});
test('the dedicated emulator record does not increase the two test-script fixture limit', () => {
  const fixtures = [1, 2, 3].map((line) => ({
    reviewed: `${oldCommit}:scripts/example.test.mjs:generic-api-key:${line}`,
    observed: `${newCommit}:scripts/example.test.mjs:generic-api-key:${line}`,
    reviewedBlob: 'c'.repeat(40),
  }));
  assert.throws(() => validateAliases({ ...manifest(), reviewedTestFixtures: fixtures }, baseline, candidate + fixtures.map((f) => f.observed).join('\n')), /Invalid reviewed fixture count/);
});
test('requires the reviewed full lockfile before allowing its podspec checksum fingerprints', () => {
  const finding = 'a818d9e02eb57cadd7fe0a0041a1fedba452e8a4:apps/mobile/ios/Podfile.lock:generic-api-key:2526';
  const changed = candidate + finding + '\n';
  assert.throws(() => validateAliases(manifest(), baseline, changed));
  assert.throws(() => validateAliases(manifest(), baseline, changed, () => 'SPEC CHECKSUMS:\n'), /Historical lockfile differs/);
});
test('deduplicates blob reads without weakening per-finding verification', async () => {
  let calls = 0;
  const aliases = [...manifest().aliases, { reviewed: reviewed.replace(':17', ':18'), observed: observed.replace(':17', ':18') }];
  assert.equal((await verifyAliases(aliases, async () => { calls++; return 'c'.repeat(40); })).length, 2);
  assert.equal(calls, 2);
});
test('public scan summaries never include the match, secret or unknown fields', () => {
  const report = summarizeFindings([{ RuleID: 'test', File: 'file', StartLine: 1, Commit: oldCommit, Secret: 'not-for-output', Match: 'not-for-output', extra: 'not-for-output' }]);
  assert.equal(JSON.stringify(report).includes('not-for-output'), false);
  assert.deepEqual(summarizeFindings([]), { count: 0, findings: [] });
  assert.throws(() => summarizeFindings({}));
});
