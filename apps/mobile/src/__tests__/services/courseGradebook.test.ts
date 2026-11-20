import { getDoc, getDocs } from 'firebase/firestore';
import { listCourseGradebook } from '../../services/courseWorkspace';

jest.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...parts: string[]) => ({ path: parts.join('/') }),
  collection: (_db: unknown, ...parts: string[]) => ({ path: parts.join('/') }),
  getDoc: jest.fn(),
  getDocs: jest.fn(),
}));
jest.mock('firebase/functions', () => ({ httpsCallable: jest.fn() }));
jest.mock('../../services/memberDirectory', () => ({ fetchSchoolDirectoryProfiles: jest.fn() }));
const snapshot = (rows: { id: string; [key: string]: unknown }[]) => ({
  docs: rows.map(({ id, ...data }) => ({ id, data: () => data })),
});
beforeEach(() => {
  jest.clearAllMocks();
  jest
    .mocked(getDoc)
    .mockResolvedValue({ exists: () => true, data: () => ({ name: '資料庫', role: 'instructor' }) } as never);
});
test.each(['assignments', 'gradebook', 'members', 'submissions'])(
  '%s failure never becomes empty or missing work and retry restores progress',
  async (failed) => {
    let failing = true;
    jest.mocked(getDocs).mockImplementation(async (ref) => {
      const path = (ref as { path: string }).path;
      if (failing && path.endsWith(`/${failed}`)) throw new Error('讀取失敗');
      if (path.endsWith('/assignments'))
        return snapshot([{ id: 'work-1', title: '作業' }]) as never;
      if (path.endsWith('/members'))
        return snapshot([{ id: 'student-a', status: 'active', role: 'student' }]) as never;
      if (path.endsWith('/gradebook'))
        return snapshot([{ id: 'student-a', finalScore: 80, published: true }]) as never;
      return snapshot([{ id: 'student-a', grade: 80 }]) as never;
    });
    await expect(listCourseGradebook({} as never, 'course-1', 'teacher')).rejects.toThrow('讀取失敗');
    failing = false;
    const result = await listCourseGradebook({} as never, 'course-1', 'teacher');
    expect(result.rows[0]).toMatchObject({
      gradedAssignments: 1,
      totalAssignments: 1,
      finalScore: 80,
    });
    expect(result.rows[0].assignmentBreakdown[0].grade).toBe(80);
    expect(result.assignments[0].averageScore).toBe(80);
  },
);

test('students read only their own documents under collection permission denial', async () => {
  jest.mocked(getDoc).mockImplementation(async (ref) => {
    const path = (ref as { path: string }).path;
    const data = path.includes('/members/') ? { status: 'active', role: 'student' }
      : path.includes('/gradebook/') ? { finalScore: 80, published: true }
      : path.includes('/submissions/') ? { grade: 80 } : {};
    return { exists: () => true, data: () => data } as never;
  });
  jest.mocked(getDocs).mockImplementation(async (ref) => {
    if (!(ref as { path: string }).path.endsWith('/assignments')) throw new Error('permission-denied');
    return snapshot([{ id: 'work-1' }]) as never;
  });
  const result = await listCourseGradebook({} as never, 'course-1', 'student-a');
  expect(result.rows).toHaveLength(1);
  expect(result.rows[0]).toMatchObject({ uid: 'student-a', finalScore: 80 });
  expect(result.assignments[0].averageScore).toBeNull();
  expect(jest.mocked(getDoc).mock.calls.every(([ref]) => {
    const path = (ref as { path: string }).path;
    return path === 'groups/course-1' || path.endsWith('/student-a');
  })).toBe(true);
});
test.each(['members', 'gradebook', 'submissions'])('student %s document permission errors propagate', async (failed) => {
  jest.mocked(getDoc).mockImplementation(async (ref) => {
    const path = (ref as { path: string }).path;
    if (path.includes(`/${failed}/`)) throw new Error('permission-denied');
    return { exists: () => true, data: () => ({ status: 'active', role: 'student' }) } as never;
  });
  jest.mocked(getDocs).mockResolvedValue(snapshot([{ id: 'work-1' }]) as never);
  await expect(listCourseGradebook({} as never, 'course-1', 'student-a')).rejects.toThrow('permission-denied');
});
