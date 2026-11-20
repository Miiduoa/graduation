#!/usr/bin/env node
// Run with Application Default Credentials scoped to the intended Firebase bucket.
// Defaults to read-only; production mutation requires TWO explicit flags.
// Never print or persist old Firebase tokens, URLs, or attachment filenames.
const { initializeApp, getApps } = require('firebase-admin/app');
const { getStorage } = require('firebase-admin/storage');
const { isDmAttachmentPath, migrateDmToken, scanDmTokens } = require('../dmAttachmentTokenMigration');

function args(argv) {
  const values = {};
  const flags = new Set(['--execute']);
  for (let i = 0; i < argv.length; i++) {
    if (flags.has(argv[i])) { values[argv[i]] = true; continue; }
    if (!['--bucket', '--confirm-bucket', '--max-objects', '--path', '--page-token'].includes(argv[i]) || !argv[i + 1]) {
      throw new Error('Usage: --bucket BUCKET [--path DM_OBJECT | --max-objects 100] [--execute --confirm-bucket BUCKET]');
    }
    values[argv[i]] = argv[++i];
  }
  if (!values['--bucket'] || !/^[a-z0-9][a-z0-9._-]{2,221}$/.test(values['--bucket'])) {
    throw new Error('Explicit, valid --bucket is required');
  }
  if (values['--execute'] && values['--confirm-bucket'] !== values['--bucket']) {
    throw new Error('To revoke tokens, pass --execute --confirm-bucket with the EXACT --bucket value');
  }
  if (values['--path'] && !isDmAttachmentPath(values['--path'])) {
    throw new Error('Only conversations/{id}/{media|messages}/{id}/{filename} may be modified');
  }
  const maxObjects = values['--max-objects'] == null ? 100 : Number(values['--max-objects']);
  if (values['--page-token'] && values['--path']) throw new Error('--page-token cannot be used with --path');
  if (!Number.isSafeInteger(maxObjects) || maxObjects < 1 || maxObjects > 1000) {
    throw new Error('--max-objects must be from 1 to 1000');
  }
  return { bucketName: values['--bucket'], path: values['--path'], execute: !!values['--execute'], maxObjects, pageToken: values['--page-token'] };
}

async function main() {
  const opts = args(process.argv.slice(2));
  if (!getApps().length) initializeApp();
  const bucket = getStorage().bucket(opts.bucketName);
  const onItem = (item) => process.stdout.write(JSON.stringify(item) + '\n');
  const target = opts.path ? bucket.file(opts.path) : null;
  if (target) {
    const result = await migrateDmToken(target, { execute: opts.execute });
    onItem(result);
  } else {
    const result = await scanDmTokens(bucket, { execute: opts.execute, maxObjects: opts.maxObjects, pageToken: opts.pageToken, onItem });
    process.stdout.write(JSON.stringify({ summary: result }) + '\n');
  }
  process.stdout.write(opts.execute
    ? 'Metadata update requested; this does not yet prove an OLD URL returns HTTP 403. Probe the same saved URL independently.\n'
    : 'DRY RUN ONLY: nothing was changed.\n');
}
if (require.main === module) {
  main().catch((error) => {
    console.error('Migration aborted; do not claim revocation:', error?.message || 'unknown error');
    process.exitCode = 1;
  });
}
module.exports = { args };
