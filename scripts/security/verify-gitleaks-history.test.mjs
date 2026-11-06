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
test('fails closed on missing blobs or lookup failures', async () => {
  await assert.rejects(verifyAliases(manifest().aliases, async () => undefined));
  await assert.rejects(verifyAliases(manifest().aliases, async () => { throw new Error('unavailable'); }));
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
