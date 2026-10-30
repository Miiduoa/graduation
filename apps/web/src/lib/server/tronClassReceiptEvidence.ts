/**
 * A school submission row can be created before a student actually submits it.
 * In particular, created_at by itself is not a submission receipt.
 *
 * This protects both the manual status lookup and the post-write verification
 * from labeling drafts or unfinished records as successfully submitted.
 */
const FINAL_STATES = new Set(['submitted', 'graded', 'finished']);
const NON_FINAL_STATES = new Set([
  'draft', 'pending', 'saved', 'editing', 'in_progress', 'in-progress',
  'not_submitted', 'not-submitted', 'unsubmitted', 'rejected', 'withdrawn',
]);

export function hasConfirmedTronClassSubmissionEvidence(record: Record<string, unknown>): boolean {
  const state = String(record.status ?? record.submission_status ?? '').trim().toLowerCase();
  if (NON_FINAL_STATES.has(state)) return false;
  if (FINAL_STATES.has(state)) return true;
  const submittedAt = record.submitted_at;
  return typeof submittedAt === 'string' && submittedAt.trim().length > 0 &&
    Number.isFinite(Date.parse(submittedAt));
}
