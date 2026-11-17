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

if (require.main === module) {
  try {
    if (process.argv.length !== 3) throw new Error('Usage: node scripts/audit-group-post-visibility.cjs export.ndjson');
    const file = process.argv[2];
    const source = fs.statSync(file);
    if (!source.isFile()) throw new Error('Inventory input must be a regular file');
    if (source.size > MAX_BYTES) throw new Error('Inventory input exceeds 32 MiB; split into smaller files');
    const rows = fs.readFileSync(file, 'utf8');
    const result = inventory(rows);
    process.stdout.write(JSON.stringify(result) + '\n');
  } catch (error) {
    process.stderr.write('Inventory failed: ' + error.message + '\n');
    process.exitCode = 1;
  }
}

module.exports = { classify, inventory };
