import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { AppHeader } from './AppHeader';
import { SelectedSchoolProvider, schoolPreferenceKey } from './SelectedSchoolProvider';
import LoginPage from '@/app/login/page';
import { ClubOverview } from '@/app/groups/ClubOverview';
import { SchoolAccountRequired } from './SchoolAccountRequired';
import SettingsPage from '@/app/settings/page';

const { navigation, assign, replace, signIn, options } = vi.hoisted(() => ({
  navigation: { pathname: '/', search: '', hash: '' },
  assign: vi.fn(),
  replace: vi.fn(),
  signIn: vi.fn(),
  options: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  usePathname: () => navigation.pathname,
  useSearchParams: () => new URLSearchParams(navigation.search),
  useRouter: () => ({ replace: vi.fn() }),
}));
vi.mock('./AuthGuard', () => ({
  useAuth: () => ({ user: null, loading: false, error: null, signOutUser: vi.fn() }),
}));
vi.mock('@/features/nuni/Session', () => ({
  useNuniSession: () => ({ session: null, loading: false, pendingLogout: false, logout: vi.fn() }),
  useOptionalNuniSession: () => ({ session: null, loading: false, pendingLogout: false }),
}));
vi.mock('@/features/auth/client', () => ({
  isFirebaseConfigured: () => true,
  signInWithPuStudentId: signIn,
}));
vi.mock('@/lib/signInOptions', () => ({
  STUDENT_ID_PREPARING_COPY: '正在確認登入方式…',
  useSignInOptions: (schoolId: string | null, ready: boolean) => {
    options(schoolId, ready);
    return { studentId: ready && schoolId === 'pu', loading: !ready, error: false, retry: vi.fn() };
  },
}));
vi.mock('@/lib/useClientHydrated', () => ({ useClientHydrated: () => true }));
vi.mock('@/lib/useLocationHash', () => ({ useLocationHash: () => navigation.hash }));
vi.mock('./CampusServiceMenu', () => ({ CampusServiceMenu: () => null }));
vi.mock('./SchoolSelector', () => ({ SchoolSelector: () => null }));
vi.mock('./QuickCampusEntry', () => ({ QuickCampusEntry: () => null }));
vi.mock('./NuniSignIn', () => ({
  NuniSignIn: ({ returnUrl }: { returnUrl: string }) => <div data-return-url={returnUrl}>Google 登入</div>,
}));
vi.mock('@/components/ui', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/components/ui')>()),
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));
vi.mock('./SiteShell', () => ({
  SiteShell: ({ title, children }: { title: string; children: ReactNode }) => (
    <main><h1>{title}</h1>{children}</main>
  ),
}));
vi.mock('@/app/groups/ClubProfile', () => ({ ClubProfile: () => <div>私有社團資料</div> }));

const schools = [
  { id: 'pu', name: '靜宜大學', code: 'PU' },
  { id: 'nthu', name: '國立清華大學', code: 'NTHU' },
];

function Flow({ login = false, task }: { login?: boolean; task?: 'school' | 'settings' }) {
  return (
    <SelectedSchoolProvider ownerKey={null} loading={false} schools={schools} catalogStatus="ready">
      {login ? <LoginPage /> : task === 'school' ? (
        <SchoolAccountRequired returnUrl="/teacher" alternative="請先使用學校正式管道。" />
      ) : task === 'settings' ? <SettingsPage /> : <><AppHeader /><ClubOverview groupId="photography" /></>}
    </SelectedSchoolProvider>
  );
}

function visit(href: string) {
  const url = new URL(href, 'https://campus.local');
  navigation.pathname = url.pathname;
  navigation.search = url.search;
  navigation.hash = url.hash;
  window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
  vi.stubGlobal('location', { ...window.location, pathname: url.pathname, search: url.search, hash: url.hash, assign, replace });
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  signIn.mockResolvedValue({ uid: 'pu-student' });
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.history.replaceState({}, '', '/');
});

it.each(['nthu', null])(
  'keeps a PU deep-link task through header login despite saved campus %s',
  async (savedSchoolId) => {
    localStorage.setItem(schoolPreferenceKey(null), JSON.stringify({ schoolId: savedSchoolId }));
    const destination = '/groups/photography/club/overview?school=PU&schoolId=pu&campus=pu&token=private#announcements';
    visit(destination);
    const view = render(<Flow />);
    await screen.findByRole('link', { name: '登入後查看社團' });
    const link = screen.getByRole('link', { name: '登入' });
    const loginUrl = new URL(link.getAttribute('href')!, 'https://campus.local');
    expect(Object.fromEntries(loginUrl.searchParams)).toEqual({
      returnUrl: destination,
      school: 'PU',
      schoolId: 'pu',
      campus: 'pu',
    });
    fireEvent.click(link);
    expect(assign).toHaveBeenCalledWith(link.getAttribute('href'));

    visit(assign.mock.calls[0][0]);
    view.rerender(<Flow login />);
    await screen.findByLabelText('學號');
    expect(options).toHaveBeenLastCalledWith('pu', true);
    expect(screen.queryByText('Google 登入')).toBeNull();
    fireEvent.change(screen.getByLabelText('學號'), { target: { value: 's123' } });
    fireEvent.change(screen.getByLabelText('密碼'), { target: { value: 'password' } });
    fireEvent.submit(screen.getByLabelText('學號').closest('form')!);
    await waitFor(() => expect(replace).toHaveBeenCalledWith(destination));
    expect(signIn).toHaveBeenCalledWith('S123', 'password', expect.any(AbortSignal), 'pu');
    expect(JSON.parse(localStorage.getItem(schoolPreferenceKey(null))!)).toEqual({ schoolId: savedSchoolId });
  },
);

it('uses the same campus-preserving login helper from the club overview action', async () => {
  localStorage.setItem(schoolPreferenceKey(null), JSON.stringify({ schoolId: 'nthu' }));
  visit('/groups/photography/club/overview?schoolId=pu&campus=pu');
  const view = render(<Flow />);
  const link = await screen.findByRole('link', { name: '登入後查看社團' });
  const loginUrl = new URL(link.getAttribute('href')!, 'https://campus.local');
  expect(Object.fromEntries(loginUrl.searchParams)).toEqual({
    returnUrl: '/groups/photography/club/overview?schoolId=pu',
    schoolId: 'pu',
  });
  visit(link.getAttribute('href')!);
  view.rerender(<Flow login />);
  await screen.findByLabelText('學號');
  expect(options).toHaveBeenLastCalledWith('pu', true);
  expect(screen.queryByText('私有社團資料')).toBeNull();
});

it.each(['all', 'personal'])('does not restore a saved school when %s was explicitly selected', async (campus) => {
  localStorage.setItem(schoolPreferenceKey(null), JSON.stringify({ schoolId: 'pu' }));
  visit(`/profile?campus=${campus}&schoolId=pu&school=PU`);
  const view = render(<Flow />);
  const link = screen.getByRole('link', { name: '登入' });
  const loginUrl = new URL(link.getAttribute('href')!, 'https://campus.local');
  expect(Object.fromEntries(loginUrl.searchParams)).toEqual({
    returnUrl: `/profile?campus=${campus}&schoolId=pu&school=PU`,
    campus: 'all',
  });
  visit(link.getAttribute('href')!);
  view.rerender(<Flow login />);
  await waitFor(() => expect(options).toHaveBeenLastCalledWith(null, true));
  expect(screen.getByText('Google 登入')).toBeTruthy();
  expect(screen.queryByLabelText('學號')).toBeNull();
  expect(JSON.parse(localStorage.getItem(schoolPreferenceKey(null))!)).toEqual({ schoolId: 'pu' });
});

it.each(['nthu', null])('school-required tasks keep their explicit PU campus despite preference %s', async (savedSchoolId) => {
  localStorage.setItem(schoolPreferenceKey(null), JSON.stringify({ schoolId: savedSchoolId }));
  visit('/teacher?campus=pu&schoolId=pu');
  const view = render(<Flow task="school" />);
  await waitFor(() => expect(options).toHaveBeenLastCalledWith('pu', true));
  const link = screen.getByRole('link', { name: '用學校帳號登入' });
  const target = new URL(link.getAttribute('href')!, 'https://campus.local');
  const destination = '/teacher?schoolId=pu&campus=pu&school=PU';
  expect(Object.fromEntries(target.searchParams)).toEqual({
    reconnect: 'school', returnUrl: destination, school: 'PU', schoolId: 'pu', campus: 'pu',
  });
  visit(link.getAttribute('href')!);
  view.rerender(<Flow login />);
  await screen.findByLabelText('學號');
  expect(options).toHaveBeenLastCalledWith('pu', true);
  expect(screen.queryByText('Google 登入')).toBeNull();
  fireEvent.change(screen.getByLabelText('學號'), { target: { value: 's123' } });
  fireEvent.change(screen.getByLabelText('密碼'), { target: { value: 'password' } });
  fireEvent.submit(screen.getByLabelText('學號').closest('form')!);
  await waitFor(() => expect(replace).toHaveBeenCalledWith(destination));
  expect(signIn).toHaveBeenCalledWith('S123', 'password', expect.any(AbortSignal), 'pu');
  expect(JSON.parse(localStorage.getItem(schoolPreferenceKey(null))!)).toEqual({ schoolId: savedSchoolId });
});

it('checks the actual selected school before offering a school-required login', async () => {
  localStorage.setItem(schoolPreferenceKey(null), JSON.stringify({ schoolId: 'pu' }));
  visit('/teacher?campus=nthu');
  render(<Flow task="school" />);
  await waitFor(() => expect(options).toHaveBeenLastCalledWith('nthu', true));
  expect(screen.getByRole('heading', { name: '這個功能還沒接通' })).toBeTruthy();
  expect(screen.queryByRole('link', { name: '用學校帳號登入' })).toBeNull();
});

it('requires a selected campus instead of using the default PU login capability for all campuses', async () => {
  localStorage.setItem(schoolPreferenceKey(null), JSON.stringify({ schoolId: 'pu' }));
  visit('/teacher?campus=all&schoolId=pu');
  render(<Flow task="school" />);
  await screen.findByRole('heading', { name: '先選擇要瀏覽的校園' });
  expect(options).toHaveBeenLastCalledWith(null, false);
  expect(screen.queryByRole('link', { name: '用學校帳號登入' })).toBeNull();
});

it('returns Google login to the requested assistant permission section, campus and hash', async () => {
  localStorage.setItem(schoolPreferenceKey(null), JSON.stringify({ schoolId: 'nthu' }));
  visit('/settings?section=assistant&campus=pu&schoolId=pu&token=private#permissions');
  const view = render(<Flow task="settings" />);
  const link = await screen.findByRole('link', { name: '前往登入' });
  const destination = '/settings?section=assistant&schoolId=pu&campus=pu&school=PU#permissions';
  const target = new URL(link.getAttribute('href')!, 'https://campus.local');
  expect(Object.fromEntries(target.searchParams)).toEqual({
    returnUrl: destination, school: 'PU', schoolId: 'pu', campus: 'pu',
  });
  visit(link.getAttribute('href')!);
  view.rerender(<Flow login />);
  const google = await screen.findByText('Google 登入');
  expect(google.getAttribute('data-return-url')).toBe(destination);
  expect(options).toHaveBeenLastCalledWith('pu', true);
  expect(JSON.parse(localStorage.getItem(schoolPreferenceKey(null))!)).toEqual({ schoolId: 'nthu' });
});

it.each(['notifications', 'account'])('returns school connection to the %s settings task', async (section) => {
  localStorage.setItem(schoolPreferenceKey(null), JSON.stringify({ schoolId: 'nthu' }));
  visit(`/settings?section=${section}&campus=pu&schoolId=pu#preferences`);
  const view = render(<Flow task="settings" />);
  await waitFor(() => expect(options).toHaveBeenLastCalledWith('pu', true));
  const link = screen.getByRole('link', { name: '連線學校帳號' });
  const destination = `/settings?section=${section}&schoolId=pu&campus=pu&school=PU#preferences`;
  const google = screen.getByRole('link', { name: '登入課程空間' });
  expect(Object.fromEntries(new URL(google.getAttribute('href')!, 'https://campus.local').searchParams)).toEqual({
    returnUrl: destination, school: 'PU', schoolId: 'pu', campus: 'pu',
  });
  expect(Object.fromEntries(new URL(link.getAttribute('href')!, 'https://campus.local').searchParams)).toEqual({
    reconnect: 'school', returnUrl: destination, school: 'PU', schoolId: 'pu', campus: 'pu',
  });
  visit(link.getAttribute('href')!);
  view.rerender(<Flow login />);
  await screen.findByLabelText('學號');
  expect(screen.queryByText('Google 登入')).toBeNull();
  fireEvent.change(screen.getByLabelText('學號'), { target: { value: 's123' } });
  fireEvent.change(screen.getByLabelText('密碼'), { target: { value: 'password' } });
  fireEvent.submit(screen.getByLabelText('學號').closest('form')!);
  await waitFor(() => expect(replace).toHaveBeenCalledWith(destination));
});

it('uses the current settings section after an in-page navigation', async () => {
  visit('/settings?section=notifications&campus=pu#preferences');
  render(<Flow task="settings" />);
  await waitFor(() => expect(options).toHaveBeenLastCalledWith('pu', true));
  // In-page settings navigation uses native history, independently of the login redirect spy.
  vi.unstubAllGlobals();
  fireEvent.click(screen.getByRole('button', { name: '帳號' }));
  const link = screen.getByRole('link', { name: '連線學校帳號' });
  expect(Object.fromEntries(new URL(link.getAttribute('href')!, 'https://campus.local').searchParams)).toEqual({
    reconnect: 'school',
    returnUrl: '/settings?section=account&schoolId=pu&campus=pu&school=PU#preferences',
    school: 'PU', schoolId: 'pu', campus: 'pu',
  });
});

it.each(['all', 'personal'])('settings login keeps the explicit %s scope without restoring a saved school', async (campus) => {
  localStorage.setItem(schoolPreferenceKey(null), JSON.stringify({ schoolId: 'pu' }));
  visit(`/settings?section=assistant&campus=${campus}&schoolId=pu&school=PU#permissions`);
  render(<Flow task="settings" />);
  const link = await screen.findByRole('link', { name: '前往登入' });
  await waitFor(() => expect(options).toHaveBeenLastCalledWith(null, false));
  expect(Object.fromEntries(new URL(link.getAttribute('href')!, 'https://campus.local').searchParams)).toEqual({
    returnUrl: '/settings?section=assistant&campus=all#permissions', campus: 'all',
  });
  expect(JSON.parse(localStorage.getItem(schoolPreferenceKey(null))!)).toEqual({ schoolId: 'pu' });
});

it('settings does not offer the PU school connection for another selected campus', async () => {
  localStorage.setItem(schoolPreferenceKey(null), JSON.stringify({ schoolId: 'pu' }));
  visit('/settings?section=account&campus=nthu');
  render(<Flow task="settings" />);
  await waitFor(() => expect(options).toHaveBeenLastCalledWith('nthu', true));
  expect(screen.queryByRole('link', { name: '連線學校帳號' })).toBeNull();
  const link = screen.getByRole('link', { name: '登入課程空間' });
  expect(Object.fromEntries(new URL(link.getAttribute('href')!, 'https://campus.local').searchParams)).toEqual({
    returnUrl: '/settings?section=account&schoolId=nthu&campus=nthu&school=NTHU',
    school: 'NTHU', schoolId: 'nthu', campus: 'nthu',
  });
});

it('does not use default school login capability for an unavailable campus', async () => {
  localStorage.setItem(schoolPreferenceKey(null), JSON.stringify({ schoolId: 'pu' }));
  visit('/teacher?campus=missing-school');
  render(<Flow task="school" />);
  await screen.findByRole('heading', { name: '找不到這所校園' });
  expect(options).toHaveBeenLastCalledWith(null, false);
  expect(screen.queryByRole('link', { name: '用學校帳號登入' })).toBeNull();
});
