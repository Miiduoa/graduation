import { beforeEach, expect, it, vi } from 'vitest';
import { getDoc, getDocs } from 'firebase/firestore';
import { isFirebaseConfigured } from './firebase';
import { GRADE_COPY } from './lmsStudentGrades';
import { loadSchoolStudentGrades } from './schoolStudentGrades';

vi.mock('./firebase', () => ({ getDb: () => ({}), isFirebaseConfigured: vi.fn(() => true) }));
vi.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...parts: string[]) => parts.join('/'),
  doc: (_db: unknown, ...parts: string[]) => parts.join('/'),
  getDoc: vi.fn(),
  getDocs: vi.fn(),
}));

const entry = (id: string, data: Record<string, unknown>) => ({ id, data: () => data });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isFirebaseConfigured).mockReturnValue(true);
});

it('keeps an unpublished score out of the gradebook and isolates a failing course', async () => {
  vi.mocked(getDocs).mockImplementation(async (path) => {
    const key = String(path);
    if (key === 'users/alice/groups') {
      return {
        docs: [
          entry('cs101', { type: 'course', status: 'active', name: '資料結構', role: 'student' }),
          entry('phys', { type: 'course', status: 'active', name: '普通物理', role: 'student' }),
          entry('teach', { type: 'course', status: 'active', name: '我教的課', role: 'instructor' }),
        ],
      } as never;
    }
    if (key === 'groups/cs101/assignments') {
      return {
        docs: [
          entry('hw-1', { title: '報告', type: 'assignment', points: 100 }),
          entry('draft', { title: '草稿', published: false }),
        ],
      } as never;
    }
    if (key === 'groups/phys/assignments') {
      throw Object.assign(new Error('missing'), { code: 'permission-denied' });
    }
    throw new Error(`Unexpected getDocs ${key}`);
  });
  vi.mocked(getDoc).mockImplementation(async (path) => {
    if (String(path).includes('/hw-1/')) {
      return {
        exists: () => true,
        data: () => ({
          submittedAt: '2026-10-08T00:00:00Z',
          content: '我的報告',
          gradePublished: false,
          gradeScore: 97,
          gradeFeedback: '還不能看',
        }),
      } as never;
    }
    return { exists: () => false, data: () => ({}) } as never;
  });
  const result = await loadSchoolStudentGrades('alice');
  expect(result.teachingCount).toBe(1);
  expect(result.courses).toHaveLength(2);
  const structure = result.courses.find((course) => course.courseId === 'cs101')!;
  expect(structure.status).toBe('ready');
  expect(structure.items).toHaveLength(1);
  expect(structure.items[0]).toMatchObject({
    status: 'waiting',
    score: null,
    feedback: null,
    href: '/course/cs101#assignment-hw-1',
  });
  expect(JSON.stringify(structure.items[0])).not.toContain('97');
  expect(JSON.stringify(structure.items[0])).not.toContain('還不能看');
  const physics = result.courses.find((course) => course.courseId === 'phys')!;
  expect(physics.status).toBe('denied');
  expect(physics.items).toEqual([]);
});

it('shows a published zero and does not request courses when firebase is not configured', async () => {
  vi.mocked(isFirebaseConfigured).mockReturnValue(false);
  expect(await loadSchoolStudentGrades('alice')).toEqual({
    teachingCount: 0,
    courses: [],
    listError: GRADE_COPY.unsigned,
  });
  expect(getDocs).not.toHaveBeenCalled();
});
