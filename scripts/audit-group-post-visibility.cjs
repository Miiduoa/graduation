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
  const counts = { total: 0, canonicalVisible: 0, hidden: 0, reviewRequired: 0 };
  for (const line of ndjson.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const row = JSON.parse(line);
    const type = classify(row);
    counts.total += 1;
    counts[type] += 1;
  }
  return counts;
}

if (require.main === module) {
  try {
    if (process.argv.length !== 3) throw new Error('Usage: node scripts/audit-group-post-visibility.cjs export.ndjson');
    const file = process.argv[2];
    if (fs.statSync(file).size > MAX_BYTES) throw new Error('Inventory input exceeds 32 MiB; split into smaller files');
    const rows = fs.readFileSync(file, 'utf8');
    const result = inventory(rows);
    process.stdout.write(JSON.stringify(result) + '\n');
  } catch (error) {
    process.stderr.write('Inventory failed: ' + error.message + '\n');
    process.exitCode = 1;
  }
}

module.exports = { classify, inventory };
