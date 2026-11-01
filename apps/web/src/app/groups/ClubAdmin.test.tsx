import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';
import { ClubBoard } from './ClubAdmin';
import { callClub } from './clubService';
vi.mock('./clubService', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./clubService')>()),
  callClub: vi.fn(),
  loadClubView: (...args: unknown[]) => callClub(...(args as Parameters<typeof callClub>)),
  clubEnabled: () => true,
}));
vi.mock('@/components/SiteShell', () => ({
  SiteShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('@/components/AuthGuard', () => ({ useAuth: () => ({}) }));
vi.mock('@/lib/useBrowsingSchoolPageContext', () => ({ useBrowsingSchoolPageContext: () => ({}) }));
const view = {
  success: true,
  role: 'member',
  members: [{ id: 'one', name: '測試社員', role: '社員' }],
  events: [],
};
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(callClub).mockResolvedValue(view);
});
test('社員空狀態沒有管理操作及私人欄位', async () => {
  render(<ClubBoard uid="one" schoolId="school" groupId="club" />);
  await screen.findByText('尚無活動');
  expect(screen.queryByText('學號')).toBeNull();
  expect(screen.queryByText('建立活動')).toBeNull();
  expect(screen.queryByText('匯出社員與活動 CSV')).toBeNull();
});
test('幹部看見名單與真實計數，報名後重讀伺服器資料', async () => {
  vi.mocked(callClub).mockResolvedValue({
    ...view,
    role: 'admin',
    events: [
      {
        id: 'event',
        title: '合成活動',
        location: '',
        startsAt: Date.now() + 3600000,
        endsAt: Date.now() + 7200000,
        registered: 2,
        checkedIn: 1,
        mine: false,
        registrations: [],
      },
    ],
  });
  render(<ClubBoard uid="one" schoolId="school" groupId="club" />);
  await screen.findByText('報名 2 人 · 簽到 1 人 · 簽到率 50%');
  expect(screen.getByText('學號')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: /^報名$/ }));
  await waitFor(() =>
    expect(callClub).toHaveBeenCalledWith('one', 'school', 'club', {
      action: 'register',
      eventId: 'event',
    }),
  );
  await screen.findByText('已由伺服器確認');
});
test('撤權後清除舊名單並顯示錯誤', async () => {
  render(<ClubBoard uid="one" schoolId="school" groupId="club" />);
  await screen.findByText('測試社員');
  vi.mocked(callClub).mockRejectedValue(new Error('身分失效'));
  fireEvent.click(screen.getByRole('button', { name: '重新整理' }));
  await screen.findByRole('alert');
  expect(screen.queryByText('測試社員')).toBeNull();
});

test('後端不可用時保留名單，活動不可冒充空資料或提供操作', async () => {
  vi.mocked(callClub).mockResolvedValue({ ...view, rosterOnly: true });
  render(<ClubBoard uid="one" schoolId="school" groupId="club" />);
  await screen.findByText('測試社員');
  expect(screen.getByText('活動後台暫時無法使用，社員名單仍可查閱。')).toBeTruthy();
  expect(screen.queryByText('尚無活動')).toBeNull();
  expect(screen.queryByText('建立活動')).toBeNull();
});

test('備援名單的會長與幹部角色以中文呈現', async () => {
  vi.mocked(callClub).mockResolvedValue({
    ...view,
    rosterOnly: true,
    members: [
      { id: 'one', name: '甲', role: 'owner' },
      { id: 'two', name: '乙', role: 'admin' },
    ],
  });
  render(<ClubBoard uid="one" schoolId="school" groupId="club" />);
  expect(await screen.findByText('會長')).toBeTruthy();
  expect(screen.getByText('幹部')).toBeTruthy();
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const privateView = {
  ...view,
  role: 'admin',
  members: [{ id: 'one', name: '舊社員', role: '社員', phone: '0912345678' }],
};

test('初次載入晚回不可覆蓋較新的刷新結果', async () => {
  const initial = deferred<typeof view>();
  vi.mocked(callClub).mockReturnValueOnce(initial.promise).mockResolvedValueOnce(view);
  render(<ClubBoard uid="one" schoolId="school" groupId="club" />);
  fireEvent.click(screen.getByRole('button', { name: '重新整理' }));
  await screen.findByText('測試社員');
  await act(async () => initial.resolve(privateView));
  expect(screen.queryByText('0912345678')).toBeNull();
  expect(screen.getByText('測試社員')).toBeTruthy();
  expect(screen.getByRole('status').textContent).toBe('已由伺服器確認');
});

test('刷新失權後，初次載入晚回不可恢復私人名單與管理操作', async () => {
  const initial = deferred<typeof view>();
  vi.mocked(callClub)
    .mockReturnValueOnce(initial.promise)
    .mockRejectedValueOnce(new Error('身分失效'));
  render(<ClubBoard uid="one" schoolId="school" groupId="club" />);
  fireEvent.click(screen.getByRole('button', { name: '重新整理' }));
  await screen.findByRole('alert');
  await act(async () => initial.resolve(privateView));
  expect(screen.queryByText('0912345678')).toBeNull();
  expect(screen.queryByText('社員名單')).toBeNull();
  expect(screen.queryByText('匯出社員與活動 CSV')).toBeNull();
  expect(screen.getByRole('alert').textContent).toBe('身分失效');
});

test('匯出使用最新快照，初次載入晚回不可覆蓋匯出結果', async () => {
  const initial = deferred<typeof view>();
  const exported = {
    ...privateView,
    members: [{ ...privateView.members[0], name: '最新社員' }],
    csv: '最新 CSV',
  };
  vi.mocked(callClub)
    .mockReturnValueOnce(initial.promise)
    .mockResolvedValueOnce(privateView)
    .mockResolvedValueOnce(exported);
  const createURL = vi.fn<(blob: Blob) => string>().mockReturnValue('blob:roster');
  vi.stubGlobal('URL', { createObjectURL: createURL, revokeObjectURL: vi.fn() });
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  try {
    render(<ClubBoard uid="one" schoolId="school" groupId="club" />);
    fireEvent.click(screen.getByRole('button', { name: '重新整理' }));
    await screen.findByText('已由伺服器確認');
    fireEvent.click(screen.getByRole('button', { name: '匯出社員與活動 CSV' }));
    await screen.findByText('最新社員');
    await act(async () => initial.resolve(privateView));
    expect(screen.queryByText('舊社員')).toBeNull();
    expect(screen.getByText('最新社員')).toBeTruthy();
    expect(createURL).toHaveBeenCalledTimes(1);
    const csv = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = reject;
      reader.readAsText(createURL.mock.calls[0][0]);
    });
    expect(csv).toBe('最新 CSV');
    expect(click).toHaveBeenCalledTimes(1);
  } finally {
    click.mockRestore();
    vi.unstubAllGlobals();
  }
});
