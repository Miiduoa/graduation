import { Suspense } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import GroupsPage from './page';
import ClubsPage from '../clubs/page';
import { FunctionsUnconfiguredError } from '@/lib/functionsUrl';
import { clubEnabled } from './clubService';
import { joinByCode, leaveMemberGroup, loadMyGroups, type MemberGroup } from './groupService';

const account = vi.hoisted(() => ({
  user: { uid: 'alice' } as { uid: string } | null,
  loading: false,
}));
vi.mock('@/components/AuthGuard', () => ({ useAuth: () => account }));
vi.mock('@/components/SiteShell', () => ({
  SiteShell: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));
vi.mock('./groupService', () => ({
  joinByCode: vi.fn(),
  leaveMemberGroup: vi.fn(),
  loadMyGroups: vi.fn(),
}));
vi.mock('./clubService', () => ({ clubEnabled: vi.fn() }));
const course: MemberGroup = {
  id: 'firestore-course',
  schoolId: 'pu',
  name: '本人課程群組',
  description: '讀書討論',
  type: 'course',
  role: 'member',
  memberCount: null,
};
const club: MemberGroup = {
  id: 'firestore-club',
  schoolId: 'pu',
  name: '本人社團',
  description: '每週練習',
  type: 'club',
  role: 'member',
  memberCount: 8,
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((finish) => {
    resolve = finish;
  });
  return { promise, resolve };
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(clubEnabled).mockReturnValue(false);
  account.user = { uid: 'alice' };
  account.loading = false;
  vi.mocked(loadMyGroups).mockResolvedValue([course, club]);
  vi.mocked(joinByCode).mockResolvedValue({ ...club, id: 'new-club', name: '新加入社團' });
  vi.mocked(leaveMemberGroup).mockResolvedValue(undefined);
});

it('requires a real account even with an old administrator demo role', () => {
  localStorage.setItem('demoRole', 'admin');
  account.user = null;
  render(<GroupsPage />);
  expect(screen.getByRole('link', { name: '登入學校帳號' })).toBeTruthy();
  expect(loadMyGroups).not.toHaveBeenCalled();
  expect(screen.queryByText(/王大明|資料結構|未讀訊息/)).toBeNull();
});

it('uses real group IDs for course navigation, actual counts only, and no fake unread messages', async () => {
  render(<GroupsPage />);
  await screen.findByText('本人課程群組 ↗');
  expect(loadMyGroups).toHaveBeenCalledWith('alice', 'pu');
  expect(screen.getByRole('link', { name: '查看課程' }).getAttribute('href')).toBe(
    '/course/firestore-course?schoolId=pu',
  );
  expect(screen.getByText('8 位成員')).toBeTruthy();
  expect(screen.queryByText('0 位成員')).toBeNull();
  expect(screen.queryByText(/未讀|最後訊息|王大明/)).toBeNull();
  fireEvent.change(screen.getByLabelText('類型'), { target: { value: 'club' } });
  expect(screen.queryByText('本人課程群組 ↗')).toBeNull();
  expect(screen.getByText('本人社團')).toBeTruthy();
  fireEvent.change(screen.getByLabelText('搜尋群組'), { target: { value: '不存在' } });
  expect(screen.getByText('沒有符合條件的結果')).toBeTruthy();
});

it('社團分段只顯示真實會籍，找社團使用鎖定空態且沒有入社操作', async () => {
  render(<ClubsPage />);
  await screen.findByText('本人社團');
  expect(screen.queryByText('本人課程群組 ↗')).toBeNull();
  expect(screen.queryByText(/社團公開列表尚未開放/)).toBeNull();
  expect(screen.getByRole('link', { name: '查看社團' }).getAttribute('href')).toBe(
    '/groups/firestore-club/club/overview?schoolId=pu',
  );
  expect(screen.getByLabelText('邀請碼')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '找社團' }));
  expect(screen.getByText('學校還沒提供社團名單。')).toBeTruthy();
  expect(screen.queryByRole('heading', { name: '本人社團' })).toBeNull();
  expect(screen.queryByRole('button', { name: '加入群組' })).toBeNull();
  expect(screen.queryByRole('link', { name: '查看社團' })).toBeNull();
  expect(joinByCode).not.toHaveBeenCalled();
  expect(screen.queryByRole('button', { name: /申請|核准|管理成員/ })).toBeNull();
});

it('社團搜尋與未加入空態不使用假資料', async () => {
  render(<ClubsPage />);
  await screen.findByText('本人社團');
  fireEvent.change(screen.getByLabelText('搜尋我的社團'), { target: { value: '不存在' } });
  expect(screen.getByText('沒有符合條件的結果')).toBeTruthy();
  expect(screen.queryByText(/程式設計社|王小明/)).toBeNull();
});

it('沒有會籍時引導找社團，沒有錯誤的零人數', async () => {
  vi.mocked(loadMyGroups).mockResolvedValue([]);
  render(<ClubsPage />);
  await screen.findByText('還沒加入社團，可以到「找社團」看看。');
  expect(screen.queryByRole('article')).toBeNull();
});

it('never fills an empty or failed source with demo groups', async () => {
  vi.mocked(loadMyGroups).mockRejectedValueOnce(new Error('offline'));
  render(<GroupsPage />);
  await screen.findByRole('alert');
  expect(screen.queryByRole('article')).toBeNull();
  vi.mocked(loadMyGroups).mockResolvedValueOnce([]);
  fireEvent.click(screen.getByRole('button', { name: '重新讀取' }));
  await screen.findByText('尚未加入群組');
  expect(screen.queryByRole('article')).toBeNull();
});

it.each([GroupsPage, ClubsPage])(
  'does not show joined or send duplicate mutations before the verified response resolves',
  async (Page) => {
    const operation = deferred<MemberGroup>();
    vi.mocked(joinByCode).mockReturnValueOnce(operation.promise);
    render(<Page />);
    await screen.findByText('本人社團');
    fireEvent.change(screen.getByLabelText('邀請碼'), { target: { value: 'ABC12345' } });
    const form = screen.getByRole('button', { name: '加入群組' }).closest('form')!;
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(joinByCode).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('已加入「新加入社團」。')).toBeNull();
    await act(async () => operation.resolve({ ...club, id: 'new-club', name: '新加入社團' }));
    expect(screen.getByText('已加入「新加入社團」。')).toBeTruthy();
    expect(screen.getByText('新加入社團')).toBeTruthy();
  },
);

it('shows that join is not enabled instead of asking the member to retry', async () => {
  vi.mocked(joinByCode).mockRejectedValueOnce(
    new FunctionsUnconfiguredError('加入與退出群組尚未啟用'),
  );
  render(<GroupsPage />);
  await screen.findByText('本人社團');
  fireEvent.change(screen.getByLabelText('邀請碼'), { target: { value: 'ABC12345' } });
  fireEvent.click(screen.getByRole('button', { name: '加入群組' }));
  expect(await screen.findByText('加入與退出群組尚未啟用')).toBeTruthy();
  expect(screen.queryByText(/請先更新列表確認成員狀態，再決定是否重試/)).toBeNull();
  expect((screen.getByRole('button', { name: '加入群組' }) as HTMLButtonElement).disabled).toBe(
    false,
  );
});

it('requires a fresh server read after an unconfirmed mutation instead of allowing blind resubmission', async () => {
  vi.mocked(joinByCode).mockRejectedValueOnce(new Error('unconfirmed'));
  render(<GroupsPage />);
  await screen.findByText('本人社團');
  fireEvent.change(screen.getByLabelText('邀請碼'), { target: { value: 'ABC12345' } });
  fireEvent.click(screen.getByRole('button', { name: '加入群組' }));
  await screen.findByRole('alert');
  expect((screen.getByRole('button', { name: '加入群組' }) as HTMLButtonElement).disabled).toBe(
    true,
  );
  expect(screen.queryByText('已加入「新加入社團」。')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '更新列表' }));
  await screen.findByText('本人社團');
  expect((screen.getByRole('button', { name: '加入群組' }) as HTMLButtonElement).disabled).toBe(
    false,
  );
});

it.each([GroupsPage, ClubsPage])(
  'confirms leaving and waits for the verified result before removing the group',
  async (Page) => {
    vi.mocked(loadMyGroups).mockResolvedValue([club]);
    const operation = deferred<void>();
    vi.mocked(leaveMemberGroup).mockReturnValueOnce(operation.promise);
    render(<Page />);
    await screen.findByText('本人社團');
    fireEvent.click(screen.getByRole('button', { name: '退出群組' }));
    expect(leaveMemberGroup).not.toHaveBeenCalled();
    const confirm = screen.getByRole('button', { name: '確認退出' });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    expect(leaveMemberGroup).toHaveBeenCalledTimes(1);
    expect(screen.getByText('本人社團')).toBeTruthy();
    await act(async () => operation.resolve());
    expect(screen.queryByRole('article')).toBeNull();
    expect(screen.getByText('已退出「本人社團」。')).toBeTruthy();
  },
);

it.each([GroupsPage, ClubsPage])(
  'does not offer leave to the owner and surfaces the real ownership transfer action',
  async (Page) => {
    vi.mocked(loadMyGroups).mockResolvedValue([{ ...club, role: 'owner' }]);
    render(<Page />);
    await screen.findByText('本人社團');
    expect(screen.queryByRole('button', { name: '退出群組' })).toBeNull();
    expect(screen.getByText(/須先完成擁有權轉讓/)).toBeTruthy();
    expect(screen.getByRole('button', { name: '轉讓擁有權' })).toBeTruthy();
  },
);

it('links club and study groups to the real discussion page instead of an App-only stub', async () => {
  render(<GroupsPage />);
  await screen.findByText('本人社團');
  const discussion = screen.getAllByRole('link', { name: '開啟討論' });
  expect(
    discussion.some((link) => link.getAttribute('href') === '/groups/firestore-club?schoolId=pu'),
  ).toBe(true);
  expect(screen.queryByText('網頁版討論尚未開放。')).toBeNull();
});

it('removes the old account data and ignores its pending join result after switching accounts', async () => {
  const operation = deferred<MemberGroup>();
  vi.mocked(joinByCode).mockReturnValueOnce(operation.promise);
  const view = render(<GroupsPage />);
  await screen.findByText('本人社團');
  fireEvent.change(screen.getByLabelText('邀請碼'), { target: { value: 'ABC12345' } });
  fireEvent.click(screen.getByRole('button', { name: '加入群組' }));
  const currentScope = vi.mocked(joinByCode).mock.calls[0][3];
  const next = deferred<MemberGroup[]>();
  vi.mocked(loadMyGroups).mockReturnValueOnce(next.promise);
  account.user = { uid: 'bob' };
  view.rerender(<GroupsPage />);
  expect(screen.queryByText('本人社團')).toBeNull();
  expect(currentScope()).toBe(false);
  await act(async () => operation.resolve({ ...club, name: '舊帳號加入結果' }));
  expect(screen.queryByText('舊帳號加入結果')).toBeNull();
  await act(async () => next.resolve([]));
  expect(screen.getByText('尚未加入群組')).toBeTruthy();
  expect((screen.getByLabelText('邀請碼') as HTMLInputElement).value).toBe('');
});

it('discards an old response after logout and signing back into the same UID', async () => {
  const old = deferred<MemberGroup[]>();
  vi.mocked(loadMyGroups).mockReturnValueOnce(old.promise);
  const view = render(<GroupsPage />);
  account.user = null;
  view.rerender(<GroupsPage />);
  expect(screen.getByRole('link', { name: '登入學校帳號' })).toBeTruthy();
  account.user = { uid: 'alice' };
  view.rerender(<GroupsPage />);
  await screen.findByText('本人社團');
  await act(async () => old.resolve([{ ...club, name: '登出前晚回應' }]));
  expect(screen.queryByText('登出前晚回應')).toBeNull();
});

it('scopes both group results and form state to the selected school', async () => {
  const pu = Promise.resolve({ schoolId: 'pu' });
  const nthu = Promise.resolve({ schoolId: 'nthu' });
  let view!: ReturnType<typeof render>;
  await act(async () => {
    view = render(
      <Suspense>
        <GroupsPage searchParams={pu} />
      </Suspense>,
    );
  });
  await screen.findByText('本人社團');
  fireEvent.change(screen.getByLabelText('邀請碼'), { target: { value: 'OLD-CODE' } });
  vi.mocked(loadMyGroups).mockResolvedValueOnce([]);
  await act(async () => {
    view.rerender(
      <Suspense>
        <GroupsPage searchParams={nthu} />
      </Suspense>,
    );
  });
  await screen.findByText('尚未加入群組');
  expect(loadMyGroups).toHaveBeenLastCalledWith('alice', 'nthu');
  expect((screen.getByLabelText('邀請碼') as HTMLInputElement).value).toBe('');
  expect(screen.queryByText('本人社團')).toBeNull();
});

it.each([false, true])('社團後台入口沿用既有旗標：%s', async (enabled) => {
  vi.mocked(clubEnabled).mockReturnValue(enabled);
  render(<ClubsPage />);
  await screen.findByText('本人社團');
  expect(Boolean(screen.queryByText('這所學校還沒開放社團管理。'))).toBe(!enabled);
  const link = screen.queryByRole('link', { name: '社團後台' });
  if (enabled) expect(link?.getAttribute('href')).toBe('/groups/firestore-club/club?schoolId=pu');
  else expect(link).toBeNull();
});

it('加入確認期間切換分段，回到我的社團仍呈現已確認的結果', async () => {
  const operation = deferred<MemberGroup>();
  vi.mocked(joinByCode).mockReturnValueOnce(operation.promise);
  render(<ClubsPage />);
  await screen.findByText('本人社團');
  fireEvent.change(screen.getByLabelText('邀請碼'), { target: { value: 'ABC12345' } });
  fireEvent.click(screen.getByRole('button', { name: '加入群組' }));
  fireEvent.click(screen.getByRole('button', { name: '找社團' }));
  await act(async () => operation.resolve({ ...club, id: 'new-club', name: '新加入社團' }));
  fireEvent.click(screen.getByRole('button', { name: '我的社團' }));
  expect(screen.getByRole('heading', { name: '新加入社團' })).toBeTruthy();
  expect(screen.getByText('已加入「新加入社團」。')).toBeTruthy();
  expect(joinByCode).toHaveBeenCalledTimes(1);
  expect(loadMyGroups).toHaveBeenCalledTimes(1);
});
