const { readFileSync, writeFileSync, existsSync } = require('node:fs');
const { resolve, dirname } = require('node:path');
const { createRequire } = require('node:module');

const googleClientPattern = /^[0-9]+-[a-z0-9-]+\.apps\.googleusercontent\.com$/;

function googleIosInfoPlist(infoPlist, rawClientId) {
  const clientId = (rawClientId || '').trim();
  if (!clientId) return { ...infoPlist };
  if (!googleClientPattern.test(clientId)) {
    throw new Error('EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID must be a registered Google iOS client ID.');
  }
  const reversed = clientId.split('.').reverse().join('.');
  const previousReversed =
    typeof infoPlist.GIDClientID === 'string' && googleClientPattern.test(infoPlist.GIDClientID)
      ? infoPlist.GIDClientID.split('.').reverse().join('.')
      : null;
  const urlTypes = (Array.isArray(infoPlist.CFBundleURLTypes) ? infoPlist.CFBundleURLTypes : [])
    .map((entry) => {
      if (!entry || typeof entry !== 'object') throw new Error('Invalid iOS URL types.');
      const schemes = Array.isArray(entry.CFBundleURLSchemes) ? entry.CFBundleURLSchemes : [];
      return {
        ...entry,
        CFBundleURLSchemes: schemes.filter((scheme) => scheme !== previousReversed),
      };
    })
    .filter((entry) => entry.CFBundleURLSchemes.length > 0);
  if (!urlTypes.some((entry) => entry.CFBundleURLSchemes.includes(reversed))) {
    urlTypes.push({ CFBundleURLSchemes: [reversed] });
  }
  return { ...infoPlist, GIDClientID: clientId, CFBundleURLTypes: urlTypes };
}

function checkGoogleIosInfoPlist(infoPlist, rawClientId) {
  const clientId = (rawClientId || '').trim();
  if (!clientId) {
    if (infoPlist.GIDClientID) {
      throw new Error('The native Google iOS client has no matching environment setting.');
    }
    return false;
  }
  const expected = googleIosInfoPlist(infoPlist, clientId);
  const reversed = clientId.split('.').reverse().join('.');
  if (
    infoPlist.GIDClientID !== expected.GIDClientID ||
    !infoPlist.CFBundleURLTypes?.some((entry) => entry.CFBundleURLSchemes?.includes(reversed))
  ) {
    throw new Error(
      'Native Google iOS configuration differs; run native:configure-google before building.',
    );
  }
  return true;
}

function main(args, env = process.env) {
  if (args.length !== 1 || !['--check', '--write'].includes(args[0])) {
    throw new Error('Usage: configure-nuni-google.cjs --check | --write');
  }
  const appRoot = resolve(__dirname, '..');
  const plistPath = resolve(appRoot, 'ios/mobile/Info.plist');
  if (!existsSync(plistPath)) {
    console.log('No tracked iOS project; Expo prebuild applies the Google configuration.');
    return;
  }
  const appRequire = createRequire(resolve(appRoot, 'package.json'));
  const expoRequire = createRequire(appRequire.resolve('expo/package.json'));
  const pluginRequire = createRequire(expoRequire.resolve('@expo/config-plugins'));
  const plistModule = pluginRequire('@expo/plist');
  const plist = plistModule.default ?? plistModule;
  const value = plist.parse(readFileSync(plistPath, 'utf8'));
  const clientId = env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID?.trim();
  if (args[0] === '--write' && clientId) {
    const updated = googleIosInfoPlist(value, clientId);
    // Only the public Google client and its callback change; bundle/signing IDs stay intact.
    if (JSON.stringify(value) !== JSON.stringify(updated)) {
      writeFileSync(plistPath, plist.build(updated));
    }
    console.log('Native Google iOS configuration synchronized.');
  } else {
    const configured = checkGoogleIosInfoPlist(value, clientId);
    console.log(
      configured
        ? 'Native Google iOS configuration matches.'
        : 'Google iOS login is not configured.',
    );
  }
}

module.exports = { googleIosInfoPlist, checkGoogleIosInfoPlist, main };

if (require.main === module) {
  require('dotenv').config({ path: resolve(dirname(__dirname), '.env'), quiet: true });
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
