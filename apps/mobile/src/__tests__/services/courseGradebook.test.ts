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
  jest
    .mocked(getDoc)
    .mockResolvedValue({ exists: () => true, data: () => ({ name: '資料庫' }) } as never);
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
    await expect(listCourseGradebook({} as never, 'course-1')).rejects.toThrow('讀取失敗');
    failing = false;
    const result = await listCourseGradebook({} as never, 'course-1');
    expect(result.rows[0]).toMatchObject({
      gradedAssignments: 1,
      totalAssignments: 1,
      finalScore: 80,
    });
    expect(result.rows[0].assignmentBreakdown[0].grade).toBe(80);
  },
);
