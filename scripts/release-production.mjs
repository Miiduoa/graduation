/* global console, process */
import { execFileSync } from 'node:child_process';

const repository = 'Miiduoa/graduation';
const api = ['api', '--hostname', 'github.com', '-H', 'X-GitHub-Api-Version: 2026-03-10'];

function read(command, args) {
  return execFileSync(command, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  }).trim();
}

try {
  if (process.argv.length !== 2) throw new Error('Usage: pnpm release:production');
  if (read('git', ['status', '--porcelain=v1', '--untracked-files=normal']))
    throw new Error('Commit or set aside local changes before requesting a production build.');

  const commit = read('git', ['rev-parse', '--verify', 'HEAD^{commit}']);
  const main = read('gh', [
    ...api,
    `repos/${repository}/git/ref/heads/main`,
    '--jq',
    '.object.sha',
  ]);
  if (commit !== main)
    throw new Error(
      `Production builds require the checkout to match github.com/${repository} main.`,
    );

  // GitHub returns the ID of this dispatch even if another build of the same commit is running.
  const runId = read('gh', [
    ...api,
    '--method',
    'POST',
    `repos/${repository}/actions/workflows/release.yml/dispatches`,
    '-f',
    'ref=main',
    '-f',
    'inputs[platform]=all',
    '-f',
    'inputs[profile]=production',
    '-f',
    'inputs[submit]=false',
    '-f',
    `inputs[build_only_sha]=${commit}`,
    '--jq',
    '.workflow_run_id',
  ]);
  if (!/^[1-9][0-9]*$/.test(runId))
    throw new Error('GitHub did not return a run ID. Check the Release workflow before retrying.');
  console.log(`https://github.com/${repository}/actions/runs/${runId}`);
  execFileSync(
    'gh',
    [
      'run',
      'watch',
      runId,
      '--repo',
      `github.com/${repository}`,
      '--exit-status',
      '--interval',
      '15',
    ],
    { stdio: 'inherit' },
  );
} catch (error) {
  console.error(error.message);
  process.exitCode = error.status || 1;
}
