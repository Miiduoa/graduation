import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { LEAVE_COPY, LEAVE_LOAD_TIMEOUT_MS } from '@/lib/leavePageState';
import { listMyLeaveRequests } from '@/lib/leaveRequests';
import { loadPersonalTimetable } from '@/lib/timetable/store';
import LeavePage from './page';

const runtime = vi.hoisted(() => ({
  functionsConfigured: false,
  user: { uid: 'stu' } as { uid: string } | null,
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
vi.mock('@/lib/timetable/store', () => ({
  loadPersonalTimetable: vi.fn(),
  ensureTimetableIndex: vi.fn(),
}));
vi.mock('@/lib/leaveRequests', async (original) => ({
  ...(await original<typeof import('@/lib/leaveRequests')>()),
  listMyLeaveRequests: vi.fn(),
  submitLeaveRequest: vi.fn(),
  withdrawLeaveRequest: vi.fn(),
}));

const record = {
  id: 'leave-1',
  kind: 'sick' as const,
  period: 'all' as const,
  startDate: '2026-10-26',
  endDate: '2026-10-26',
  detail: '',
  status: 'pending' as const,
  courses: [
    { courseId: 'c1', courseName: '資料庫', offeringId: '資料庫｜王老師', reviewStatus: 'pending' as const, reviewerNote: '' },
  ],
  createdAt: '2026-10-26T00:00:00.000Z',
};

const STATES = [
  LEAVE_COPY.loadingSubmit,
  LEAVE_COPY.unavailableSubmit,
  LEAVE_COPY.emptySubmit,
  LEAVE_COPY.network,
  LEAVE_COPY.timeout,
  LEAVE_COPY.unauthorized,
  LEAVE_COPY.forbiddenSubmit,
];

function expectOnly(visible: string) {
  expect(screen.getByText(visible)).toBeTruthy();
  for (const text of STATES) {
    if (text !== visible) expect(screen.queryByText(text)).toBeNull();
  }
  expect(screen.queryByText('正在讀取課表…')).toBeNull();
  expect(screen.queryByText('正在讀取你的申請紀錄…')).toBeNull();
  expect(screen.queryByText(/請確認連線/)).toBeNull();
}

beforeEach(() => {
  vi.clearAllMocks();
  runtime.functionsConfigured = false;
  runtime.user = { uid: 'stu' };
  runtime.authLoading = false;
  vi.mocked(loadPersonalTimetable).mockResolvedValue({
    courses: [],
    meta: { school: '', year: '', semester: '', className: '', credits: 0, title: '' },
    shareWithFriends: false,
    updatedAt: '2026-10-26T00:00:00.000Z',
    schoolId: 'pu',
  });
  vi.mocked(listMyLeaveRequests).mockResolvedValue([]);
});

it('shows only the unavailable copy when Functions are not configured', async () => {
  render(<LeavePage />);
  expectOnly(LEAVE_COPY.unavailableSubmit);
  expect(listMyLeaveRequests).not.toHaveBeenCalled();
  expect(loadPersonalTimetable).not.toHaveBeenCalled();
  expect(screen.queryByRole('button', { name: LEAVE_COPY.retry })).toBeNull();
});

it('shows only the loading copy while the source is in flight', () => {
  runtime.functionsConfigured = true;
  vi.mocked(listMyLeaveRequests).mockReturnValue(new Promise(() => {}));
  render(<LeavePage />);
  expectOnly(LEAVE_COPY.loadingSubmit);
});

it('shows only the empty copy after a successful read with no records', async () => {
  runtime.functionsConfigured = true;
  render(<LeavePage />);
  expect(await screen.findByText(LEAVE_COPY.emptySubmit)).toBeTruthy();
  expectOnly(LEAVE_COPY.emptySubmit);
  expect(screen.queryByText(LEAVE_COPY.loadingSubmit)).toBeNull();
});

it('shows records instead of empty, loading, error or unavailable', async () => {
  runtime.functionsConfigured = true;
  vi.mocked(listMyLeaveRequests).mockResolvedValue([record]);
  render(<LeavePage />);
  expect(await screen.findByText('等待站內核閱')).toBeTruthy();
  for (const text of STATES) expect(screen.queryByText(text)).toBeNull();
});

it('shows a network error with retry and never keeps loading beside it', async () => {
  runtime.functionsConfigured = true;
  vi.mocked(listMyLeaveRequests).mockRejectedValue(new TypeError('Failed to fetch'));
  render(<LeavePage />);
  expect(await screen.findByText(LEAVE_COPY.network)).toBeTruthy();
  expectOnly(LEAVE_COPY.network);
  expect(screen.getByRole('button', { name: LEAVE_COPY.retry })).toBeTruthy();
});

it('sends unauthenticated reads to login instead of calling it a network error', async () => {
  runtime.functionsConfigured = true;
  vi.mocked(listMyLeaveRequests).mockRejectedValue(
    Object.assign(new Error('signed out'), { code: 'functions/unauthenticated' }),
  );
  render(<LeavePage />);
  expect(await screen.findByText(LEAVE_COPY.unauthorized)).toBeTruthy();
  expectOnly(LEAVE_COPY.unauthorized);
  expect(screen.getByRole('link', { name: LEAVE_COPY.login }).getAttribute('href')).toBe(
    '/login?returnUrl=%2Fleave',
  );
  expect(screen.queryByRole('button', { name: LEAVE_COPY.retry })).toBeNull();
});

it('shows missing permission without blaming the network', async () => {
  runtime.functionsConfigured = true;
  vi.mocked(listMyLeaveRequests).mockRejectedValue(
    Object.assign(new Error('denied'), { code: 'permission-denied' }),
  );
  render(<LeavePage />);
  expect(await screen.findByText(LEAVE_COPY.forbiddenSubmit)).toBeTruthy();
  expectOnly(LEAVE_COPY.forbiddenSubmit);
  expect(screen.queryByText(/請確認連線|請確認網路/)).toBeNull();
});

it('stops loading after the timeout and lets the user retry', async () => {
  runtime.functionsConfigured = true;
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  try {
    vi.mocked(listMyLeaveRequests).mockReturnValue(new Promise(() => {}));
    render(<LeavePage />);
    expectOnly(LEAVE_COPY.loadingSubmit);
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

it('retry after a network error can reach the empty state', async () => {
  runtime.functionsConfigured = true;
  vi.mocked(listMyLeaveRequests)
    .mockRejectedValueOnce(new TypeError('Failed to fetch'))
    .mockResolvedValueOnce([]);
  render(<LeavePage />);
  expect(await screen.findByText(LEAVE_COPY.network)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: LEAVE_COPY.retry }));
  await waitFor(() => expect(screen.getByText(LEAVE_COPY.emptySubmit)).toBeTruthy());
  expect(screen.queryByText(LEAVE_COPY.network)).toBeNull();
  expect(screen.queryByText(LEAVE_COPY.loadingSubmit)).toBeNull();
});
