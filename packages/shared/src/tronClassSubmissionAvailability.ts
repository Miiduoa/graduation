/**
 * Read-only observations of the school's submission windows. An open window is
 * not a write grant: mode, prerequisites, attachments and final-write contracts
 * still need their own current server-side authorization.
 */
export type TronClassSpecialSubmissionWindow = {
  state: 'none' | 'open' | 'used' | 'closed' | 'disabled' | 'unknown';
  /** The student endpoint's last_updated_time, when explicitly understood. */
  updatedAt: string | null;
};

export type TronClassSubmissionAvailability = {
  source: 'tronclass';
  courseId: number;
  homeworkId: number;
  revision: string;
  fetchedAt: string;
  state: 'available' | 'unavailable' | 'group-unsupported';
  ordinary: {
    state: 'open' | 'not-started' | 'closed' | 'attempts-exhausted' | 'unknown';
    /** First formal submission versus another attempt; drafts are separate. */
    kind: 'first' | 'repeat' | 'unknown';
    /** Null can mean unlimited or unconfirmed; do not infer unlimited from it. */
    remainingAttempts: number | null;
  };
  makeUp: TronClassSpecialSubmissionWindow;
  resubmit: TronClassSpecialSubmissionWindow;
  draft: {
    state: 'none' | 'available' | 'ambiguous' | 'unknown';
    /** Only one unambiguous, owned school draft provides an ID. */
    submissionId: string | null;
    count: number | null;
  };
};

const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const id = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
const revision = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-f0-9]{32}$/.test(value);
const timestamp = (value: unknown): value is string => {
  if (typeof value !== 'string' || value.length !== 24) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
};
const only = (value: Record<string, unknown>, keys: readonly string[]) =>
  Object.keys(value).every(key => keys.includes(key));
const member = (value: unknown, choices: readonly string[]) =>
  typeof value === 'string' && choices.includes(value);

function special(value: unknown, allowDisabled: boolean): value is TronClassSpecialSubmissionWindow {
  return object(value) && only(value, ['state', 'updatedAt']) &&
    member(value.state, ['none', 'open', 'used', 'closed', 'unknown', ...(allowDisabled ? ['disabled'] : [])]) &&
    (value.updatedAt === null || timestamp(value.updatedAt)) &&
    (value.state !== 'none' || value.updatedAt === null);
}

/** Exact DTO boundary, including the enclosing preparation's scope/revision. */
export function isTronClassSubmissionAvailability(
  value: unknown,
  scope: { courseId: number; homeworkId: number },
  expectedRevision: string,
): value is TronClassSubmissionAvailability {
  if (!object(value) || !only(value, ['source', 'courseId', 'homeworkId', 'revision', 'fetchedAt',
    'state', 'ordinary', 'makeUp', 'resubmit', 'draft']) || value.source !== 'tronclass' ||
    !id(value.courseId) || !id(value.homeworkId) || value.courseId !== scope.courseId ||
    value.homeworkId !== scope.homeworkId || !revision(expectedRevision) || value.revision !== expectedRevision ||
    !timestamp(value.fetchedAt) || !member(value.state, ['available', 'unavailable', 'group-unsupported']) ||
    !object(value.ordinary) || !only(value.ordinary, ['state', 'kind', 'remainingAttempts']) ||
    !member(value.ordinary.state, ['open', 'not-started', 'closed', 'attempts-exhausted', 'unknown']) ||
    !member(value.ordinary.kind, ['first', 'repeat', 'unknown']) ||
    !(value.ordinary.remainingAttempts === null || (typeof value.ordinary.remainingAttempts === 'number' &&
      Number.isSafeInteger(value.ordinary.remainingAttempts) && value.ordinary.remainingAttempts >= 0)) ||
    !special(value.makeUp, false) || !special(value.resubmit, true) ||
    !object(value.draft) || !only(value.draft, ['state', 'submissionId', 'count']) ||
    !member(value.draft.state, ['none', 'available', 'ambiguous', 'unknown'])) return false;

  const draft = value.draft;
  if (draft.state === 'available') {
    if (draft.count !== 1 || typeof draft.submissionId !== 'string' ||
      !/^[1-9]\d{0,15}$/.test(draft.submissionId) || !Number.isSafeInteger(Number(draft.submissionId))) return false;
  } else if (draft.submissionId !== null ||
    (draft.state === 'none' && draft.count !== 0) ||
    (draft.state === 'unknown' && draft.count !== null) ||
    (draft.state === 'ambiguous' && (typeof draft.count !== 'number' ||
      !Number.isSafeInteger(draft.count) || draft.count < 2 || draft.count > 100))) return false;

  if ((value.ordinary.state === 'open' && value.ordinary.remainingAttempts === 0) ||
    (value.ordinary.state === 'attempts-exhausted' && value.ordinary.remainingAttempts !== 0)) return false;
  if (value.state !== 'available') {
    return value.ordinary.state === 'unknown' && value.ordinary.kind === 'unknown' &&
      value.ordinary.remainingAttempts === null && value.makeUp.state === 'unknown' && value.makeUp.updatedAt === null &&
      value.resubmit.state === 'unknown' && value.resubmit.updatedAt === null && draft.state === 'unknown';
  }
  return true;
}
