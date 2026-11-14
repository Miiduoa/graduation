import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { AppHeader } from './AppHeader';
import { SelectedSchoolProvider, schoolPreferenceKey } from './SelectedSchoolProvider';
import LoginPage from '@/app/login/page';
import { ClubOverview } from '@/app/groups/ClubOverview';

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
vi.mock('./NuniSignIn', () => ({ NuniSignIn: () => <div>Google 登入</div> }));
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

function Flow({ login = false }: { login?: boolean }) {
  return (
    <SelectedSchoolProvider ownerKey={null} loading={false} schools={schools} catalogStatus="ready">
      {login ? <LoginPage /> : <><AppHeader /><ClubOverview groupId="photography" /></>}
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
