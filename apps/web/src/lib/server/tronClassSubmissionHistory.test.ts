// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { NuniError } from '@campus/shared/src/nuni';
import { isTronClassSubmissionHistory } from '@campus/shared/src/tronClassSubmissionHistory';
import { normalizeTronClassSubmissionHistory, readTronClassSubmissionHistory } from './tronClassSubmissionHistory';
import { createTronClassSubmissionSource, type TronClassSubmissionBinding } from './tronClassSubmissionSource';
import type { LmsReadonlySource } from './tronClassLmsSource';

// Synthetic contract examples derived from public client field use; never a live student capture.
const now = Date.parse('2026-11-16T12:00:00.000Z');
const scope = { courseId: 101, homeworkId: 202 };
const binding: TronClassSubmissionBinding = {
  schoolId: 'pu', userId: 303, account: 'synthetic-student', revision: 'a'.repeat(32),
  userName: null, cookies: { session: 'synthetic-cookie' }, expiresAt: '2026-11-17T00:00:00.000Z',
};
const activity = { id: 202, course_id: 101, type: 'homework', title: '報告', published: true, submit_by_group: false };
const submission = {
  id: 501, created_by: { id: 303, name: '不應外傳的姓名' }, created_at: '2026-11-15T10:00:00Z',
  is_latest_version: true, is_draft: false, is_redo: false, submit_by_instructor: false, marked_submitted: false,
  comment: '<p>自己的報告</p>', uploads: [{ id: 601, name: '報告.pdf', size: 2048, key: 'private-upload-key' }],
  submission_correct: { instructor_score: 80, comment: '未公開的評閱內容' },
};
const normalize = (list: unknown[], extras: Record<string, unknown> = {}) =>
  normalizeTronClassSubmissionHistory({ list, ...extras }, binding, scope, now);
function fixture() {
  const source: LmsReadonlySource = {
    fetchCourses: vi.fn(async (_cookies, options) => options.status === 'ongoing' ? [{ id: 101, name: '課程' }] : []),
    fetchHomeworkPage: vi.fn(async () => ({ ok: true as const, value: { homework_activities: [activity], total: 1 } })),
    fetchActivities: vi.fn(async () => ({ ok: true as const, value: [] })),
    fetchCourseAnnouncements: vi.fn(async () => ({ ok: true as const, value: [] })),
    fetchSiteAnnouncements: vi.fn(async () => ({ ok: true as const, value: [] })),
    fetchHomeworkActivity: vi.fn(async () => ({ ok: true as const, value: activity })),
    fetchStudentSubmissionList: vi.fn(async () => ({ ok: true as const, value: { list: [submission] } })),
  };
  return { source, adapter: createTronClassSubmissionSource(source) };
}

describe('read-only student submission history', () => {
  it('projects the official fields without exposing keys, names or unpublished marking', () => {
    const result = normalize([submission]);
    expect(result).toEqual({ source: 'tronclass', ...scope, fetchedAt: new Date(now).toISOString(),
      state: 'available', latestId: '501', entries: [{
        id: '501', state: 'submitted', isLatest: true, createdAt: '2026-11-15T10:00:00.000Z',
        content: '自己的報告', contentTruncated: false, attachments: [{ name: '報告.pdf', size: 2048 }], hasOtherResources: false,
      }] });
    expect(isTronClassSubmissionHistory(result, scope)).toBe(true);
    expect(JSON.stringify(result)).not.toMatch(/private-upload-key|不應外傳|未公開的評閱|instructor_score|submission_correct/);
    expect(result.entries[0]).not.toHaveProperty('submittedAt');
  });

  it('uses the explicit latest version and retains a returned latest alongside an older submitted version', () => {
    const result = normalize([
      { ...submission, id: 999, is_latest_version: false },
      { ...submission, id: 500, is_redo: true },
    ]);
    expect(result.latestId).toBe('500');
    expect(result.entries.map(row => row.state)).toEqual(['submitted', 'returned']);
  });

  it('exposes only an upload ID for an explicitly downloadable ordinary own attachment', () => {
    const result = normalize([{ ...submission, uploads: [{ ...submission.uploads[0],
      allow_download: true, reference_id: 0, audit_status: 'agree', status: 'ready',
      download_url: 'https://untrusted.example/private',
    }] }]);
    expect(result.entries[0].attachments).toEqual([{ name: '報告.pdf', size: 2048, download: { uploadId: 601 } }]);
    expect(isTronClassSubmissionHistory(result, scope)).toBe(true);
    expect(JSON.stringify(result)).not.toMatch(/private-upload-key|download_url|untrusted/);
    expect(result).not.toHaveProperty('receipt');
  });

  it.each([
    { allow_download: undefined }, { allow_download: false }, { allow_download: 1 },
    { reference_id: 701 }, { reference_id: '0' }, { source: 'LARK' }, { source: 'auto-generated-pdf' },
    { source: false }, { audit_status: 'pending' }, { audit_status: 'rejected' }, { audit_status: false },
    { deleted: true }, { is_deleted: 1 }, { from_project: true }, { isFromKnowledgeGraph: true },
    { type: 'link' }, { status: 'uploading' }, { status: 'failed' }, { status: 'cliping' },
    { status: 'clip_failed' }, { status: ['ready'] },
  ])('does not grant a normal attachment download for a different or unknown contract: %j', change => {
    const result = normalize([{ ...submission, uploads: [{ ...submission.uploads[0], allow_download: true, ...change }] }]);
    expect(result.entries[0].attachments).toEqual([{ name: '報告.pdf', size: 2048 }]);
    expect(isTronClassSubmissionHistory(result, scope)).toBe(true);
  });

  it('does not offer attachment downloads for an uncertain submission state', () => {
    const result = normalize([{ ...submission, is_draft: undefined,
      uploads: [{ ...submission.uploads[0], allow_download: true }] }]);
    expect(result.entries[0]).toMatchObject({ state: 'unknown', attachments: [{ name: '報告.pdf', size: 2048 }] });
    expect(result.entries[0].attachments[0]).not.toHaveProperty('download');
  });

  it.each([
    { marked_submitted: true }, { marked_submitted: undefined },
    { is_redo: undefined }, { submit_by_instructor: undefined },
    { submit_by_instructor: true },
  ])('does not label a contradictory draft or grant an attachment download: %j', change => {
    const result = normalize([{ ...submission, is_draft: true,
      uploads: [{ ...submission.uploads[0], allow_download: true }], ...change }]);
    expect(result.entries[0].state).toBe('unknown');
    for (const attachment of result.entries[0].attachments) {
      expect(attachment).not.toHaveProperty('download');
    }
    expect(isTronClassSubmissionHistory(result, scope)).toBe(true);
  });

  it('does not guess a latest version from order, dates or identifiers', () => {
    const result = normalize([{ ...submission, is_latest_version: undefined },
      { ...submission, id: 502, created_at: '2026-11-16T11:00:00Z', is_latest_version: false }]);
    expect(result.latestId).toBeNull();
    expect(result.entries.every(row => !row.isLatest)).toBe(true);
    expect(isTronClassSubmissionHistory(result, scope)).toBe(true);
  });

  it.each([
    [{ is_draft: true }, 'draft'], [{ is_redo: true }, 'returned'],
    [{ is_draft: undefined }, 'unknown'], [{ is_redo: undefined }, 'unknown'],
    [{ submit_by_instructor: undefined }, 'unknown'], [{ is_draft: 0 }, 'unknown'],
    [{ is_latest_version: 'true' }, 'unknown'], [{ is_draft: true, is_redo: true }, 'unknown'],
  ] as const)('keeps draft, returned and uncertain states separate: %j', (change, expected) => {
    expect(normalize([{ ...submission, ...change }]).entries[0].state).toBe(expected);
  });

  it('redacts teacher-created marking rows and distinguishes them from a student submission', () => {
    const result = normalize([{ ...submission, created_by: { id: 404 }, submit_by_instructor: true,
      marked_submitted: true, comment: 'teacher private content', uploads: [{ confidential: true }],
      other_resources: [{ secret: true }] }]);
    expect(result.entries[0]).toMatchObject({ state: 'teacher-marked', content: '', attachments: [], hasOtherResources: false });
    expect(isTronClassSubmissionHistory(result, scope)).toBe(true);
    expect(JSON.stringify(result)).not.toContain('teacher private');
  });

  it('keeps unconfirmed instructor marks unknown and redacted', () => {
    expect(normalize([{ ...submission, created_by: { id: 404 }, submit_by_instructor: true,
      marked_submitted: false }]).entries[0]).toMatchObject({ state: 'unknown', content: '', attachments: [] });
  });

  it('retains empty source history without making a submission claim', () => {
    expect(normalize([])).toMatchObject({ state: 'available', entries: [], latestId: null });
  });

  it('accepts the optional nested student only when it names the bound student', () => {
    const expected = normalize([submission]);
    expect(normalize([{ ...submission, student: { id: binding.userId, name: '私人學生姓名' } }])).toEqual(expected);
    expect(JSON.stringify(expected)).not.toContain('私人學生姓名');
  });

  it.each([
    { label: 'another student', student: { id: 999 } },
    { label: 'string ID', student: { id: '303' } },
    { label: 'missing ID', student: {} },
    { label: 'null', student: null },
    { label: 'array', student: [] },
    { label: 'undefined', student: undefined },
  ])('rejects an explicit $label before projecting history', ({ student }) => {
      for (const change of [
        {}, { is_draft: true },
        { created_by: { id: 404 }, submit_by_instructor: true, marked_submitted: true },
      ]) {
        expect(() => normalize([{ ...submission, ...change, student }])).toThrowError('TRONCLASS_HISTORY_UNAVAILABLE');
      }
    });

  it('removes active HTML and marks limited content and resources not represented by attachments', () => {
    const result = normalize([{ ...submission,
      comment: '<script>credential()</script><p>內容</p>' + '字'.repeat(21000),
      other_resources: [{ source: 'LARK', token: 'never-expose' }], slide_references: [{ id: 3 }],
    }]);
    expect(result.entries[0].content).not.toMatch(/credential|<script/);
    expect(result.entries[0]).toMatchObject({ contentTruncated: true, hasOtherResources: true });
    expect(result.entries[0].content.length).toBeLessThanOrEqual(20000);
    expect(JSON.stringify(result)).not.toContain('never-expose');
  });

  it('does not apply nuni upload limits to metadata for an existing school submission', () => {
    const uploads = Array.from({ length: 8 }, (_, index) => ({ id: 700 + index, name: `附件${index}.pdf`, size: 50 * 1024 * 1024 }));
    expect(normalize([{ ...submission, uploads }]).entries[0].attachments).toHaveLength(8);
  });

  it.each([
    { created_by: { id: 999 } }, { id: '501' }, { activity_id: 999 }, { course_id: 999 },
    { student_id: 999 }, { user_id: 999 }, { group_id: 99 }, { published: false },
    { uploads: null }, { comment: { secret: true } },
    { uploads: [{ id: 1, name: '報告.pdf', size: -1 }] },
    { uploads: [{ id: 1, name: '報告.pdf', size: 1 }, { id: 1, name: '另一份.pdf', size: 1 }] },
  ])('rejects identity/scope/content ambiguity without leaking a partial record: %j', change => {
    expect(() => normalize([{ ...submission, ...change }])).toThrowError('TRONCLASS_HISTORY_UNAVAILABLE');
  });

  it('rejects duplicate records and conflicting latest versions', () => {
    expect(() => normalize([submission, submission])).toThrow();
    expect(() => normalize([submission, { ...submission, id: 502 }])).toThrow();
  });

  it.each([{ total: 2 }, { has_next: true }, { next_page: 2 }, { paging: { pages: 2 } },
    { pagination: { has_next: true } }, { pages: 2 }, { page: 2 }, { next_cursor: 'next-page' }])('does not hide incomplete source metadata: %j', metadata => {
    expect(() => normalize([submission], metadata)).toThrow();
  });

  it.each([
    { error: 'synthetic-error' }, { errors: [] }, { success: false },
    { status: 401 }, { unknown: null },
  ])('rejects mixed or unknown history envelopes rather than reporting an empty or complete history: %j', extras => {
    for (const rows of [[], [submission]]) {
      expect(() => normalize(rows, extras)).toThrowError('TRONCLASS_HISTORY_UNAVAILABLE');
    }
  });

  it('accepts only consistent known completeness fields', () => {
    expect(normalize([], { total: 0, has_next: false, next_page: null }))
      .toEqual(normalize([]));
    expect(normalize([submission], { total: 1, has_next: false, next_page: null }))
      .toEqual(normalize([submission]));
  });

  it('rejects an inherited history list and hidden or symbolic envelope fields', () => {
    for (const value of [
      Object.create({ list: [] }),
      Object.defineProperty({ list: [] }, 'hidden', { value: true }),
      { list: [], [Symbol('synthetic')]: true },
    ]) {
      expect(() => normalizeTronClassSubmissionHistory(value, binding, scope, now))
        .toThrowError('TRONCLASS_HISTORY_UNAVAILABLE');
    }
  });

  it('bounds result size and does not silently truncate a longer history', () => {
    expect(() => normalize(Array.from({ length: 101 }, (_, i) => ({ ...submission, id: i + 1, is_latest_version: false })))).toThrow();
  });

  it('checks the owned course and activity before requesting the fixed current-student history', async () => {
    const { source, adapter } = fixture();
    expect(await adapter.readSubmissionHistory!(binding, scope)).toMatchObject({ latestId: '501', state: 'available' });
    expect(source.fetchHomeworkActivity).toHaveBeenCalledWith(binding.cookies, 202, undefined);
    expect(source.fetchStudentSubmissionList).toHaveBeenCalledWith(binding.cookies, 202, 303, undefined);
    expect(adapter.contractVerified).toBe(false);
    await expect(adapter.listSubmissions(binding, scope)).rejects.toMatchObject({ code: 'TRONCLASS_SUBMISSION_UNAVAILABLE' });
  });

  it('does not read a student-specific history for an unowned course', async () => {
    const { source, adapter } = fixture();
    await expect(adapter.readSubmissionHistory!(binding, { ...scope, courseId: 999 })).rejects.toMatchObject({ code: 'TRONCLASS_COURSE_ACCESS_DENIED' });
    expect(source.fetchHomeworkActivity).not.toHaveBeenCalled();
    expect(source.fetchStudentSubmissionList).not.toHaveBeenCalled();
  });

  it.each([{ id: 999 }, { course_id: 999 }, { type: 'exam' }, { submit_by_group: undefined }])(
    'requires a visible owned individual homework activity before listing: %j', async change => {
      const { source } = fixture();
      vi.mocked(source.fetchHomeworkActivity!).mockResolvedValueOnce({ ok: true, value: { ...activity, ...change } });
      await expect(readTronClassSubmissionHistory(source, binding, scope, now)).rejects.toMatchObject({ code: 'TRONCLASS_HISTORY_UNAVAILABLE' });
      expect(source.fetchStudentSubmissionList).not.toHaveBeenCalled();
    },
  );

  it.each([{ published: false }, { hidden: true }, { is_hidden: 1 }])(
    'preserves an explicit visibility denial for the enclosing preparation: %j', async flags => {
      const { source } = fixture();
      vi.mocked(source.fetchHomeworkActivity!).mockResolvedValueOnce({ ok: true, value: { ...activity, ...flags } });
      await expect(readTronClassSubmissionHistory(source, binding, scope, now)).rejects.toMatchObject({
        status: 404, code: 'TRONCLASS_HOMEWORK_NOT_FOUND',
      });
      expect(source.fetchStudentSubmissionList).not.toHaveBeenCalled();
    },
  );

  it.each([404, 410])('preserves a removed activity status %s, including a thrown transport response', async status => {
    const { source } = fixture();
    vi.mocked(source.fetchHomeworkActivity!).mockResolvedValueOnce({ ok: false, status });
    await expect(readTronClassSubmissionHistory(source, binding, scope, now)).rejects.toMatchObject({
      status: 404, code: 'TRONCLASS_HOMEWORK_NOT_FOUND',
    });
    vi.mocked(source.fetchHomeworkActivity!).mockRejectedValueOnce(Object.assign(new Error('private upstream text'), { status }));
    await expect(readTronClassSubmissionHistory(source, binding, scope, now)).rejects.toMatchObject({
      status: 404, code: 'TRONCLASS_HOMEWORK_NOT_FOUND',
    });
    expect(source.fetchStudentSubmissionList).not.toHaveBeenCalled();
  });

  it('does not mistake a missing history endpoint for revocation of the visible activity', async () => {
    const { source } = fixture();
    vi.mocked(source.fetchStudentSubmissionList!).mockResolvedValueOnce({ ok: false, status: 404 });
    await expect(readTronClassSubmissionHistory(source, binding, scope, now)).rejects.toMatchObject({
      status: 502, code: 'TRONCLASS_HISTORY_UNAVAILABLE',
    });
  });

  it.each(['activity', 'history'] as const)('preserves a thrown HTTP 403 from the %s source', async target => {
    const { source } = fixture();
    vi.mocked(target === 'activity' ? source.fetchHomeworkActivity! : source.fetchStudentSubmissionList!)
      .mockRejectedValueOnce(Object.assign(new Error('private upstream text'), { status: 403 }));
    await expect(readTronClassSubmissionHistory(source, binding, scope, now)).rejects.toMatchObject({
      status: 403, code: 'TRONCLASS_COURSE_ACCESS_DENIED',
    });
  });

  it('does not substitute a personal history for a group assignment', async () => {
    const { source } = fixture();
    vi.mocked(source.fetchHomeworkActivity!).mockResolvedValueOnce({ ok: true, value: { ...activity, submit_by_group: true } });
    await expect(readTronClassSubmissionHistory(source, binding, scope, now)).resolves.toMatchObject({ state: 'group-unsupported', entries: [], latestId: null });
    expect(source.fetchStudentSubmissionList).not.toHaveBeenCalled();
  });

  it.each(['activity', 'history'] as const)('surfaces source expiry during %s reads', async target => {
    const { source } = fixture();
    vi.mocked(target === 'activity' ? source.fetchHomeworkActivity! : source.fetchStudentSubmissionList!)
      .mockResolvedValueOnce({ ok: false, status: 401 });
    await expect(readTronClassSubmissionHistory(source, binding, scope, now)).rejects.toMatchObject({ status: 401, code: 'TRONCLASS_RECONNECT_REQUIRED' });
  });

  it('does not turn a malformed envelope or server failure into no submissions', async () => {
    const { source } = fixture();
    vi.mocked(source.fetchStudentSubmissionList!).mockResolvedValueOnce({ ok: true, value: { submissions: [] } });
    await expect(readTronClassSubmissionHistory(source, binding, scope, now)).rejects.toMatchObject({ code: 'TRONCLASS_HISTORY_UNAVAILABLE' });
    vi.mocked(source.fetchStudentSubmissionList!).mockRejectedValueOnce(new NuniError(503, 'upstream-private-body'));
    await expect(readTronClassSubmissionHistory(source, binding, scope, now)).rejects.toMatchObject({ code: 'TRONCLASS_HISTORY_UNAVAILABLE' });
  });

  it.each([
    { status: 409, code: 'TRONCLASS_BINDING_CHANGED' },
    { status: 409, code: 'SESSION_CHANGED' },
    { status: 403, code: 'TRONCLASS_COURSE_ACCESS_DENIED' },
  ])('does not downgrade observed scope revocation to a partial history: %j', async ({ status, code }) => {
    const { source } = fixture();
    vi.mocked(source.fetchStudentSubmissionList!).mockRejectedValueOnce(new NuniError(status, code));
    await expect(readTronClassSubmissionHistory(source, binding, scope, now)).rejects.toMatchObject({ status, code });
  });
});
