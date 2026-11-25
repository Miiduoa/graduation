'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { randomBytes } = require('node:crypto');
const { parseArgs } = require('node:util');
const { fieldRequirements, loadDeployment } = require('../wait-for-firestore-indexes.cjs');

function requireOutsideRepository(output, root) {
  const relative = path.relative(root, output);
  if (relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`))) {
    throw new Error('Use an output directory outside the repository.');
  }
}

// Linux procfs lets Node resolve a child relative to a pinned directory.
const O_PATH = 0o10000000;
const { O_DIRECTORY, O_NOFOLLOW, O_WRONLY, O_CREAT, O_EXCL } = fs.constants;
const fdPath = fd => `/proc/self/fd/${fd}`;

function withPrivateOutput(outDir, root, write) {
  const uid = process.getuid();
  const explicit = outDir !== undefined;
  if (explicit && (typeof outDir !== 'string' || !outDir.trim())) throw new Error('Use a nonempty output path.');
  const requested = explicit ? path.resolve(outDir) : undefined;
  if (requested) requireOutsideRepository(requested, root);
  const parent = requested ? path.dirname(requested) : path.resolve(os.tmpdir());
  const handles = [];
  const bindings = [];

  function pin(location, flags) {
    const fd = fs.openSync(location, flags | O_NOFOLLOW);
    handles.push(fd);
    return fd;
  }

  function trustedOwner(stat) {
    return Number(stat.uid) === uid || Number(stat.uid) === 0;
  }

  function verifyDirectory(stat) {
    const mode = Number(stat.mode);
    if (!stat.isDirectory() || !trustedOwner(stat) || ((mode & 0o022) && !(mode & 0o1000))) {
      throw new Error('Use an output location controlled by the current user.');
    }
  }

  try {
    const rootFd = pin('/', O_PATH | O_DIRECTORY);
    verifyDirectory(fs.fstatSync(rootFd));
    const stack = [rootFd];
    let parts = parent.split('/');
    let links = 0;
    while (parts.length) {
      const part = parts.shift();
      if (!part || part === '.') continue;
      if (part === '..') {
        if (stack.length > 1) stack.pop();
        continue;
      }
      const entry = `${fdPath(stack.at(-1))}/${part}`;
      const fd = pin(entry, O_PATH);
      const stat = fs.fstatSync(fd, { bigint: true });
      bindings.push({ entry, stat });
      if (stat.isSymbolicLink()) {
        // A trusted link in a verified parent is protected from other UIDs.
        if (!trustedOwner(stat) || ++links > 40) {
          throw new Error('Use an output location controlled by the current user.');
        }
        const target = fs.readlinkSync(entry);
        if (path.isAbsolute(target)) stack.length = 1;
        parts = [...target.split('/'), ...parts];
      } else {
        verifyDirectory(stat);
        stack.push(fd);
      }
    }
    const parentFd = stack.at(-1);
    for (const { entry, stat } of bindings.reverse()) {
      const current = fs.lstatSync(entry, { bigint: true });
      if (current.dev !== stat.dev || current.ino !== stat.ino || current.uid !== stat.uid || current.mode !== stat.mode) {
        throw new Error('Use an output location controlled by the current user.');
      }
    }

    const actualParent = fs.readlinkSync(fdPath(parentFd));
    requireOutsideRepository(path.join(actualParent, requested ? path.basename(requested) : 'nuni-tronclass-ttl-'), root);
    for (;;) {
      const name = requested ? path.basename(requested) : `nuni-tronclass-ttl-${randomBytes(16).toString('hex')}`;
      const entry = `${fdPath(parentFd)}/${name}`;
      try {
        fs.mkdirSync(entry, { mode: 0o700 });
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
        if (explicit) throw new Error('Output path already exists.');
        continue;
      }
      const outputFd = pin(entry, O_PATH | O_DIRECTORY);
      const stat = fs.fstatSync(outputFd);
      const mode = stat.mode & 0o7777;
      if (stat.uid !== uid || (mode & ~0o2700) !== 0) {
        throw new Error('The new output directory must be private and owned by the current user.');
      }
      // Resolve the descriptor itself to normalize inherited setgid and umask.
      fs.chmodSync(fdPath(outputFd), 0o700);
      if ((fs.fstatSync(outputFd).mode & 0o7777) !== 0o700) {
        throw new Error('The new output directory must be private and owned by the current user.');
      }
      return write(path.join(actualParent, name), outputFd);
    }
  } finally {
    for (const fd of handles.reverse()) fs.closeSync(fd);
  }
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
  return withPrivateOutput(outDir, root, (output, outputFd) => {
    const indexPath = path.join(output, 'firestore.indexes.json');
    const preparedConfigPath = path.join(output, 'firebase.json');
    const config = { firestore: { ...firestore, indexes: indexPath,
      ...(firestore.rules && { rules: path.resolve(root, firestore.rules) }),
    } };
    for (const [name, value] of [['firestore.indexes.json', indexes], ['firebase.json', config]]) {
      fs.writeFileSync(`${fdPath(outputFd)}/${name}`, `${JSON.stringify(value, null, 2)}\n`, {
        flag: O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW, mode: 0o600,
      });
    }
    return { outDir: output, configPath: preparedConfigPath, indexPath };
  });
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
