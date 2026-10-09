/* global require, module, __dirname, console, process */
/* eslint-disable @typescript-eslint/no-require-imports -- Node release tooling uses CommonJS. */
const { readFileSync, writeFileSync, existsSync, realpathSync } = require('node:fs');
const { resolve } = require('node:path');
const { createRequire } = require('node:module');
const { googleIosInfoPlist } = require('./configure-nuni-google.cjs');

const production = {
  identifier: 'com.nuni.app',
  projectId: '8955b97c-802c-463c-bd1d-d5f02e30a966',
  iosClientId: '1096741064465-b8ue803rbqdpcq75t1g03o5t49vi0s4q.apps.googleusercontent.com',
  runtimeVersion: 'campus-one-native-google-1',
};

function buildPlan(projectRoot) {
  const eas = JSON.parse(readFileSync(resolve(projectRoot, 'eas.json'), 'utf8'));
  const profile = eas.build?.production;
  if (
    profile?.env?.APP_ENV !== 'production' ||
    profile.env.IOS_BUNDLE_IDENTIFIER !== production.identifier ||
    profile.env.ANDROID_PACKAGE_NAME !== production.identifier ||
    profile.env.EXPO_PUBLIC_EAS_PROJECT_ID !== production.projectId ||
    profile.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID !== production.iosClientId ||
    profile.channel !== 'production'
  )
    throw new Error('Production identity does not match the verified EAS and Google clients.');

  const appRequire = createRequire(resolve(__dirname, '../package.json'));
  const expoRequire = createRequire(appRequire.resolve('expo/package.json'));
  const pluginRequire = createRequire(expoRequire.resolve('@expo/config-plugins'));
  const plistModule = pluginRequire('@expo/plist');
  const plist = plistModule.default ?? plistModule;
  const changes = [];
  const add = (file, contents) => {
    const path = resolve(projectRoot, file);
    if (readFileSync(path, 'utf8') !== contents) changes.push({ path, contents });
  };
  const projectPath = resolve(projectRoot, 'ios/mobile.xcodeproj/project.pbxproj');
  if (!existsSync(projectPath)) return changes; // EAS prebuild will use the production app config.
  const project = readFileSync(projectPath, 'utf8');
  const identifiers = [...project.matchAll(/PRODUCT_BUNDLE_IDENTIFIER = ([^;]+);/g)];
  if (
    identifiers.length !== 2 ||
    identifiers.some(
      (match) =>
        !['com.campus.app.dev', production.identifier].includes(
          match[1].replaceAll('"', '').trim(),
        ),
    )
  ) {
    throw new Error('Refusing to rewrite an unrecognized native target or bundle identifier.');
  }
  add(
    'ios/mobile.xcodeproj/project.pbxproj',
    project.replace(
      /PRODUCT_BUNDLE_IDENTIFIER = [^;]+;/g,
      `PRODUCT_BUNDLE_IDENTIFIER = ${production.identifier};`,
    ),
  );
  const info = plist.parse(readFileSync(resolve(projectRoot, 'ios/mobile/Info.plist'), 'utf8'));
  const configured = googleIosInfoPlist(info, production.iosClientId);
  configured.CFBundleURLTypes = configured.CFBundleURLTypes.map((entry) => ({
    ...entry,
    CFBundleURLSchemes: entry.CFBundleURLSchemes.map((scheme) =>
      scheme === 'com.campus.app.dev' ? production.identifier : scheme,
    ),
  }));
  add('ios/mobile/Info.plist', plist.build(configured));
  const updates = plist.parse(
    readFileSync(resolve(projectRoot, 'ios/mobile/Supporting/Expo.plist'), 'utf8'),
  );
  add(
    'ios/mobile/Supporting/Expo.plist',
    plist.build({
      ...updates,
      EXUpdatesEnabled: true,
      EXUpdatesRuntimeVersion: production.runtimeVersion,
      EXUpdatesURL: `https://u.expo.dev/${production.projectId}`,
      EXUpdatesRequestHeaders: {
        ...updates.EXUpdatesRequestHeaders,
        'expo-channel-name': 'production',
      },
    }),
  );
  return changes;
}

function requireProductionCi(projectRoot, env) {
  if (
    env.GITHUB_ACTIONS !== 'true' ||
    env.CI !== 'true' ||
    env.BUILD_PLATFORM !== 'ios' ||
    env.BUILD_PROFILE !== 'production' ||
    env.GITHUB_WORKFLOW !== 'Release' ||
    !env.GITHUB_WORKSPACE ||
    projectRoot !== realpathSync(resolve(env.GITHUB_WORKSPACE, 'apps/mobile'))
  )
    throw new Error('CI synchronization requires the production iOS Release job checkout.');
}

function main(args, env = process.env) {
  if (args.length !== 2 || !['--check', '--write', '--ci-write'].includes(args[0]))
    throw new Error(
      'Usage: prepare-native-release.cjs --check|--write <isolated-mobile-directory> | --ci-write <ci-mobile-directory>',
    );
  const projectRoot = realpathSync(resolve(args[1]));
  if (args[0] === '--ci-write') requireProductionCi(projectRoot, env);
  if (args[0] === '--write' && projectRoot === realpathSync(resolve(__dirname, '..')))
    throw new Error(
      'Use an isolated release checkout; the current development native project stays unchanged.',
    );
  const plan = buildPlan(projectRoot); // Validate every input before writing any native file.
  if (args[0] === '--check' && plan.length)
    throw new Error(
      `Native production synchronization required for ${plan.length} files. Run --write in an isolated release checkout.`,
    );
  if (args[0] !== '--check') for (const change of plan) writeFileSync(change.path, change.contents);
  console.log(
    'Production iOS identity, Google callback and update runtime match the verified target.',
  );
}

module.exports = { production, buildPlan, main };
if (require.main === module) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
