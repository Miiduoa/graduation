import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { blobSha, parseFingerprint, summarizeFindings, validateAliases, verifyAliases, verifyPublicWorkflowReference } from './verify-gitleaks-history.mjs';

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
const privacyFixtures = JSON.parse(readFileSync(new URL('./gitleaks-history-aliases.json', import.meta.url), 'utf8')).reviewedTestFixtures;
test('accepts only the two reviewed CLI privacy fixture squashes', async () => {
  assert.equal(privacyFixtures.length, 2);
  const m = { ...manifest(), reviewedTestFixtures: privacyFixtures };
  const updated = candidate + privacyFixtures.map((f) => f.observed).join('\n') + '\n';
  const pairs = validateAliases(m, baseline, updated);
  assert.equal(pairs.length, 3);
  const resolve = async (_commit, path) => privacyFixtures.find((f) => parseFingerprint(f.observed).path === path)?.reviewedBlob ?? 'c'.repeat(40);
  assert.equal((await verifyAliases(pairs, resolve)).length, 3);
  await assert.rejects(verifyAliases(pairs, async () => 'c'.repeat(40)), /pinned review/);
});
test('rejects changed fixture commit, path, rule, line and full blob', () => {
  const fixture = privacyFixtures[0];
  for (const change of [
    { reviewed: fixture.reviewed.replace(/^.{40}/, oldCommit) },
    { observed: fixture.observed.replace(/^.{40}/, newCommit) },
    { reviewed: fixture.reviewed.replace('.test.cjs', '.test.mjs') },
    { observed: fixture.observed.replace('generic-api-key', 'gcp-api-key') },
    { observed: fixture.observed.replace(':51', ':52') },
    { reviewedBlob: 'd'.repeat(40) },
    { reviewedBlob: undefined },
  ]) {
    const altered = { ...fixture, ...change };
    assert.throws(() => validateAliases({ ...manifest(), reviewedTestFixtures: [altered] }, baseline, candidate + altered.observed + '\n'));
  }
});
test('fixture inventory rejects duplicates, malformed entries and undeclared ignore records', () => {
  const fixture = privacyFixtures[0];
  assert.throws(() => validateAliases({ ...manifest(), reviewedTestFixtures: [fixture, fixture] }, baseline, candidate + fixture.observed + '\n'), /Duplicate/);
  for (const value of [null, {}, [null], ['not a fixture'], [...privacyFixtures, fixture]]) {
    assert.throws(() => validateAliases({ ...manifest(), reviewedTestFixtures: value }, baseline, candidate));
  }
  assert.throws(() => validateAliases({ ...manifest(), reviewedTestFixtures: privacyFixtures }, baseline, candidate), /Candidate must preserve/);
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
  assert.throws(() => validateAliases({ ...manifest(), reviewedTestFixtures: [fixture] }, baseline, ignore), /Unknown reviewed test fixture/);
});
test('the dedicated emulator record does not increase the two test-script fixture limit', () => {
  const fixtures = [1, 2, 3].map((line) => ({
    reviewed: `${oldCommit}:scripts/example.test.mjs:generic-api-key:${line}`,
    observed: `${newCommit}:scripts/example.test.mjs:generic-api-key:${line}`,
    reviewedBlob: 'c'.repeat(40),
  }));
  assert.throws(() => validateAliases({ ...manifest(), reviewedTestFixtures: fixtures }, baseline, candidate + fixtures.map((f) => f.observed).join('\n')), /Invalid reviewed fixture count/);
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

function workflowFixture() {
  const ref = { fingerprint: newCommit + ':scripts/merge-gate/policy.json:generic-api-key:4',
    workflowPath: '.github/workflows/example.yml', workflowBlob: 'c'.repeat(40) };
  const source = JSON.stringify({ baseline: oldCommit, workflowBlobs: { [ref.workflowPath]: ref.workflowBlob } }, null, 2);
  ref.policyBlob = blobSha(source);
  const resolve = (commit, path) => {
    if (commit === newCommit && path === 'scripts/merge-gate/policy.json') return ref.policyBlob;
    if ([oldCommit, newCommit].includes(commit) && path === ref.workflowPath) return ref.workflowBlob;
    throw new Error('Missing file');
  };
  return { ref, source, resolve };
}
test('the emulator alias preserves the public workflow reference and both strict privacy fixtures', () => {
  const { ref } = workflowFixture();
  const fixture = JSON.parse(readFileSync(new URL('./gitleaks-history-aliases.json', import.meta.url), 'utf8')).reviewedTronclassEmulatorFixture;
  const m = { ...manifest(), reviewedTestFixtures: privacyFixtures, reviewedTronclassEmulatorFixture: fixture, publicWorkflowReference: ref };
  const additions = [...privacyFixtures.map(({ observed }) => observed), fixture.observed, ref.fingerprint];
  const ignore = candidate + additions.join('\n') + '\n';
  assert.equal(validateAliases(m, baseline, ignore).length, 4);
  for (const required of additions) {
    assert.throws(() => validateAliases(m, baseline, ignore.replace(required + '\n', '')), /Candidate must preserve/);
  }
});
test('one declared public workflow mapping extends the original exact inventory', () => {
  const {ref} = workflowFixture();
  const m = { ...manifest(), publicWorkflowReference: ref };
  const updated = candidate + ref.fingerprint + '\n';
  validateAliases(m, baseline, updated);
  assert.throws(() => validateAliases(m, baseline, candidate));
  for (const changed of [ref.fingerprint.replace('generic-api-key', 'other'), ref.fingerprint.replace('policy.json', 'other.json')])
    assert.throws(() => validateAliases({...m, publicWorkflowReference: {...ref, fingerprint: changed}}, baseline, candidate + changed));
  assert.throws(() => validateAliases({...m, publicWorkflowReference: {...ref, workflowPath: '../example.yml'}}, baseline, updated));
});
test('the exact line and actual regular blob in both historical trees must match', () => {
  const {ref, source, resolve} = workflowFixture();
  assert.equal(verifyPublicWorkflowReference(ref, resolve, () => source).workflowBaseline, oldCommit);
  assert.throws(() => verifyPublicWorkflowReference({...ref, fingerprint: ref.fingerprint.replace(':4', ':3')}, resolve, () => source));
  assert.throws(() => verifyPublicWorkflowReference(ref, resolve, () => source + '\n'));
  for (const badRevision of [newCommit, oldCommit]) {
    const changed = (commit, path) => commit === badRevision && path === ref.workflowPath ? 'd'.repeat(40) : resolve(commit, path);
    assert.throws(() => verifyPublicWorkflowReference(ref, changed, () => source));
  }
  const extra = source.replace(/\n  }/, ', "other": "unreviewed"\n  }');
  const changed = {...ref, policyBlob: blobSha(extra)};
  assert.throws(() => verifyPublicWorkflowReference(changed, (commit, path) => path.endsWith('policy.json') ? changed.policyBlob : resolve(commit, path), () => extra));
  let readDifferentObject = false;
  assert.throws(() => verifyPublicWorkflowReference({...ref, policyBlob: 'd'.repeat(40)}, resolve, () => { readDifferentObject = true; return source; }));
  assert.equal(readDifferentObject, false);
});
