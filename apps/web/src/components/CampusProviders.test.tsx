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
it('uses real directory state and does not transfer an account school choice to another account', async () => {
  fetcher.mockImplementation((url: string) =>
    Promise.resolve(
      response(
        url === '/api/nuni/session'
          ? { authenticated: false }
          : { schools: [{ id: 'pu', name: '靜宜大學', status: 'not-open' }] },
      ),
    ),
  );
  const view = render(
    <CampusProviders>
      <View />
    </CampusProviders>,
  );
  await screen.findByRole('combobox', { name: '瀏覽校園' });
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'pu' } });
  await waitFor(() => expect(screen.getByRole('status').textContent).toBe('pu'));
  expect(screen.getByRole('option', { name: /靜宜大學.*校務尚未開通/ })).toBeTruthy();
  user.uid = 'bob';
  view.rerender(
    <CampusProviders>
      <View />
    </CampusProviders>,
  );
  await act(async () => {});
  expect(screen.getByRole('status').textContent).toBe('all');
});
