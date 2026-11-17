#!/usr/bin/env node
'use strict';
/** Read-only offline inventory for synthetic or separately authorized NDJSON exports.
 * Input: one JSON object per line, { path: 'groups/G/posts/P', data: {...} }.
 * Outputs only aggregate counts; never connects to Firebase or changes records.
 */
const fs = require('node:fs');
const HIDDEN_STATUSES = new Set([
  'draft', 'scheduled', 'pending', 'unpublished',
  'archived', 'cancelled', 'canceled', 'deleted',
]);
const MAX_BYTES = 32 * 1024 * 1024;

function classify(row) {
  if (!row || typeof row !== 'object' || Array.isArray(row)
    || typeof row.path !== 'string'
    || !/^groups\/[^/]+\/posts\/[^/]+$/.test(row.path)
    || !row.data || typeof row.data !== 'object' || Array.isArray(row.data)) {
    throw new Error('Invalid group post export record');
  }
  const data = row.data;
  if (data.published === false || HIDDEN_STATUSES.has(data.status)
    || data.deleted === true || (data.deletedAt !== undefined && data.deletedAt !== null)) {
    return 'hidden';
  }
  if (data.published === true && data.status === 'published'
    && data.deleted === false && data.deletedAt === null) {
    return 'canonicalVisible';
  }
  return 'reviewRequired'; // Never infer that a missing flag means published.
}

function inventory(ndjson) {
  if (typeof ndjson !== 'string' || Buffer.byteLength(ndjson, 'utf8') > MAX_BYTES) {
    throw new Error('Inventory input must be UTF-8 text within 32 MiB');
  }
  const counts = { total: 0, canonicalVisible: 0, hidden: 0, reviewRequired: 0 };
  const paths = new Set();
  for (const line of ndjson.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let row;
    try {
      row = JSON.parse(line);
    } catch {
      // Node's JSON.parse error includes excerpts from invalid source text.
      // Never echo student data or the raw export line in CLI errors.
      throw new Error('Invalid NDJSON record');
    }
    const type = classify(row);
    if (paths.has(row.path)) throw new Error('Duplicate group post record');
    paths.add(row.path);
    counts.total += 1;
    counts[type] += 1;
  }
  return counts;
}

// Open a single, non-following file descriptor before validating size and type.
// A separate stat(path) followed by readFile(path) can read a different file if
// an export directory is replaced between those operations. Never follow a
// symbolic link to an unrelated file or block indefinitely on a named pipe.
function readAuthorizedExport(file) {
  if (typeof fs.constants.O_NOFOLLOW !== 'number'
    || typeof fs.constants.O_NONBLOCK !== 'number') {
    throw new Error('Safe inventory file opening is unavailable');
  }
  let fd;
  try {
    fd = fs.openSync(file,
      fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
    const source = fs.fstatSync(fd);
    if (!source.isFile()) throw new Error('Inventory input must be a regular file');
    if (source.size > MAX_BYTES) throw new Error('Inventory input exceeds 32 MiB; split into smaller files');
    // The inode may grow after fstat; cap bytes actually read as well. An
    // unbounded readFileSync(fd) would bypass the intended 32 MiB limit.
    const buffer = Buffer.allocUnsafe(64 * 1024);
    const chunks = [];
    let bytes = 0;
    while (true) {
      const count = fs.readSync(fd, buffer, 0,
        Math.min(buffer.length, MAX_BYTES + 1 - bytes), null);
      if (count === 0) break;
      bytes += count;
      if (bytes > MAX_BYTES) throw new Error('Inventory input exceeds 32 MiB; split into smaller files');
      chunks.push(Buffer.from(buffer.subarray(0, count)));
    }
    return Buffer.concat(chunks, bytes).toString('utf8');
  } catch (error) {
    // Filesystem errors can include a user-supplied path. Log no path or
    // source-line excerpts, even if the export filename contains private data.
    if (error.code) throw new Error('Inventory input cannot be opened safely');
    throw error;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

if (require.main === module) {
  try {
    if (process.argv.length !== 3) throw new Error('Usage: node scripts/audit-group-post-visibility.cjs export.ndjson');
    const rows = readAuthorizedExport(process.argv[2]);
    const result = inventory(rows);
    process.stdout.write(JSON.stringify(result) + '\n');
  } catch (error) {
    process.stderr.write('Inventory failed: ' + error.message + '\n');
    process.exitCode = 1;
  }
}

module.exports = { classify, inventory };
