import { beforeEach, expect, it, vi } from 'vitest';
import { loadHomeData } from './homeOverview';
import { getDoc, getDocs } from 'firebase/firestore';
import { isFirebaseConfigured } from './firebase';

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
it('requires a configured service and authenticated user', async () => {
  await expect(loadHomeData('')).rejects.toThrow();
  vi.mocked(isFirebaseConfigured).mockReturnValue(false);
  await expect(loadHomeData('alice')).rejects.toThrow();
  expect(getDocs).not.toHaveBeenCalled();
});
it('returns an empty account without sample courses', async () => {
  vi.mocked(getDocs).mockResolvedValue({ docs: [] } as never);
  expect(await loadHomeData('alice')).toEqual({ courses: [], tasks: [], unreadCount: 0 });
  expect(getDocs).toHaveBeenCalledWith('users/alice/groups');
});
it('uses only active course memberships and excludes submitted work and drafts', async () => {
  vi.mocked(getDocs)
    .mockResolvedValueOnce({
      docs: [
        entry('c1', { type: 'course', status: 'active', name: 'Course', unreadCount: 2 }),
        entry('c2', { type: 'course', status: 'removed' }),
        entry('club', { type: 'club', status: 'active' }),
      ],
    } as never)
    .mockResolvedValueOnce({
      docs: [
        entry('a1', { title: 'Pending', dueAt: '2026-10-10T12:00:00Z' }),
        entry('a2', { title: 'Submitted' }),
        entry('a3', { title: 'Draft', published: false }),
      ],
    } as never);
  vi.mocked(getDoc).mockImplementation(
    async (path) =>
      ({
        exists: () => String(path).includes('/a2/'),
        data: () => ({ submittedAt: '2026-10-07T10:00:00Z' }),
      }) as never,
  );
  const home = await loadHomeData('alice');
  expect(home.courses.map((c) => c.id)).toEqual(['c1']);
  expect(home.tasks.map((task) => task.id)).toEqual(['a1']);
  expect(home.unreadCount).toBe(2);
  expect(getDoc).toHaveBeenCalledWith('groups/c1/assignments/a1/submissions/alice');
});
it('does not turn a permission failure into a successful empty page', async () => {
  vi.mocked(getDocs).mockRejectedValue(new Error('permission-denied'));
  await expect(loadHomeData('alice')).rejects.toThrow('permission-denied');
});
