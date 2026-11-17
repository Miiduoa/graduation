import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import DormitoryPage from './page';
import {
  emptyDormCloud,
  projectDormParcel,
  projectDormRepair,
  watchDormCloud,
  type DormCloudState,
} from '@campus/shared/src/dormitoryCloud';

const mock = vi.hoisted(() => ({
  uid: 'alice',
  school: 'pu',
  listeners: [] as Array<(state: DormCloudState) => void>,
  stops: [] as Array<ReturnType<typeof vi.fn>>,
}));
vi.mock('./cloud', () => ({
  subscribeDormCloud: vi.fn((_school, _uid, update) => {
    mock.listeners.push(update);
    const stop = vi.fn();
    mock.stops.push(stop);
    return stop;
  }),
}));
vi.mock('@/components/SiteShell', () => ({
  SiteShell: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}));
vi.mock('@/components/AuthGuard', () => ({
  useAuth: () => ({ user: { uid: mock.uid }, loading: false }),
}));
vi.mock('@/features/nuni/Session', () => ({ useOptionalNuniSession: () => null }));
vi.mock('@/lib/useCampusBrowseContext', () => ({
  useCampusBrowseContext: () => ({
    status: 'ready',
    schoolId: mock.school,
    schoolName: '靜宜大學',
  }),
}));
afterEach(() => {
  cleanup();
  localStorage.clear();
  mock.listeners = [];
  mock.stops = [];
  mock.uid = 'alice';
  mock.school = 'pu';
});
const state = (): DormCloudState => ({
  ...emptyDormCloud(),
  packagesState: 'ready',
  repairsState: 'ready',
});

it('renders cloud arrivals, separates registered mail, and presents a human-readable identity without claiming pickup', () => {
  render(<DormitoryPage />);
  const next = state();
  next.identity = { studentId: 'S123456', name: '王同學' };
  next.packages = [
    projectDormParcel('p1', {
      description: '家人寄的衣服',
      createdAt: Date.now() - 4 * 86400000,
      location: '希嘉學苑服務台',
      status: 'arrived',
    }),
    projectDormParcel('estimate', {
      description: '預估提醒包裹',
      arrivedAt: Date.now() - 2 * 86400000,
    }),
    projectDormParcel('p2', {
      description: '私密掛號信',
      courier: '中華郵政',
      location: '行政大樓收發室',
      status: 'arrived',
    }),
  ];
  act(() => mock.listeners[0](next));
  expect(
    within(screen.getByRole('region', { name: '今晚宿舍' })).getByText(/待領包裹 2 件/),
  ).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '包裹領取' }));
  expect(screen.getByText('家人寄的衣服')).toBeTruthy();
  expect(screen.getByText('已到件多日，請確認領取期限')).toBeTruthy();
  expect(screen.getByText('預估明天起可能退件（依到件日加三天推算，實際期限以宿舍公告為準）')).toBeTruthy();
  expect(screen.queryByText(/登錄退件／領取期限/)).toBeNull();
  expect(screen.getByText('掛號包裹請看收發室公告')).toBeTruthy();
  expect(screen.queryByText('私密掛號信')).toBeNull();
  expect(screen.getByRole('heading', { name: '我自己記的' })).toBeTruthy();
  fireEvent.click(screen.getAllByRole('button', { name: '領取碼' })[0]);
  const identity = within(screen.getByRole('dialog', { name: '領取碼' }));
  expect(identity.getByText('S123456').style.fontSize).toBe('34px');
  expect(identity.getByText('王同學').style.fontSize).toBe('34px');
  expect(identity.getByText(/不是取件密碼/)).toBeTruthy();
  expect(document.body.textContent).not.toMatch(/已送出|單號|你抽中了|通行證|已扣款/);
  fireEvent.click(screen.getByRole('button', { name: '關閉領取碼' }));
  expect(screen.queryByRole('dialog')).toBeNull();
});

it.each([
  ['2026-11-20T02:00:00Z', '2026/11/20 10:00:00'],
  ['2026-11-15T02:00:00Z', '2026/11/15 10:00:00'],
])('有登錄期限 %s 時，包裹卡片顯示台灣日期，不使用三天推算', (pickupDeadline, date) => {
  render(<DormitoryPage />);
  act(() => mock.listeners[0]({
    ...state(),
    packages: [projectDormParcel('official', {
      description: '有登錄期限的包裹',
      arrivedAt: Date.now() - 2 * 86400000,
      pickupDeadline,
    })],
  }));
  fireEvent.click(screen.getByRole('button', { name: '包裹領取' }));
  expect(screen.getByText(`登錄退件／領取期限：${date}（台灣時間）`)).toBeTruthy();
  expect(screen.queryByText(/預估|依到件日加三天推算|已到件多日|已退件/)).toBeNull();
});

it.each(['picked_up', 'returned'])('包裹狀態 %s 不顯示待退件提示', (status) => {
  render(<DormitoryPage />);
  act(() => mock.listeners[0]({
    ...state(),
    packages: [projectDormParcel('completed', {
      description: '已處理的包裹',
      arrivedAt: Date.now() - 4 * 86400000,
      returnAt: '2026-11-15T02:00:00Z',
      status,
    })],
  }));
  fireEvent.click(screen.getByRole('button', { name: '包裹領取' }));
  expect(within(screen.getByRole('region', { name: '校方登錄包裹' })).getByText(status === 'returned' ? '已退件' : '已領取')).toBeTruthy();
  expect(screen.queryByText(/登錄退件／領取期限|預估|依到件日加三天推算|已到件多日/)).toBeNull();
});

it('updates repair status timestamps live, keeps private staff references out and clears school/account subscriptions', () => {
  const view = render(<DormitoryPage />);
  const next = state();
  next.repairs = [
    projectDormRepair('r1', {
      description: '冷氣不冷',
      status: 'in_progress',
      createdAt: 1700000000000,
      assignedAt: 1700000060000,
      in_progressAt: 1700000120000,
      reference: 'SECRET-REF',
      staffNote: 'PRIVATE',
    }),
  ];
  act(() => mock.listeners[0](next));
  fireEvent.click(screen.getByRole('button', { name: '設備問題' }));
  expect(screen.getByText(/備忘待處理 ·/)).toBeTruthy();
  expect(screen.getByText(/備忘標記：已指派 ·/)).toBeTruthy();
  expect(screen.getByText(/備忘標記：處理中 ·/)).toBeTruthy();
  expect(screen.queryByText(/SECRET-REF|PRIVATE/)).toBeNull();
  expect(document.body.textContent).not.toMatch(/已送出|單號/);
  mock.school = 'nthu';
  view.rerender(<DormitoryPage />);
  expect(mock.stops[0]).toHaveBeenCalled();
  expect(screen.queryByText('冷氣不冷')).toBeNull();
  mock.uid = 'bob';
  view.rerender(<DormitoryPage />);
  expect(mock.stops[1]).toHaveBeenCalled();
});

it('distinguishes loading, denied reads and the personal empty state without hiding local notes', () => {
  render(<DormitoryPage />);
  fireEvent.click(screen.getByRole('button', { name: '包裹領取' }));
  expect(screen.getByText('正在讀取包裹…')).toBeTruthy();
  act(() => mock.listeners[0]({ ...state(), packagesState: 'error' }));
  expect(screen.getByRole('alert').textContent).toContain('包裹讀取失敗');
  expect(screen.getByRole('alert').textContent).toContain('私有包裹暫時保留上次紀錄，可能尚未更新');
  expect(screen.queryByText('此處目前沒有顯示登錄給你的包裹；郵局包裹及掛號郵件請至櫃檯領取。')).toBeNull();
  act(() => mock.listeners[0](state()));
  expect(screen.getByText('此處目前沒有顯示登錄給你的包裹；郵局包裹及掛號郵件請至櫃檯領取。')).toBeTruthy();
  act(() => mock.listeners[0]({ ...state(), packages: [projectDormParcel('postal', { location: '郵局' })] }));
  expect(screen.getByText('此處目前沒有顯示登錄給你的包裹；郵局包裹及掛號郵件請至櫃檯領取。')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '總覽' }));
  expect(screen.getByText('今晚沒有待辦。')).toBeTruthy();
});

it('uses existing owner fields, ignores late updates after unsubscribe and never fabricates status times', () => {
  const rows: Record<string, (rows: Array<{ id: string; data: Record<string, unknown> }>) => void> =
    {};
  const watch = vi.fn((name, field, update) => {
    expect(field).toBe(name === 'packages' ? 'recipientId' : 'userId');
    rows[name] = update;
    return stop;
  });
  const stop = vi.fn();
  const update = vi.fn();
  const dispose = watchDormCloud(
    {
      watch,
      identity: (callback) => {
        callback(null);
        return stop;
      },
    },
    update,
  );
  rows.repairRequests([{ id: 'r', data: { status: 'completed', description: '檢查電燈' } }]);
  expect(update.mock.calls.at(-1)?.[0].repairs[0].steps).toEqual([
    { status: 'completed', at: null },
  ]);
  dispose();
  const count = update.mock.calls.length;
  rows.packages([{ id: 'late', data: { status: 'arrived' } }]);
  expect(update).toHaveBeenCalledTimes(count);
  expect(stop).toHaveBeenCalledTimes(3);
});

it('does not relabel a preexisting server-side personal memo as delivered to a counselor', () => {
  const memo = projectDormRepair('old', {
    description: '尚未正式通報的問題',
    status: 'pending',
    createdAt: 1700000000000,
  });
  expect(memo.status).toBe('pending');
  expect(memo.steps).toEqual([{ status: 'pending', at: 1700000000000 }]);
  const reopened = projectDormRepair('reopened', {
    description: '同一問題',
    status: 'pending',
    assignedAt: 1700000000000,
    pendingAt: 1700000060000,
  });
  expect(reopened.status).toBe('pending');
  expect(reopened.steps).toContainEqual({ status: 'pending', at: 1700000060000 });
});

it('shows cancellation time and excludes cancelled repairs from tonight tasks', () => {
  render(<DormitoryPage />);
  const cancelledAt = Date.UTC(2026, 10, 14, 8);
  const repair = projectDormRepair('cancelled', {
    description: '已取消的冷氣報修',
    status: 'cancelled',
    cancelledAt,
    reference: 'STAFF-ONLY',
  });
  expect(repair.status).toBe('cancelled');
  expect(repair.steps).toContainEqual({ status: 'cancelled', at: cancelledAt });
  act(() => mock.listeners[0]({ ...state(), repairs: [repair] }));
  expect(screen.queryByText(/報修備忘待辦/)).toBeNull();
  expect(screen.getByText('今晚沒有待辦。')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '設備問題' }));
  expect(screen.getByText(/備忘標記：已取消 ·/)).toBeTruthy();
  expect(screen.queryByText(/尚未確認輔導員接手|STAFF-ONLY/)).toBeNull();
});

it.each(['pending', 'assigned', 'in_progress', 'completed', 'closed', 'cancelled'])(
  'presents %s as a memo even with status timestamps',
  (status) => {
    render(<DormitoryPage />);
    act(() =>
      mock.listeners[0]({
        ...state(),
        repairs: [
          projectDormRepair('memo', {
            status,
            createdAt: 1700000000000,
            [status + 'At']: 1700000060000,
          }),
        ],
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: '設備問題' }));
    expect(screen.getByText(/此應用沒有將備忘送到學校/)).toBeTruthy();
    expect(document.body.textContent).toContain('備忘');
    expect(document.body.textContent).not.toMatch(/已送給輔導員|輔導員已收到|已安排維修|已修好/);
  },
);

it('projects formal tickets distinctly and retains every reopen timestamp', () => {
  const ticket = projectDormRepair('formal', {
    workflow: 'dorm_staff',
    status: 'pending',
    dormStatus: 'sent',
    title: '燈不亮',
    history: [
      { status: 'sent', at: 1000 },
      { status: 'fixed', at: 2000 },
      { status: 'sent', at: 3000 },
    ],
    schoolReference: 'A123',
    vendor: '維修人員',
  });
  expect(ticket.official).toBe(true);
  expect(ticket.status).toBe('sent');
  expect(ticket.steps.map((h) => h.at)).toEqual([1000, 2000, 3000]);
  expect(ticket).not.toHaveProperty('vendor');
});

it('polls the backend parcel projection and ignores late results after unsubscribe', async () => {
  const { pollDormParcels } = await import('@campus/shared/src/dormitoryCloud');
  let resolve!: (value: { rows: Array<{ id: string; data: Record<string, unknown> }> }) => void;
  const load = vi.fn(
    () =>
      new Promise<{ rows: Array<{ id: string; data: Record<string, unknown> }> }>((done) => {
        resolve = done;
      }),
  );
  const rows = vi.fn(),
    error = vi.fn();
  const stop = pollDormParcels(load, rows, error);
  expect(load).toHaveBeenCalledTimes(1);
  stop();
  resolve({ rows: [{ id: 'dw_synthetic', data: { description: '合成包裹' } }] });
  await Promise.resolve();
  expect(rows).not.toHaveBeenCalled();
  expect(error).not.toHaveBeenCalled();
});
