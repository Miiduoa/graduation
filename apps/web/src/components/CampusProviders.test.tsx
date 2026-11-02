import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { CampusProviders } from './CampusProviders';
import { SchoolSelector } from './SchoolSelector';
import { useSelectedSchool } from './SelectedSchoolProvider';
import { useAgentDraft } from './AgentDraftProvider';
import { useNuniSession } from '@/features/nuni/Session';
const user = vi.hoisted(() => ({ uid: 'alice' as string | null, loading: false }));
vi.mock('./AuthGuard', () => ({
  useAuth: () => ({ user: user.uid ? { uid: user.uid } : null, loading: user.loading }),
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
  user.loading = false;
  window.history.replaceState({}, '', '/');
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
    return Promise.resolve(response({ schools: [{ id: 'pu', name: '靜宜大學', status: 'open' }] }));
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
  await waitFor(() => expect(screen.getByRole('status').textContent).toBe('pu'));
});

function DraftJourney() {
  const draft = useAgentDraft('search');
  const session = useNuniSession();
  return (
    <>
      <input
        aria-label="助理未送文字"
        value={draft.draft.text}
        onChange={(event) => draft.setDraft({ text: event.target.value })}
      />
      <output aria-label="助理可執行">{String(draft.ready)}</output>
      <button onClick={() => void session.refresh()}>確認登入</button>
    </>
  );
}
it('keeps same combined owner through a real Nuni background check but clears on a settled account change', async () => {
  const first = 'pa_11111111-1111-4111-8111-111111111111';
  const second = 'pa_22222222-2222-4222-8222-222222222222';
  const principal = (platformAccountId: string) => ({
    authenticated: true,
    platformAccountId,
    isPlatformOperator: false,
    context: 'a'.repeat(43),
  });
  fetcher.mockImplementation((url: string) =>
    Promise.resolve(
      response(
        url === '/api/nuni/session'
          ? principal(first)
          : { schools: [{ id: 'pu', name: '靜宜大學' }] },
      ),
    ),
  );
  render(
    <CampusProviders>
      <DraftJourney />
    </CampusProviders>,
  );
  await waitFor(() => expect(screen.getByLabelText('助理可執行').textContent).toBe('true'));
  fireEvent.change(screen.getByLabelText('助理未送文字'), { target: { value: '同帳號未送草稿' } });
  let resume!: (value: Response) => void;
  fetcher.mockImplementation((url: string) =>
    url === '/api/nuni/session'
      ? new Promise<Response>((resolve) => {
          resume = resolve;
        })
      : Promise.resolve(response({ schools: [{ id: 'pu', name: '靜宜大學' }] })),
  );
  fireEvent.click(screen.getByRole('button', { name: '確認登入' }));
  expect(screen.getByLabelText('助理可執行').textContent).toBe('false');
  expect((screen.getByLabelText('助理未送文字') as HTMLInputElement).value).toBe('同帳號未送草稿');
  await act(async () => {
    resume(response(principal(first)));
  });
  expect((screen.getByLabelText('助理未送文字') as HTMLInputElement).value).toBe('同帳號未送草稿');
  fireEvent.click(screen.getByRole('button', { name: '確認登入' }));
  await act(async () => {
    resume(response(principal(second)));
  });
  expect((screen.getByLabelText('助理未送文字') as HTMLInputElement).value).toBe('');
  fireEvent.click(screen.getByRole('button', { name: '確認登入' }));
  await act(async () => {
    resume(response(principal(first)));
  });
  expect((screen.getByLabelText('助理未送文字') as HTMLInputElement).value).toBe('');
});
it('retains a known Firebase owner during a temporary identity check, then clears after confirmed sign-out', async () => {
  fetcher.mockImplementation((url: string) =>
    Promise.resolve(
      response(
        url === '/api/nuni/session'
          ? { authenticated: false }
          : { schools: [{ id: 'pu', name: '靜宜大學' }] },
      ),
    ),
  );
  const view = render(
    <CampusProviders>
      <DraftJourney />
    </CampusProviders>,
  );
  await waitFor(() => expect(screen.getByLabelText('助理可執行').textContent).toBe('true'));
  fireEvent.change(screen.getByLabelText('助理未送文字'), { target: { value: '暫停但保留' } });
  user.uid = null;
  user.loading = true;
  view.rerender(
    <CampusProviders>
      <DraftJourney />
    </CampusProviders>,
  );
  expect((screen.getByLabelText('助理未送文字') as HTMLInputElement).value).toBe('暫停但保留');
  expect(screen.getByLabelText('助理可執行').textContent).toBe('false');
  user.uid = 'alice';
  user.loading = false;
  view.rerender(
    <CampusProviders>
      <DraftJourney />
    </CampusProviders>,
  );
  expect((screen.getByLabelText('助理未送文字') as HTMLInputElement).value).toBe('暫停但保留');
  user.uid = null;
  view.rerender(
    <CampusProviders>
      <DraftJourney />
    </CampusProviders>,
  );
  expect((screen.getByLabelText('助理未送文字') as HTMLInputElement).value).toBe('');
});
