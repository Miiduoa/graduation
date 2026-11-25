'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { parseArgs } = require('node:util');
const { fieldRequirements, loadDeployment } = require('../wait-for-firestore-indexes.cjs');

function requireOutsideRepository(output, root) {
  const relative = path.relative(root, output);
  if (relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`))) {
    throw new Error('Use an output directory outside the repository.');
  }
}

function createPrivateOutput(outDir, root) {
  const uid = process.getuid();
  const explicit = outDir !== undefined;
  if (explicit && (typeof outDir !== 'string' || !outDir.trim())) throw new Error('Use a nonempty output path.');
  const requested = explicit ? path.resolve(outDir) : undefined;
  if (requested) requireOutsideRepository(requested, root);
  const parent = fs.realpathSync(requested ? path.dirname(requested) : os.tmpdir());
  const output = path.join(parent, requested ? path.basename(requested) : 'nuni-tronclass-ttl-');
  requireOutsideRepository(output, root);

  // A shared sticky ancestor such as /tmp protects entries owned by this user.
  // Reject untrusted owners and directories where others can replace entries.
  for (let directory = parent; ; directory = path.dirname(directory)) {
    const stat = fs.statSync(directory);
    const writableByOthers = (stat.mode & 0o022) !== 0;
    const sticky = (stat.mode & 0o1000) !== 0;
    const trustedOwner = stat.uid === uid || (stat.uid === 0 && (!explicit || directory !== parent));
    if (!stat.isDirectory() || !trustedOwner || (writableByOthers && !sticky)) {
      throw new Error('Use an output location controlled by the current user.');
    }
    if (path.dirname(directory) === directory) break;
  }
  if (!requested) return fs.mkdtempSync(output);
  try {
    fs.mkdirSync(output, { mode: 0o700 });
  } catch (error) {
    if (error.code === 'EEXIST') throw new Error('Output path already exists.');
    throw error;
  }
  return output;
}

/**
 * Prepare an optional billing-enabled deployment profile. This writes local
 * configuration only: no cloud credentials, network calls, billing changes or
 * deployment. The normal Spark-compatible firebase.json remains untouched.
 */
function prepareTronClassTtlProfile({ outDir, root = path.resolve(__dirname, '../..') } = {}) {
  root = fs.realpathSync(path.resolve(root));
  const configPath = path.join(root, 'firebase.json');
  loadDeployment(configPath);
  const firebase = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const firestore = firebase.firestore;
  const base = JSON.parse(fs.readFileSync(path.resolve(root, firestore.indexes), 'utf8'));
  const policy = JSON.parse(fs.readFileSync(path.join(root, 'deploy/tronclass/firestore-ttl-policy.json'), 'utf8'));
  fieldRequirements(policy.fieldOverrides);
  const expected = new Map([
    ['_tronClassBindings', true], ['_tronClassLoginAttempts', true],
    ['_tronClassSubmissionOperations', true], ['_tronClassSubmissionLocks', false],
  ]);
  if (Object.keys(policy).length !== 1 || policy.fieldOverrides.length !== expected.size ||
    policy.fieldOverrides.some(field => field.fieldPath !== 'purgeAt' || !expected.has(field.collectionGroup) ||
      field.ttl !== expected.get(field.collectionGroup))) throw new Error('Invalid TronClass retention policy.');
  const targets = new Set(policy.fieldOverrides.map(field => JSON.stringify([field.collectionGroup, field.fieldPath])));
  const indexes = { ...base, fieldOverrides: [
    ...(base.fieldOverrides ?? []).filter(field => !targets.has(JSON.stringify([field.collectionGroup, field.fieldPath]))),
    ...policy.fieldOverrides,
  ] };
  fieldRequirements(indexes.fieldOverrides);
  const output = createPrivateOutput(outDir, root);
  // Normalize only the newly created directory, including inherited setgid bits.
  fs.chmodSync(output, 0o700);
  const stat = fs.statSync(output);
  if (stat.uid !== process.getuid() || (stat.mode & 0o7777) !== 0o700) {
    throw new Error('The new output directory must be private and owned by the current user.');
  }
  const indexPath = path.join(output, 'firestore.indexes.json');
  const preparedConfigPath = path.join(output, 'firebase.json');
  const config = { firestore: { ...firestore, indexes: indexPath,
    ...(firestore.rules && { rules: path.resolve(root, firestore.rules) }),
  } };
  fs.writeFileSync(indexPath, `${JSON.stringify(indexes, null, 2)}\n`, { flag: 'wx' });
  fs.writeFileSync(preparedConfigPath, `${JSON.stringify(config, null, 2)}\n`, { flag: 'wx' });
  return { outDir: output, configPath: preparedConfigPath, indexPath };
}

if (require.main === module) {
  try {
    const { values } = parseArgs({ options: { out: { type: 'string' } } });
    const result = prepareTronClassTtlProfile({ outDir: values.out });
    console.log(`Private output directory: ${result.outDir}`);
    console.log(`Prepared optional TronClass TTL profile: ${result.configPath}`);
    console.log('No deployment performed. TTL deletion requires a billing-enabled Firebase project.');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { prepareTronClassTtlProfile };
