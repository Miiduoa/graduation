const profileRead = vi.hoisted(() => vi.fn());
vi.mock('@/lib/firebase', () => ({ getDb: () => ({}) }));
vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, collection: string, uid: string) => `${collection}/${uid}`,
  getDoc: profileRead,
}));
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { CampusProviders } from './CampusProviders';
import { SchoolSelector } from './SchoolSelector';
import { useSelectedSchool } from './SelectedSchoolProvider';
const user = vi.hoisted(() => ({ uid: 'alice' as string | null }));
vi.mock('./AuthGuard', () => ({
  useAuth: () => ({ user: user.uid ? { uid: user.uid } : null, loading: false }),
}));
vi.mock('next/navigation', () => ({
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ replace: vi.fn() }),
}));
const fetcher = vi.fn();
const response = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
beforeEach(() => {
  profileRead.mockReset().mockResolvedValue({ get: () => undefined });
  user.uid = 'alice';
  localStorage.clear();
  vi.stubGlobal('fetch', fetcher.mockReset());
});
function View() {
  const school = useSelectedSchool();
  return (
    <>
      <label>
        未儲存筆記
        <input />
      </label>
      <SchoolSelector />
      <output>{school.selectedSchoolId || 'all'}</output>
    </>
  );
}
it('keeps existing page content and unsaved edits when the directory cannot load or is retried', async () => {
  fetcher.mockImplementation((url: string) =>
    url === '/api/nuni/session'
      ? Promise.resolve(response({ authenticated: false }))
      : Promise.resolve(response({}, 503)),
  );
  render(
    <CampusProviders>
      <View />
    </CampusProviders>,
  );
  fireEvent.change(screen.getByLabelText('未儲存筆記'), { target: { value: '既有課程草稿' } });
  expect(await screen.findByRole('alert')).toBeTruthy();
  fetcher.mockImplementation((url: string) =>
    Promise.resolve(
      response(
        url === '/api/nuni/session'
          ? { authenticated: false }
          : { schools: [{ id: 'pu', name: '靜宜大學', status: 'open' }] },
      ),
    ),
  );
  fireEvent.click(screen.getByRole('button', { name: '重新讀取目錄' }));
  expect(await screen.findByRole('combobox', { name: '瀏覽校園' })).toBeTruthy();
  expect((screen.getByLabelText('未儲存筆記') as HTMLInputElement).value).toBe('既有課程草稿');
});
it('retries a 429 school catalog once and becomes ready', async () => {
  let directoryCalls = 0;
  fetcher.mockImplementation((url: string) => {
    if (url === '/api/nuni/session') return Promise.resolve(response({ authenticated: false }));
    if (url !== '/api/schools') return Promise.resolve(response({ authenticated: false }));
    directoryCalls += 1;
    if (directoryCalls === 1) {
      return Promise.resolve(
        new Response(JSON.stringify({}), {
          status: 429,
          headers: { 'Content-Type': 'application/json', 'Retry-After': '0' },
        }),
      );
    }
    return Promise.resolve(
      response({ schools: [{ id: 'pu', name: '靜宜大學', status: 'open' }] }),
    );
  });
  function Status() {
    const school = useSelectedSchool();
    return <output data-testid="catalog-status">{school.catalogStatus}</output>;
  }
  render(
    <CampusProviders>
      <Status />
    </CampusProviders>,
  );
  await waitFor(() => expect(screen.getByTestId('catalog-status').textContent).toBe('ready'));
  expect(directoryCalls).toBe(2);
});

it('uses real directory state and does not transfer an account school choice to another account', async () => {
  fetcher.mockImplementation((url: string) =>
    Promise.resolve(
      response(
        url === '/api/nuni/session'
          ? { authenticated: false }
          : {
              schools: [
                { id: 'pu', name: '靜宜大學', status: 'not-open' },
                { id: 'nthu', name: '國立清華大學', status: 'open' },
              ],
            },
      ),
    ),
  );
  const view = render(
    <CampusProviders>
      <View />
    </CampusProviders>,
  );
  await screen.findByRole('combobox', { name: '瀏覽校園' });
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'nthu' } });
  await waitFor(() => expect(screen.getByRole('status').textContent).toBe('nthu'));
  expect(screen.getByRole('option', { name: /靜宜大學.*校務尚未開通/ })).toBeTruthy();
  user.uid = 'bob';
  view.rerender(
    <CampusProviders>
      <View />
    </CampusProviders>,
  );
  await waitFor(() => expect(screen.getByRole('status').textContent).toBe('all'));
  expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('');
  user.uid = 'alice';
  view.rerender(
    <CampusProviders>
      <View />
    </CampusProviders>,
  );
  await waitFor(() => expect(screen.getByRole('status').textContent).toBe('nthu'));
});

for (const field of ['schoolId', 'primarySchoolId']) {
  it(`以帳號既有 ${field} 作為瀏覽預設並正規化公開學校代碼`, async () => {
    profileRead.mockResolvedValue({ get: (key: string) => key === field ? 'tw-pu' : undefined });
    fetcher.mockImplementation((url: string) => Promise.resolve(response(
      url === '/api/nuni/session' ? { authenticated: false } : { schools: [{ id: 'pu', name: '靜宜大學' }] },
    )));
    render(<CampusProviders><View /></CampusProviders>);
    await waitFor(() => expect(screen.getByRole('combobox', { name: '瀏覽校園' }).getAttribute('disabled')).toBeNull());
    expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('pu');
    expect(profileRead).toHaveBeenCalledWith('users/alice');
    expect(localStorage.length).toBe(0);
  });
}

it('帳號學校讀取中維持載入，失敗後仍可選校', async () => {
  let rejectRead!: (reason: Error) => void;
  profileRead.mockImplementation(() => new Promise((_resolve, reject) => { rejectRead = reject; }));
  fetcher.mockImplementation((url: string) => Promise.resolve(response(
    url === '/api/nuni/session' ? { authenticated: false } : { schools: [{ id: 'pu', name: '靜宜大學' }] },
  )));
  render(<CampusProviders><View /></CampusProviders>);
  await waitFor(() => expect(fetcher).toHaveBeenCalledWith('/api/schools', expect.anything()));
  expect(screen.queryByRole('combobox', { name: '瀏覽校園' })).toBeNull();
  await act(async () => rejectRead(new Error('讀取失敗')));
  const selector = await screen.findByRole('combobox', { name: '瀏覽校園' });
  expect((selector as HTMLSelectElement).value).toBe('');
  fireEvent.change(selector, { target: { value: 'pu' } });
  expect((selector as HTMLSelectElement).value).toBe('pu');
});

it('切換帳號後忽略舊帳號延遲回傳的學校', async () => {
  let resolveAlice!: (value: unknown) => void;
  let resolveBob!: (value: unknown) => void;
  profileRead.mockImplementation((path: string) => new Promise((resolve) => {
    if (path === 'users/alice') resolveAlice = resolve;
    else resolveBob = resolve;
  }));
  fetcher.mockImplementation((url: string) => Promise.resolve(response(
    url === '/api/nuni/session' ? { authenticated: false } : { schools: [
      { id: 'pu', name: '靜宜大學' }, { id: 'nthu', name: '國立清華大學' },
    ] },
  )));
  const view = render(<CampusProviders><View /></CampusProviders>);
  await waitFor(() => expect(profileRead).toHaveBeenCalledWith('users/alice'));
  user.uid = 'bob';
  view.rerender(<CampusProviders><View /></CampusProviders>);
  await act(async () => resolveAlice({ get: () => 'pu' }));
  expect(screen.queryByRole('combobox', { name: '瀏覽校園' })).toBeNull();
  await act(async () => resolveBob({ get: () => 'nthu' }));
  expect((await screen.findByRole('combobox', { name: '瀏覽校園' }) as HTMLSelectElement).value).toBe('nthu');
});
