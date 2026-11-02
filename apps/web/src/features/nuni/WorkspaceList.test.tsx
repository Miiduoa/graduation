import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { NuniError, type NuniWorkspace } from '@campus/shared/src/nuni';
import { WorkspaceList } from './WorkspaceList';

const state = vi.hoisted(() => ({ request: vi.fn(), refresh: vi.fn(), push: vi.fn() }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: state.push }),
  useSearchParams: () => new URLSearchParams(window.location.search),
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
  fireEvent.click(screen.getByRole('button', { name: '查看所有進行中課程' }));
  expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('');
  expect(screen.getByRole('link', { name: /Data 資料庫系統/ })).toBeTruthy();
  expect(screen.getByRole('link', { name: /互動設計/ })).toBeTruthy();
  expect(screen.getByRole('link', { name: /研究方法/ })).toBeTruthy();
  expect(screen.queryByRole('link', { name: /資料庫入門/ })).toBeNull();
  expect(new URLSearchParams(window.location.search).has('courses')).toBe(false);
  expect(new URLSearchParams(window.location.search).has('q')).toBe(false);
  expect(state.request).toHaveBeenCalledTimes(1);
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
