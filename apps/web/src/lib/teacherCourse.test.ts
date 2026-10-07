import { beforeEach, expect, it, vi } from 'vitest';
import { getDocFromServer, getDocsFromServer, onSnapshot } from 'firebase/firestore';
import {
  loadTeacherWorkspace,
  loadTeacherGradebook,
  teacherResourceUrl,
  watchTeacherAccess,
} from './teacherCourse';
const current = vi.hoisted(() => ({ uid: 'teacher', configured: true }));
vi.mock('./firebase', () => ({
  getDb: () => ({}),
  getAuth: () => ({ currentUser: { uid: current.uid } }),
  isFirebaseConfigured: () => current.configured,
}));
vi.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...parts: string[]) => parts.join('/'),
  doc: (_db: unknown, ...parts: string[]) => parts.join('/'),
  getDocFromServer: vi.fn(),
  getDocsFromServer: vi.fn(),
  onSnapshot: vi.fn(),
}));
const scope = { uid: 'teacher', schoolId: 'pu', courseId: 'course-a' };
let documents: Record<string, Record<string, unknown> | null>;
const snapshot = (data: Record<string, unknown> | null) => ({
  exists: () => data !== null,
  data: () => data,
});
const entry = (id: string, data: Record<string, unknown>) => ({ id, data: () => data });
beforeEach(() => {
  vi.clearAllMocks();
  current.uid = 'teacher';
  current.configured = true;
  documents = {
    'schools/pu/members/teacher': { status: 'active' },
    'groups/course-a/members/teacher': { role: 'instructor', status: 'active' },
    'groups/course-a': { type: 'course', schoolId: 'pu', name: '資料結構' },
  };
  vi.mocked(getDocFromServer).mockImplementation(
    async (path) => snapshot(documents[String(path)] ?? null) as never,
  );
  vi.mocked(getDocsFromServer).mockResolvedValue({ docs: [] } as never);
  vi.mocked(onSnapshot).mockImplementation(() => vi.fn());
});
it.each(['admin', 'owner', 'instructor', 'moderator'])(
  'uses the server group %s role permitted by Firestore',
  async (role) => {
    documents['groups/course-a/members/teacher'] = { role, status: 'active' };
    await expect(loadTeacherGradebook(scope)).resolves.toMatchObject({
      course: { name: '資料結構', role },
      rows: [],
    });
    expect(getDocsFromServer).toHaveBeenCalledWith('groups/course-a/gradebook');
  },
);
it.each(['member', 'student', 'teacher', 'ta', 'department_head'])(
  'rejects non-manager group role %s before reading protected collections',
  async (role) => {
    documents['groups/course-a/members/teacher'] = { role, status: 'active' };
    await expect(loadTeacherGradebook(scope)).rejects.toThrow('教師權限');
    expect(getDocsFromServer).not.toHaveBeenCalled();
  },
);
it.each(['school', 'group', 'course'])(
  'rejects an invalid %s scope before reading content',
  async (key) => {
    if (key === 'school') documents['schools/pu/members/teacher'] = { status: 'removed' };
    if (key === 'group')
      documents['groups/course-a/members/teacher'] = { role: 'owner', status: 'removed' };
    if (key === 'course') documents['groups/course-a'] = { type: 'course', schoolId: 'other' };
    await expect(loadTeacherWorkspace(scope)).rejects.toThrow();
    expect(getDocsFromServer).not.toHaveBeenCalled();
  },
);
it('does not read while signed out, configured as unavailable or using another uid', async () => {
  current.uid = 'other';
  await expect(loadTeacherGradebook(scope)).rejects.toThrow();
  current.uid = 'teacher';
  current.configured = false;
  await expect(loadTeacherGradebook(scope)).rejects.toThrow();
  expect(getDocFromServer).not.toHaveBeenCalled();
});
it('loads only modules and assignments for the authorized course, with no mixed attendance or gradebook reads', async () => {
  vi.mocked(getDocsFromServer).mockImplementation(
    async (path) =>
      ({
        docs: String(path).endsWith('/modules')
          ? [
              entry('visible', {
                title: 'Trees',
                published: true,
                resourceUrl: 'https://school.test/notes',
              }),
              entry('draft', { published: false }),
              entry('unsafe', { title: 'Unsafe URL', resourceUrl: 'javascript:alert(1)' }),
            ]
          : [entry('work', { title: 'Report', points: 0 }), entry('draft', { status: 'draft' })],
      }) as never,
  );
  const result = await loadTeacherWorkspace(scope);
  expect(result.modules).toHaveLength(2);
  expect(result.modules[1].resourceUrl).toBeNull();
  expect(result.assignments).toEqual([
    expect.objectContaining({ id: 'work', points: 0, dueAt: null }),
  ]);
  expect(vi.mocked(getDocsFromServer).mock.calls.map(([path]) => path)).toEqual([
    'groups/course-a/modules',
    'groups/course-a/assignments',
  ]);
});
it('rechecks server authorization after protected reads and discards data after revocation', async () => {
  vi.mocked(getDocsFromServer).mockImplementationOnce(async () => {
    documents['groups/course-a/members/teacher'] = { role: 'member', status: 'active' };
    return { docs: [entry('student', { finalScore: 99 })] } as never;
  });
  await expect(loadTeacherGradebook(scope)).rejects.toThrow('教師權限');
});
it('discards results if the uid or page scope changes during reads', async () => {
  vi.mocked(getDocsFromServer).mockImplementationOnce(async () => {
    current.uid = 'new-user';
    return { docs: [] } as never;
  });
  await expect(loadTeacherGradebook(scope)).rejects.toThrow('登入');
});
it('a read failure stays a failure instead of becoming an empty gradebook', async () => {
  vi.mocked(getDocsFromServer).mockRejectedValueOnce(new Error('permission-denied'));
  await expect(loadTeacherGradebook(scope)).rejects.toThrow('permission-denied');
});
it('keeps missing scores/publication unknown and preserves real zero scores', async () => {
  vi.mocked(getDocsFromServer).mockResolvedValueOnce({
    docs: [
      entry('a', { displayName: '甲同學' }),
      entry('b', { finalScore: 0, published: false }),
      entry('c', {
        finalScore: 81.5,
        published: true,
        publishedAt: '2026-10-08T01:00:00Z',
        result: 'passed',
      }),
    ],
  } as never);
  const result = await loadTeacherGradebook(scope);
  expect(result.rows[0]).toMatchObject({
    finalScore: null,
    published: null,
    result: null,
    publishedAt: null,
  });
  expect(result.rows[1]).toMatchObject({ finalScore: 0, published: false });
  expect(result.rows[2]).toMatchObject({ finalScore: 81.5, result: 'passed' });
});
it('invalidates a loaded page when server membership is revoked and unsubscribes', () => {
  const invalidate = vi.fn();
  const cleanup = watchTeacherAccess(scope, invalidate);
  const memberCallback = vi.mocked(onSnapshot).mock.calls[1][1] as (snapshot: unknown) => void;
  memberCallback(snapshot({ status: 'active', role: 'member' }));
  expect(invalidate).toHaveBeenCalledTimes(1);
  cleanup();
  for (const result of vi.mocked(onSnapshot).mock.results)
    expect(result.value).toHaveBeenCalledTimes(1);
});
it('keeps textbook links limited to web URLs', () => {
  expect(teacherResourceUrl('https://school.test/notes')).toBe('https://school.test/notes');
  expect(teacherResourceUrl('javascript:alert(1)')).toBeNull();
  expect(teacherResourceUrl('https://account@school.test/notes')).toBeNull();
});
