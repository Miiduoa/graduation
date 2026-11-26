import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { readMergeDiff, requiresSuite } from './pr-scope.mjs';

const diff = (...paths) => Buffer.from(paths.length ? `${paths.join('\0')}\0` : '');
const suites = ['maestro', 'mobile', 'spatial'];
const forPath = path => suites.filter(suite => requiresSuite(suite, diff(path)));

test('retains previous path selection and tests classifier and workflow edits', () => {
  for (const [path, expected] of [
    ['docs/guide.md', []], ['apps/mobile/src/pages/Calendar.tsx', ['maestro', 'mobile']],
    ['apps/mobile/ios/Podfile', ['maestro']], ['packages/shared/src/wakeAwareRequest.ts', ['maestro', 'mobile']],
    ['scripts/maestro/start-emulators.sh', ['maestro']], ['scripts/maestro/nested/check.mjs', ['maestro']],
    ['scripts/test-env/seed.cjs', ['maestro']], ['scripts/test-env/env.sh', ['maestro']],
    ['firebase.test.json', ['maestro']], ['scripts/maestro-not-applicable.md', []],
    ['packages/shared/src/assistantExecution.ts', ['mobile']], ['packages/shared/src/imports/a/b.ts', ['mobile']],
    ['backend/functions/agent/assignmentPaging.test.js', ['mobile']], ['backend/functions/agent/assignmentSummary/sub.js', []],
    ['backend/functions/agent/handlers/getCampusAssistantSnapshot.js', ['mobile']],
    ['apps/web/src/app/map/nested/a', ['spatial']], ['apps/web/src/app/globals.css', ['spatial']],
    ['apps/web/src/components/ui/Modal.tsx', ['spatial']], ['apps/web/src/components/ui/Button/group.tsx', []],
    ['apps/web/src/components/ui/modalSession.test.ts', ['spatial']], ['apps/web/src/lib/personalImportImagePreview.ts', ['spatial']],
    ['packages/shared/src/campusGeo.test.ts', ['spatial']], ['packages/shared/src/providenceCampus.ts', ['spatial']],
    ['packages/shared/src/campusMapRecords.ts', ['spatial']], ['packages/shared/src/campusClassroomLookup.ts', ['spatial']],
    ['packages/shared/src/campusMapLookup.ts', ['spatial']], ['scripts/qa/browser/nested/check.sh', ['spatial']],
    ['scripts/qa/campus-spatial/test.py', ['spatial']], ['pnpm-lock.yaml', ['spatial']],
    ['pnpm-workspace.yaml', ['spatial']], ['apps/web/tsconfig.json', ['spatial']],
    ['package.json', ['spatial']], ['apps/web/package.json', ['spatial']],
    ['.github/workflows/mobile-agent-regression.yml', ['mobile']], ['.github/workflows/maestro-e2e.yml', ['maestro']],
    ['.github/workflows/campus-spatial-browser.yml', ['spatial']], ['scripts/merge-gate/maestro-reports.py', ['maestro']],
    ['.github/workflows/nuni-merge-gate-tests.yml', suites], ['scripts/merge-gate/maestro-reports.test.py', ['maestro']],
    ['scripts/merge-gate/pr-scope.mjs', suites], ['scripts/merge-gate/pr-scope.test.mjs', suites],
  ]) assert.deepEqual(forPath(path), expected, path);
  assert.throws(() => requiresSuite('missing', diff()));
});

test('does not truncate the changed paths at an API page or interpret filenames as lines', () => {
  const docs = Array.from({ length: 3500 }, (_, i) => `docs/note-${i}.md`);
  assert.equal(requiresSuite('maestro', diff(...docs, 'apps/mobile/final.txt')), true);
  assert.equal(requiresSuite('spatial', diff('docs/path\napps/web/src/app/map/a.ts')), false);
  assert.equal(requiresSuite('maestro', diff('apps/mobile/a\nb.py')), true);
  assert.throws(() => requiresSuite('mobile', Buffer.from('partial list')));
  assert.throws(() => requiresSuite('mobile', Buffer.from('\0')));
});

test('reads exact shallow PR merge parents and both ends of a rename outside sparse checkout', t => {
  const root = mkdtempSync(join(tmpdir(), 'nuni-scope-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const source = join(root, 'source');
  const checkout = join(root, 'shallow');
  mkdirSync(source);
  const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=Test', '-c',
    'user.email=test@example.invalid', '-c', 'commit.gpgSign=false', ...args], { cwd, encoding: 'utf8' }).trim();
  git(source, 'init', '-q', '-b', 'main');
  mkdirSync(join(source, 'apps/mobile'), { recursive: true });
  writeFileSync(join(source, 'apps/mobile', 'a\nb.ts'), 'tracked content\n');
  git(source, 'add', '.'); git(source, 'commit', '-qm', 'base');
  const base = git(source, 'rev-parse', 'HEAD');
  git(source, 'checkout', '-qb', 'candidate');
  mkdirSync(join(source, 'docs')); renameSync(join(source, 'apps/mobile', 'a\nb.ts'), join(source, 'docs', 'moved.ts'));
  git(source, 'add', '-A'); git(source, 'commit', '-qm', 'move');
  const head = git(source, 'rev-parse', 'HEAD');
  git(source, 'checkout', '-q', 'main'); git(source, 'merge', '--no-ff', '-qm', 'test merge', head);
  const merge = git(source, 'rev-parse', 'HEAD');
  git(root, 'clone', '-q', '--depth', '2', '--no-local', '--single-branch', '--no-checkout', source, checkout);
  git(checkout, 'sparse-checkout', 'init', '--no-cone');
  git(checkout, 'sparse-checkout', 'set', '--no-cone', '/scripts/merge-gate/pr-scope.mjs');
  git(checkout, 'checkout', '-q', '--detach', merge);
  const paths = readMergeDiff({ merge, base, head }, checkout);
  assert.deepEqual(paths, diff('apps/mobile/a\nb.ts', 'docs/moved.ts'));
  assert.equal(requiresSuite('maestro', paths), true);
  for (const incorrect of [{ merge: head, base, head }, { merge, base: head, head: base }, { merge, base, head: '' }]) {
    assert.throws(() => readMergeDiff(incorrect, checkout));
  }
});

test('all three native verdicts reject missing, failed, cancelled or skipped applicable tests', () => {
  for (const file of ['maestro-e2e.yml', 'mobile-agent-regression.yml', 'campus-spatial-browser.yml']) {
    const source = readFileSync(new URL(`../../.github/workflows/${file}`, import.meta.url), 'utf8');
    const trigger = source.split('\n  pull_request:\n')[1].split(/\n(?=  [a-z_]+:|[^ #\n])/)[0];
    assert.ok(trigger.includes('main') && !trigger.includes('paths:'), file);
    assert.ok(source.includes("(needs.scope.result == 'success' && needs.scope.outputs.required == 'true'))"));
    const verdict = source.split('\n  pr-result:\n')[1];
    assert.ok(verdict.includes("if: always() && github.event_name == 'pull_request'"));
    assert.ok(verdict.includes("github.event_name == 'pull_request' && github.base_ref == 'main' &&"));
    assert.ok(verdict.includes('other result'));
    const shell = verdict.split('        run: |\n')[1].trimEnd().replace(/^          /gm, '');
    for (const [scope, required, result, passed] of [
      ['success', 'true', 'success', true], ['success', 'false', 'skipped', true],
      ['failure', 'false', 'skipped', false], ['cancelled', 'true', 'skipped', false],
      ['skipped', 'false', 'skipped', false], ['success', '', 'skipped', false],
      ['success', 'true', 'failure', false], ['success', 'true', 'cancelled', false],
      ['success', 'true', 'skipped', false], ['success', 'true', '', false],
    ]) {
      const { status } = spawnSync('bash', ['-c', shell], { env: { SCOPE: scope, REQUIRED: required, TEST: result } });
      assert.equal(status === 0, passed, `${file}: ${scope}/${required}/${result}`);
    }
  }
});
