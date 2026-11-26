import type { TronClassAssignmentDetails } from './tronClassIntegrationTypes';

function record(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
function exactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every(key => Object.prototype.hasOwnProperty.call(value, key));
}
function instant(value: unknown): boolean {
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}
function flag(value: unknown): boolean { return value === null || typeof value === 'boolean'; }
function count(value: unknown): boolean {
  return value === null || (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0);
}

/** Reject malformed/stale provider shapes before they can become user-facing rules. */
export function isTronClassAssignmentDetails(value: unknown): value is TronClassAssignmentDetails {
  if (!record(value)) return false;
  if (value.status === 'unavailable') return exactKeys(value, ['status']);
  if (value.status !== 'available' || !exactKeys(value, ['status', 'fetchedAt', 'submissionType', 'mode',
    'opensAt', 'deadline', 'isInProgress', 'isClosed', 'attempts', 'resubmissionOpen', 'retractAllowed']) ||
    !instant(value.fetchedAt) || typeof value.submissionType !== 'string' || !['individual', 'group', 'unknown'].includes(value.submissionType) ||
    typeof value.mode !== 'string' || !['normal', 'multiple', 'unknown'].includes(value.mode) ||
    (value.opensAt !== null && !instant(value.opensAt)) || (value.deadline !== null && !instant(value.deadline)) ||
    !flag(value.isInProgress) || !flag(value.isClosed) || !flag(value.resubmissionOpen) || !flag(value.retractAllowed) ||
    !record(value.attempts) || !exactKeys(value.attempts, ['unlimited', 'limit', 'used', 'remaining'])) return false;
  const attempts = value.attempts;
  if (!flag(attempts.unlimited) || !count(attempts.limit) || !count(attempts.used) || !count(attempts.remaining)) return false;
  if (attempts.unlimited === true && attempts.limit !== null) return false;
  const remaining = attempts.unlimited === false && typeof attempts.limit === 'number' && typeof attempts.used === 'number'
    ? Math.max(0, attempts.limit - attempts.used) : null;
  return attempts.remaining === remaining;
}
