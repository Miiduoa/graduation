import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const sharedPaths = new Set([
  '.github/workflows/nuni-merge-gate-tests.yml',
  'scripts/merge-gate/pr-scope.mjs',
  'scripts/merge-gate/pr-scope.test.mjs',
]);

const spatialFiles = new Set([
  '.github/workflows/campus-spatial-browser.yml',
  'apps/web/src/app/globals.css',
  'apps/web/tsconfig.json',
  'apps/web/package.json',
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
]);

// GitHub's single '*' never spans a directory separator.
const spatialFile = /^(?:apps\/web\/src\/components\/ui\/(?:Modal|modalSession|Button)|apps\/web\/src\/lib\/personalImportImagePreview|packages\/shared\/src\/(?:providenceCampus|campusGeo|campusMapRecords|campusClassroomLookup|campusMapLookup))[^/]*$/s;
const mobileAgentFile = /^backend\/functions\/agent\/(?:assignmentSummary|assignmentPaging)[^/]*$/s;
const pathRules = {
  maestro: path => path.startsWith('apps/mobile/') ||
    path.startsWith('scripts/maestro/') ||
    path === 'scripts/test-env/seed.cjs' || path === 'scripts/test-env/env.sh' ||
    path === 'firebase.test.json' ||
    path === 'packages/shared/src/wakeAwareRequest.ts' ||
    path === '.github/workflows/maestro-e2e.yml' ||
    path === 'scripts/merge-gate/maestro-reports.py' || path === 'scripts/merge-gate/maestro-reports.test.py',
  mobile: path => path.startsWith('apps/mobile/src/') ||
    path.startsWith('packages/shared/src/imports/') || mobileAgentFile.test(path) ||
    path === 'packages/shared/src/assistantExecution.ts' ||
    path === 'packages/shared/src/wakeAwareRequest.ts' ||
    path === 'backend/functions/agent/handlers/getCampusAssistantSnapshot.js' ||
    path === '.github/workflows/mobile-agent-regression.yml',
  spatial: path => spatialFiles.has(path) || spatialFile.test(path) ||
    path.startsWith('apps/web/src/app/map/') || path.startsWith('scripts/qa/campus-spatial/') ||
    path.startsWith('scripts/qa/browser/'),
};

export function requiresSuite(suite, diff) {
  if (!Object.hasOwn(pathRules, suite)) throw new Error('Unknown PR test suite');
  if (!Buffer.isBuffer(diff) || (diff.length && diff.at(-1) !== 0)) {
    throw new Error('Incomplete NUL-terminated Git path list');
  }
  // The tested paths are ASCII. latin1 preserves every byte even in non-UTF-8 filenames.
  const paths = diff.length ? diff.toString('latin1').slice(0, -1).split('\0') : [];
  if (paths.some(path => !path)) throw new Error('Invalid empty Git path');
  return paths.some(path => sharedPaths.has(path) || pathRules[suite](path));
}

export function readMergeDiff({ merge, base, head }, cwd = process.cwd()) {
  for (const sha of [merge, base, head]) {
    if (typeof sha !== 'string' || !/^[0-9a-f]{40}$/.test(sha)) throw new Error('Missing or invalid commit SHA');
  }
  const git = (...args) => execFileSync('git', args, { cwd, maxBuffer: 64 * 1024 * 1024 });
  if (git('rev-parse', 'HEAD').toString().trim() !== merge ||
      git('show', '-s', '--format=%P', merge).toString().trim() !== `${base} ${head}`) {
    throw new Error('Checkout does not match the event merge commit and both exact PR parents');
  }
  // Compare full Git trees, independent of sparse working-tree paths and REST pagination.
  // A rename is a deletion plus an addition so crossing a suite boundary covers both names.
  return git('diff-tree', '--no-commit-id', '-r', '--no-renames', '--name-only', '-z', base, merge);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { GITHUB_SHA: merge, PR_BASE_SHA: base, PR_HEAD_SHA: head, GITHUB_OUTPUT } = process.env;
  const required = requiresSuite(process.argv[2], readMergeDiff({ merge, base, head }));
  appendFileSync(GITHUB_OUTPUT, `required=${required}\n`);
  console.log(`PR suite ${process.argv[2]} ${required ? 'required' : 'not applicable'} at ${merge}`);
}
