// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  buildTronClassNewSubmission, parseTronClassSubmissionAcknowledgment,
} from './tronClassSubmissionProtocol';
import {
  verifyTronClassSubmissionReadback, type TronClassSubmissionReadbackContext,
} from './tronClassSubmissionReadback';

// Synthetic protocol cases, not captured student or teacher receipts. No HTTP.
const NOW = Date.parse('2026-11-17T08:00:00.700Z');
const FILES = [
  { id: 601, name: 'synthetic-report.pdf', size: 2048 },
  { id: 602, name: 'synthetic-code.zip', size: 4096 },
];
const COMMENT = buildTronClassNewSubmission({ activityId: 202,
  content: '我的 <作業> & 說明\n第二行', uploadIds: FILES.map(file => file.id) }).body.comment as string;
function row(change: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 501, course_id: 101, activity_id: 202, created_by: { id: 303 },
    is_latest_version: true, is_draft: false, is_redo: false, submit_by_instructor: false,
    marked_submitted: false, comment: COMMENT, uploads: FILES.map(file => ({ ...file })),
    created_at: '2026-11-17T08:00:00Z', other_resources: [], slide_references: [],
    submission_correct: { grade: 99, comment: 'private-synthetic-grade' }, ...change,
  };
}
function oldRow(change: Record<string, unknown> = {}): Record<string, unknown> {
  return row({ id: 500, is_latest_version: false, comment: 'earlier content', uploads: [], ...change });
}
function context(change: Partial<TronClassSubmissionReadbackContext> = {}): TronClassSubmissionReadbackContext {
  const acknowledgment = parseTronClassSubmissionAcknowledgment({ submission: row(), student: { id: 303 } },
    { courseId: 101, activityId: 202, studentId: 303, priorSubmissionIds: [500] });
  if (acknowledgment.state !== 'acknowledged') throw new Error('invalid synthetic setup');
  return { acknowledgment, priorHistoryComplete: true, priorSubmissionIds: [500],
    comment: COMMENT, uploads: FILES.map(file => ({ ...file })), ...change };
}
function source(target = row(), envelope: Record<string, unknown> = {}) {
  return { list: [oldRow(), target], ...envelope };
}
const VERIFIED = {
  state: 'verified-new-version', submissionId: 501, courseId: 101, activityId: 202,
  studentId: 303, sourceRecordedAt: '2026-11-17T08:00:00.000Z',
};
const UNKNOWN = { state: 'unconfirmed' };

describe('authenticated final POST readback matching', () => {
  it('matches the exact new ID, body and unordered file set even when created_at has coarser precision', () => {
    const raw = source(row({ uploads: FILES.toReversed() }), { total: 2, has_next: false, next_page: null });
    expect(verifyTronClassSubmissionReadback(raw, context(), NOW)).toEqual(VERIFIED);
    expect(verifyTronClassSubmissionReadback({ list: [row(), oldRow()] }, context(), NOW)).toEqual(VERIFIED);
    // The coarse source record time is 700ms before this read; it is not used
    // as a final-submission timestamp or compared to a local write start time.
    expect(verifyTronClassSubmissionReadback(raw, context(), NOW)).not.toHaveProperty('submittedAt');
  });

  it('supports a confirmed empty baseline for a first submission and text/file-only submissions', () => {
    const first = context({ priorSubmissionIds: [] });
    expect(verifyTronClassSubmissionReadback({ list: [row()] }, first, NOW)).toEqual(VERIFIED);
    expect(verifyTronClassSubmissionReadback(source(row({ uploads: [] })), context({ uploads: [] }), NOW)).toEqual(VERIFIED);
    expect(verifyTronClassSubmissionReadback(source(row({ comment: '' })), context({ comment: '' }), NOW)).toEqual(VERIFIED);
  });

  it.each([undefined, null, '', 'bad-time', 1794902400000, '2026-11-18T00:00:00Z'])
  ('keeps an unavailable source record time nullable without rejecting a verified version: %j', created_at => {
    expect(verifyTronClassSubmissionReadback(source(row({ created_at })), context(), NOW))
      .toEqual({ ...VERIFIED, sourceRecordedAt: null });
  });

  it('preserves an earlier record time without claiming it is the time of submission', () => {
    expect(verifyTronClassSubmissionReadback(source(row({ created_at: '2026-11-16 16:00:00' })), context(), NOW))
      .toEqual({ ...VERIFIED, sourceRecordedAt: '2026-11-16T08:00:00.000Z' });
  });

  it('allows the scoped GET to supply scope while rejecting any supplied conflicting scope alias', () => {
    const target = row();
    delete target.course_id;
    delete target.activity_id;
    expect(verifyTronClassSubmissionReadback(source(target), context(), NOW)).toEqual(VERIFIED);
  });

  it.each([
    { course_id: 999 }, { activity_id: 999 }, { homework_id: 999 }, { student_id: 999 },
    { user_id: '303' }, { course: { id: 999 } }, { activity: { id: 999 } },
    { homework: { id: 999 } }, { student: { id: 999 } }, { created_by: { id: 999 } },
    { created_by: undefined }, { group_id: 4 }, { group: { id: 4 } }, { submit_by_group: true },
  ])('rejects contradictory target identity or scope: %j', change => {
    expect(verifyTronClassSubmissionReadback(source(row(change)), context(), NOW)).toEqual(UNKNOWN);
  });

  it.each([{ course_id: 999 }, { activity_id: 999 }, { student: { id: 999 } }, { group_id: 4 },
    { hidden: true }, { published: false }])('rejects conflicting envelope scope and visibility: %j', change => {
    expect(verifyTronClassSubmissionReadback(source(row(), change), context(), NOW)).toEqual(UNKNOWN);
  });

  it.each([
    { is_latest_version: false }, { is_latest_version: 1 }, { is_latest_version: undefined },
    { is_draft: true }, { is_draft: 0 }, { is_draft: undefined },
    { is_redo: true }, { is_redo: undefined },
    { submit_by_instructor: true, marked_submitted: true, created_by: { id: 999 } },
    { submit_by_instructor: undefined }, { marked_submitted: 'true' },
    { hidden: true }, { is_hidden: 1 }, { published: false },
  ])('requires the explicit student final state instead of a draft, returned or teacher marker: %j', change => {
    expect(verifyTronClassSubmissionReadback(source(row(change)), context(), NOW)).toEqual(UNKNOWN);
  });

  it('will not use an older matching version when a newer version is returned or unrecognised', () => {
    const raw = { list: [oldRow(), row({ is_latest_version: false }), row({ id: 502, is_redo: true })] };
    expect(verifyTronClassSubmissionReadback(raw, context(), NOW)).toEqual(UNKNOWN);
    expect(verifyTronClassSubmissionReadback({ list: [oldRow({ is_latest_version: true }), row()] }, context(), NOW)).toEqual(UNKNOWN);
  });

  it.each([
    { total: 3 }, { has_next: true }, { has_next: 'false' }, { next_page: 2 },
    { pagination: {} }, { paging: {} }, { page: 1 }, { page_size: 100 }, { page_count: 1 },
    { total_pages: 1 }, { total_count: 2 }, { next_cursor: null }, { next: null }, { has_more: false },
  ])('refuses unknown or incomplete pagination: %j', envelope => {
    expect(verifyTronClassSubmissionReadback(source(row(), envelope), context(), NOW)).toEqual(UNKNOWN);
  });

  it('requires every baseline ID and only one newly acknowledged version', () => {
    for (const list of [[], [row()], [oldRow()], [oldRow(), row(), row({ id: 502, is_latest_version: false })],
      [oldRow(), row(), row()], [oldRow({ id: 499 }), row()]]) {
      expect(verifyTronClassSubmissionReadback({ list }, context(), NOW)).toEqual(UNKNOWN);
    }
    expect(verifyTronClassSubmissionReadback(source(), context({ priorSubmissionIds: [501] }), NOW)).toEqual(UNKNOWN);
  });

  it('checks identity aliases on baseline rows without exposing existing teacher entries', () => {
    const teacher = oldRow({ submit_by_instructor: true, marked_submitted: true,
      created_by: { id: 999 }, comment: { private: true }, uploads: undefined });
    expect(verifyTronClassSubmissionReadback({ list: [teacher, row()] }, context(), NOW)).toEqual(VERIFIED);
    expect(verifyTronClassSubmissionReadback({ list: [oldRow({ student: { id: 999 } }), row()] }, context(), NOW)).toEqual(UNKNOWN);
  });

  it('requires explicit latest flags on the complete list so an unknown old row cannot hide another latest version', () => {
    for (const is_latest_version of [undefined, null, 'true', 0]) {
      expect(verifyTronClassSubmissionReadback({ list: [oldRow({ is_latest_version }), row()] }, context(), NOW)).toEqual(UNKNOWN);
    }
  });

  it.each([
    undefined, null, [], [FILES[0]], [...FILES, { id: 603, name: 'extra.pdf', size: 1 }],
    [{ ...FILES[0], id: 604 }, FILES[1]], [{ ...FILES[0], id: '601' }, FILES[1]],
    [{ ...FILES[0], name: 'renamed.pdf' }, FILES[1]], [{ ...FILES[0], size: 2049 }, FILES[1]],
    [{ ...FILES[0], size: null }, FILES[1]], [{ ...FILES[0], size: undefined }, FILES[1]],
    [FILES[0], FILES[0]], [{ ...FILES[0], hidden: true }, FILES[1]],
  ])('requires the complete, exact uploaded file set: %j', uploads => {
    expect(verifyTronClassSubmissionReadback(source(row({ uploads })), context(), NOW)).toEqual(UNKNOWN);
  });

  it.each([
    '我的 <作業> & 說明\n第二行', COMMENT.replace('<br>', '<br/>'), `${COMMENT} `,
    COMMENT.replace('&lt;', '&#60;'), null, undefined, '',
  ])('compares the canonical raw HTML string exactly without decoding or whitespace folding: %j', comment => {
    expect(verifyTronClassSubmissionReadback(source(row({ comment })), context(), NOW)).toEqual(UNKNOWN);
  });

  it.each(['other_resources', 'slide_references', 'slides', 'uploads_in_rich_text'])
  ('rejects extra or unknown resource references in %s', key => {
    for (const value of [[{ id: 888 }], [888], null, {}, '']) {
      expect(verifyTronClassSubmissionReadback(source(row({ [key]: value })), context(), NOW)).toEqual(UNKNOWN);
    }
    expect(verifyTronClassSubmissionReadback(source(row({ [key]: [] })), context(), NOW)).toEqual(VERIFIED);
  });

  it('does not turn a multiple-choice or ambiguous mode into normal text/file proof', () => {
    expect(verifyTronClassSubmissionReadback(source(row({ mode: 'normal' })), context(), NOW)).toEqual(VERIFIED);
    for (const mode of ['multiple', null, false]) {
      expect(verifyTronClassSubmissionReadback(source(row({ mode })), context(), NOW)).toEqual(UNKNOWN);
    }
  });

  it.each([
    { priorHistoryComplete: false }, { priorHistoryComplete: undefined },
    { priorSubmissionIds: [500, 500] }, { priorSubmissionIds: new Array(1) },
    { priorSubmissionIds: ['500'] }, { priorSubmissionIds: Array.from({ length: 100 }, (_, index) => index + 1) },
    { acknowledgment: { state: 'unconfirmed' } },
    { uploads: [FILES[0], FILES[0]] }, { uploads: new Array(1) },
    { uploads: [{ ...FILES[0], name: '../private.txt' }] },
    { uploads: [{ ...FILES[0], size: 0 }] }, { uploads: [{ ...FILES[0], size: 10 * 1024 * 1024 + 1 }] },
    { comment: '', uploads: [] }, { comment: 'x'.repeat(120_001) },
  ])('rejects incomplete or malformed comparison context: %j', change => {
    expect(verifyTronClassSubmissionReadback(source(), context(change as Partial<TronClassSubmissionReadbackContext>), NOW)).toEqual(UNKNOWN);
  });

  it('projects no private data and never reads teacher grading fields or returns raw errors', () => {
    const target = row();
    Object.defineProperty(target, 'submission_correct', { get() { throw new Error('private-grading-must-not-be-read'); } });
    const result = verifyTronClassSubmissionReadback(source(target), context(), NOW);
    expect(result).toEqual(VERIFIED);
    expect(Object.keys(result)).toEqual(['state', 'submissionId', 'courseId', 'activityId', 'studentId', 'sourceRecordedAt']);
    expect(JSON.stringify(result)).not.toMatch(/private|synthetic|uploads|comment|grade|receipt|submittedAt/);
    const malformed = { get list() { throw new Error('private-upstream-exception'); } };
    expect(verifyTronClassSubmissionReadback(malformed, context(), NOW)).toEqual(UNKNOWN);
  });

  it('does not mutate its raw source or context', () => {
    const raw = source();
    const comparison = context();
    const before = JSON.stringify({ raw, comparison });
    verifyTronClassSubmissionReadback(raw, comparison, NOW);
    expect(JSON.stringify({ raw, comparison })).toBe(before);
  });
});
