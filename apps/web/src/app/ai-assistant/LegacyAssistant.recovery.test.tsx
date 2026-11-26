import { fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import { SelectedSchoolProvider } from '@/components/SelectedSchoolProvider';
import { callCampusAssistant, getCampusAssistantSnapshot } from '@/lib/campusAssistantClient';
import AssistantPage from './LegacyAssistant';

const state = vi.hoisted(() => ({
  uid: null as string | null,
  query: '',
  functionsConfigured: false,
  catalogStatus: 'ready' as 'ready' | 'loading' | 'error',
  authError: null as Error | null,
  retry: vi.fn(),
  replace: vi.fn(),
}));
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(state.query),
  usePathname: () => '/ai-assistant',
  useRouter: () => ({ replace: state.replace }),
}));
vi.mock('@/components/AuthGuard', () => ({
  useAuth: () => ({ user: state.uid ? { uid: state.uid } : null, loading: false, error: state.authError }),
}));
vi.mock('@/features/nuni/Session', () => ({ useOptionalNuniSession: () => null }));
vi.mock('@/lib/signInOptions', () => ({
  useSignInOptions: () => ({ google: false, studentId: true, loading: false, retry: vi.fn() }),
}));
vi.mock('@/components/SiteShell', () => ({
  SiteShell: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}));
vi.mock('@/lib/functionsUrl', async (original) => ({
  ...(await original<typeof import('@/lib/functionsUrl')>()),
  areFunctionsConfigured: () => state.functionsConfigured,
}));
vi.mock('@/lib/campusAssistantClient', async (original) => ({
  ...(await original<typeof import('@/lib/campusAssistantClient')>()),
  callCampusAssistant: vi.fn(),
  getCampusAssistantSnapshot: vi.fn(),
}));

const schools = [{ id: 'pu', name: '靜宜大學', code: 'PU' }, { id: 'nthu', name: '國立清華大學', code: 'NTHU' }];
function Entry() {
  return (
    <SelectedSchoolProvider ownerKey={state.uid} loading={false} schools={schools}
      catalogStatus={state.catalogStatus} onRetryCatalog={state.retry}>
      <AssistantPage />
    </SelectedSchoolProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  state.uid = null;
  state.query = new URLSearchParams({ q: '查我的門市營運概況', taskProfile: 'merchant' }).toString();
  state.functionsConfigured = false;
  state.catalogStatus = 'ready';
  state.authError = null;
  state.replace.mockImplementation((href: string) => { state.query = new URL(href, 'https://nuni.test').search.slice(1); });
  vi.mocked(getCampusAssistantSnapshot).mockResolvedValue({
    schoolId: 'pu', checkedAt: '2026-11-24T12:00:00.000Z',
    schedule: { status: 'unavailable', count: null },
    assignments: { status: 'unavailable', count: null, items: [] },
    announcements: { status: 'unavailable', items: [] },
  });
});

it('keeps a guest deep-link draft visible during a catalog failure and retries only the existing source', () => {
  state.catalogStatus = 'error';
  state.query += '&campus=nthu';
  render(<Entry />);
  expect(screen.getByRole('heading', { name: '校園資料暫時連不上' })).toBeTruthy();
  const draft = screen.getByRole('textbox', { name: '保留的問題' }) as HTMLTextAreaElement;
  expect(draft.value).toBe('查我的門市營運概況');
  expect(draft.readOnly).toBe(true);
  expect(screen.getByText(/雲端助理尚未啟用/)).toBeTruthy();
  expect(screen.getByRole('link', { name: '返回探索' }).getAttribute('href')).toBe('/explore?campus=nthu');
  expect(screen.getByRole('link', { name: '店家工作區' }).getAttribute('href')).toBe('/merchant?campus=nthu');
  expect(screen.getByRole('link', { name: '校園地圖' }).getAttribute('href')).toBe('/map?campus=nthu');
  expect(screen.queryByRole('form', { name: '傳送問題' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '重新讀取校園' }));
  expect(state.retry).toHaveBeenCalledTimes(1);
  expect(callCampusAssistant).not.toHaveBeenCalled();
  expect(getCampusAssistantSnapshot).not.toHaveBeenCalled();
  expect(state.replace).not.toHaveBeenCalled();
});

it('uses the real school selector and keeps the question and task context through selection and sign-in', () => {
  const view = render(<Entry />);
  expect(screen.getByRole('heading', { name: '先選擇要使用的校園' })).toBeTruthy();
  fireEvent.change(screen.getByRole('combobox', { name: '瀏覽校園' }), { target: { value: 'nthu' } });
  const destination = new URL(state.replace.mock.calls[0][0], 'https://nuni.test');
  expect(destination.pathname).toBe('/ai-assistant');
  expect(destination.searchParams.get('q')).toBe('查我的門市營運概況');
  expect(destination.searchParams.get('taskProfile')).toBe('merchant');
  expect(destination.searchParams.get('campus')).toBe('nthu');
  view.rerender(<Entry />);
  const login = new URL(screen.getByRole('link', { name: '用學校帳號登入' }).getAttribute('href')!, 'https://nuni.test');
  const returnUrl = new URL(login.searchParams.get('returnUrl')!, 'https://nuni.test');
  expect(returnUrl.searchParams.get('q')).toBe('查我的門市營運概況');
  expect(returnUrl.searchParams.get('taskProfile')).toBe('merchant');
  expect(returnUrl.searchParams.get('campus')).toBe('nthu');
  expect(login.searchParams.get('reconnect')).toBe('school');
  expect(screen.getByRole('link', { name: '公車' }).getAttribute('href')).toContain('campus=nthu');
  state.uid = 'alice';
  view.rerender(<Entry />);
  expect((screen.getByRole('textbox', { name: '你的問題' }) as HTMLTextAreaElement).value).toBe('查我的門市營運概況');
  expect(callCampusAssistant).not.toHaveBeenCalled();
  expect(getCampusAssistantSnapshot).not.toHaveBeenCalled();
});

it('retains the draft when the selected source recovers without running the question for a guest', () => {
  state.catalogStatus = 'error';
  state.query += '&campus=pu';
  const view = render(<Entry />);
  fireEvent.click(screen.getByRole('button', { name: '重新讀取校園' }));
  state.catalogStatus = 'ready';
  state.functionsConfigured = true;
  view.rerender(<Entry />);
  expect(screen.getByRole('textbox', { name: '保留的問題' })).toHaveProperty('value', '查我的門市營運概況');
  expect(screen.getByRole('link', { name: '用學校帳號登入' })).toBeTruthy();
  expect(screen.queryByRole('form', { name: '傳送問題' })).toBeNull();
  expect(callCampusAssistant).not.toHaveBeenCalled();
  expect(getCampusAssistantSnapshot).not.toHaveBeenCalled();
});

it.each([
  ['teacher', '查我的授課概況', '開啟課程與作業', false],
  ['teacher', '查我的授課概況', '開啟課程與作業', true],
  ['merchant', '查我的門市營運概況', '開啟店家工作區', false],
  ['merchant', '查我的門市營運概況', '開啟店家工作區', true],
] as const)('keeps %s question "%s" as %s service guidance (Functions %s)', (profile, question, service, configured) => {
  state.uid = 'ordinary-school-account';
  state.query = new URLSearchParams({ q: question, taskProfile: profile, campus: 'pu' }).toString();
  state.functionsConfigured = configured;
  render(<Entry />);
  expect(screen.getByText(/選擇情境不會更換帳號或取得權限/)).toBeTruthy();
  expect(callCampusAssistant).not.toHaveBeenCalled();
  fireEvent.submit(screen.getByRole('form', { name: '傳送問題' }));
  const log = screen.getByRole('log', { name: '對話紀錄' });
  expect(within(log).getByText(/這次沒有讀取或變更工作資料/)).toBeTruthy();
  expect(within(log).getByRole('link', { name: new RegExp(service) })).toBeTruthy();
  expect(callCampusAssistant).not.toHaveBeenCalled();
  expect(getCampusAssistantSnapshot).not.toHaveBeenCalled();
});

it('keeps an authentication failure recoverable without discarding the question or assigning a role', () => {
  state.authError = new Error('auth unavailable');
  state.query += '&campus=pu';
  render(<Entry />);
  expect(screen.getByRole('heading', { name: '暫時無法確認登入狀態' })).toBeTruthy();
  const retry = screen.getByRole('link', { name: '重新確認登入狀態' });
  expect(new URL(retry.getAttribute('href')!, 'https://nuni.test').searchParams.get('q')).toBe('查我的門市營運概況');
  expect(screen.getByRole('textbox', { name: '保留的問題' })).toHaveProperty('value', '查我的門市營運概況');
  expect(screen.queryByRole('form', { name: '傳送問題' })).toBeNull();
  expect(callCampusAssistant).not.toHaveBeenCalled();
  expect(getCampusAssistantSnapshot).not.toHaveBeenCalled();
});
