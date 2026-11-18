// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NuniError } from '@campus/shared/src/nuni';
import type { LmsReadonlySource } from './tronClassLmsSource';
import { TRONCLASS_DOWNLOAD_MAX_BYTES } from './tronClassMaterialDownload';
import { createTronClassSubmissionAttachmentDownloader } from './tronClassSubmissionAttachmentDownload';

vi.mock('./tronClassLmsSource', () => ({ tronClassLmsReadonlySource: {} }));

const input = { courseId: 101, homeworkId: 202, submissionId: '401', uploadId: 501, revision: 'a'.repeat(32) };
const owner = 'firebase:history-download-fixture';
const now = Date.parse('2026-11-18T06:00:00.000Z');
const bytes = Buffer.from('%PDF-synthetic-homework');
const binding = {
  schoolId: 'pu' as const, revision: input.revision, account: 'student-fixture', userId: 303,
  userName: null, cookies: { session: 'server-only-fixture' }, expiresAt: '2026-11-19T06:00:00.000Z',
};
const attachment = { id: 501, name: '第一版報告.pdf', size: bytes.byteLength, allow_download: true };
const submission = {
  id: 401, course_id: 101, activity_id: 202, student_id: 303, created_by: { id: 303 },
  is_latest_version: true, is_draft: false, is_redo: false, submit_by_instructor: false,
  comment: '<p>合成學生資料</p>', uploads: [attachment], created_at: '2026-11-18T05:00:00.000Z',
};

function fixture(timeoutMs?: number, mediaFetch?: (url: string, init?: RequestInit) => Promise<Response>) {
  const state: { activity: Record<string, unknown>; history: { list: Record<string, unknown>[]; [key: string]: unknown } } = {
    activity: { id: 202, course_id: 101, title: '合成作業', type: 'homework', submit_by_group: false,
      data: { description: '請上傳報告', mode: 'normal' } },
    history: { list: [structuredClone(submission)] },
  };
  const bindings = {
    requireBinding: vi.fn<(ownerKey: string) => Promise<typeof binding>>(async () => structuredClone(binding)),
    assertCurrent: vi.fn<(ownerKey: string, revision: string) => Promise<void>>(async () => {}),
  };
  const source: LmsReadonlySource = {
    fetchCourses: vi.fn(async (_cookies, options) => options.status === 'ongoing' ? [{ id: 101 }] : []),
    fetchHomeworkPage: vi.fn(async () => ({ ok: true as const, value: { homework_activities: [{ id: 202, course_id: 101, title: '合成作業' }], total: 1 } })),
    fetchHomeworkActivity: vi.fn(async () => ({ ok: true as const, value: structuredClone(state.activity) })),
    fetchStudentSubmissionList: vi.fn(async () => ({ ok: true as const, value: structuredClone(state.history) })),
    fetchActivities: vi.fn(), fetchCourseAnnouncements: vi.fn(), fetchSiteAnnouncements: vi.fn(),
  };
  const fetch = vi.fn<(url: string, options?: RequestInit) => Promise<Response>>(async () => new Response(bytes, {
    headers: { 'Content-Type': 'application/pdf', 'Content-Length': String(bytes.byteLength) },
  }));
  const download = createTronClassSubmissionAttachmentDownloader({ bindings, source, fetch, mediaFetch, now: () => now, timeoutMs });
  return { state, bindings, source, fetch, download };
}

afterEach(() => vi.useRealTimers());

describe('own historical submission attachment download', () => {
  it('rechecks the complete real source reader before and after downloading an exact owned version', async () => {
    const f = fixture();
    expect(await f.download(owner, input)).toEqual({ bytes, name: attachment.name, contentType: 'application/pdf' });
    expect(f.fetch).toHaveBeenCalledExactlyOnceWith('https://tronclass.pu.edu.tw/api/uploads/501/blob', expect.objectContaining({
      method: 'GET', redirect: 'manual', cache: 'no-store', signal: expect.any(AbortSignal),
      headers: { Cookie: 'session=server-only-fixture', Accept: 'application/octet-stream, */*', 'Accept-Encoding': 'identity' },
    }));
    expect(f.source.fetchStudentSubmissionList).toHaveBeenCalledTimes(2);
    expect(f.source.fetchStudentSubmissionList).toHaveBeenCalledWith(binding.cookies, 202, 303,
      expect.objectContaining({ signal: expect.any(AbortSignal) }));
    const binaryOrder = f.fetch.mock.invocationCallOrder[0];
    for (const sourceRead of [f.source.fetchCourses, f.source.fetchHomeworkPage, f.source.fetchHomeworkActivity!]) {
      const calls = vi.mocked(sourceRead).mock.invocationCallOrder;
      expect(calls[0]).toBeLessThan(binaryOrder);
      expect(calls.at(-1)).toBeGreaterThan(binaryOrder);
    }
    expect(f.bindings.requireBinding.mock.calls.every(([key]) => key === owner)).toBe(true);
    expect(f.bindings.assertCurrent).toHaveBeenLastCalledWith(owner, input.revision);
  });

  it('selects the requested older version instead of substituting the latest version', async () => {
    const f = fixture();
    f.state.history.list = [
      { ...submission, is_latest_version: false },
      { ...submission, id: 402, uploads: [{ ...attachment, id: 502, name: '第二版.pdf' }] },
    ];
    expect((await f.download(owner, input)).name).toBe('第一版報告.pdf');
    expect(f.fetch.mock.calls[0][0]).toBe('https://tronclass.pu.edu.tw/api/uploads/501/blob');
    await expect(f.download(owner, { ...input, submissionId: '402' }))
      .rejects.toMatchObject({ code: 'TRONCLASS_SUBMISSION_ATTACHMENT_DENIED' });
    expect(f.fetch).toHaveBeenCalledTimes(1);
  });

  it('downloads a historical attachment through PU media and still revalidates the exact version afterward', async () => {
    const mediaUrl = `https://media.pu.edu.tw/download/file/${'a'.repeat(40)}?timestamp=1795000000&token=${'b'.repeat(32)}&name=report.pdf`;
    const mediaFetch = vi.fn(async () => new Response(bytes, { headers: {
      'Content-Type': 'application/pdf', 'Content-Length': String(bytes.length),
    } }));
    const f = fixture(undefined, mediaFetch);
    f.fetch.mockResolvedValue(new Response(null, { status: 302, headers: { Location: mediaUrl } }));
    expect(await f.download(owner, input)).toEqual({ bytes, name: attachment.name, contentType: 'application/pdf' });
    expect(mediaFetch).toHaveBeenCalledExactlyOnceWith(mediaUrl, expect.objectContaining({
      headers: { Accept: 'application/octet-stream, */*', 'Accept-Encoding': 'identity' },
      redirect: 'manual', credentials: 'omit',
    }));
    expect(f.source.fetchStudentSubmissionList).toHaveBeenCalledTimes(2);
    expect(vi.mocked(f.source.fetchStudentSubmissionList!).mock.invocationCallOrder.at(-1))
      .toBeGreaterThan(mediaFetch.mock.invocationCallOrder[0]);
    expect(f.bindings.assertCurrent).toHaveBeenLastCalledWith(owner, input.revision);
  });

  it('discards media bytes if the school removes the historical version during download', async () => {
    const mediaUrl = `https://media.pu.edu.tw/download/file/${'a'.repeat(40)}?timestamp=1795000000&token=${'b'.repeat(32)}&name=report.pdf`;
    const mediaFetch = vi.fn(async () => {
      f.state.history.list = [];
      return new Response(bytes, { headers: { 'Content-Type': 'application/pdf' } });
    });
    const f = fixture(undefined, mediaFetch);
    f.fetch.mockResolvedValue(new Response(null, { status: 302, headers: { Location: mediaUrl } }));
    await expect(f.download(owner, input)).rejects.toMatchObject({ code: 'TRONCLASS_SUBMISSION_ATTACHMENT_DENIED' });
    expect(mediaFetch).toHaveBeenCalledOnce();
  });

  it.each([
    { ownerKey: 'firebase:other' }, { studentId: 999 }, { url: 'https://other.test/file' }, { cookies: {} },
    { courseId: '101' }, { homeworkId: 0 }, { submissionId: '0401' }, { submissionId: '../401' },
    { submissionId: '9007199254740993' }, { uploadId: '501' }, { uploadId: -1 }, { revision: 'stale' },
  ])('rejects caller-controlled identity or an invalid selector before accessing bindings: %j', async patch => {
    const f = fixture();
    await expect(f.download(owner, { ...input, ...patch } as typeof input)).rejects.toMatchObject({ code: 'TRONCLASS_INVALID_INPUT' });
    expect(f.bindings.requireBinding).not.toHaveBeenCalled();
    expect(f.fetch).not.toHaveBeenCalled();
  });

  it('reads only the current school identity and rejects another student’s source record', async () => {
    const f = fixture();
    f.bindings.requireBinding.mockResolvedValue({ ...binding, userId: 999 });
    await expect(f.download('firebase:other-owner', input)).rejects.toMatchObject({ code: 'TRONCLASS_HISTORY_UNAVAILABLE' });
    expect(f.source.fetchStudentSubmissionList).toHaveBeenCalledWith(binding.cookies, 202, 999, expect.any(Object));
    expect(f.fetch).not.toHaveBeenCalled();
  });

  it('stops before reading history when the course is not owned', async () => {
    const f = fixture();
    vi.mocked(f.source.fetchCourses).mockResolvedValue([]);
    await expect(f.download(owner, input)).rejects.toMatchObject({ status: 403, code: 'TRONCLASS_COURSE_ACCESS_DENIED' });
    expect(f.source.fetchStudentSubmissionList).not.toHaveBeenCalled();
    expect(f.fetch).not.toHaveBeenCalled();
  });

  it.each([
    { is_hidden: true }, { published: false }, { submit_by_group: true }, { course_id: 999 }, { type: 'material' },
  ])('requires a visible individual homework activity in the same course: %j', async patch => {
    const f = fixture();
    Object.assign(f.state.activity, patch);
    await expect(f.download(owner, input)).rejects.toBeInstanceOf(NuniError);
    expect(f.source.fetchStudentSubmissionList).not.toHaveBeenCalled();
    expect(f.fetch).not.toHaveBeenCalled();
  });

  it.each([
    { allow_download: undefined }, { allow_download: false }, { allow_download: 1 },
    { reference_id: 123 }, { reference_id: '0' }, { source: 'LARK' }, { source: 'auto-generated-pdf' },
    { audit_status: 'pending' }, { audit_status: 'reject' }, { deleted: true }, { is_deleted: 1 },
  ])('does not grant ordinary binary download to missing permission or special attachment contracts: %j', async patch => {
    const f = fixture();
    f.state.history.list[0].uploads = [{ ...attachment, ...patch }];
    await expect(f.download(owner, input)).rejects.toMatchObject({ code: 'TRONCLASS_SUBMISSION_ATTACHMENT_DENIED' });
    expect(f.fetch).not.toHaveBeenCalled();
  });

  it.each([
    { reference_id: 0, source: '', audit_status: 'agree', deleted: false, is_deleted: 0 },
    { reference_id: null, source: null, audit_status: null },
  ])('accepts an ordinary attachment with explicit non-reference metadata: %j', async patch => {
    const f = fixture();
    f.state.history.list[0].uploads = [{ ...attachment, ...patch }];
    expect((await f.download(owner, input)).bytes).toEqual(bytes);
  });

  it.each([
    { submit_by_instructor: true, marked_submitted: true, created_by: { id: 999 } },
    { is_redo: undefined }, { submit_by_instructor: undefined },
  ])('does not expose teacher-created or ambiguous-state attachments: %j', async patch => {
    const f = fixture();
    Object.assign(f.state.history.list[0], patch);
    await expect(f.download(owner, input)).rejects.toMatchObject({ code: 'TRONCLASS_SUBMISSION_ATTACHMENT_DENIED' });
    expect(f.fetch).not.toHaveBeenCalled();
  });

  it.each(['hidden-version', 'hidden-file', 'duplicate-version', 'duplicate-upload', 'incomplete-list'] as const)(
    'rejects %s through the real history normalizer before downloading', async scenario => {
      const f = fixture();
      if (scenario === 'hidden-version') f.state.history.list[0].is_hidden = true;
      if (scenario === 'hidden-file') f.state.history.list[0].uploads = [{ ...attachment, published: false }];
      if (scenario === 'duplicate-version') f.state.history.list.push(structuredClone(submission));
      if (scenario === 'duplicate-upload') f.state.history.list[0].uploads = [attachment, attachment];
      if (scenario === 'incomplete-list') f.state.history.total = 2;
      await expect(f.download(owner, input)).rejects.toMatchObject({ code: 'TRONCLASS_HISTORY_UNAVAILABLE' });
      expect(f.fetch).not.toHaveBeenCalled();
    },
  );

  it.each(['permission', 'version', 'hidden-activity', 'name', 'size'] as const)(
    'discards already downloaded bytes when the source changes its %s', async scenario => {
      const f = fixture();
      f.fetch.mockImplementation(async () => {
        if (scenario === 'permission') f.state.history.list[0].uploads = [{ ...attachment, allow_download: false }];
        if (scenario === 'version') f.state.history.list = [];
        if (scenario === 'hidden-activity') f.state.activity.is_hidden = true;
        if (scenario === 'name') f.state.history.list[0].uploads = [{ ...attachment, name: 'changed.pdf' }];
        if (scenario === 'size') f.state.history.list[0].uploads = [{ ...attachment, size: bytes.byteLength + 1 }];
        return new Response(bytes, { headers: { 'Content-Type': 'application/pdf' } });
      });
      await expect(f.download(owner, input)).rejects.toMatchObject({ code:
        scenario === 'hidden-activity' ? 'TRONCLASS_HOMEWORK_NOT_FOUND' :
          ['name', 'size'].includes(scenario) ? 'TRONCLASS_SUBMISSION_ATTACHMENT_CHANGED' : 'TRONCLASS_SUBMISSION_ATTACHMENT_DENIED' });
      expect(f.fetch).toHaveBeenCalledOnce();
    },
  );

  it('checks for a replaced binding again after reading history and before fetching any file', async () => {
    const f = fixture();
    vi.mocked(f.source.fetchStudentSubmissionList!).mockImplementation(async () => {
      f.bindings.requireBinding.mockResolvedValue({ ...binding, revision: 'b'.repeat(32) });
      return { ok: true, value: f.state.history };
    });
    await expect(f.download(owner, input)).rejects.toMatchObject({ code: 'TRONCLASS_BINDING_CHANGED' });
    expect(f.fetch).not.toHaveBeenCalled();
  });

  it('cancels a fetched response if the binding changes before body delivery', async () => {
    const f = fixture();
    const cancel = vi.fn();
    f.fetch.mockImplementation(async () => {
      f.bindings.assertCurrent.mockRejectedValue(new NuniError(409, 'TRONCLASS_BINDING_CHANGED'));
      return new Response(new ReadableStream({ cancel }), { headers: { 'Content-Type': 'application/pdf' } });
    });
    await expect(f.download(owner, input)).rejects.toMatchObject({ code: 'TRONCLASS_BINDING_CHANGED' });
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('rejects an oversized source file before fetching it and rejects mismatched file bytes', async () => {
    const large = fixture();
    large.state.history.list[0].uploads = [{ ...attachment, size: TRONCLASS_DOWNLOAD_MAX_BYTES + 1 }];
    await expect(large.download(owner, input)).rejects.toMatchObject({ code: 'TRONCLASS_DOWNLOAD_TOO_LARGE' });
    expect(large.fetch).not.toHaveBeenCalled();
    const mismatched = fixture();
    mismatched.fetch.mockResolvedValue(new Response('truncated', { headers: { 'Content-Type': 'application/pdf' } }));
    await expect(mismatched.download(owner, input)).rejects.toMatchObject({ code: 'TRONCLASS_DOWNLOAD_UNAVAILABLE' });
  });

  it('rejects an incomplete binary response even when the historical source size matches the received bytes', async () => {
    const f = fixture();
    f.fetch.mockResolvedValue(new Response(bytes, { headers: {
      'Content-Type': 'application/pdf', 'Content-Length': String(bytes.byteLength + 1),
    } }));
    await expect(f.download(owner, input)).rejects.toMatchObject({ code: 'TRONCLASS_DOWNLOAD_UNAVAILABLE' });
  });

  it('cancels an oversized streamed response without relying on its declared size', async () => {
    const f = fixture();
    const cancel = vi.fn();
    f.state.history.list[0].uploads = [{ ...attachment, size: null }];
    f.fetch.mockResolvedValue(new Response(new ReadableStream({
      start(controller) { controller.enqueue(new Uint8Array(TRONCLASS_DOWNLOAD_MAX_BYTES + 1)); }, cancel,
    }), { headers: { 'Content-Type': 'application/pdf' } }));
    await expect(f.download(owner, input)).rejects.toMatchObject({ code: 'TRONCLASS_DOWNLOAD_TOO_LARGE' });
    expect(cancel).toHaveBeenCalledOnce();
  });

  it.each([301, 302, 307, 308])('does not follow redirect %s or forward cookies to another location', async status => {
    const f = fixture();
    f.fetch.mockResolvedValue(new Response(null, { status, headers: { Location: 'https://other.test/private' } }));
    await expect(f.download(owner, input)).rejects.toMatchObject({ code: 'TRONCLASS_DOWNLOAD_REDIRECT_UNSUPPORTED' });
    expect(f.fetch).toHaveBeenCalledTimes(1);
  });

  it.each(['text/html', 'application/json', 'image/svg+xml'])('rejects active content %s before consuming it', async type => {
    const f = fixture();
    const cancel = vi.fn();
    f.fetch.mockResolvedValue(new Response(new ReadableStream({ cancel }), { headers: { 'Content-Type': type } }));
    await expect(f.download(owner, input)).rejects.toMatchObject({ code: 'TRONCLASS_DOWNLOAD_TYPE_UNSUPPORTED' });
    expect(cancel).toHaveBeenCalledOnce();
  });

  it.each([401, 403])('requires reconnection when the binary source returns %s', async status => {
    const f = fixture();
    f.fetch.mockResolvedValue(new Response(null, { status }));
    await expect(f.download(owner, input)).rejects.toMatchObject({ code: 'TRONCLASS_RECONNECT_REQUIRED' });
  });

  it('rejects a login page disguised as a binary file', async () => {
    const f = fixture();
    f.fetch.mockResolvedValue(new Response('<!doctype html><form>login</form>'));
    await expect(f.download(owner, input)).rejects.toMatchObject({ code: 'TRONCLASS_RECONNECT_REQUIRED' });
  });

  it('does no source work for an already cancelled request', async () => {
    const f = fixture();
    await expect(f.download(owner, input, AbortSignal.abort())).rejects.toMatchObject({ code: 'TRONCLASS_DOWNLOAD_TIMEOUT' });
    expect(f.bindings.requireBinding).not.toHaveBeenCalled();
    expect(f.fetch).not.toHaveBeenCalled();
  });

  it('aborts a stalled history read at the overall deadline without requesting file bytes', async () => {
    vi.useFakeTimers();
    const f = fixture(50);
    vi.mocked(f.source.fetchStudentSubmissionList!).mockImplementation(() => new Promise(() => {}));
    const pending = expect(f.download(owner, input)).rejects.toMatchObject({ status: 504, code: 'TRONCLASS_DOWNLOAD_TIMEOUT' });
    await vi.advanceTimersByTimeAsync(50);
    await pending;
    expect(vi.mocked(f.source.fetchStudentSubmissionList!).mock.calls[0][3]?.signal?.aborted).toBe(true);
    expect(f.fetch).not.toHaveBeenCalled();
  });

  it('cancels a stalled binary body at the overall deadline', async () => {
    vi.useFakeTimers();
    const f = fixture(50);
    const cancel = vi.fn();
    f.fetch.mockResolvedValue(new Response(new ReadableStream({ cancel }), { headers: { 'Content-Type': 'application/pdf' } }));
    const pending = expect(f.download(owner, input)).rejects.toMatchObject({ status: 504, code: 'TRONCLASS_DOWNLOAD_TIMEOUT' });
    await vi.advanceTimersByTimeAsync(50);
    await pending;
    expect(cancel).toHaveBeenCalledOnce();
    expect(f.fetch.mock.calls[0][1]?.signal?.aborted).toBe(true);
  });
});
