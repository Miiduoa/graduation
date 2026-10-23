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
  expect(await loadHomeData('alice')).toEqual({
    courses: [],
    tasks: [],
    recentFeedback: [],
    unreadCount: 0,
  });
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
        entry('a1', { title: 'Pending', dueAt: '2026-10-10T12:00:00Z', allowLateSubmission: true }),
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
  expect(home.courses[0].href).toBe('/course/c1');
  expect(home.tasks).toEqual([
    {
      kind: 'assignment',
      id: 'a1',
      courseId: 'c1',
      courseName: 'Course',
      title: 'Pending',
      dueAt: '2026-10-10T12:00:00.000Z',
      href: '/course/c1#assignment-a1',
      acceptsLate: true,
    },
  ]);
  expect(home.recentFeedback).toEqual([]);
  expect(home.unreadCount).toBe(2);
  expect(getDoc).toHaveBeenCalledWith('groups/c1/assignments/a1/submissions/alice');
});
it('surfaces published grades as recent feedback with deep links', async () => {
  vi.mocked(getDocs)
    .mockResolvedValueOnce({
      docs: [entry('c1', { type: 'course', status: 'active', name: 'Course', unreadCount: 0 })],
    } as never)
    .mockResolvedValueOnce({
      docs: [entry('hw1', { title: '報告', type: 'assignment' })],
    } as never);
  vi.mocked(getDoc).mockResolvedValue({
    exists: () => true,
    data: () => ({
      submittedAt: '2026-10-07T10:00:00Z',
      gradePublished: true,
      gradeScore: 88,
      gradeFeedback: '結構清楚',
      gradePublishedAt: '2026-10-08T02:00:00Z',
    }),
  } as never);
  const home = await loadHomeData('alice');
  expect(home.tasks).toEqual([]);
  expect(home.recentFeedback).toEqual([
    {
      kind: 'assignment',
      id: 'hw1',
      courseId: 'c1',
      courseName: 'Course',
      title: '報告',
      feedback: '結構清楚',
      score: 88,
      reviewedAt: '2026-10-08T02:00:00.000Z',
      submittedAt: '2026-10-07T10:00:00.000Z',
      href: '/course/c1#assignment-hw1',
    },
  ]);
});
it.each([
  {
    name: 'zero score with empty feedback',
    row: {
      submittedAt: '2026-10-07T10:00:00Z',
      gradePublished: true,
      gradeScore: 0,
      gradeFeedback: '',
      gradePublishedAt: '2026-10-08T02:00:00Z',
    },
    score: 0,
    feedback: '',
  },
  {
    name: 'nonzero score with empty feedback',
    row: {
      submittedAt: '2026-10-07T10:00:00Z',
      gradePublished: true,
      gradeScore: 85,
      gradeFeedback: '',
      gradePublishedAt: '2026-10-08T02:00:00Z',
    },
    score: 85,
    feedback: '',
  },
  {
    name: 'score with whitespace-only feedback',
    row: {
      submittedAt: '2026-10-07T10:00:00Z',
      gradePublished: true,
      gradeScore: 70,
      gradeFeedback: '   ',
      gradePublishedAt: '2026-10-08T02:00:00Z',
    },
    score: 70,
    feedback: '   ',
  },
])('includes published score-only grades ($name)', async ({ row, score, feedback }) => {
  vi.mocked(getDocs)
    .mockResolvedValueOnce({
      docs: [entry('c1', { type: 'course', status: 'active', name: 'Course', unreadCount: 0 })],
    } as never)
    .mockResolvedValueOnce({
      docs: [entry('hw1', { title: '報告', type: 'assignment' })],
    } as never);
  vi.mocked(getDoc).mockResolvedValue({
    exists: () => true,
    data: () => row,
  } as never);
  const home = await loadHomeData('alice');
  expect(home.recentFeedback).toEqual([
    expect.objectContaining({
      id: 'hw1',
      score,
      feedback,
      href: '/course/c1#assignment-hw1',
    }),
  ]);
});
it('excludes unpublished grades and whitespace-only feedback without a score', async () => {
  vi.mocked(getDocs)
    .mockResolvedValueOnce({
      docs: [entry('c1', { type: 'course', status: 'active', name: 'Course', unreadCount: 0 })],
    } as never)
    .mockResolvedValueOnce({
      docs: [
        entry('draft', { title: '未發布' }),
        entry('blank', { title: '空白評語' }),
      ],
    } as never);
  vi.mocked(getDoc).mockImplementation(async (path) => {
    if (String(path).includes('/draft/')) {
      return {
        exists: () => true,
        data: () => ({
          submittedAt: '2026-10-07T10:00:00Z',
          gradePublished: false,
          gradeScore: 90,
          gradeFeedback: '草稿',
        }),
      } as never;
    }
    return {
      exists: () => true,
      data: () => ({
        submittedAt: '2026-10-07T10:00:00Z',
        gradePublished: true,
        gradeFeedback: '  ',
      }),
    } as never;
  });
  const home = await loadHomeData('alice');
  expect(home.recentFeedback).toEqual([]);
  expect(home.tasks).toEqual([]);
});
it('does not turn a permission failure into a successful empty page', async () => {
  vi.mocked(getDocs).mockRejectedValue(new Error('permission-denied'));
  await expect(loadHomeData('alice')).rejects.toThrow('permission-denied');
});
