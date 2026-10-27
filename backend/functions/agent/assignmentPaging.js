'use strict';

const { createHash } = require('node:crypto');
const { HttpsError } = require('firebase-functions/v2/https');
const { serializeAssignmentRow } = require('./assignmentSummary');

const ASSIGNMENT_PAGE_SIZE = 50;
const MAX_ASSIGNMENT_ROWS = 10000;

function parseAssignmentPageRequest(value) {
  if (value === undefined) return { offset: 0, revision: null };
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).some((key) => key !== 'offset' && key !== 'revision') ||
      !Number.isSafeInteger(value.offset) || value.offset < 0 ||
      value.offset > MAX_ASSIGNMENT_ROWS || value.offset % ASSIGNMENT_PAGE_SIZE !== 0 ||
      (value.offset > 0 && (typeof value.revision !== 'string' || !/^[a-f0-9]{64}$/.test(value.revision))) ||
      (value.offset === 0 && value.revision != null)) {
    throw new HttpsError('invalid-argument', 'Invalid assignment page');
  }
  return { offset: value.offset, revision: value.offset === 0 ? null : value.revision };
}

/**
 * Every page starts from a newly authorized reader result. A revision is a
 * consistency check, NEVER an access credential or a substitute for membership.
 * No answer bodies, submissions or extra user fields enter this envelope.
 */
function summarizeAssignmentPage(items, scope, request) {
  const page = parseAssignmentPageRequest(request);
  if (!scope || typeof scope.uid !== 'string' || !scope.uid ||
      typeof scope.schoolId !== 'string' || !scope.schoolId) {
    throw new HttpsError('invalid-argument', 'Assignment scope is required');
  }
  if (!Array.isArray(items)) throw new Error('Assignment source is unavailable');
  if (items.length > MAX_ASSIGNMENT_ROWS) {
    throw new HttpsError('resource-exhausted', 'Assignment source exceeds the read budget');
  }
  const seen = new Set();
  const rows = items.map((item) => {
    const row = serializeAssignmentRow(item);
    if (row.source) {
      const key = JSON.stringify([row.source.groupId, row.source.assignmentId]);
      if (seen.has(key)) throw new HttpsError('failed-precondition', 'Duplicate assignment identity');
      seen.add(key);
    }
    return { row, key: JSON.stringify(row), due: row.dueAt ? Date.parse(row.dueAt) : Infinity };
  });
  // Stable order even when the datastore returns equal-deadline rows differently.
  rows.sort((a, b) => {
    if (a.due !== b.due) return a.due < b.due ? -1 : 1;
    return a.key === b.key ? 0 : a.key < b.key ? -1 : 1;
  });
  const serialized = rows.map((entry) => entry.row);
  const revision = createHash('sha256')
    .update(JSON.stringify(['campus-assignments-v1', scope.uid, scope.schoolId, serialized]))
    .digest('hex');
  if (page.offset > 0 && (page.revision !== revision || page.offset >= serialized.length)) {
    throw new HttpsError('failed-precondition', 'Assignment source changed; start a new synchronization');
  }
  const end = Math.min(page.offset + ASSIGNMENT_PAGE_SIZE, serialized.length);
  return {
    status: 'available',
    count: serialized.length,
    items: serialized.slice(page.offset, end),
    paging: { version: 1, offset: page.offset, nextOffset: end < serialized.length ? end : null, revision },
  };
}

module.exports = { ASSIGNMENT_PAGE_SIZE, parseAssignmentPageRequest, summarizeAssignmentPage };
