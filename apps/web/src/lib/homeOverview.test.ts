import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { feedbackPredatesSubmission, loadHomeData } from './homeOverview';
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
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-02T02:00:00Z'));
  vi.mocked(isFirebaseConfigured).mockReturnValue(true);
});
afterEach(() => {
  vi.useRealTimers();
});
it('compares feedback and resubmissions using the accepted Taipei wall-time contract', () => {
  expect(feedbackPredatesSubmission('2026-10-11T10:00:00', '2026-10-11T03:00:00Z')).toBe(true);
  expect(feedbackPredatesSubmission('2026-10-11T03:00:00Z', '2026-10-11T10:00:00')).toBe(false);
  expect(feedbackPredatesSubmission('2026-10-11T10:00:00', '2026-10-11T02:00:00Z')).toBe(false);
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
        entry('a4', { title: 'Draft status', status: 'draft' }),
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
  expect(vi.mocked(getDocs).mock.calls.map(([path]) => path)).toEqual([
    'users/alice/groups',
    'groups/c1/assignments',
  ]);
  expect(getDoc).toHaveBeenCalledWith('groups/c1/assignments/a1/submissions/alice');
  expect(getDoc).toHaveBeenCalledTimes(2);
});
it.each([
  { name: 'closed assignment without a deadline', assignment: { status: 'closed' }, actionable: false },
  {
    name: 'closed assignment even when late submissions are allowed',
    assignment: { status: 'closed', allowLateSubmission: true, dueAt: '2026-11-03T02:00:00Z' },
    actionable: false,
  },
  {
    name: 'past deadline without late submission permission',
    assignment: { dueAt: '2026-11-02T01:59:59Z' },
    actionable: false,
  },
  {
    name: 'past deadline with late submissions explicitly disabled',
    assignment: { dueAt: '2026-11-02T01:59:59Z', allowLateSubmission: false },
    actionable: false,
  },
  {
    name: 'past deadline with late submissions allowed',
    assignment: { dueAt: '2026-11-02T01:59:59Z', allowLateSubmission: true },
    actionable: true,
  },
  {
    name: 'future deadline',
    assignment: { dueAt: '2026-11-02T02:00:01Z', allowLateSubmission: false },
    actionable: true,
  },
  {
    name: 'exact deadline, matching the course submission boundary',
    assignment: { dueAt: '2026-11-02T02:00:00Z', allowLateSubmission: false },
    actionable: true,
  },
  { name: 'no deadline', assignment: {}, actionable: true },
  {
    name: 'expired Firestore timestamp',
    assignment: { dueAt: { toDate: () => new Date('2026-11-02T01:59:59Z') } },
    actionable: false,
  },
  {
    name: 'closed quiz',
    assignment: { type: 'quiz', status: 'closed' },
    actionable: false,
  },
  {
    name: 'expired exam that does not allow late submissions',
    assignment: { type: 'exam', dueAt: '2026-11-02T01:59:59Z', allowLateSubmission: false },
    actionable: false,
  },
])('only recommends actionable work: $name', async ({ assignment, actionable }) => {
  vi.mocked(getDocs)
    .mockResolvedValueOnce({
      docs: [entry('c1', { type: 'course', status: 'active', name: 'Course' })],
    } as never)
    .mockResolvedValueOnce({ docs: [entry('work', { title: '報告', ...assignment })] } as never);
  vi.mocked(getDoc).mockResolvedValue({ exists: () => false } as never);

  const home = await loadHomeData('alice');

  expect(home.tasks.map((task) => task.id)).toEqual(actionable ? ['work'] : []);
  expect(home.courses.map((course) => course.id)).toEqual(['c1']);
  expect(home.recentFeedback).toEqual([]);
});
it.each(['owner', 'instructor', 'moderator'])(
  'does not read student work for a teaching membership (%s)',
  async (role) => {
    vi.mocked(getDocs).mockResolvedValueOnce({
      docs: [entry('teaching', { type: 'course', status: 'active', role })],
    } as never);

    const home = await loadHomeData('alice');

    expect(home.tasks).toEqual([]);
    expect(getDocs).toHaveBeenCalledTimes(1);
    expect(getDoc).not.toHaveBeenCalled();
  },
);
it('retains published feedback for closed work without recommending it again', async () => {
  vi.mocked(getDocs)
    .mockResolvedValueOnce({
      docs: [entry('c1', { type: 'course', status: 'active', name: 'Course' })],
    } as never)
    .mockResolvedValueOnce({
      docs: [entry('closed', { title: '已結束的報告', status: 'closed' })],
    } as never);
  vi.mocked(getDoc).mockResolvedValue({
    exists: () => true,
    data: () => ({
      submittedAt: '2026-11-01T01:00:00Z',
      gradePublished: true,
      gradeScore: 88,
      gradeFeedback: '已評閱',
      gradePublishedAt: '2026-11-01T02:00:00Z',
    }),
  } as never);

  const home = await loadHomeData('alice');

  expect(home.tasks).toEqual([]);
  expect(home.recentFeedback).toEqual([
    expect.objectContaining({ id: 'closed', score: 88, feedback: '已評閱' }),
  ]);
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
it('does not return pending work when its submission read is denied', async () => {
  vi.mocked(getDocs)
    .mockResolvedValueOnce({
      docs: [entry('c1', { type: 'course', status: 'active', name: 'Course' })],
    } as never)
    .mockResolvedValueOnce({ docs: [entry('work', { title: '報告' })] } as never);
  vi.mocked(getDoc).mockRejectedValueOnce(new Error('permission-denied'));

  await expect(loadHomeData('alice')).rejects.toThrow('permission-denied');
});
