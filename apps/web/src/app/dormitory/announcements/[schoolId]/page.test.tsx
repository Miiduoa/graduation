import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import type { DormWorkflowRows } from '@campus/shared/src/dormWorkflow';
import Page from './page';

const state = vi.hoisted(() => ({
  uid: 'alice' as string | null,
  campus: 'pu',
  id: 'a1' as string | null,
  fetch: vi.fn<typeof fetch>(),
}));
vi.mock('next/navigation', async (original) => ({
  ...await original<typeof import('next/navigation')>(),
  useSearchParams: () => new URLSearchParams(state.id ? { dormAnnouncementId: state.id } : {}),
}));
vi.mock('@/components/SiteShell', () => ({ SiteShell: ({ children }: { children: React.ReactNode }) => <main>{children}</main> }));
vi.mock('@/components/AuthGuard', () => ({ useAuth: () => ({
  loading: false, user: state.uid ? { uid: state.uid } : null,
}) }));
vi.mock('@/lib/firebase', () => ({
  getCloudFunctionUrl: () => '/api/fn/dormWorkflow',
  getAuth: () => ({ currentUser: state.uid ? { uid: state.uid, getIdToken: async () => 'local-token' } : null }),
}));
vi.mock('@/lib/useCampusBrowseContext', () => ({ useCampusBrowseContext: () => ({
  status: 'ready', schoolId: state.campus, schoolName: state.campus, schoolSearch: '?campus=' + state.campus,
}) }));
vi.mock('@/lib/signInOptions', () => ({ useSignInOptions: () => ({ studentId: true, loading: false }) }));

const self = { id: 'a1', building: '甲棟', title: '宿舍供水時間', body: '僅對現行名冊開放的內文', publishedAt: Date.UTC(2026, 10, 23, 18, 0) };
const other = { id: 'a2', building: '乙棟', title: '其他公告', body: '其他公告全文' };
const rows = (...announcements: NonNullable<DormWorkflowRows['announcements']>) => Response.json({ result: { announcements } });
beforeEach(() => {
  state.uid = 'alice';
  state.campus = 'pu';
  state.id = 'a1';
  state.fetch.mockReset();
  vi.stubGlobal('fetch', state.fetch);
});

async function mount(schoolId = 'pu') {
  const params = Promise.resolve({ schoolId });
  const searchParams = Promise.resolve(state.id ? { dormAnnouncementId: state.id } : {});
  let view!: ReturnType<typeof render>;
  await act(async () => { view = render(<Page params={params} searchParams={searchParams} />); });
  return () => view.rerender(<Page params={params} searchParams={searchParams} />);
}

it('only shows the identified resident announcement from mine and uses the exact school document ID', async () => {
  state.fetch.mockResolvedValue(rows(other, self));
  await mount('tw-pu');
  expect(await screen.findByRole('heading', { name: self.title })).toBeTruthy();
  expect(screen.getByText(self.body)).toBeTruthy();
  expect(screen.getByText(/發布於 2026\/11\/24 02:00/)).toBeTruthy();
  expect(screen.queryByText(other.title)).toBeNull();
  const [endpoint, init] = state.fetch.mock.calls[0];
  expect(endpoint).toBe('/api/fn/dormWorkflow');
  expect(JSON.parse(String(init?.body))).toEqual({ data: { action: 'mine', schoolId: 'tw-pu' } });
  expect(init?.headers).toMatchObject({ Authorization: 'Bearer local-token' });
});

it('opens the authorized list from older inbox entries without including any body', async () => {
  state.id = null;
  state.fetch.mockResolvedValue(rows(self, other));
  await mount();
  const current = await screen.findByRole('link', { name: self.title });
  expect(current.getAttribute('href')).toBe('/dormitory/announcements/pu?campus=pu&schoolId=pu&dormAnnouncementId=a1');
  expect(within(current.closest('li')!).getByText(/發布於 2026\/11\/24 02:00/)).toBeTruthy();
  const older = screen.getByRole('link', { name: other.title });
  expect(within(older.closest('li')!).getByText('發布時間未提供')).toBeTruthy();
  expect(screen.queryByText(self.body)).toBeNull();
});

it('shows a legacy announcement with no publication time on its detail page', async () => {
  state.id = other.id;
  state.fetch.mockResolvedValue(rows(other));
  await mount();
  await screen.findByRole('heading', { name: other.title });
  expect(screen.getByText(other.body)).toBeTruthy();
  expect(screen.getByText('發布時間未提供')).toBeTruthy();
  expect(screen.queryByText(/^發布於/)).toBeNull();
});

it('keeps the exact announcement through the school sign-in link without fetching for a guest', async () => {
  state.uid = null;
  await mount();
  const link = await screen.findByRole('link', { name: '用學校帳號登入' });
  const login = new URL(link.getAttribute('href')!, window.location.origin);
  expect(login.searchParams.get('returnUrl')).toBe('/dormitory/announcements/pu?campus=pu&schoolId=pu&dormAnnouncementId=a1');
  expect(login.searchParams.get('reconnect')).toBe('school');
  expect(state.fetch).not.toHaveBeenCalled();
});

it('rechecks mine on retry and distinguishes a service error from a missing announcement', async () => {
  state.fetch.mockResolvedValueOnce(Response.json({ error: { message: 'unavailable' } }, { status: 503 }))
    .mockResolvedValueOnce(rows(other))
    .mockResolvedValueOnce(rows(self));
  await mount();
  expect((await screen.findByRole('alert')).textContent).toContain('暫時無法讀取');
  fireEvent.click(screen.getByRole('button', { name: '重新讀取' }));
  await screen.findByRole('heading', { name: '查無這則本棟公告' });
  expect(screen.queryByText(other.body)).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '重新確認' }));
  expect(await screen.findByText(self.body)).toBeTruthy();
});

it('removes the previous resident’s private content on account change and rejects a late response after changing school', async () => {
  let finish!: (value: Response) => void;
  state.fetch.mockResolvedValueOnce(rows(self)).mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
  const rerender = await mount();
  await screen.findByText(self.body);
  state.uid = 'bob';
  rerender();
  expect(screen.queryByText(self.body)).toBeNull();
  await waitFor(() => expect(state.fetch).toHaveBeenCalledTimes(2));
  state.campus = 'ntu';
  rerender();
  expect(screen.getByRole('alert').textContent).toContain('其他校園');
  await act(async () => { finish(rows(self)); });
  expect(screen.queryByText(self.body)).toBeNull();
  expect(state.fetch).toHaveBeenCalledTimes(2);
});

it('clears the announcement while the page is hidden and verifies roster access again when it returns', async () => {
  const visible = vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
  try {
    state.fetch.mockResolvedValueOnce(rows(self)).mockResolvedValueOnce(Response.json({ error: {} }, { status: 403 }));
    await mount();
    await screen.findByText(self.body);
    visible.mockReturnValue(true);
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    expect(screen.queryByText(self.body)).toBeNull();
    visible.mockReturnValue(false);
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    expect((await screen.findByRole('alert')).textContent).toContain('目前的學校帳號無法查看');
    expect(screen.queryByText(self.body)).toBeNull();
    expect(state.fetch).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('link', { name: '返回宿舍服務' }).getAttribute('href')).toBe('/dormitory?campus=pu');
  } finally { visible.mockRestore(); }
});
