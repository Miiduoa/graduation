/** @jest-environment node */
import { getDoc, getDocs } from 'firebase/firestore';
import { listInboxTasks } from '../data/courseSpaceSource';
import { listCourseMemberships } from '../services/courseWorkspace';

jest.mock('../firebase', () => ({ getDb: () => ({}), isFirebaseMockMode: () => false }));
jest.mock('../services/courseWorkspace', () => ({
  listCourseMemberships: jest.fn(),
  toDate: (value: unknown) => (value ? new Date(String(value)) : null),
}));
jest.mock('firebase/functions', () => ({ getFunctions: jest.fn(), httpsCallable: jest.fn() }));
jest.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...parts: string[]) => parts.join('/'),
  doc: (_db: unknown, ...parts: string[]) => parts.join('/'),
  query: (ref: unknown) => ref,
  where: jest.fn(),
  limit: jest.fn(),
  getDocs: jest.fn(),
  getDoc: jest.fn(),
}));
const row = (id: string, value: Record<string, unknown>) => ({ id, data: () => value });
beforeEach(() => {
  jest.clearAllMocks();
  jest
    .mocked(listCourseMemberships)
    .mockResolvedValue([{ groupId: 'course', name: 'Course', role: 'member' }] as never);
});
test('submitted and unpublished assignments do not remain in the student inbox', async () => {
  jest
    .mocked(getDocs)
    .mockImplementation(
      async (path) =>
        ({
          empty: true,
          docs: String(path).endsWith('/assignments')
            ? [
                row('submitted', {
                  title: 'Done',
                  dueAt: new Date(Date.now() + 60000).toISOString(),
                }),
                row('draft', { published: false }),
                row('pending', {
                  title: 'Pending',
                  dueAt: new Date(Date.now() + 60000).toISOString(),
                }),
              ]
            : [],
        }) as never,
    );
  jest
    .mocked(getDoc)
    .mockImplementation(
      async (path) =>
        ({
          exists: () => String(path).includes('/submitted/'),
          data: () => ({ submittedAt: new Date() }),
        }) as never,
    );
  const tasks = await listInboxTasks('alice');
  expect(tasks.map((task) => task.title)).toEqual(['Pending']);
  expect(getDoc).toHaveBeenCalledWith('groups/course/assignments/pending/submissions/alice');
});
test('a permission failure is surfaced instead of reporting no pending work', async () => {
  jest.mocked(getDocs).mockRejectedValue(new Error('permission-denied'));
  await expect(listInboxTasks('alice')).rejects.toThrow('permission-denied');
});
