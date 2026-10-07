/** @jest-environment node */
import { isFirebaseMockMode } from '../firebase';
import { listCourseMemberships } from '../services/courseWorkspace';
import { listInboxTasks } from '../data/courseSpaceSource';
import { loadTeacherHome } from '../data/teacherHome';

jest.mock('../firebase', () => ({ getDb: () => ({}), isFirebaseMockMode: jest.fn(() => false) }));
jest.mock('../services/courseWorkspace', () => ({
  listCourseMemberships: jest.fn(),
  canManageCourse: (role: string) => ['owner', 'instructor', 'moderator'].includes(role),
}));
jest.mock('../data/courseSpaceSource', () => ({ listInboxTasks: jest.fn() }));

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(isFirebaseMockMode).mockReturnValue(false);
});

test('shows only courses the signed-in teacher manages and their own course tasks', async () => {
  jest.mocked(listCourseMemberships).mockResolvedValue([
    { id: 'teaching', groupId: 'teaching', name: '授課課程', role: 'instructor' },
    { id: 'learning', groupId: 'learning', name: '進修課程', role: 'member' },
  ]);
  jest.mocked(listInboxTasks).mockResolvedValue([
    { id: 'review', groupId: 'teaching', kind: 'assignment' },
    { id: 'personal', groupId: 'learning', kind: 'assignment' },
    { id: 'assistant', groupId: 'teaching', kind: 'assistant_queue' },
  ] as never);
  const result = await loadTeacherHome('teacher', 'school');
  expect(result.courses.map((course) => course.groupId)).toEqual(['teaching']);
  expect(result.tasks.map((task) => task.id)).toEqual(['review']);
  expect(listCourseMemberships).toHaveBeenCalledWith({}, 'teacher', 'school');
  expect(listInboxTasks).toHaveBeenCalledWith('teacher', 'school');
});

test('an empty teaching membership never inserts sample courses or reads learner work', async () => {
  jest
    .mocked(listCourseMemberships)
    .mockResolvedValue([{ id: 'learning', groupId: 'learning', name: '進修課程', role: 'member' }]);
  await expect(loadTeacherHome('teacher')).resolves.toEqual({ courses: [], tasks: [] });
  expect(listInboxTasks).not.toHaveBeenCalled();
});

test('permission and task failures propagate instead of becoming no pending work', async () => {
  jest.mocked(listCourseMemberships).mockRejectedValueOnce(new Error('permission-denied'));
  await expect(loadTeacherHome('teacher')).rejects.toThrow('permission-denied');
  jest
    .mocked(listCourseMemberships)
    .mockResolvedValue([
      { id: 'teaching', groupId: 'teaching', name: '授課課程', role: 'instructor' },
    ]);
  jest.mocked(listInboxTasks).mockRejectedValueOnce(new Error('unavailable'));
  await expect(loadTeacherHome('teacher')).rejects.toThrow('unavailable');
});

test('mock and signed-out sessions cannot load the formal teaching workspace', async () => {
  await expect(loadTeacherHome('')).rejects.toThrow('請登入');
  jest.mocked(isFirebaseMockMode).mockReturnValue(true);
  await expect(loadTeacherHome('teacher')).rejects.toThrow('請登入');
  expect(listCourseMemberships).not.toHaveBeenCalled();
});
