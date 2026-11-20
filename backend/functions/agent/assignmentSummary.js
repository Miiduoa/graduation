'use strict';

const { toJsDate } = require('../lib/assistantFormat');

function supportedId(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 128 &&
    /^[A-Za-z0-9_-]+$/.test(value);
}

/** Serialize only fields the existing authorized reader permits the caller to see. */
function serializeAssignmentRow(item) {
  if (!item || typeof item.title !== 'string' || !item.title.trim()) {
    throw new Error('Assignment source is incomplete');
  }
  const date = toJsDate(item.dueAt);
  const source = supportedId(item.groupId) && supportedId(item.id)
    ? { kind: 'group-assignment', groupId: item.groupId, assignmentId: item.id }
    : null;
  return {
    title: item.title.slice(0, 140),
    groupName: typeof item.groupName === 'string' ? item.groupName.slice(0, 100) : '',
    dueAt: date && Number.isFinite(date.getTime()) ? date.toISOString() : null,
    ...(source ? { source } : {}),
  };
}

/** Compatibility summary for callers that explicitly request a short preview. */
function summarizeAssignmentRows(items) {
  if (!Array.isArray(items)) throw new Error('Assignment source is unavailable');
  return { status: 'available', count: items.length, items: items.slice(0, 8).map(serializeAssignmentRow) };
}

module.exports = { summarizeAssignmentRows, serializeAssignmentRow };
