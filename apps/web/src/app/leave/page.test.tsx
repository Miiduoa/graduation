import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { LEAVE_COPY, LEAVE_LOAD_TIMEOUT_MS } from '@/lib/leavePageState';
import { listMyLeaveRequests, submitLeaveRequest, withdrawLeaveRequest } from '@/lib/leaveRequests';
import { ensureTimetableIndex, loadPersonalTimetable } from '@/lib/timetable/store';
import LeavePage, { dynamic, revalidate } from './page';

const runtime = vi.hoisted(() => ({
  leaveApiEnabled: false,
  user: { uid: 'stu' } as { uid: string } | null,
  authLoading: false,
}));
vi.mock('@/lib/server/leaveWebApiEnabled', () => ({
  isLeaveWebApiServerEnabled: () => runtime.leaveApiEnabled,
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

const timetable = {
  courses: [],
  meta: { school: '', year: '', semester: '', className: '', credits: 0, title: '' },
  shareWithFriends: false,
  updatedAt: '2026-10-26T00:00:00.000Z',
  schoolId: 'pu',
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

afterEach(() => {
  vi.unstubAllEnvs();
});

beforeEach(() => {
  vi.clearAllMocks();
  runtime.leaveApiEnabled = false;
  runtime.user = { uid: 'stu' };
  runtime.authLoading = false;
  vi.mocked(loadPersonalTimetable).mockResolvedValue(timetable);
  vi.mocked(listMyLeaveRequests).mockResolvedValue([]);
  vi.mocked(ensureTimetableIndex).mockResolvedValue(undefined);
  vi.mocked(submitLeaveRequest).mockImplementation(async (_uid, input) => ({
    id: input.requestId, alreadySubmitted: false,
  }));
});

it('is rendered at request time so the runtime switch is not baked at build', () => {
  expect(dynamic).toBe('force-dynamic');
  expect(revalidate).toBe(0);
});

it('shows only the unavailable copy when the leave API is off', async () => {
  render(<LeavePage />);
  expectOnly(LEAVE_COPY.unavailableSubmit);
  expect(listMyLeaveRequests).not.toHaveBeenCalled();
  expect(loadPersonalTimetable).not.toHaveBeenCalled();
  expect(screen.queryByRole('button', { name: LEAVE_COPY.retry })).toBeNull();
});

it('loads leave records when the runtime switch is on', async () => {
  runtime.leaveApiEnabled = true;
  render(<LeavePage />);
  expect(await screen.findByText(LEAVE_COPY.emptySubmit)).toBeTruthy();
  expect(listMyLeaveRequests).toHaveBeenCalled();
  expect(loadPersonalTimetable).toHaveBeenCalled();
  expect(screen.queryByText(LEAVE_COPY.unavailableSubmit)).toBeNull();
});

it('shows only the loading copy while the source is in flight', () => {
  runtime.leaveApiEnabled = true;
  vi.mocked(listMyLeaveRequests).mockReturnValue(new Promise(() => {}));
  render(<LeavePage />);
  expectOnly(LEAVE_COPY.loadingSubmit);
});

it('shows only the empty copy after a successful read with no records', async () => {
  runtime.leaveApiEnabled = true;
  render(<LeavePage />);
  expect(await screen.findByText(LEAVE_COPY.emptySubmit)).toBeTruthy();
  expectOnly(LEAVE_COPY.emptySubmit);
  expect(screen.queryByText(LEAVE_COPY.loadingSubmit)).toBeNull();
});

it('shows records instead of empty, loading, error or unavailable', async () => {
  runtime.leaveApiEnabled = true;
  vi.mocked(listMyLeaveRequests).mockResolvedValue([record]);
  render(<LeavePage />);
  expect(await screen.findByText('等待站內核閱')).toBeTruthy();
  for (const text of STATES) expect(screen.queryByText(text)).toBeNull();
});

it('shows a network error with retry and never keeps loading beside it', async () => {
  runtime.leaveApiEnabled = true;
  vi.mocked(listMyLeaveRequests).mockRejectedValue(new TypeError('Failed to fetch'));
  render(<LeavePage />);
  expect(await screen.findByText(LEAVE_COPY.network)).toBeTruthy();
  expectOnly(LEAVE_COPY.network);
  expect(screen.getByRole('button', { name: LEAVE_COPY.retry })).toBeTruthy();
});

it('sends unauthenticated reads to login instead of calling it a network error', async () => {
  runtime.leaveApiEnabled = true;
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
  runtime.leaveApiEnabled = true;
  vi.mocked(listMyLeaveRequests).mockRejectedValue(
    Object.assign(new Error('denied'), { code: 'permission-denied' }),
  );
  render(<LeavePage />);
  expect(await screen.findByText(LEAVE_COPY.forbiddenSubmit)).toBeTruthy();
  expectOnly(LEAVE_COPY.forbiddenSubmit);
  expect(screen.queryByText(/請確認連線|請確認網路/)).toBeNull();
});

it('stops loading after the timeout and lets the user retry', async () => {
  runtime.leaveApiEnabled = true;
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
  runtime.leaveApiEnabled = true;
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

async function openLeaveForm() {
  runtime.leaveApiEnabled = true;
  vi.mocked(loadPersonalTimetable).mockResolvedValue({
    ...timetable,
    courses: [{ id: 'c1', name: '資料庫', day: 0, start: 0, end: 0, teacher: '', room: '', color: 'blue' }],
  });
  render(<LeavePage />);
  fireEvent.click(await screen.findByRole('checkbox', { name: /資料庫/ }));
}

it('opens the confirmed request even when a different history filter was active', async () => {
  await openLeaveForm();
  fireEvent.click(screen.getByRole('button', { name: '已撤回' }));
  vi.mocked(listMyLeaveRequests).mockImplementationOnce(async () => [
    { ...record, id: vi.mocked(submitLeaveRequest).mock.calls[0][1].requestId },
  ]);

  fireEvent.click(screen.getByRole('button', { name: '建立請假紀錄' }));
  expect(await screen.findByRole('button', { name: '收合明細' })).toBeTruthy();
  const id = vi.mocked(submitLeaveRequest).mock.calls[0][1].requestId;
  expect(screen.getByRole('status').textContent).toContain(id);
  expect(document.activeElement).toBe(screen.getByRole('status'));
  expect(screen.getByRole('button', { name: '全部' }).getAttribute('aria-pressed')).toBe('true');
});

it('keeps the confirmed receipt visible if refreshing the history fails', async () => {
  await openLeaveForm();
  vi.mocked(listMyLeaveRequests).mockRejectedValueOnce(new TypeError('Failed to fetch'));
  fireEvent.click(screen.getByRole('button', { name: '建立請假紀錄' }));
  expect(await screen.findByText(LEAVE_COPY.network)).toBeTruthy();
  const id = vi.mocked(submitLeaveRequest).mock.calls[0][1].requestId;
  expect(screen.getByRole('status').textContent).toContain(id);
  vi.mocked(listMyLeaveRequests).mockResolvedValueOnce([{ ...record, id }]);
  fireEvent.click(screen.getByRole('button', { name: LEAVE_COPY.retry }));
  expect(await screen.findByRole('button', { name: '收合明細' })).toBeTruthy();
  expect(submitLeaveRequest).toHaveBeenCalledTimes(1);
});

it('ignores a slow refresh that finishes after the submitted record was loaded', async () => {
  await openLeaveForm();
  let finish!: (rows: typeof record[]) => void;
  vi.mocked(listMyLeaveRequests).mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
  fireEvent.click(screen.getByRole('button', { name: '更新' }));
  vi.mocked(listMyLeaveRequests).mockImplementationOnce(async () => [
    { ...record, id: vi.mocked(submitLeaveRequest).mock.calls[0][1].requestId },
  ]);
  fireEvent.click(screen.getByRole('button', { name: '建立請假紀錄' }));
  expect(await screen.findByText('等待站內核閱')).toBeTruthy();
  await act(async () => finish([]));
  expect(screen.getByText('等待站內核閱')).toBeTruthy();
});

it('uses the same request ID when the first submission response is lost', async () => {
  await openLeaveForm();
  vi.mocked(submitLeaveRequest).mockRejectedValueOnce(new TypeError('Failed to fetch'));
  fireEvent.click(screen.getByRole('button', { name: '建立請假紀錄' }));
  expect(await screen.findByText(/尚未確認這次操作/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '更新' }));
  await waitFor(() => expect(listMyLeaveRequests).toHaveBeenCalledTimes(2));
  fireEvent.click(screen.getByRole('button', { name: '建立請假紀錄' }));
  await waitFor(() => expect(submitLeaveRequest).toHaveBeenCalledTimes(2));
  expect(vi.mocked(submitLeaveRequest).mock.calls[1]).toEqual(vi.mocked(submitLeaveRequest).mock.calls[0]);
});

it('matches a lost submission response to the saved ID on refresh without resubmitting', async () => {
  await openLeaveForm();
  vi.mocked(submitLeaveRequest).mockRejectedValueOnce(new TypeError('Failed to fetch'));
  fireEvent.click(screen.getByRole('button', { name: '建立請假紀錄' }));
  expect(await screen.findByText(/尚未確認這次操作/)).toBeTruthy();
  const id = vi.mocked(submitLeaveRequest).mock.calls[0][1].requestId;
  vi.mocked(listMyLeaveRequests).mockResolvedValueOnce([{ ...record, id }]);
  fireEvent.click(screen.getByRole('button', { name: '更新' }));
  expect(await screen.findByRole('button', { name: '收合明細' })).toBeTruthy();
  expect(screen.getByRole('status').textContent).toContain(id);
  expect(submitLeaveRequest).toHaveBeenCalledTimes(1);
});

it('finds a recent request by receipt or course name and clears an empty search', async () => {
  runtime.leaveApiEnabled = true;
  vi.mocked(listMyLeaveRequests).mockResolvedValue([
    record,
    { ...record, id: 'leave-2', courses: [{ ...record.courses[0], courseName: '雲端服務' }] },
  ]);
  render(<LeavePage />);
  const search = await screen.findByRole('searchbox', { name: /搜尋最近/ });
  fireEvent.change(search, { target: { value: ' ＬＥＡＶＥ-1 ' } });
  fireEvent.click(screen.getByRole('button', { name: '查看明細' }));
  expect(screen.getByText('站內單號 leave-1')).toBeTruthy();
  fireEvent.change(search, { target: { value: '雲端' } });
  fireEvent.click(screen.getByRole('button', { name: '查看明細' }));
  expect(screen.getByText('站內單號 leave-2')).toBeTruthy();
  fireEvent.change(search, { target: { value: '無此單號' } });
  expect(screen.getByText('沒有符合條件的紀錄')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '顯示全部紀錄' }));
  expect(screen.getByText('站內單號 leave-2')).toBeTruthy();
  expect(screen.getByRole('button', { name: '查看明細' })).toBeTruthy();
});

it('keeps a withdrawn record in view when withdrawing from the open filter', async () => {
  runtime.leaveApiEnabled = true;
  vi.mocked(listMyLeaveRequests).mockResolvedValueOnce([record])
    .mockResolvedValueOnce([{ ...record, status: 'withdrawn' }]);
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
  try {
    render(<LeavePage />);
    fireEvent.click(await screen.findByRole('button', { name: '處理中' }));
    fireEvent.click(screen.getByRole('button', { name: '撤回' }));
    expect(await screen.findByRole('button', { name: '收合明細' })).toBeTruthy();
    expect(withdrawLeaveRequest).toHaveBeenCalledWith('stu', record.id);
    expect(screen.getByRole('button', { name: '已撤回' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('status').textContent).toContain(record.id);
  } finally {
    confirm.mockRestore();
  }
});
