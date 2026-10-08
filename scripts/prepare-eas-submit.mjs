import {
  constants,
  accessSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { randomUUID } from 'node:crypto';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

function required(env, name) {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required for iOS submission.`);
  return value;
}

function validEmail(value) {
  if (value.length > 254) return false;
  const parts = value.split('@');
  if (parts.length !== 2) return false;
  const [local, domain] = parts;
  if (
    local.length > 64 ||
    !/^[A-Za-z0-9!#$%&'*+/=?^_`{|}~.-]+$/.test(local) ||
    local.startsWith('.') ||
    local.endsWith('.') ||
    local.includes('..')
  )
    return false;
  const labels = domain.split('.');
  return (
    labels.length >= 2 &&
    /^[A-Za-z]{2,63}$/.test(labels.at(-1)) &&
    labels.every((label) => /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/.test(label))
  );
}

export function prepareSubmitConfig(config, env) {
  const platform = env.BUILD_PLATFORM;
  if (!['ios', 'android'].includes(platform))
    throw new Error('BUILD_PLATFORM must be ios or android.');
  const appIdentifier = env.EXPECTED_APP_IDENTIFIER;
  if (!/^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/.test(appIdentifier ?? '')) {
    throw new Error('EXPECTED_APP_IDENTIFIER must contain the verified native app identifier.');
  }
  if (/(?:^|\.)(?:dev|demo|test|preview|staging)$/i.test(appIdentifier)) {
    throw new Error('Production submission cannot use a development app identifier.');
  }
  if (
    !config ||
    typeof config !== 'object' ||
    Array.isArray(config) ||
    !config.submit?.production ||
    typeof config.submit.production !== 'object' ||
    Array.isArray(config.submit.production)
  ) {
    throw new Error('A production submit profile must already exist in eas.json.');
  }
  const result = structuredClone(config);
  const current = result.submit.production[platform];
  if (!current || typeof current !== 'object' || Array.isArray(current)) {
    throw new Error(`The production ${platform} submit profile must already exist.`);
  }
  if (platform === 'ios') {
    const appleId = required(env, 'APPLE_ID');
    const ascAppId = required(env, 'ASC_APP_ID');
    const appleTeamId = required(env, 'APPLE_TEAM_ID');
    if (!validEmail(appleId)) throw new Error('APPLE_ID must be a valid email address.');
    if (!/^\d{1,30}$/.test(ascAppId)) throw new Error('ASC_APP_ID must contain only 1–30 digits.');
    if (!/^[A-Z0-9]{10}$/.test(appleTeamId))
      throw new Error('APPLE_TEAM_ID must contain 10 uppercase letters or digits.');
    Object.assign(current, { appleId, ascAppId, appleTeamId, bundleIdentifier: appIdentifier });
  } else {
    current.applicationId = appIdentifier;
    const provided = env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH?.trim();
    // An absent path leaves credential resolution to EAS's existing remote account configuration.
    delete current.serviceAccountKeyPath;
    if (provided) {
      if (!isAbsolute(provided))
        throw new Error('GOOGLE_SERVICE_ACCOUNT_KEY_PATH must be absolute.');
      try {
        const resolved = realpathSync(provided);
        // EAS expands dollar syntax in this field; require a literal path to the file we checked.
        if (resolved.includes('$')) throw new Error('EAS would expand this path');
        if (!statSync(resolved).isFile()) throw new Error('Not a file');
        accessSync(resolved, constants.R_OK);
        current.serviceAccountKeyPath = resolved;
      } catch {
        throw new Error(
          'GOOGLE_SERVICE_ACCOUNT_KEY_PATH must identify an existing readable file without dollar syntax.',
        );
      }
    }
  }
  return result;
}

export function main(args, env = process.env) {
  if (args.length !== 1) throw new Error('Usage: prepare-eas-submit.mjs <ephemeral-eas.json>');
  const configPath = resolve(args[0]);
  let config;
  try {
    config = JSON.parse(readFileSync(configPath, 'utf8'));
  } catch {
    throw new Error('Unable to read valid EAS configuration.');
  }
  const prepared = prepareSubmitConfig(config, env);
  const temporary = join(
    dirname(configPath),
    `.${basename(configPath)}.submit-${randomUUID()}.tmp`,
  );
  try {
    writeFileSync(temporary, `${JSON.stringify(prepared, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
    renameSync(temporary, configPath);
  } finally {
    rmSync(temporary, { force: true });
  }
  console.log(
    `Prepared ${env.BUILD_PLATFORM} submission configuration. Store credentials are checked by EAS at submission.`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
