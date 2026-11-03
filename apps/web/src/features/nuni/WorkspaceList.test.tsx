import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { NuniError, type NuniWorkspace } from '@campus/shared/src/nuni';
import { WorkspaceList } from './WorkspaceList';

const state = vi.hoisted(() => ({
  request: vi.fn(),
  refresh: vi.fn(),
  push: vi.fn(),
  /** 設為固定參數時，模擬 replaceState 不會更新 useSearchParams 的真實行為 */
  fixedSearchParams: null as string | null,
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: state.push }),
  useSearchParams: () =>
    new URLSearchParams(state.fixedSearchParams ?? window.location.search),
}));
vi.mock('./Session', () => ({
  browserRequest: state.request,
  useNuniSession: () => ({
    session: {
      context: 'session-a',
      platformAccountId: 'pa_11111111-1111-4111-8111-111111111111',
    },
    refresh: state.refresh,
    pendingLogout: false,
  }),
}));
vi.mock('./StudyAgenda', () => ({ StudyAgenda: () => <section aria-label="課業待辦測試" /> }));
vi.mock('./CourseMaterialSearch', () => ({ CourseMaterialSearch: () => <p>教材檢索</p> }));

const memberships: NuniWorkspace[] = [
  {
    id: 'cw_11111111-1111-4111-8111-111111111111',
    title: 'Data 資料庫系統',
    state: 'active',
    memberRole: 'student',
  },
  {
    id: 'cw_22222222-2222-4222-8222-222222222222',
    title: '互動設計',
    state: 'active',
    memberRole: 'owner-teacher',
  },
  {
    id: 'cw_33333333-3333-4333-8333-333333333333',
    title: '研究方法',
    state: 'active',
    memberRole: 'co-teacher',
  },
  {
    id: 'cw_44444444-4444-4444-8444-444444444444',
    title: '資料庫入門',
    state: 'archived',
    memberRole: 'student',
  },
];

beforeEach(() => {
  state.fixedSearchParams = null;
  window.history.replaceState({}, '', '/classroom');
  state.push.mockReset();
  state.refresh.mockReset();
  state.request.mockReset().mockImplementation(async (path: string) => {
    if (path === 'class-workspaces') return { workspaces: memberships };
    throw new Error(`Unexpected request: ${path}`);
  });
});

it('keeps the device bookmark list reachable even with no current courses', async () => {
  state.request.mockResolvedValue({ workspaces: [] });
  render(<WorkspaceList />);
  expect(screen.getByRole('link', { name: '查看收藏的教材' }).getAttribute('href'))
    .toBe('/classroom/material-bookmarks');
  await waitFor(() => expect(state.request).toHaveBeenCalledTimes(1));
});

it('carries the current course search and filters into device bookmarks without unrelated parameters', async () => {
  window.history.replaceState({}, '', '/classroom?campus=tw-pu&q=Data&courses=studying&task=feedback&taskCourse=course-a&view=members&returnTo=https%3A%2F%2Fexample.test');
  render(<WorkspaceList />);
  await screen.findByRole('link', { name: /Data 資料庫系統/ });
  fireEvent.change(screen.getByRole('searchbox', { name: '搜尋課程名稱' }), {
    target: { value: '資料庫' },
  });
  const href = screen.getByRole('link', { name: '查看收藏的教材' }).getAttribute('href')!;
  const destination = new URL(href, window.location.origin);
  expect(destination.pathname).toBe('/classroom/material-bookmarks');
  expect(Object.fromEntries(destination.searchParams)).toEqual({
    campus: 'tw-pu', q: '資料庫', courses: 'studying', task: 'feedback', taskCourse: 'course-a',
  });
});

it('combines role, archive and normalized name search, then clears an empty result back to active courses', async () => {
  render(<WorkspaceList />);
  await screen.findByRole('link', { name: /Data 資料庫系統/ });
  expect(screen.queryByRole('link', { name: /資料庫入門/ })).toBeNull();
  const filters = within(screen.getByRole('group', { name: '篩選課程' }));
  fireEvent.click(filters.getByRole('button', { name: /我教的課/ }));
  expect(screen.getByRole('link', { name: /互動設計/ })).toBeTruthy();
  expect(screen.getByRole('link', { name: /研究方法/ })).toBeTruthy();
  expect(screen.queryByRole('link', { name: /Data 資料庫系統/ })).toBeNull();
  fireEvent.click(filters.getByRole('button', { name: /已封存/ }));
  expect(screen.getByRole('link', { name: /資料庫入門/ })).toBeTruthy();
  expect(screen.queryByRole('link', { name: /互動設計/ })).toBeNull();
  fireEvent.click(filters.getByRole('button', { name: /我修的課/ }));
  fireEvent.change(screen.getByRole('searchbox', { name: '搜尋課程名稱' }), {
    target: { value: 'ｄａｔａ' },
  });
  expect(screen.getByRole('link', { name: /Data 資料庫系統/ })).toBeTruthy();
  fireEvent.change(screen.getByRole('searchbox', { name: '搜尋課程名稱' }), {
    target: { value: '不存在的課程' },
  });
  expect(screen.getByRole('heading', { name: '找不到「不存在的課程」' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '全部課程' }));
  expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('');
  expect(screen.getByRole('link', { name: /Data 資料庫系統/ })).toBeTruthy();
  expect(screen.getByRole('link', { name: /互動設計/ })).toBeTruthy();
  expect(screen.getByRole('link', { name: /研究方法/ })).toBeTruthy();
  expect(screen.queryByRole('link', { name: /資料庫入門/ })).toBeNull();
  expect(new URLSearchParams(window.location.search).has('courses')).toBe(false);
  expect(new URLSearchParams(window.location.search).has('q')).toBe(false);
  expect(state.request).toHaveBeenCalledTimes(1);
});

it('prefilters from /classroom?q=&from=timetable with unique, multi and zero match states', async () => {
  window.history.replaceState(
    {},
    '',
    '/classroom?q=%E4%BA%92%E5%8B%95%E8%A8%AD%E8%A8%88&from=timetable',
  );
  const unique = render(<WorkspaceList />);
  expect((await screen.findByTestId('classroom-query-status-unique')).textContent).toBe(
    '剛好找到「互動設計」這門課',
  );
  expect(screen.getByTestId('classroom-query-unique').getAttribute('aria-current')).toBe('page');
  expect(screen.getByText(/· 課表對應/)).toBeTruthy();
  expect(screen.queryByRole('link', { name: /Data 資料庫系統/ })).toBeNull();
  unique.unmount();

  state.request.mockResolvedValue({
    workspaces: [
      ...memberships,
      {
        id: 'cw_55555555-5555-4555-8555-555555555555',
        title: '進階資料庫',
        state: 'active',
        memberRole: 'student',
      },
    ],
  });
  window.history.replaceState(
    {},
    '',
    '/classroom?q=%E8%B3%87%E6%96%99%E5%BA%AB&from=timetable',
  );
  const multi = render(<WorkspaceList />);
  expect((await screen.findByTestId('classroom-query-status-multi')).textContent).toBe(
    '「資料庫」找到 2 門課程',
  );
  expect(screen.getByRole('link', { name: /Data 資料庫系統/ })).toBeTruthy();
  expect(screen.getByRole('link', { name: /進階資料庫/ })).toBeTruthy();
  expect(screen.queryByRole('link', { name: /互動設計/ })).toBeNull();
  multi.unmount();

  window.history.replaceState(
    {},
    '',
    '/classroom?q=%E4%B8%8D%E5%AD%98%E5%9C%A8&from=timetable',
  );
  render(<WorkspaceList />);
  const empty = await screen.findByTestId('classroom-query-none');
  expect(within(empty).getByRole('heading', { name: '找不到「不存在」' })).toBeTruthy();
  expect(
    within(empty).getByText(/課表上的這門課尚未對應到課程空間/),
  ).toBeTruthy();
  expect(within(empty).getByRole('button', { name: '全部課程' })).toBeTruthy();
  expect(within(empty).getByRole('button', { name: '加入課程' })).toBeTruthy();
});

it('keeps manual search as substring and omits timetable attribution copy', async () => {
  render(<WorkspaceList />);
  await screen.findByRole('link', { name: /Data 資料庫系統/ });
  fireEvent.change(screen.getByRole('searchbox', { name: '搜尋課程名稱' }), {
    target: { value: 'Data 資料' },
  });
  expect(screen.getByRole('link', { name: /Data 資料庫系統/ })).toBeTruthy();
  expect(screen.queryByText(/· 課表對應/)).toBeNull();
  expect(screen.queryByText(/剛好找到/)).toBeNull();

  fireEvent.change(screen.getByRole('searchbox', { name: '搜尋課程名稱' }), {
    target: { value: '不存在的課程' },
  });
  const empty = await screen.findByTestId('classroom-query-none');
  expect(within(empty).getByText('換個課程關鍵字，或清除篩選再找一次。')).toBeTruthy();
  expect(within(empty).queryByText(/課表上的這門課/)).toBeNull();
  expect(within(empty).queryByRole('button', { name: '加入課程' })).toBeNull();
});

it('hits a unique course when timetable q carries name plus course code', async () => {
  state.request.mockResolvedValue({
    workspaces: [
      {
        id: 'cw_55555555-5555-4555-8555-555555555555',
        title: '資料庫系統',
        state: 'active',
        memberRole: 'student',
      },
      {
        id: 'cw_66666666-6666-4666-8666-666666666666',
        title: '互動設計',
        state: 'active',
        memberRole: 'student',
      },
    ],
  });
  window.history.replaceState(
    {},
    '',
    '/classroom?q=%E8%B3%87%E6%96%99%E5%BA%AB%E7%B3%BB%E7%B5%B1&from=timetable&code=CS301',
  );
  render(<WorkspaceList />);
  expect(await screen.findByTestId('classroom-query-unique')).toBeTruthy();
  expect(screen.getByRole('link', { name: /資料庫系統/ })).toBeTruthy();
  expect(screen.queryByRole('link', { name: /互動設計/ })).toBeNull();
  expect(screen.getByText(/· 課表對應/)).toBeTruthy();
});

it('clears timetable attribution copy after the user edits search from from=timetable', async () => {
  window.history.replaceState(
    {},
    '',
    '/classroom?q=%E4%BA%92%E5%8B%95%E8%A8%AD%E8%A8%88&from=timetable',
  );
  render(<WorkspaceList />);
  expect(await screen.findByTestId('classroom-query-unique')).toBeTruthy();
  expect(screen.getByText(/· 課表對應/)).toBeTruthy();

  fireEvent.change(screen.getByRole('searchbox', { name: '搜尋課程名稱' }), {
    target: { value: '不存在的課程' },
  });
  const empty = await screen.findByTestId('classroom-query-none');
  expect(within(empty).getByText('換個課程關鍵字，或清除篩選再找一次。')).toBeTruthy();
  expect(within(empty).queryByText(/課表上的這門課/)).toBeNull();
  expect(screen.queryByText(/· 課表對應/)).toBeNull();
  expect(new URLSearchParams(window.location.search).get('from')).toBeNull();
  expect(new URLSearchParams(window.location.search).get('code')).toBeNull();
});

it('drops timetable attribution after search edit when useSearchParams stays stale after replaceState', async () => {
  const stale =
    'q=%E5%B9%BD%E9%9D%88%E8%AA%B2%E8%A1%A8%E8%AA%B2&from=timetable&code=ZZ999';
  state.fixedSearchParams = stale;
  window.history.replaceState({}, '', `/classroom?${stale}`);
  const view = render(<WorkspaceList />);
  const attributed = await screen.findByTestId('classroom-query-none');
  expect(within(attributed).getByText(/課表上的這門課尚未對應到課程空間/)).toBeTruthy();
  expect(within(attributed).getByRole('button', { name: '加入課程' })).toBeTruthy();

  fireEvent.change(screen.getByRole('searchbox', { name: '搜尋課程名稱' }), {
    target: { value: '另一個關鍵字' },
  });
  const empty = await screen.findByTestId('classroom-query-none');
  expect(within(empty).getByRole('heading', { name: '找不到「另一個關鍵字」' })).toBeTruthy();
  expect(within(empty).getByText('換個課程關鍵字，或清除篩選再找一次。')).toBeTruthy();
  expect(within(empty).queryByText(/課表上的這門課/)).toBeNull();
  expect(within(empty).queryByRole('button', { name: '加入課程' })).toBeNull();
  expect(new URLSearchParams(window.location.search).get('from')).toBeNull();
  expect(new URLSearchParams(window.location.search).get('code')).toBeNull();
  // 固定 mock 仍帶 from／code，確認畫面已不依賴它
  expect(state.fixedSearchParams).toContain('from=timetable');

  act(() => {
    state.fixedSearchParams =
      'q=%E4%BA%92%E5%8B%95%E8%A8%AD%E8%A8%88&from=timetable&code=ID201';
    window.history.replaceState(
      {},
      '',
      '/classroom?q=%E4%BA%92%E5%8B%95%E8%A8%AD%E8%A8%88&from=timetable&code=ID201',
    );
    view.rerender(<WorkspaceList />);
  });
  expect(await screen.findByTestId('classroom-query-unique')).toBeTruthy();
  expect(screen.getByText(/· 課表對應/)).toBeTruthy();
});

it('restores URL filters and keeps campus, search and task context in course navigation', async () => {
  window.history.replaceState(
    {},
    '',
    '/classroom?campus=tw-pu&q=Data&courses=studying&task=feedback',
  );
  const view = render(<WorkspaceList />);
  const course = await screen.findByRole('link', { name: /Data 資料庫系統/ });
  const destination = new URL(course.getAttribute('href')!, window.location.origin);
  expect(destination.pathname).toBe(`/classroom/course/${memberships[0].id}`);
  expect(Object.fromEntries(destination.searchParams)).toMatchObject({
    campus: 'tw-pu',
    q: 'Data',
    courses: 'studying',
    task: 'feedback',
  });
  expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('Data');
  act(() => {
    window.history.replaceState({}, '', '/classroom?campus=tw-pu&q=互動&courses=teaching');
    view.rerender(<WorkspaceList />);
  });
  expect(await screen.findByRole('link', { name: /互動設計/ })).toBeTruthy();
  expect(screen.queryByRole('link', { name: /Data 資料庫系統/ })).toBeNull();
  expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('互動');
  expect(state.request).toHaveBeenCalledTimes(1);
});

it.each([
  { status: 503, retains: true },
  { status: 403, retains: false },
])(
  'handles refresh status $status without showing unverified course access',
  async ({ status, retains }) => {
    render(<WorkspaceList />);
    await screen.findByRole('link', { name: /Data 資料庫系統/ });
    state.request.mockRejectedValue(new NuniError(status, 'ACCESS_FAILURE'));
    fireEvent.click(screen.getByRole('button', { name: '更新課程' }));
    const alert = await screen.findByRole('alert');
    await waitFor(() => expect(screen.getByRole('button', { name: '更新課程' })).toBeTruthy());
    expect(Boolean(screen.queryByRole('link', { name: /Data 資料庫系統/ }))).toBe(retains);
    expect(Boolean(screen.queryByRole('region', { name: '課業待辦測試' }))).toBe(retains);
    expect(alert.textContent?.includes('已保留目前的課程清單')).toBe(retains);
  },
);

it('retains both form drafts across toggles and normalizes only the submitted invitation code', async () => {
  render(<WorkspaceList />);
  await screen.findByRole('link', { name: /Data 資料庫系統/ });
  fireEvent.click(screen.getByRole('button', { name: '加入課程' }));
  fireEvent.change(screen.getByLabelText('邀請碼'), { target: { value: 'ab-cd ef' } });
  fireEvent.click(screen.getByRole('button', { name: '我要開課' }));
  fireEvent.change(screen.getByLabelText('課程名稱'), { target: { value: '尚未建立的專題' } });
  fireEvent.click(screen.getByRole('button', { name: '加入課程' }));
  expect((screen.getByLabelText('邀請碼') as HTMLInputElement).value).toBe('ab-cd ef');
  fireEvent.click(screen.getByRole('button', { name: '我要開課' }));
  expect((screen.getByLabelText('課程名稱') as HTMLInputElement).value).toBe('尚未建立的專題');
  fireEvent.click(screen.getByRole('button', { name: '加入課程' }));
  state.request.mockResolvedValueOnce(memberships[0]);
  fireEvent.submit(screen.getByRole('button', { name: '確認加入' }).closest('form')!);
  await waitFor(() => expect(state.push).toHaveBeenCalledTimes(1));
  expect(state.request).toHaveBeenLastCalledWith(
    'class-workspaces/join',
    'session-a',
    expect.objectContaining({ code: 'ABCDEF', idempotencyKey: expect.any(String) }),
  );
  expect((screen.getByLabelText('課程名稱') as HTMLInputElement).value).toBe('尚未建立的專題');
});
