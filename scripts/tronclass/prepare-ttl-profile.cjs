'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { parseArgs } = require('node:util');
const { fieldRequirements, loadDeployment } = require('../wait-for-firestore-indexes.cjs');

/**
 * Prepare an optional billing-enabled deployment profile. This writes local
 * configuration only: no cloud credentials, network calls, billing changes or
 * deployment. The normal Spark-compatible firebase.json remains untouched.
 */
function prepareTronClassTtlProfile({ outDir, root = path.resolve(__dirname, '../..') }) {
  if (typeof outDir !== 'string' || !outDir.trim()) throw new Error('An explicit output directory is required.');
  root = fs.realpathSync(path.resolve(root));
  let output = path.resolve(outDir);
  // Do not replace the live checked-in configuration, even accidentally.
  if (output === root || output.startsWith(`${root}${path.sep}`)) {
    throw new Error('Use an output directory outside the repository.');
  }
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
  fs.mkdirSync(output, { recursive: true });
  output = fs.realpathSync(output);
  if (output === root || output.startsWith(`${root}${path.sep}`)) {
    throw new Error('Use an output directory outside the repository.');
  }
  const indexPath = path.join(output, 'firestore.indexes.json');
  const preparedConfigPath = path.join(output, 'firebase.json');
  if (fs.existsSync(indexPath) || fs.existsSync(preparedConfigPath)) throw new Error('Use an empty output directory.');
  const config = { firestore: { ...firestore, indexes: indexPath,
    ...(firestore.rules && { rules: path.resolve(root, firestore.rules) }),
  } };
  fs.writeFileSync(indexPath, `${JSON.stringify(indexes, null, 2)}\n`, { flag: 'wx' });
  fs.writeFileSync(preparedConfigPath, `${JSON.stringify(config, null, 2)}\n`, { flag: 'wx' });
  return { configPath: preparedConfigPath, indexPath };
}

if (require.main === module) {
  try {
    const { values } = parseArgs({ options: { out: { type: 'string' } } });
    const result = prepareTronClassTtlProfile({ outDir: values.out });
    console.log(`Prepared optional TronClass TTL profile: ${result.configPath}`);
    console.log('No deployment performed. TTL deletion requires a billing-enabled Firebase project.');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { prepareTronClassTtlProfile };
