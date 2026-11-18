// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { parseFragment } from 'parse5';
import {
  TRONCLASS_PROTOCOL_MAX_CONTENT, TRONCLASS_PROTOCOL_MAX_FILE_BYTES, TRONCLASS_PROTOCOL_MAX_PRIOR_SUBMISSIONS,
  buildTronClassNewSubmission, buildTronClassUploadCallback, buildTronClassUploadMetadata,
  parseTronClassSubmissionAcknowledgment, parseTronClassUploadMetadata,
  type TronClassAcknowledgmentContext, type TronClassNewSubmissionInput, type TronClassUploadMetadataInput,
} from './tronClassSubmissionProtocol';

// Every fixture below is SYNTHETIC. No student capture or verified server receipt.
const syntheticContext: TronClassAcknowledgmentContext = {
  courseId: 101, activityId: 202, studentId: 303, priorSubmissionIds: [500],
};
const syntheticSubmission = {
  id: 501, course_id: 101, activity_id: 202, created_by: { id: 303, name: 'synthetic-private-name' },
  is_draft: false, is_redo: false, is_latest_version: true, submit_by_instructor: false, marked_submitted: false,
  created_at: '2026-11-16T10:00:00Z', comment: 'synthetic-private-content',
  uploads: [{ id: 601, key: 'synthetic-private-key' }],
  submission_correct: { instructor_score: 99, comment: 'synthetic-private-grade' },
};
function syntheticEnvelope(change: Record<string, unknown> = {}) {
  return { submission: { ...syntheticSubmission, ...change }, student: { id: 303, email: 'synthetic@example.invalid' } };
}
const syntheticFile = { name: 'synthetic-report.pdf', size: 2048 };
const syntheticMetadata = {
  id: 601, ...syntheticFile, status: 'synthetic-unknown-status', storage_type: 'S3', transcoder: 'WRPC',
  upload_url: 'https://untrusted.example.invalid/upload?token=synthetic-secret', key: 'synthetic-storage-key',
};
const invalidIds: unknown[] = [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '202', true, null, undefined, {}, []];

describe('synthetic new normal submission protocol', () => {
  it('constructs only the observed POST fields and deduplicates numeric IDs without retaining input arrays', () => {
    const uploadIds = [602, 601, 602];
    const input = { activityId: 202, content: '  synthetic report  ', uploadIds,
      operationId: 'synthetic-internal-operation', submission_id: 500, is_draft: true, mode: 'multiple' };
    const request = buildTronClassNewSubmission(input);
    uploadIds.push(999);
    expect(request).toEqual({ method: 'POST', schoolPath: '/api/course/activities/202/submissions', body: {
      comment: 'synthetic report', uploads: [602, 601], slides: [], is_draft: false, mode: 'normal',
      other_resources: [], uploads_in_rich_text: [],
    } });
    expect(request.body).not.toHaveProperty('operationId');
    expect(request.body).not.toHaveProperty('submission_id');
  });

  it('turns literal HTML, entities and newlines into inert comment text with only deliberate br elements', () => {
    const request = buildTronClassNewSubmission({ activityId: 202,
      content: '  <script>"x" & \'y\'</script>\r\n<img src=x onerror=bad()>\r&lt;b&gt;  ', uploadIds: [] });
    expect(request.body.comment).toBe('&lt;script&gt;&quot;x&quot; &amp; &#39;y&#39;&lt;/script&gt;<br>&lt;img src=x onerror=bad()&gt;<br>&amp;lt;b&amp;gt;');
    const fragment = parseFragment(request.body.comment as string);
    expect(fragment.childNodes.map(node => node.nodeName)).toEqual(['#text', 'br', '#text', 'br', '#text']);
    expect(fragment.childNodes[0]).toMatchObject({ value: '<script>"x" & \'y\'</script>' });
    expect(request.body.uploads_in_rich_text).toEqual([]);
  });

  it('preserves valid Unicode and supports either plain text or already verified numeric uploads', () => {
    expect(buildTronClassNewSubmission({ activityId: 202, content: '報告 😀', uploadIds: [] }).body.comment).toBe('報告 😀');
    expect(buildTronClassNewSubmission({ activityId: 202, content: '  ', uploadIds: [601] }).body.comment).toBe('');
    expect(() => buildTronClassNewSubmission({ activityId: 202, content: ' \n\t', uploadIds: [] })).toThrow('TRONCLASS_PROTOCOL_INVALID_INPUT');
  });

  it.each(invalidIds)('rejects activity/upload/callback IDs without numeric coercion: %j', value => {
    expect(() => buildTronClassNewSubmission({ activityId: value, content: 'synthetic', uploadIds: [] } as TronClassNewSubmissionInput))
      .toThrow('TRONCLASS_PROTOCOL_INVALID_INPUT');
    expect(() => buildTronClassNewSubmission({ activityId: 202, content: 'synthetic', uploadIds: [value] } as TronClassNewSubmissionInput))
      .toThrow('TRONCLASS_PROTOCOL_INVALID_INPUT');
    expect(() => buildTronClassUploadCallback(value as number)).toThrow('TRONCLASS_PROTOCOL_INVALID_INPUT');
  });

  it.each([
    null, { activityId: 202, content: {}, uploadIds: [] },
    { activityId: 202, content: 'synthetic', uploadIds: '601' },
    { activityId: 202, content: 'synthetic', uploadIds: new Array(1) },
    { activityId: 202, content: 'synthetic', uploadIds: [1, 2, 3, 4, 5] },
    { activityId: 202, content: 'x'.repeat(TRONCLASS_PROTOCOL_MAX_CONTENT + 1), uploadIds: [] },
    ...['a\u0000b', 'a\u001bb', 'a\u007fb', 'a\u0085b', '\ud800', '\udfff'].map(content => ({ activityId: 202, content, uploadIds: [] })),
  ])('rejects malformed, unbounded or lossy text input with a fixed error: %j', input => {
    expect(() => buildTronClassNewSubmission(input as TronClassNewSubmissionInput)).toThrow('TRONCLASS_PROTOCOL_INVALID_INPUT');
  });
});

describe('synthetic root resource metadata and callback protocol', () => {
  it('uses the personal root and the exact observed metadata defaults', () => {
    expect(buildTronClassUploadMetadata({ ...syntheticFile, parent_id: 202 } as TronClassUploadMetadataInput)).toEqual({
      method: 'POST', schoolPath: '/api/uploads', body: { ...syntheticFile, parent_type: null, parent_id: 0,
        is_scorm: false, is_wmpkg: false, source: '', is_marked_attachment: false, embed_material_type: '' },
    });
    expect(buildTronClassUploadCallback(601)).toEqual({
      method: 'POST', schoolPath: '/internal-api/upload/callback/601', body: { file_key: 601 },
    });
  });

  it.each([
    null, { name: '', size: 1 }, { name: '   ', size: 1 }, { name: '.', size: 1 }, { name: '..', size: 1 },
    { name: '../synthetic.pdf', size: 1 }, { name: 'dir\\synthetic.pdf', size: 1 },
    { name: 'synthetic\nheader.pdf', size: 1 }, { name: 'x'.repeat(201), size: 1 },
    { name: '\ud800', size: 1 }, { name: ['synthetic.pdf'], size: 1 },
    ...invalidIds.map(size => ({ name: 'synthetic.pdf', size })),
    { name: 'synthetic.pdf', size: TRONCLASS_PROTOCOL_MAX_FILE_BYTES + 1 },
  ])('rejects unsafe names and unsupported byte sizes: %j', input => {
    expect(() => buildTronClassUploadMetadata(input as TronClassUploadMetadataInput)).toThrow('TRONCLASS_PROTOCOL_INVALID_INPUT');
    expect(parseTronClassUploadMetadata(syntheticMetadata, input as TronClassUploadMetadataInput)).toEqual({ state: 'unconfirmed' });
  });

  it.each([
    'https://untrusted.example.invalid/private?token=synthetic-secret',
    'https://tronclass.pu.edu.tw/api/course/activities/999/submissions',
    'http://127.0.0.1/private', 'file:///synthetic-secret', 'javascript:synthetic()', { secret: true }, null,
  ])('never trusts or returns an upload URL even when metadata was created: %j', upload_url => {
    const result = parseTronClassUploadMetadata({ ...syntheticMetadata, upload_url }, syntheticFile);
    expect(result).toEqual({ state: 'metadata-created', uploadId: 601, binaryUpload: 'unsupported' });
    expect(result).not.toHaveProperty('status');
    expect(result).not.toHaveProperty('upload_url');
    expect(JSON.stringify(result)).not.toMatch(/secret|storage|token|WRPC|S3|uploaded/);
  });

  it('does not even read the URL or infer uploaded from a status or storage type', () => {
    const raw = { ...syntheticMetadata, status: 'uploaded' };
    Object.defineProperty(raw, 'upload_url', { get() { throw new Error('synthetic-url-must-not-be-read'); } });
    expect(parseTronClassUploadMetadata(raw, syntheticFile)).toEqual({ state: 'metadata-created', uploadId: 601, binaryUpload: 'unsupported' });
  });

  it.each([
    null, [], { upload: syntheticMetadata }, { ...syntheticMetadata, id: '601' },
    { ...syntheticMetadata, id: 0 }, { ...syntheticMetadata, name: undefined },
    { ...syntheticMetadata, name: 'different-synthetic.pdf' }, { ...syntheticMetadata, size: 2049 },
    { ...syntheticMetadata, parent_id: 202 }, { ...syntheticMetadata, parent_type: 'activity' },
    { ...syntheticMetadata, is_marked_attachment: true }, { ...syntheticMetadata, published: false },
  ])('keeps malformed or mismatched metadata unconfirmed: %j', raw => {
    expect(parseTronClassUploadMetadata(raw, syntheticFile)).toEqual({ state: 'unconfirmed' });
  });
});

describe('synthetic final acknowledgment, never a receipt', () => {
  it('projects only the new scoped acknowledgment and never relabels created_at', () => {
    const result = parseTronClassSubmissionAcknowledgment(syntheticEnvelope(), syntheticContext);
    expect(result).toEqual({ state: 'acknowledged', submissionId: 501, courseId: 101, activityId: 202, studentId: 303 });
    expect(JSON.stringify(result)).not.toMatch(/submittedAt|created_at|2026-|synthetic-private|grade|email|content|uploads|receipt/);
    expect(result).not.toHaveProperty('status');
  });

  it.each([
    { id: 500 }, { id: '501' }, { id: 0 }, { id: Number.MAX_SAFE_INTEGER + 1 },
    { course_id: 999 }, { course_id: undefined }, { course_id: '101' },
    { activity_id: 999 }, { activity_id: undefined }, { homework_id: 999 },
    { created_by: { id: 999 } }, { created_by: { id: '303' } }, { created_by: undefined },
    { student_id: 999 }, { user_id: 999 }, { student: { id: 999 } }, { course: { id: 999 } },
    { group_id: 99 }, { group_id: '0' }, { group: { id: 99 } }, { submit_by_group: true },
    { is_draft: true }, { is_draft: undefined }, { is_draft: 0 },
    { is_redo: true }, { is_redo: undefined }, { is_redo: 0 },
    { is_latest_version: false }, { is_latest_version: undefined }, { is_latest_version: 1 },
    { submit_by_instructor: true, marked_submitted: true },
    { submit_by_instructor: true, marked_submitted: false, created_by: { id: 999 } },
    { submit_by_instructor: undefined }, { submit_by_instructor: 0 }, { marked_submitted: 'true' },
    { hidden: true }, { published: false },
  ])('rejects stale, crossed, missing and ambiguous submission proof: %j', change => {
    expect(parseTronClassSubmissionAcknowledgment(syntheticEnvelope(change), syntheticContext)).toEqual({ state: 'unconfirmed' });
  });

  it.each([
    null, [], { id: 501 }, { submission: syntheticSubmission },
    { ...syntheticEnvelope(), student: { id: 999 } }, { ...syntheticEnvelope(), student: { id: '303' } },
    { ...syntheticEnvelope(), course_id: 999 }, { ...syntheticEnvelope(), activity_id: 999 },
    { ...syntheticEnvelope(), user_id: 999 }, { ...syntheticEnvelope(), group_id: 99 },
    { ...syntheticEnvelope(), hidden: true },
  ])('does not treat a 2xx-shaped envelope or conflicting outer identity as a success: %j', raw => {
    expect(parseTronClassSubmissionAcknowledgment(raw, syntheticContext)).toEqual({ state: 'unconfirmed' });
  });

  it.each([
    null, { ...syntheticContext, courseId: '101' }, { ...syntheticContext, activityId: 0 },
    { ...syntheticContext, studentId: '303' }, { ...syntheticContext, priorSubmissionIds: ['500'] },
    { ...syntheticContext, priorSubmissionIds: [500, 500] }, { ...syntheticContext, priorSubmissionIds: new Array(1) },
    { ...syntheticContext, priorSubmissionIds: Array.from({ length: TRONCLASS_PROTOCOL_MAX_PRIOR_SUBMISSIONS + 1 }, (_, index) => index + 1) },
  ])('requires a bounded valid comparison context: %j', context => {
    expect(parseTronClassSubmissionAcknowledgment(syntheticEnvelope(), context as TronClassAcknowledgmentContext)).toEqual({ state: 'unconfirmed' });
  });

  it('does not infer teacher submission from marked_submitted alone', () => {
    expect(parseTronClassSubmissionAcknowledgment(syntheticEnvelope({ marked_submitted: true }), syntheticContext).state).toBe('acknowledged');
  });

  it('returns a fixed result if malformed upstream property access fails', () => {
    const raw = { get submission() { throw new Error('synthetic-private-upstream-error'); }, student: { id: 303 } };
    expect(parseTronClassSubmissionAcknowledgment(raw, syntheticContext)).toEqual({ state: 'unconfirmed' });
  });
});
