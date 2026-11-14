// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import { createAdapter } from './adapter';

const workspaceId = 'cw_11111111-1111-4111-8111-111111111111';
const workspaces = (state = 'active', memberRole = 'student') => ({
  workspaces: [{ id: workspaceId, title: '課程', state, memberRole }],
});
const receipt = () => ({
  workspaceId,
  memberRole: 'student',
  membershipActive: true,
  status: 'reviewed',
  course: {
    workspaceId,
    schoolId: 'pu',
    id: 'ccd_11111111-1111-4111-8111-111111111111',
    version: 1,
    verification: 'administrator-reviewed',
    academicYear: '115',
    semester: '1',
    courseCode: 'CS301',
    teacher: '老師',
    className: '三甲',
    title: '本校已核對課程',
  },
});
const source = () =>
  createAdapter(
    { sessionHandle: 'fixture-session', expiresAt: Date.now() + 1000 },
    'pu',
    new AbortController().signal,
  ).adapter;
afterEach(() => {
  vi.unstubAllGlobals();
});

it('checks a specifically selected workspace against the authenticated school-scoped access endpoint', async () => {
  const fetcher = vi.fn(async (url: string, init: RequestInit) => {
    expect(init.headers).toMatchObject({ Authorization: 'Platform fixture-session' });
    expect(init.cache).toBe('no-store');
    expect(init.redirect).toBe('error');
    if (url.endsWith('/class-workspaces')) return Response.json(workspaces());
    expect(new URL(url).pathname).toBe('/v1/auth/platform/course-access/workspace-course');
    expect(JSON.parse(String(init.body))).toEqual({ workspaceId, schoolId: 'pu' });
    return Response.json(receipt());
  });
  vi.stubGlobal('fetch', fetcher);
  expect(await source().course!(workspaceId)).toEqual({ id: workspaceId, title: '本校已核對課程' });
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it('does not promote unreviewed or teacher access into student coursework authority', async () => {
  const f = vi.fn(async (url: string) =>
    Response.json(
      url.endsWith('/class-workspaces')
        ? workspaces()
        : { ...receipt(), status: 'unreviewed', course: null },
    ),
  );
  vi.stubGlobal('fetch', f);
  expect(await source().course!(workspaceId)).toBeNull();
  f.mockImplementation(async (url: string) =>
    Response.json(
      url.endsWith('/class-workspaces')
        ? workspaces()
        : { ...receipt(), memberRole: 'owner-teacher' },
    ),
  );
  expect(await source().course!(workspaceId)).toBeNull();
});

it.each([
  ['archived', 'student'],
  ['active', 'owner-teacher'],
])('does not prepare coursework from a %s/%s workspace', async (state, role) => {
  const fetcher = vi.fn(async (url: string) => {
    expect(url.endsWith('/class-workspaces')).toBe(true);
    return Response.json(workspaces(state, role));
  });
  vi.stubGlobal('fetch', fetcher);
  expect(await source().course!(workspaceId)).toBeNull();
  expect(fetcher).toHaveBeenCalledOnce();
});

it.each(['school', 'workspace', 'membership'])(
  'rejects an access receipt with a mismatched %s',
  async (field) => {
    const value = receipt();
    if (field === 'school') value.course.schoolId = 'other-school';
    if (field === 'workspace') value.course.workspaceId = 'cw_22222222-2222-4222-8222-222222222222';
    if (field === 'membership') value.membershipActive = false;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        Response.json(url.endsWith('/class-workspaces') ? workspaces() : value),
      ),
    );
    await expect(source().course!(workspaceId)).rejects.toThrow();
  },
);
