import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

// This entry point imports API source directly; its only workspace runtime
// dependency (@campus/contracts) also exports source. Installed dependencies
// outside these roots are not part of the candidate Git tree.
const runtimePaths = ['apps/api/src', 'packages/contracts/src'];

export function assertPinnedNuniSource(source, candidateTree) {
  const git = (...args) => execFileSync('git', args, { cwd: source, encoding: 'utf8' });
  git('diff', '--quiet');
  const tree = git('write-tree').trim();
  assert.equal(tree, candidateTree, 'Only the pinned, reconstructed API tree may run');
  // Migration discovery reads the directory, not Git's index. An untracked SQL
  // file (including an ignored one) can otherwise execute despite an exact tree.
  const extraSource = [
    git('ls-files', '--others', '--exclude-standard', '-z', '--', ...runtimePaths),
    git('ls-files', '--others', '--ignored', '--exclude-standard', '-z', '--', ...runtimePaths),
  ]
    .join('')
    .split('\0')
    .filter(Boolean);
  assert.equal(
    extraSource.length,
    0,
    `Untracked runtime source cannot be verified against the pinned tree: ${extraSource.join(', ')}`,
  );
  return tree;
}
