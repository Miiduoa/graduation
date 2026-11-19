import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { RequireAdmin } from './RequireAdmin';
import { getSupabaseClient } from '@/lib/supabaseClient';

const campusAuth = vi.hoisted(() => ({ uid: 'campus-alice' as string | null, loading: false }));
const navigation = vi.hoisted(() => ({
  search: '',
  selection: null as null | {
    loading: boolean;
    catalogStatus: 'ready' | 'loading';
    selectedSchool: { id: string; code: string } | null;
  },
}));
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(navigation.search),
}));
vi.mock('./SelectedSchoolProvider', () => ({
  useOptionalSelectedSchool: () => navigation.selection,
}));
vi.mock('./AuthGuard', () => ({
  useAuth: () => ({
    user: campusAuth.uid ? { uid: campusAuth.uid } : null,
    loading: campusAuth.loading,
  }),
}));
vi.mock('@/lib/supabaseClient', () => ({ getSupabaseClient: vi.fn() }));
const client = {
  auth: { getSession: vi.fn(), signOut: vi.fn(), onAuthStateChange: vi.fn() },
  from: vi.fn(),
};
beforeEach(() => {
  vi.clearAllMocks();
  campusAuth.uid = 'campus-alice';
  campusAuth.loading = false;
  navigation.search = '';
  navigation.selection = null;
  vi.mocked(getSupabaseClient).mockReturnValue(client);
  client.auth.getSession.mockResolvedValue({
    data: { session: { user: { id: 'unrelated-admin', email: 'private@example.test' } } },
  });
  client.auth.signOut.mockResolvedValue({ error: null });
});
it('does not mount children when the integration is unconfigured', () => {
  vi.mocked(getSupabaseClient).mockReturnValue(null);
  render(
    <RequireAdmin>
      <p>Private records</p>
    </RequireAdmin>,
  );
  expect(screen.queryByText('Private records')).toBeNull();
  expect(screen.getByText('教學管理尚未開放')).toBeTruthy();
  expect(screen.getByRole('link', { name: '前往授課課程' }).getAttribute('href')).toBe('/classroom');
  expect(screen.getByRole('link', { name: '前往課務申訴審核' }).getAttribute('href')).toBe('/teacher');
});
it('never reads a separate account or mounts management readers without a verified binding', () => {
  render(
    <RequireAdmin>
      <p>Private records</p>
    </RequireAdmin>,
  );
  expect(screen.queryByText('Private records')).toBeNull();
  expect(screen.getByText('教學管理尚未完成帳號連結')).toBeTruthy();
  expect(client.auth.getSession).not.toHaveBeenCalled();
  expect(client.from).not.toHaveBeenCalled();
});
it('a signed-out campus account cannot expose a persisted LMS session', () => {
  campusAuth.uid = null;
  render(
    <RequireAdmin>
      <p>Private records</p>
    </RequireAdmin>,
  );
  expect(screen.queryByText('Private records')).toBeNull();
  expect(screen.getByText('選擇要處理的教學工作')).toBeTruthy();
  expect(screen.getByRole('link', { name: '前往授課課程' }).getAttribute('href')).toBe('/classroom');
  const login = new URL(
    screen.getByRole('link', { name: '登入學校帳號後查看課務申訴' }).getAttribute('href')!,
    'https://campus.local',
  );
  expect(Object.fromEntries(login.searchParams)).toEqual({
    reconnect: 'school',
    returnUrl: '/teacher',
  });
  expect(client.auth.getSession).not.toHaveBeenCalled();
});

it('preserves the selected campus and sends school login back to the actual appeals task', () => {
  campusAuth.uid = null;
  navigation.search = 'school=pu&schoolId=pu&campus=pu&course=private-course';
  navigation.selection = {
    loading: false,
    catalogStatus: 'ready',
    selectedSchool: { id: 'nthu', code: 'NTHU' },
  };
  render(<RequireAdmin><p>Private records</p></RequireAdmin>);
  const classroom = new URL(
    screen.getByRole('link', { name: '前往授課課程' }).getAttribute('href')!,
    'https://campus.local',
  );
  expect(classroom.pathname).toBe('/classroom');
  expect(Object.fromEntries(classroom.searchParams)).toEqual({
    school: 'NTHU', schoolId: 'nthu', campus: 'nthu',
  });
  const login = new URL(
    screen.getByRole('link', { name: '登入學校帳號後查看課務申訴' }).getAttribute('href')!,
    'https://campus.local',
  );
  expect(login.pathname).toBe('/login');
  expect(Object.fromEntries(login.searchParams)).toEqual({
    reconnect: 'school',
    returnUrl: '/teacher?schoolId=nthu&campus=nthu&school=NTHU',
    school: 'NTHU', schoolId: 'nthu', campus: 'nthu',
  });
  expect(screen.queryByText('Private records')).toBeNull();
  expect(client.from).not.toHaveBeenCalled();
  expect(client.auth.getSession).not.toHaveBeenCalled();
});

it('retains an explicit campus URL before the directory finishes loading', () => {
  navigation.search = 'school=pu&schoolId=pu&campus=pu&source=old-admin';
  navigation.selection = {
    loading: true,
    catalogStatus: 'loading',
    selectedSchool: null,
  };
  render(<RequireAdmin><p>Private records</p></RequireAdmin>);
  expect(screen.getByRole('link', { name: '前往課務申訴審核' }).getAttribute('href')).toBe(
    '/teacher?school=pu&schoolId=pu&campus=pu',
  );
  expect(screen.getByRole('link', { name: '前往授課課程' }).getAttribute('href')).toBe(
    '/classroom?school=pu&schoolId=pu&campus=pu',
  );
  expect(screen.queryByText('Private records')).toBeNull();
});

it('does not restore a previous campus when all campuses is selected', () => {
  navigation.search = 'school=pu&schoolId=pu&campus=pu';
  navigation.selection = { loading: false, catalogStatus: 'ready', selectedSchool: null };
  render(<RequireAdmin><p>Private records</p></RequireAdmin>);
  expect(screen.getByRole('link', { name: '前往授課課程' }).getAttribute('href')).toBe(
    '/classroom?campus=all',
  );
  expect(screen.getByRole('link', { name: '前往課務申訴審核' }).getAttribute('href')).toBe(
    '/teacher?campus=all',
  );
});

it('waits for campus authentication without mounting private readers or stale task links', () => {
  campusAuth.loading = true;
  render(<RequireAdmin><p>Private records</p></RequireAdmin>);
  expect(screen.getByRole('status').textContent).toBe('確認學校帳號…');
  expect(screen.queryByRole('navigation', { name: '教學工作入口' })).toBeNull();
  expect(screen.queryByText('Private records')).toBeNull();
  expect(client.auth.getSession).not.toHaveBeenCalled();
  expect(client.from).not.toHaveBeenCalled();
});
it('provides an explicit local logout for any residual teaching session', async () => {
  render(
    <RequireAdmin>
      <p>Private records</p>
    </RequireAdmin>,
  );
  fireEvent.click(screen.getByRole('button', { name: '清除先前的教學服務登入' }));
  await waitFor(() => expect(client.auth.signOut).toHaveBeenCalledWith({ scope: 'local' }));
  expect(await screen.findByText('已清除這個瀏覽器的教學服務登入。')).toBeTruthy();
});
it.each(['resolve', 'reject'])(
  'does not expose an old identity after account switching with a delayed logout: %s',
  async (outcome) => {
    let finish!: (value: unknown) => void;
    let reject!: (reason: unknown) => void;
    client.auth.signOut.mockImplementationOnce(
      () =>
        new Promise((resolve, fail) => {
          finish = resolve;
          reject = fail;
        }),
    );
    const view = render(
      <RequireAdmin>
        <p>Private records</p>
      </RequireAdmin>,
    );
    fireEvent.click(screen.getByRole('button', { name: '清除先前的教學服務登入' }));
    campusAuth.uid = 'campus-bob';
    view.rerender(
      <RequireAdmin>
        <p>Private records</p>
      </RequireAdmin>,
    );
    await act(async () => {
      if (outcome === 'resolve') finish({ error: null });
      else reject(new Error('offline'));
    });
    expect(screen.queryByText(/private@example.test|Private records/)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(client.from).not.toHaveBeenCalled();
    expect(client.auth.getSession).not.toHaveBeenCalled();
  },
);
