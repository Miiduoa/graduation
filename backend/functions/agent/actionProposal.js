'use strict';

function timestampMs(value) {
  if (value && typeof value.toMillis === 'function') return value.toMillis();
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return Date.parse(value);
  return NaN;
}

function canonicalJson(value) {
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  if (value && typeof value === 'object') {
    const fields = Object.keys(value).filter((key) => value[key] !== undefined).sort();
    return '{' + fields.map((key) => JSON.stringify(key) + ':' + canonicalJson(value[key])).join(',') + '}';
  }
  return JSON.stringify(value);
}

/**
 * A write may only use a proposal saved with this user's completed run.
 * Returns its index for the single-use claim, or -1 if it cannot be authorized.
 */
function matchAgentProposal(run, { uid, schoolId, toolName, input, now = Date.now() }) {
  if (!run || run.status !== 'completed' || run.userId !== uid || run.schoolId !== schoolId) {
    return -1;
  }
  const createdAt = timestampMs(run.createdAt);
  if (!Number.isFinite(createdAt) || createdAt > now + 60_000 || now - createdAt > 30 * 60_000) {
    return -1;
  }
  if (!Array.isArray(run.actionProposals)) return -1;
  const expected = canonicalJson(input);
  return run.actionProposals.findIndex((item) =>
    item && item.toolName === toolName && canonicalJson(item.input) === expected);
}

module.exports = { matchAgentProposal };
