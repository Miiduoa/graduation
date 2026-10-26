import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { LEAVE_COPY, LEAVE_LOAD_TIMEOUT_MS } from '@/lib/leavePageState';
import { listLeaveReviewQueue } from '@/lib/leaveRequests';
import LeaveReviewPage from './page';

const runtime = vi.hoisted(() => ({
  functionsConfigured: false,
  user: { uid: 'teacher' } as { uid: string } | null,
  authLoading: false,
}));
vi.mock('@/lib/functionsUrl', async (original) => ({
  ...(await original<typeof import('@/lib/functionsUrl')>()),
  areFunctionsConfigured: () => runtime.functionsConfigured,
}));
vi.mock('@/components/AuthGuard', () => ({
  useAuth: () => ({ user: runtime.user, loading: runtime.authLoading }),
}));
vi.mock('@/components/SelectedSchoolProvider', () => ({
  useSelectedSchool: () => ({
    selectedSchoolId: 'pu',
    selectedSchool: { name: '靜宜大學' },
    loading: false,
  }),
}));
vi.mock('@/components/SiteShell', () => ({
  SiteShell: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));
vi.mock('@/components/SchoolScopePlaceholder', () => ({
  SchoolScopePlaceholder: () => <p role="status">選擇校園</p>,
}));
vi.mock('@/components/SchoolAccountRequired', () => ({
  SchoolAccountRequired: () => <p>需要學校帳號</p>,
}));
vi.mock('@/lib/leaveRequests', async (original) => ({
  ...(await original<typeof import('@/lib/leaveRequests')>()),
  listLeaveReviewQueue: vi.fn(),
  reviewLeaveRequest: vi.fn(),
}));

const row = {
  id: 'leave-1',
  studentName: '王小明',
  kind: 'sick' as const,
  period: 'all' as const,
  startDate: '2026-10-26',
  endDate: '2026-10-26',
  detail: '',
  status: 'pending' as const,
  createdAt: '2026-10-26T00:00:00.000Z',
  courses: [
    { courseId: 'c1', courseName: '資料庫', offeringId: '資料庫｜王老師', reviewStatus: 'pending' as const, reviewerNote: '' },
  ],
};

const STATES = [
  LEAVE_COPY.loadingReview,
  LEAVE_COPY.unavailableReview,
  LEAVE_COPY.emptyReview,
  LEAVE_COPY.network,
  LEAVE_COPY.timeout,
  LEAVE_COPY.unauthorized,
  LEAVE_COPY.forbiddenReview,
];

function expectOnly(visible: string) {
  expect(screen.getByText(visible)).toBeTruthy();
  for (const text of STATES) {
    if (text !== visible) expect(screen.queryByText(text)).toBeNull();
  }
  expect(screen.queryByText('正在讀取你有權限查看的請假紀錄…')).toBeNull();
  expect(screen.queryByText(/請確認連線/)).toBeNull();
}

beforeEach(() => {
  vi.clearAllMocks();
  runtime.functionsConfigured = false;
  runtime.user = { uid: 'teacher' };
  runtime.authLoading = false;
  vi.mocked(listLeaveReviewQueue).mockResolvedValue([]);
});

it('shows only that review is not open when Functions are not configured', async () => {
  render(<LeaveReviewPage />);
  expectOnly(LEAVE_COPY.unavailableReview);
  expect(listLeaveReviewQueue).not.toHaveBeenCalled();
  expect(screen.queryByRole('button', { name: LEAVE_COPY.retry })).toBeNull();
});

it('shows only the loading copy while the review queue is in flight', () => {
  runtime.functionsConfigured = true;
  vi.mocked(listLeaveReviewQueue).mockReturnValue(new Promise(() => {}));
  render(<LeaveReviewPage />);
  expectOnly(LEAVE_COPY.loadingReview);
});

it('shows only the empty copy when the queue is configured and has no rows', async () => {
  runtime.functionsConfigured = true;
  render(<LeaveReviewPage />);
  expect(await screen.findByText(LEAVE_COPY.emptyReview)).toBeTruthy();
  expectOnly(LEAVE_COPY.emptyReview);
});

it('shows queue rows instead of loading, error, empty or unavailable', async () => {
  runtime.functionsConfigured = true;
  vi.mocked(listLeaveReviewQueue).mockResolvedValue([row]);
  render(<LeaveReviewPage />);
  expect(await screen.findByText(/王小明/)).toBeTruthy();
  for (const text of STATES) expect(screen.queryByText(text)).toBeNull();
});

it('shows a network error with retry and does not keep loading beside it', async () => {
  runtime.functionsConfigured = true;
  vi.mocked(listLeaveReviewQueue).mockRejectedValue(new TypeError('Failed to fetch'));
  render(<LeaveReviewPage />);
  expect(await screen.findByText(LEAVE_COPY.network)).toBeTruthy();
  expectOnly(LEAVE_COPY.network);
  expect(screen.getByRole('button', { name: LEAVE_COPY.retry })).toBeTruthy();
});

it('sends 401 to login and 403 to a permission state', async () => {
  runtime.functionsConfigured = true;
  vi.mocked(listLeaveReviewQueue).mockRejectedValueOnce(
    Object.assign(new Error('signed out'), { status: 401 }),
  );
  const first = render(<LeaveReviewPage />);
  expect(await screen.findByText(LEAVE_COPY.unauthorized)).toBeTruthy();
  expect(screen.getByRole('link', { name: LEAVE_COPY.login }).getAttribute('href')).toBe(
    '/login?returnUrl=%2Fleave%2Freview',
  );
  expect(screen.queryByText(LEAVE_COPY.network)).toBeNull();
  first.unmount();

  vi.mocked(listLeaveReviewQueue).mockRejectedValueOnce(
    Object.assign(new Error('denied'), { status: 403 }),
  );
  render(<LeaveReviewPage />);
  expect(await screen.findByText(LEAVE_COPY.forbiddenReview)).toBeTruthy();
  expectOnly(LEAVE_COPY.forbiddenReview);
  expect(screen.queryByRole('button', { name: LEAVE_COPY.retry })).toBeNull();
});

it('stops a stuck review read after the timeout', async () => {
  runtime.functionsConfigured = true;
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  try {
    vi.mocked(listLeaveReviewQueue).mockReturnValue(new Promise(() => {}));
    render(<LeaveReviewPage />);
    expectOnly(LEAVE_COPY.loadingReview);
    await act(async () => {
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(LEAVE_LOAD_TIMEOUT_MS);
    });
    expectOnly(LEAVE_COPY.timeout);
    expect(screen.getByRole('button', { name: LEAVE_COPY.retry })).toBeTruthy();
  } finally {
    vi.useRealTimers();
  }
});

it('retry after a network error can reach the empty queue', async () => {
  runtime.functionsConfigured = true;
  vi.mocked(listLeaveReviewQueue)
    .mockRejectedValueOnce(new TypeError('Failed to fetch'))
    .mockResolvedValueOnce([]);
  render(<LeaveReviewPage />);
  expect(await screen.findByText(LEAVE_COPY.network)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: LEAVE_COPY.retry }));
  await waitFor(() => expect(screen.getByText(LEAVE_COPY.emptyReview)).toBeTruthy());
  expect(screen.queryByText(LEAVE_COPY.network)).toBeNull();
  expect(screen.queryByText(LEAVE_COPY.loadingReview)).toBeNull();
});
