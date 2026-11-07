import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { LEAVE_COPY, LEAVE_LOAD_TIMEOUT_MS } from '@/lib/leavePageState';
import { getMyLeaveRequest, listMyLeaveRequests, submitLeaveRequest, withdrawLeaveRequest } from '@/lib/leaveRequests';
import { ensureTimetableIndex, loadPersonalTimetable } from '@/lib/timetable/store';
import LeavePage, { dynamic, revalidate } from './page';

const runtime = vi.hoisted(() => ({
  leaveApiEnabled: false,
  user: { uid: 'stu' } as { uid: string } | null,
  authLoading: false,
  search: '',
  schoolId: 'pu',
}));
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(runtime.search),
}));
vi.mock('@/lib/server/leaveWebApiEnabled', () => ({
  isLeaveWebApiServerEnabled: () => runtime.leaveApiEnabled,
}));
vi.mock('@/components/AuthGuard', () => ({
  useAuth: () => ({ user: runtime.user, loading: runtime.authLoading }),
}));
vi.mock('@/components/SelectedSchoolProvider', () => ({
  useSelectedSchool: () => ({
    selectedSchoolId: runtime.schoolId,
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
  SchoolAccountRequired: ({ returnUrl }: { returnUrl: string }) => <a href={'/login?returnUrl=' + encodeURIComponent(returnUrl)}>需要學校帳號</a>,
}));
vi.mock('@/lib/timetable/store', () => ({
  loadPersonalTimetable: vi.fn(),
  ensureTimetableIndex: vi.fn(),
}));
vi.mock('@/lib/leaveRequests', async (original) => ({
  ...(await original<typeof import('@/lib/leaveRequests')>()),
  listMyLeaveRequests: vi.fn(),
  getMyLeaveRequest: vi.fn(),
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
  runtime.search = '';
  runtime.schoolId = 'pu';
  vi.mocked(loadPersonalTimetable).mockResolvedValue(timetable);
  vi.mocked(listMyLeaveRequests).mockResolvedValue([]);
  vi.mocked(getMyLeaveRequest).mockResolvedValue(null);
  vi.mocked(ensureTimetableIndex).mockResolvedValue(undefined);
  vi.mocked(submitLeaveRequest).mockImplementation(async (_uid, input) => ({
    id: input.requestId, alreadySubmitted: false,
  }));
});

const linkedRecord = {
  ...record,
  id: 'leave-2026-archive',
  startDate: '2025-01-01',
  endDate: '2025-01-02',
  status: 'completed' as const,
  courses: [{ ...record.courses[0], courseName: '歷史課程', reviewStatus: 'approved' as const, reviewerNote: '已確認這門課的申請' }],
};

it('opens and focuses a linked request outside the recent list with full dates and course results', async () => {
  runtime.leaveApiEnabled = true;
  runtime.search = 'schoolId=pu&requestId=leave-2026-archive';
  vi.mocked(listMyLeaveRequests).mockResolvedValue([record]);
  vi.mocked(getMyLeaveRequest).mockResolvedValue(linkedRecord);
  render(<LeavePage />);
  const panel = screen.getByRole('region', { name: '這筆請假紀錄' });
  expect(await within(panel).findByText('歷史課程')).toBeTruthy();
  expect(within(panel).getByText('病假 · 2025-01-01 ～ 2025-01-02')).toBeTruthy();
  expect(within(panel).getByText('師長回覆：已確認這門課的申請')).toBeTruthy();
  expect(getMyLeaveRequest).toHaveBeenCalledWith('stu', 'pu', linkedRecord.id);
  await waitFor(() => expect(document.activeElement).toBe(panel));
});

it('offers an exact lookup link when a searched ID is outside the recent list', async () => {
  runtime.leaveApiEnabled = true;
  vi.mocked(listMyLeaveRequests).mockResolvedValue([record]);
  render(<LeavePage />);
  const search = await screen.findByRole('searchbox');
  fireEvent.change(search, { target: { value: linkedRecord.id } });
  expect(screen.getByText('沒有符合條件的紀錄')).toBeTruthy();
  expect(screen.getByRole('link', { name: '依完整單號查詢紀錄，包含較早的申請' }).getAttribute('href')).toBe(
    '/leave?schoolId=pu&requestId=' + linkedRecord.id,
  );
});

it('refreshes a linked result after withdrawing the same request in history', async () => {
  runtime.leaveApiEnabled = true;
  runtime.search = 'requestId=leave-2026-archive';
  const pending = { ...record, id: linkedRecord.id };
  vi.mocked(listMyLeaveRequests).mockResolvedValue([pending]);
  vi.mocked(getMyLeaveRequest).mockResolvedValue(pending);
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
  try {
    render(<LeavePage />);
    const panel = screen.getByRole('region', { name: '這筆請假紀錄' });
    await within(panel).findByText('等待站內核閱');
    vi.mocked(withdrawLeaveRequest).mockResolvedValue(undefined);
    vi.mocked(getMyLeaveRequest).mockResolvedValue({ ...pending, status: 'withdrawn' });
    vi.mocked(listMyLeaveRequests).mockResolvedValue([{ ...pending, status: 'withdrawn' }]);
    fireEvent.click(await screen.findByRole('button', { name: '撤回' }));
    await waitFor(() => expect(getMyLeaveRequest).toHaveBeenCalledTimes(2));
    expect(await within(screen.getByRole('region', { name: '這筆請假紀錄' })).findByText('已撤回')).toBeTruthy();
  } finally {
    confirm.mockRestore();
  }
});

it.each(['outside recent history', 'timetable failure', 'lookup refresh failure'])(
  'withdraws an older linked pending request and keeps the receipt despite %s', async (scenario) => {
    runtime.leaveApiEnabled = true;
    runtime.search = 'requestId=leave-2026-archive';
    const pending = { ...record, id: linkedRecord.id };
    vi.mocked(getMyLeaveRequest).mockResolvedValue(pending);
    if (scenario === 'timetable failure') {
      vi.mocked(loadPersonalTimetable).mockRejectedValue(new TypeError('Failed to fetch'));
    }
    let resolve!: () => void;
    vi.mocked(withdrawLeaveRequest).mockReturnValueOnce(new Promise<void>((done) => { resolve = done; }));
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    try {
      render(<LeavePage />);
      const button = await screen.findByRole('button', { name: '撤回這筆紀錄' });
      fireEvent.click(button);
      fireEvent.click(button);
      expect(withdrawLeaveRequest).toHaveBeenCalledTimes(1);
      expect(withdrawLeaveRequest).toHaveBeenCalledWith('stu', linkedRecord.id);
      expect((button as HTMLButtonElement).disabled).toBe(true);
      if (scenario === 'lookup refresh failure') {
        vi.mocked(getMyLeaveRequest).mockRejectedValue(new TypeError('Failed to fetch'));
      } else {
        vi.mocked(getMyLeaveRequest).mockResolvedValue({ ...pending, status: 'withdrawn' });
      }
      await act(async () => resolve());
      const panel = screen.getByRole('region', { name: '這筆請假紀錄' });
      expect(await within(panel).findByText(scenario === 'lookup refresh failure' ? LEAVE_COPY.network : '已撤回')).toBeTruthy();
      expect(screen.getByText(`站內單號 ${linkedRecord.id} 已撤回。若曾在學校系統申請，仍須另外處理。`)).toBeTruthy();
      expect(screen.queryByRole('button', { name: '撤回這筆紀錄' })).toBeNull();
    } finally {
      confirm.mockRestore();
    }
  },
);

it.each(['partial', 'completed', 'withdrawn'] as const)('does not offer linked withdrawal for a %s request', async (status) => {
  runtime.leaveApiEnabled = true;
  runtime.search = 'requestId=leave-2026-archive';
  vi.mocked(getMyLeaveRequest).mockResolvedValue({ ...linkedRecord, status });
  render(<LeavePage />);
  await screen.findByText('歷史課程');
  expect(screen.queryByRole('button', { name: '撤回這筆紀錄' })).toBeNull();
});

it('keeps a linked request available when the recent list cannot load', async () => {
  runtime.leaveApiEnabled = true;
  runtime.search = 'requestId=leave-2026-archive';
  vi.mocked(listMyLeaveRequests).mockRejectedValue(new TypeError('Failed to fetch'));
  vi.mocked(getMyLeaveRequest).mockResolvedValue(linkedRecord);
  render(<LeavePage />);
  expect(await screen.findByText('歷史課程')).toBeTruthy();
  expect(await screen.findByText(LEAVE_COPY.network)).toBeTruthy();
});

it('shows a pending lookup and a missing result with a working refresh', async () => {
  runtime.leaveApiEnabled = true;
  runtime.search = 'requestId=leave-2026-archive';
  let resolve!: (value: null) => void;
  vi.mocked(getMyLeaveRequest).mockReturnValueOnce(new Promise((done) => { resolve = done; }));
  render(<LeavePage />);
  expect(screen.getByText('正在查詢這筆請假紀錄…')).toBeTruthy();
  await act(async () => resolve(null));
  expect(screen.getByText('找不到可查看的本人站內請假紀錄，請確認單號、校園與登入帳號。')).toBeTruthy();
  vi.mocked(getMyLeaveRequest).mockResolvedValue(linkedRecord);
  fireEvent.click(screen.getByRole('button', { name: '重新查詢' }));
  expect(await screen.findByText('歷史課程')).toBeTruthy();
});

it('keeps a lookup failure distinct from missing and retries only that request', async () => {
  runtime.leaveApiEnabled = true;
  runtime.search = 'requestId=leave-2026-archive';
  vi.mocked(getMyLeaveRequest).mockRejectedValueOnce(new TypeError('Failed to fetch'));
  render(<LeavePage />);
  const panel = screen.getByRole('region', { name: '這筆請假紀錄' });
  expect(await within(panel).findByText(LEAVE_COPY.network)).toBeTruthy();
  expect(within(panel).queryByText(/找不到可查看/)).toBeNull();
  vi.mocked(getMyLeaveRequest).mockResolvedValue(linkedRecord);
  fireEvent.click(within(panel).getByRole('button', { name: '重試' }));
  expect(await within(panel).findByText('歷史課程')).toBeTruthy();
  expect(listMyLeaveRequests).toHaveBeenCalledTimes(1);
});

it('shows an inaccessible lookup without deciding whether the request exists', async () => {
  runtime.leaveApiEnabled = true;
  runtime.search = 'requestId=leave-2026-archive';
  vi.mocked(getMyLeaveRequest).mockRejectedValueOnce({ code: 'permission-denied' });
  render(<LeavePage />);
  const panel = screen.getByRole('region', { name: '這筆請假紀錄' });
  expect(await within(panel).findByText('目前無法讀取這筆站內請假紀錄，請確認單號、校園與登入帳號。')).toBeTruthy();
  expect(within(panel).queryByText(/找不到可查看/)).toBeNull();
  vi.mocked(getMyLeaveRequest).mockResolvedValue(linkedRecord);
  fireEvent.click(within(panel).getByRole('button', { name: '重新查詢' }));
  expect(await within(panel).findByText('歷史課程')).toBeTruthy();
});

it.each(['requestId=../other', 'requestId=', 'schoolId=../pu&requestId=leave-2026-archive'])(
  'rejects an invalid lookup URL without reading a request %s', async (search) => {
    runtime.leaveApiEnabled = true;
    runtime.search = search;
    render(<LeavePage />);
    expect(screen.getByText('請假連結中的單號或校園格式不正確，請重新從通知開啟。')).toBeTruthy();
    await screen.findByText(LEAVE_COPY.emptySubmit);
    expect(getMyLeaveRequest).not.toHaveBeenCalled();
  },
);

it('does not query the wrong selected school and offers the canonical school link', async () => {
  runtime.leaveApiEnabled = true;
  runtime.schoolId = 'ntu';
  runtime.search = 'campus=ntu&schoolId=pu&requestId=leave-2026-archive';
  render(<LeavePage />);
  expect(screen.getByRole('link', { name: '切換至通知校園查詢' }).getAttribute('href')).toBe('/leave?schoolId=pu&requestId=leave-2026-archive');
  await screen.findByText(LEAVE_COPY.emptySubmit);
  expect(getMyLeaveRequest).not.toHaveBeenCalled();
});

it('preserves the school and request when login is required', () => {
  runtime.user = null;
  runtime.search = 'schoolId=pu&requestId=leave-2026-archive';
  render(<LeavePage />);
  expect(screen.getByRole('link', { name: '需要學校帳號' }).getAttribute('href')).toBe(
    '/login?returnUrl=' + encodeURIComponent('/leave?' + runtime.search),
  );
  expect(getMyLeaveRequest).not.toHaveBeenCalled();
});

it('preserves the lookup URL when the request read reports an expired session', async () => {
  runtime.leaveApiEnabled = true;
  runtime.search = 'schoolId=pu&requestId=leave-2026-archive';
  vi.mocked(getMyLeaveRequest).mockRejectedValue({ code: 'functions/unauthenticated' });
  render(<LeavePage />);
  const panel = screen.getByRole('region', { name: '這筆請假紀錄' });
  expect(await within(panel).findByText(LEAVE_COPY.unauthorized)).toBeTruthy();
  expect(within(panel).getByRole('link', { name: LEAVE_COPY.login }).getAttribute('href')).toBe(
    '/login?returnUrl=' + encodeURIComponent('/leave?' + runtime.search),
  );
});

it('discards an older lookup after navigating to another request', async () => {
  runtime.leaveApiEnabled = true;
  runtime.search = 'requestId=leave-2026-archive';
  let resolve!: (value: typeof linkedRecord) => void;
  vi.mocked(getMyLeaveRequest).mockReturnValueOnce(new Promise((done) => { resolve = done; }));
  const page = render(<LeavePage />);
  runtime.search = 'requestId=leave-2026-current';
  vi.mocked(getMyLeaveRequest).mockResolvedValue(null);
  page.rerender(<LeavePage />);
  await screen.findByText('找不到可查看的本人站內請假紀錄，請確認單號、校園與登入帳號。');
  await act(async () => resolve(linkedRecord));
  expect(screen.queryByText('歷史課程')).toBeNull();
  expect(screen.queryByText('站內單號 leave-2026-archive')).toBeNull();
  expect(screen.getByText('站內單號 leave-2026-current')).toBeTruthy();
});

it('is rendered at request time so the runtime switch is not baked at build', () => {
  expect(dynamic).toBe('force-dynamic');
  expect(revalidate).toBe(0);
});

it('shows only the unavailable copy when the leave API is off', async () => {
  runtime.search = 'requestId=leave-2026-archive';
  render(<LeavePage />);
  expectOnly(LEAVE_COPY.unavailableSubmit);
  expect(listMyLeaveRequests).not.toHaveBeenCalled();
  expect(loadPersonalTimetable).not.toHaveBeenCalled();
  expect(getMyLeaveRequest).not.toHaveBeenCalled();
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
