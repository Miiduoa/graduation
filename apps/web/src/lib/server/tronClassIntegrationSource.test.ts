// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NuniError } from '@campus/shared/src/nuni';
import { createTronClassIntegrationReader } from './tronClassIntegrationSource';
import type { LmsReadonlySource } from './tronClassLmsSource';

vi.mock('./tronClassLmsSource', () => ({ tronClassLmsReadonlySource: {} }));

const course = { id: 101, name: '資料庫管理', course_code: 'CS01', teachers: [{ name: '林老師' }], semester: { name: '115-1' }, status: 'ongoing' };
const assignment = { id: 201, title: '期中報告', course_id: 101, submitted: false, deadline: '2026-11-20T15:59:00Z', data: { description: '<p>請上傳報告</p>' } };
const binding = { schoolId: 'pu' as const, revision: 'revision_1234567890', account: '410000001', userId: 12, userName: '測試同學', cookies: { session: 'private-cookie' }, expiresAt: '2026-11-14T00:00:00Z' };

function setup() {
  const bindings = { requireBinding: vi.fn().mockResolvedValue(binding), assertCurrent: vi.fn().mockResolvedValue(undefined) };
  const source: LmsReadonlySource = {
    fetchCourses: vi.fn().mockImplementation(async (_cookie, opts) => opts.status === 'ongoing' ? [course] : []),
    fetchHomeworkPage: vi.fn().mockResolvedValue({ ok: true, value: { homework_activities: [assignment], total: 1 } }),
    fetchActivities: vi.fn().mockResolvedValue({ ok: true, value: [] }),
    fetchCourseAnnouncements: vi.fn().mockResolvedValue({ ok: true, value: [] }),
    fetchSiteAnnouncements: vi.fn().mockResolvedValue({ ok: true, value: [] }),
  };
  const reader = createTronClassIntegrationReader({ bindings, source });
  return { reader, bindings, source };
}

beforeEach(() => vi.restoreAllMocks());

describe('independent TronClass source', () => {
  it('uses the verified binding without a school portal and never exposes its cookies', async () => {
    const { reader, bindings, source } = setup();
    const result = await reader('platform:pa_fixture');
    expect(bindings.requireBinding).toHaveBeenCalledWith('platform:pa_fixture');
    expect(source.fetchCourses).toHaveBeenCalledWith(binding.cookies, { userId: 12, status: 'ongoing' });
    expect(result).toMatchObject({ revision: binding.revision, partial: false, homework: [{ id: 201, submitted: false, description: '請上傳報告' }] });
    expect(JSON.stringify(result)).not.toContain('private-cookie');
    expect(source.fetchActivities).not.toHaveBeenCalled();
  });

  it('does not call a missing submission flag an unsubmitted assignment', async () => {
    const { reader, source } = setup();
    vi.mocked(source.fetchHomeworkPage).mockResolvedValue({ ok: true, value: { homework_activities: [{ ...assignment, submitted: undefined, homework_submissions: [1] }], total: 1 } });
    expect((await reader('platform:pa_fixture')).homework[0].submitted).toBeNull();
  });

  it('interprets a school deadline without an offset in Taipei and returns an unambiguous instant', async () => {
    const { reader, source } = setup();
    vi.mocked(source.fetchHomeworkPage).mockResolvedValue({ ok: true, value: {
      homework_activities: [{ ...assignment, deadline: '2026-11-20T23:59:00' }], total: 1,
    } });
    expect((await reader('platform:pa_fixture')).homework[0].deadline).toBe('2026-11-20T15:59:00.000Z');
  });

  it('loads a courseware-only material and deduplicates materials returned by both feeds', async () => {
    const { reader, source } = setup();
    const first = { id: 301, course_id: 101, title: '講義', type: 'material', uploads: [
      { name: 'notes.pdf', key: 'visible', allow_download: true },
      { name: 'private.pdf', key: 'hidden-key', allow_download: false },
    ] };
    vi.mocked(source.fetchActivities).mockImplementation(async (_cookie, _course, query) => ({ ok: true, value: query ? [first, { ...first, id: 302, title: '課件' }] : [first] }));
    const result = await reader('platform:pa_fixture', { courseId: 101 });
    expect(result.materials.map((item) => item.id)).toEqual([301, 302]);
    expect(result.materials[0].files).toEqual([
      { name: 'notes.pdf', allowDownload: true, downloadHref: 'https://tronclass.pu.edu.tw/api/uploads/visible/blob' },
      { name: 'private.pdf', allowDownload: false, downloadHref: null },
    ]);
    expect(JSON.stringify(result)).not.toContain('hidden-key');
  });

  it('rejects another course before reading its activities', async () => {
    const { reader, source } = setup();
    await expect(reader('platform:pa_fixture', { courseId: 999 })).rejects.toMatchObject({ status: 403 });
    expect(source.fetchHomeworkPage).not.toHaveBeenCalled();
    expect(source.fetchActivities).not.toHaveBeenCalled();
  });

  it('does not return data when the owner reconnects during an upstream read', async () => {
    const { reader, source, bindings } = setup();
    vi.mocked(source.fetchHomeworkPage).mockImplementation(async () => {
      bindings.assertCurrent.mockRejectedValue(new NuniError(409, 'TRONCLASS_BINDING_CHANGED'));
      return { ok: true, value: { homework_activities: [assignment], total: 1 } };
    });
    await expect(reader('platform:pa_fixture')).rejects.toMatchObject({ status: 409 });
  });

  it.each(['homework', 'courseware', 'announcements'] as const)('rejects the whole response after %s reports an expired session', async (area) => {
    const { reader, source } = setup();
    if (area === 'homework') vi.mocked(source.fetchHomeworkPage).mockResolvedValue({ ok: false, status: 401 });
    if (area === 'courseware') vi.mocked(source.fetchActivities).mockImplementation(async (_cookies, _id, query) => query ? { ok: false, status: 401 } : { ok: true, value: [] });
    if (area === 'announcements') vi.mocked(source.fetchCourseAnnouncements).mockRejectedValue(Object.assign(new Error('HTTP 401'), { status: 401 }));
    await expect(reader('platform:pa_fixture', { courseId: 101 })).rejects.toMatchObject({ status: 401 });
  });

  it('treats an incomplete second page as a partial sync, not as no homework', async () => {
    const { reader, source } = setup();
    vi.mocked(source.fetchHomeworkPage)
      .mockResolvedValueOnce({ ok: true, value: { homework_activities: Array.from({ length: 50 }, (_, n) => ({ ...assignment, id: 201 + n })), total: 51 } })
      .mockResolvedValueOnce({ ok: false, status: 503 });
    const result = await reader('platform:pa_fixture');
    expect(result).toMatchObject({ homework: [], partial: true, errors: [{ courseId: 101, area: 'homework' }] });
  });

  it('does not turn a failed course listing into an empty successful result', async () => {
    const { reader, source } = setup();
    vi.mocked(source.fetchCourses).mockRejectedValue(new Error('unavailable upstream body with cookies'));
    await expect(reader('platform:pa_fixture')).rejects.toMatchObject({ code: 'TRONCLASS_SOURCE_UNAVAILABLE' });
  });

  it.each([404, 503])('distinguishes an absent optional courseware feed from an outage (%s)', async (status) => {
    const { reader, source } = setup();
    vi.mocked(source.fetchActivities).mockImplementation(async (_cookie, _id, query) => query ? { ok: false, status } : { ok: true, value: [] });
    const result = await reader('platform:pa_fixture', { courseId: 101 });
    expect(result.partial).toBe(status !== 404);
  });

  it('stops dispatching new school calls when the bounded request has expired', async () => {
    const { source, bindings } = setup();
    let finish!: (value: unknown) => void;
    vi.mocked(source.fetchCourses).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const read = createTronClassIntegrationReader({ source, bindings, budgetMs: 10 });
    await expect(read('platform:pa_fixture')).rejects.toMatchObject({ code: 'TRONCLASS_READ_TIMEOUT' });
    finish([course]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(source.fetchCourses).toHaveBeenCalledTimes(1);
    expect(source.fetchHomeworkPage).not.toHaveBeenCalled();
  });
});
