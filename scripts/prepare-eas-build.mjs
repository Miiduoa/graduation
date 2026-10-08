import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { releaseTarget } from './verify-eas-build.mjs';

const receiptName = '.release-build-target.json';
const guardCommand = `node ../../scripts/prepare-eas-build.mjs --worker ${receiptName}`;
const object = (value) => value && typeof value === 'object' && !Array.isArray(value);

export function identityEnvironment(target) {
  return {
    APP_ENV: target.profile,
    EXPO_PUBLIC_EAS_PROJECT_ID: target.projectId,
    [target.platform === 'ios' ? 'IOS_BUNDLE_IDENTIFIER' : 'ANDROID_PACKAGE_NAME']:
      target.appIdentifier,
  };
}

export function prepareBuildConfig(config, target) {
  if (config?.cli?.requireCommit === true)
    throw new Error('Release preparation requires EAS to include checkout changes in the archive.');
  if (!object(config?.build?.[target.profile]))
    throw new Error('The selected EAS build profile must already exist.');
  const result = structuredClone(config);
  const profile = result.build[target.profile];
  if (profile.env !== undefined && !object(profile.env))
    throw new Error('Invalid build profile environment.');
  if (profile[target.platform] !== undefined && !object(profile[target.platform]))
    throw new Error('Invalid platform build profile.');
  const platform = profile[target.platform] ?? {};
  if (platform.env !== undefined && !object(platform.env))
    throw new Error('Invalid platform environment.');
  // Platform env is merged after shared env, including inherited platform settings.
  const identity = identityEnvironment(target);
  profile.environment = target.profile;
  profile.env = { ...profile.env, ...identity };
  profile[target.platform] = {
    ...platform,
    environment: target.profile,
    env: { ...platform.env, ...identity },
  };
  return result;
}

export function prepareBuildPackage(manifest) {
  if (!object(manifest) || (manifest.scripts !== undefined && !object(manifest.scripts)))
    throw new Error('Invalid mobile package manifest.');
  const result = structuredClone(manifest);
  const previous = result.scripts?.['eas-build-post-install'];
  if (previous !== undefined && typeof previous !== 'string')
    throw new Error('Invalid existing EAS post-install hook.');
  if (previous?.includes(guardCommand)) throw new Error('Release guard is already prepared.');
  result.scripts = {
    ...result.scripts,
    'eas-build-post-install': previous?.trim()
      ? `( ${previous} ) && ${guardCommand}`
      : guardCommand,
  };
  return result;
}

export function verifyAppConfig(appConfig, target) {
  const nativeId =
    target.platform === 'ios' ? appConfig?.ios?.bundleIdentifier : appConfig?.android?.package;
  if (nativeId !== target.appIdentifier)
    throw new Error('Resolved Expo app identifier does not match the release target.');
  if (appConfig?.extra?.eas?.projectId !== target.projectId)
    throw new Error('Resolved Expo project ID does not match the release target.');
  if (appConfig?.extra?.appEnv !== target.profile)
    throw new Error('Resolved Expo environment does not match the release profile.');
  if (appConfig?.updates?.url !== `https://u.expo.dev/${target.projectId}`)
    throw new Error('Resolved update URL does not match the release project.');
}

export function verifyResolvedBuildConfig(result, target) {
  const profile = result?.buildProfile;
  if (!object(profile) || profile.environment !== target.profile)
    throw new Error('Resolved EAS environment does not match the release profile.');
  for (const [key, value] of Object.entries(identityEnvironment(target))) {
    if (profile.env?.[key] !== value) throw new Error(`Resolved EAS profile does not bind ${key}.`);
  }
  if (profile.distribution !== (target.profile === 'production' ? 'store' : 'internal'))
    throw new Error('Resolved EAS distribution does not match the release profile.');
  if (profile.developmentClient || profile.withoutCredentials || profile.simulator)
    throw new Error('Release requires a signed device build.');
  verifyAppConfig(result.appConfig, target);
}

function expoRequire(projectRoot) {
  const appRequire = createRequire(join(projectRoot, 'package.json'));
  return createRequire(appRequire.resolve('expo/package.json'));
}

export async function verifyNativeIdentity(
  projectRoot,
  target,
  profile = {},
  requireNative = false,
) {
  const nativeDirectory = join(projectRoot, target.platform);
  if (!existsSync(nativeDirectory)) {
    if (requireNative) throw new Error('EAS worker has no native project to verify.');
    return;
  }
  const { IOSConfig, AndroidConfig } = expoRequire(projectRoot)('@expo/config-plugins');
  let identifier;
  try {
    if (target.platform === 'ios') {
      const project = IOSConfig.XcodeUtils.getPbxproj(projectRoot);
      const applications = IOSConfig.Target.getNativeTargets(project).filter(([, entry]) =>
        IOSConfig.Target.isTargetOfType(entry, IOSConfig.Target.TargetType.APPLICATION),
      );
      if (applications.length !== 1) throw new Error('Ambiguous native target');
      const targetName = applications[0][1].name.replace(/^"|"$/g, '');
      identifier = IOSConfig.BundleIdentifier.getBundleIdentifierFromPbxproj(projectRoot, {
        targetName,
        buildConfiguration: profile.buildConfiguration ?? 'Release',
      });
    } else {
      const gradlePath = AndroidConfig.Paths.getAppBuildGradleFilePath(projectRoot);
      const gradle = readFileSync(gradlePath, 'utf8');
      // Only the current single-application Android build is supported by this gate.
      if (/applicationIdSuffix|productFlavors/.test(gradle))
        throw new Error('Ambiguous Android variant');
      identifier = await AndroidConfig.Package.getApplicationIdAsync(projectRoot);
    }
  } catch {
    throw new Error(
      'Cannot resolve the native release identifier; native configuration must be reviewed.',
    );
  }
  if (identifier !== target.appIdentifier)
    throw new Error(
      'Native project identifier does not match the release target; app.config does not rewrite tracked native projects.',
    );
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    throw new Error('Unable to read valid release configuration.');
  }
}

function readTarget(path) {
  const receipt = readJson(path);
  return releaseTarget({
    BUILD_PLATFORM: receipt.platform,
    BUILD_PROFILE: receipt.profile,
    EXPECTED_EAS_PROJECT_ID: receipt.projectId,
    EXPECTED_APP_IDENTIFIER: receipt.appIdentifier,
    GITHUB_SHA: receipt.commit,
  });
}

function writeJson(path, data) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, `${JSON.stringify(data, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    renameSync(temporary, path);
  } finally {
    rmSync(temporary, { force: true });
  }
}

export async function main(args, env = process.env) {
  if (args.length === 2 && args[0] === '--prepare') {
    const projectRoot = resolve(args[1]);
    const target = releaseTarget(env);
    const receiptPath = join(projectRoot, receiptName);
    if (existsSync(receiptPath)) throw new Error('Use a fresh checkout for release preparation.');
    for (const [key, value] of Object.entries(identityEnvironment(target))) {
      if (env[key] !== undefined && env[key] !== value)
        throw new Error(`Local ${key} conflicts with the release target.`);
    }
    const easPath = join(projectRoot, 'eas.json');
    const packagePath = join(projectRoot, 'package.json');
    const eas = prepareBuildConfig(readJson(easPath), target);
    const manifest = prepareBuildPackage(readJson(packagePath));
    // Reject the existing tracked iOS .dev project before even requesting a build.
    await verifyNativeIdentity(projectRoot, target, eas.build[target.profile][target.platform]);
    writeJson(easPath, eas);
    writeJson(packagePath, manifest);
    writeJson(receiptPath, target);
    console.log('Prepared the release build profile and worker identity guard in this checkout.');
    return;
  }
  if (args.length === 3 && args[0] === '--verify-config') {
    const receiptPath = resolve(args[2]);
    const target = readTarget(receiptPath);
    const result = readJson(resolve(args[1]));
    verifyResolvedBuildConfig(result, target);
    await verifyNativeIdentity(dirname(receiptPath), target, result.buildProfile);
    console.log('EAS resolved configuration matches the release target.');
    return;
  }
  if (args.length === 2 && args[0] === '--worker') {
    const receiptPath = resolve(args[1]);
    const target = readTarget(receiptPath);
    for (const [key, value] of Object.entries(identityEnvironment(target))) {
      if (env[key] !== value) throw new Error(`Worker ${key} does not match the release receipt.`);
    }
    const projectRoot = dirname(receiptPath);
    let appConfig;
    try {
      appConfig = expoRequire(projectRoot)('@expo/config').getConfig(projectRoot, {
        skipPlugins: true,
      }).exp;
    } catch {
      throw new Error(
        'Worker Expo configuration cannot be resolved; check the required release environment.',
      );
    }
    verifyAppConfig(appConfig, target);
    // The EAS post-install hook runs after prebuild (and, on iOS, pod installation).
    const eas = readJson(join(projectRoot, 'eas.json'));
    await verifyNativeIdentity(
      projectRoot,
      target,
      eas.build?.[target.profile]?.[target.platform],
      true,
    );
    console.log('Worker Expo and native identities match the release receipt.');
    return;
  }
  throw new Error(
    'Usage: prepare-eas-build.mjs --prepare <mobile-dir> | --verify-config <eas-config.json> <receipt> | --worker <receipt>',
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
