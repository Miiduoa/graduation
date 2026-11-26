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
// Redacted shape observed in an authenticated student submission_list. IDs,
// names and sizes are synthetic; this is not evidence of a new live submission.
function generatedPdf(change: Record<string, unknown> = {}) {
  return { id: 603, name: 'synthetic-system-document', size: 1024,
    source: 'auto-generated-pdf', status: 'ready', type: 'document',
    allow_download: true, deleted: false, reference_id: 0, ...change };
}
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

  it.each([true, false])('matches original uploads and one explicit school-generated PDF (has originals=%s)', withOriginals => {
    const originals = withOriginals ? FILES.map(file => ({ ...file, source: '' })) : [];
    const target = row({ uploads: [generatedPdf(), ...originals.toReversed()] });
    delete target.course_id; // The authenticated history response omits this redundant field.
    const comparison = context({ uploads: withOriginals ? FILES : [] });
    const raw = source(target);
    const before = JSON.stringify({ raw, comparison });
    const result = verifyTronClassSubmissionReadback(raw, comparison, NOW);
    expect(result).toEqual(VERIFIED);
    expect(JSON.stringify({ raw, comparison })).toBe(before);
    expect(JSON.stringify(result)).not.toMatch(/auto-generated|synthetic-system|uploads|comment/);
  });

  it.each([
    { source: '' }, { source: undefined }, { source: null }, { source: 'LARK' },
    { source: 'auto-generated-pdf ' }, { source: ['auto-generated-pdf'] },
    { status: undefined }, { status: 'uploading' }, { status: 'failed' },
    { type: undefined }, { type: 'image' }, { allow_download: undefined }, { allow_download: false },
    { deleted: undefined }, { deleted: true }, { deleted: 0 }, { is_deleted: true },
    { reference_id: undefined }, { reference_id: 1 },
    { id: -1 }, { id: '603' }, { size: null }, { size: undefined }, { size: 0 },
    { hidden: true }, { published: false },
  ])('keeps an extra resource unknown unless it matches the observed generated-PDF shape: %j', change => {
    expect(verifyTronClassSubmissionReadback(source(row({ uploads: [...FILES, generatedPdf(change)] })), context(), NOW)).toEqual(UNKNOWN);
  });

  it('never uses a generated PDF to replace a missing original, disguise an original ID, or hide another extra file', () => {
    for (const uploads of [
      [FILES[0], generatedPdf()],
      [generatedPdf({ ...FILES[0] }), FILES[1]],
      [...FILES, generatedPdf(), generatedPdf({ id: 604 })],
      [...FILES, generatedPdf(), generatedPdf()],
      [...FILES, generatedPdf(), { id: 604, name: 'extra.pdf', size: 1024, source: '' }],
      [...FILES, generatedPdf(), generatedPdf({ id: 604, source: 'LARK' })],
      [{ ...FILES[0], source: 'LARK' }, FILES[1], generatedPdf()],
    ]) {
      expect(verifyTronClassSubmissionReadback(source(row({ uploads })), context(), NOW)).toEqual(UNKNOWN);
    }
  });

  it.each([
    { deleted: true }, { is_deleted: 1 }, { from_project: true }, { isFromKnowledgeGraph: true },
    { reference_id: 804 }, { type: 'link' }, { audit_status: 'reject' }, { audit_status: 'pending' },
    { status: 'failed' }, { status: 'uploading' }, { status: 'cliping' }, { status: 'clip_failed' },
  ])('rejects explicit unusable or external metadata on original and generated files: %j', change => {
    const original = source(row({ uploads: [{ ...FILES[0], ...change }, FILES[1]] }));
    const generated = source(row({ uploads: [...FILES, generatedPdf(change)] }));
    expect([
      verifyTronClassSubmissionReadback(original, context(), NOW),
      verifyTronClassSubmissionReadback(generated, context(), NOW),
    ]).toEqual([UNKNOWN, UNKNOWN]);
  });

  it.each([
    {}, { allow_download: false },
    { audit_status: 'agree', deleted: false, is_deleted: 0, from_project: false,
      isFromKnowledgeGraph: 0, reference_id: 0, type: 'document', status: 'ready', allow_download: false },
    { audit_status: null, reference_id: null, type: null, status: null },
  ])('preserves legacy optional original-file metadata and does not require download permission: %j', change => {
    const uploads = FILES.map(file => ({ ...file, ...change }));
    expect(verifyTronClassSubmissionReadback(source(row({ uploads })), context(), NOW)).toEqual(VERIFIED);
    expect(verifyTronClassSubmissionReadback(source(row({ uploads: [...uploads, generatedPdf()] })), context(), NOW)).toEqual(VERIFIED);
  });

  it('does not let a generated PDF weaken the owner, version, body or complete-history checks', () => {
    for (const change of [
      { created_by: { id: 999 } }, { is_latest_version: false }, { is_draft: true },
      { comment: `${COMMENT} changed` }, { activity_id: 999 },
    ]) {
      expect(verifyTronClassSubmissionReadback(source(row({ uploads: [...FILES, generatedPdf()], ...change })), context(), NOW)).toEqual(UNKNOWN);
    }
    expect(verifyTronClassSubmissionReadback(source(row({ uploads: [...FILES, generatedPdf()] }), { has_next: true }), context(), NOW)).toEqual(UNKNOWN);
    expect(verifyTronClassSubmissionReadback({ list: [row({ uploads: [...FILES, generatedPdf()] })] }, context(), NOW)).toEqual(UNKNOWN);
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
