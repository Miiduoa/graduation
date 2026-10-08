import { appendFileSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function releaseTarget(env) {
  const target = {
    platform: env.BUILD_PLATFORM,
    profile: env.BUILD_PROFILE,
    projectId: env.EXPECTED_EAS_PROJECT_ID,
    appIdentifier: env.EXPECTED_APP_IDENTIFIER,
    commit: env.GITHUB_SHA,
  };
  if (!['ios', 'android'].includes(target.platform))
    throw new Error('BUILD_PLATFORM must be ios or android');
  if (!['preview', 'production'].includes(target.profile))
    throw new Error('BUILD_PROFILE must be preview or production');
  if (!uuid.test(target.projectId ?? ''))
    throw new Error(
      'Set EAS_PROJECT_ID to the verified EAS project UUID in the release environment',
    );
  if (!/^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/.test(target.appIdentifier ?? '')) {
    throw new Error(
      'Set IOS_BUNDLE_IDENTIFIER or ANDROID_PACKAGE_NAME to the verified app identifier in the release environment',
    );
  }
  if (
    target.profile === 'production' &&
    /(?:^|\.)(?:dev|demo|test|preview|staging)$/i.test(target.appIdentifier)
  ) {
    throw new Error('Production cannot use a development app identifier');
  }
  if (!/^[0-9a-f]{40}$/i.test(target.commit ?? ''))
    throw new Error('GITHUB_SHA must identify the full source commit');
  return target;
}

// EAS CLI 24.12.0 --json returns BuildFragment records (app.id, appIdentifier)
// from this invocation. Keep the Release workflow on that reviewed CLI version.
// Older CLI releases return a different schema and must not silently pass.
// Never select a
// project-wide latest build: a concurrent run may have uploaded another binary.
export function verifyBuild(records, target) {
  if (!Array.isArray(records) || records.length !== 1)
    throw new Error('Expected exactly one EAS build result');
  const build = records[0];
  if (!build || !uuid.test(build.id ?? '')) throw new Error('EAS result has no valid build ID');
  const expected = {
    platform: target.platform.toUpperCase(),
    buildProfile: target.profile,
    status: 'FINISHED',
    gitCommitHash: target.commit,
    appIdentifier: target.appIdentifier,
    distribution: target.profile === 'production' ? 'STORE' : 'INTERNAL',
  };
  for (const [key, value] of Object.entries(expected)) {
    if (build[key] !== value)
      throw new Error(`EAS build ${key} does not match the requested release`);
  }
  if (build.app?.id !== target.projectId)
    throw new Error('EAS build belongs to a different project');
  if (target.platform === 'ios' && build.isForIosSimulator !== false)
    throw new Error('Release requires a device build, not a simulator build');
  const archive = build.artifacts?.applicationArchiveUrl ?? build.artifacts?.buildUrl;
  let archiveUrl;
  try {
    archiveUrl = new URL(archive);
  } catch {
    throw new Error('EAS build has no downloadable app artifact');
  }
  if (archiveUrl.protocol !== 'https:' || archiveUrl.username || archiveUrl.password)
    throw new Error('EAS artifact must use HTTPS without embedded credentials');
  return build.id;
}

export function main(args, env = process.env) {
  const target = releaseTarget(env);
  if (args.length === 1 && args[0] === '--preflight') {
    console.log(
      'Release target is configured. Native identity will be checked against the completed build.',
    );
    return;
  }
  if (args.length !== 1)
    throw new Error('Usage: verify-eas-build.mjs <build-result.json> | --preflight');
  const id = verifyBuild(JSON.parse(readFileSync(args[0], 'utf8')), target);
  if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, `build_id=${id}\n`);
  console.log(`Verified ${target.platform} build ${id} for source ${target.commit}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
