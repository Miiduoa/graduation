import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CampusProviders } from '@/components/CampusProviders';
import { schoolPreferenceKey, useSelectedSchool } from '@/components/SelectedSchoolProvider';
import { PersonalCalendar } from './PersonalCalendar';
import { useNuniSession } from '@/features/nuni/Session';
import { personalImportSavedNotice } from '@campus/shared';
import { personalImportsStorageKey, readPersonalImports } from '@/lib/personalImports';
import { loadHomeData } from '@/lib/homeOverview';

type SessionReply = {
  body: Record<string, unknown>;
  status: number;
  delayed: boolean;
  release: (() => void) | null;
};
const state = vi.hoisted(() => ({
  session: { authenticated: false } as Record<string, unknown>,
  sessionCalls: 0,
  replies: [] as SessionReply[],
  requests: [] as { path: string; method: string }[],
  unexpectedRequests: [] as string[],
  search: 'campus=pu',
  auth: { user: null as { uid: string } | null, loading: false, error: null as Error | null },
  holdNextLock: false,
  lockGrants: [] as (() => void)[],
  lockCalls: 0,
}));
vi.mock('@/components/AuthGuard', () => ({ useAuth: () => state.auth }));
vi.mock('@/components/imports/PersonalImportSync', () => ({
  PersonalImportSyncBridge: () => null,
}));
vi.mock('@/lib/homeOverview', () => ({ loadHomeData: vi.fn() }));
vi.mock('next/navigation', () => ({
  usePathname: () => '/calendar',
  useSearchParams: () => new URLSearchParams(state.search),
  useRouter: () => ({
    replace: (href: string) => {
      state.search = new URL(href, 'https://fixture.invalid').search.slice(1);
    },
  }),
}));
vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: { children: React.ReactNode; href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

const ACCOUNT_A = 'pa_11111111-1111-4111-8111-111111111111';
const ACCOUNT_B = 'pa_22222222-2222-4222-8222-222222222222';
const TITLE = '合成個人安排';
const guest = { authenticated: false };
const principal = (id = ACCOUNT_A) => ({
  authenticated: true,
  platformAccountId: id,
  isPlatformOperator: false,
  context: (id === ACCOUNT_A ? 'a' : 'b').repeat(43),
});
const scope = (owner = `platform:${ACCOUNT_A}`, schoolId = 'pu') => ({ owner, schoolId });

function Controls() {
  const school = useSelectedSchool();
  const nuni = useNuniSession();
  return (
    <>
      <button onClick={() => school.selectSchool('pu')}>選合成校園甲</button>
      <button onClick={() => school.selectSchool('ntu')}>選合成校園乙</button>
      <output data-testid="selected-school">
        {school.loading ? 'pending' : (school.selectedSchoolId ?? 'personal')}
      </output>
      <output data-testid="platform-account">{nuni.session?.platformAccountId ?? 'guest'}</output>
    </>
  );
}
function TestApp() {
  return (
    <CampusProviders>
      <Controls />
      <PersonalCalendar />
    </CampusProviders>
  );
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-02T04:00:00.000Z'));
  Object.assign(state, {
    session: guest,
    sessionCalls: 0,
    replies: [],
    requests: [],
    unexpectedRequests: [],
    search: 'campus=pu',
    auth: { user: null, loading: false, error: null },
    holdNextLock: false,
    lockGrants: [],
    lockCalls: 0,
  });
  localStorage.clear();
  vi.mocked(loadHomeData).mockReset();
  vi.mocked(loadHomeData).mockResolvedValue({ tasks: [], courses: [], unreadCount: 0 });
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
  Object.defineProperty(navigator, 'locks', {
    configurable: true,
    value: {
      request: (_key: string, action: () => unknown) => {
        state.lockCalls += 1;
        if (!state.holdNextLock) return Promise.resolve().then(action);
        state.holdNextLock = false;
        return new Promise((resolve, reject) => {
          state.lockGrants.push(() => {
            void Promise.resolve().then(action).then(resolve, reject);
          });
        });
      },
    },
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const path = String(input);
      const method = init?.method ?? 'GET';
      state.requests.push({ path, method });
      if (method !== 'GET' || init?.body !== undefined) {
        state.unexpectedRequests.push(`${method} ${path}`);
        throw new Error('Only synthetic GET fixtures are allowed');
      }
      if (path === '/api/schools')
        return new Response(
          JSON.stringify({
            schools: [
              { id: 'pu', name: '合成校園甲', status: 'open' },
              { id: 'ntu', name: '合成校園乙', status: 'open' },
            ],
          }),
          { status: 200 },
        );
      if (path === '/api/nuni/session') {
        state.sessionCalls += 1;
        const reply = state.replies.shift();
        const body = JSON.stringify(reply?.body ?? state.session);
        if (reply?.delayed)
          await new Promise<void>((resolve) => {
            reply.release = resolve;
          });
        return new Response(body, { status: reply?.status ?? 200 });
      }
      state.unexpectedRequests.push(`${method} ${path}`);
      throw new Error(`Unexpected fixture request: ${path}`);
    }),
  );
});
afterEach(() => {
  expect(state.unexpectedRequests).toEqual([]);
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function queueSession(body = state.session, status = 200, delayed = false): SessionReply {
  const reply = { body, status, delayed, release: null };
  state.replies.push(reply);
  return reply;
}
async function ready(schoolId = 'pu') {
  await waitFor(() => {
    expect(screen.getByTestId('selected-school').textContent).toBe(schoolId);
    expect((screen.getByRole('button', { name: '新增行程' }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });
}
function fillDraft(title = TITLE) {
  fireEvent.click(screen.getByRole('button', { name: '新增行程' }));
  fireEvent.change(screen.getByRole('textbox', { name: '標題' }), { target: { value: title } });
  fireEvent.change(screen.getByLabelText('日期'), { target: { value: '2026-11-02' } });
}
async function openDraft(title = TITLE, schoolId = 'pu') {
  const view = render(<TestApp />);
  await ready(schoolId);
  fillDraft(title);
  return view;
}
const draftTitle = () => (screen.getByRole('textbox', { name: '標題' }) as HTMLInputElement).value;
function expectNoVisibleDraft() {
  expect(screen.queryByRole('textbox', { name: '標題' })).toBeNull();
  expect(screen.queryByRole('button', { name: '儲存行程' })).toBeNull();
}
async function refresh(event: 'visibilitychange' | 'pageshow' = 'visibilitychange') {
  const calls = state.sessionCalls;
  if (event === 'pageshow') fireEvent(window, new Event(event));
  else fireEvent(document, new Event(event));
  await waitFor(() => expect(state.sessionCalls).toBe(calls + 1));
}
async function startPausedRefresh() {
  const reply = queueSession(state.session, 200, true);
  await refresh();
  await waitFor(() => expect(reply.release).not.toBeNull());
  expectNoVisibleDraft();
  return reply;
}
async function finishRefresh(reply: SessionReply, schoolId = 'pu') {
  await act(async () => {
    reply.release?.();
  });
  await ready(schoolId);
}
async function saveNew() {
  fireEvent.click(screen.getByRole('button', { name: '儲存行程' }));
  await screen.findByText(personalImportSavedNotice(1));
}

it.each([
  ['guest', 'pu'],
  ['platform', 'pu'],
  ['guest', 'personal'],
  ['platform', 'personal'],
] as const)(
  'restores an unsaved %s draft in %s after foreground validation, then saves locally and reads it after returning',
  async (identity, schoolId) => {
    state.session = identity === 'platform' ? principal() : guest;
    state.search = schoolId === 'personal' ? 'campus=all' : 'campus=pu';
    const owner = identity === 'platform' ? `platform:${ACCOUNT_A}` : 'guest';
    const view = await openDraft(TITLE, schoolId);
    const pending = await startPausedRefresh();
    expect(localStorage.getItem(personalImportsStorageKey(scope(owner, schoolId)))).toBeNull();
    await finishRefresh(pending, schoolId);
    expect(draftTitle()).toBe(TITLE);
    expect(state.sessionCalls).toBe(2);
    expect(state.requests.map(({ path }) => path)).toEqual([
      '/api/schools',
      '/api/nuni/session',
      '/api/nuni/session',
    ]);
    await saveNew();
    const saved = readPersonalImports(scope(owner, schoolId));
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ title: TITLE, kind: 'events', schoolId });
    view.unmount();
    render(<TestApp />);
    await ready(schoolId);
    expect(readPersonalImports(scope(owner, schoolId))).toEqual(saved);
    expect(screen.getAllByText(TITLE).length).toBeGreaterThan(0);
    expectNoVisibleDraft();
  },
);
it.each(['guest', 'platform'] as const)(
  'preserves saved %s data during a same-identity refresh without school authorization',
  async (identity) => {
    state.session = identity === 'platform' ? principal() : guest;
    const owner = identity === 'platform' ? `platform:${ACCOUNT_A}` : 'guest';
    await openDraft();
    await saveNew();
    const saved = readPersonalImports(scope(owner));
    const pending = await startPausedRefresh();
    await finishRefresh(pending);
    expect(readPersonalImports(scope(owner))).toEqual(saved);
    expect(screen.getAllByText(TITLE).length).toBeGreaterThan(0);
    expect(saved).toHaveLength(1);
  },
);
it('retains an edited record through pageshow and updates only that record after confirmation', async () => {
  state.session = principal();
  await openDraft();
  await saveNew();
  const original = readPersonalImports(scope())[0];
  fireEvent.click(screen.getByRole('button', { name: '列表' }));
  fireEvent.click(screen.getByRole('button', { name: '編輯' }));
  fireEvent.change(screen.getByRole('textbox', { name: '標題' }), {
    target: { value: '合成改期安排' },
  });
  const pending = queueSession(state.session, 200, true);
  await refresh('pageshow');
  expectNoVisibleDraft();
  await finishRefresh(pending);
  expect(draftTitle()).toBe('合成改期安排');
  fireEvent.click(screen.getByRole('button', { name: '儲存修改' }));
  await screen.findByText('個人行程已更新。');
  const records = readPersonalImports(scope());
  expect(records).toHaveLength(1);
  expect(records[0]).toMatchObject({
    id: original.id,
    source: original.source,
    title: '合成改期安排',
  });
});
it('hides a retained draft after session GET 503 and retries the same account on this page', async () => {
  state.session = principal();
  await openDraft();
  queueSession({ error: 'UNAVAILABLE' }, 503);
  await refresh();
  const retry = await screen.findByRole('button', { name: '重新確認帳號' });
  expectNoVisibleDraft();
  expect(screen.queryByRole('button', { name: '新增行程' })).toBeNull();
  expect(readPersonalImports(scope('guest'))).toEqual([]);
  fireEvent.click(retry);
  await ready();
  expect(draftTitle()).toBe(TITLE);
  await saveNew();
  expect(readPersonalImports(scope())).toHaveLength(1);
  expect(readPersonalImports(scope('guest'))).toEqual([]);
});
it('does not show a guest editor while the initial account request is unconfirmed', async () => {
  state.session = principal();
  queueSession({ error: 'UNAVAILABLE' }, 503);
  render(<TestApp />);
  const retry = await screen.findByRole('button', { name: '重新確認帳號' });
  expectNoVisibleDraft();
  expect(screen.queryByRole('button', { name: '新增行程' })).toBeNull();
  fireEvent.click(retry);
  await ready();
  fillDraft();
  await saveNew();
  expect(readPersonalImports(scope())).toHaveLength(1);
  expect(readPersonalImports(scope('guest'))).toEqual([]);
});
it('offers session retry before the independent Firebase error and resumes the verified platform draft', async () => {
  state.session = principal();
  const view = await openDraft();
  state.auth.error = new Error('synthetic Firebase unavailable');
  view.rerender(<TestApp />);
  queueSession({ error: 'UNAVAILABLE' }, 503);
  await refresh();
  const retry = await screen.findByRole('button', { name: '重新確認帳號' });
  expectNoVisibleDraft();
  expect(screen.queryByRole('button', { name: '重新整理頁面' })).toBeNull();
  fireEvent.click(retry);
  await ready();
  expect(draftTitle()).toBe(TITLE);
  await saveNew();
  expect(readPersonalImports(scope())).toHaveLength(1);
  expect(readPersonalImports(scope('guest'))).toEqual([]);
});
it('rejects a late A response after B resolves and does not revive drafts after A→B→A', async () => {
  state.session = principal();
  await openDraft('帳號甲未存稿');
  const staleA = await startPausedRefresh();
  state.session = principal(ACCOUNT_B);
  await refresh();
  await ready();
  expect(screen.getByTestId('platform-account').textContent).toBe(ACCOUNT_B);
  expectNoVisibleDraft();
  fillDraft('帳號乙未存稿');
  await act(async () => {
    staleA.release?.();
  });
  expect(screen.getByTestId('platform-account').textContent).toBe(ACCOUNT_B);
  expect(draftTitle()).toBe('帳號乙未存稿');
  state.session = principal();
  await refresh();
  await ready();
  expect(screen.getByTestId('platform-account').textContent).toBe(ACCOUNT_A);
  expectNoVisibleDraft();
  expect(readPersonalImports(scope())).toEqual([]);
  expect(readPersonalImports(scope(`platform:${ACCOUNT_B}`))).toEqual([]);
});
it.each(['loading', 'error'] as const)(
  'does not revive A after verified platform A→B→A while the separate Firebase identity has %s',
  async (condition) => {
    state.session = principal();
    const view = await openDraft('甲原始草稿');
    state.auth = {
      user: null,
      loading: condition === 'loading',
      error: condition === 'error' ? new Error('synthetic Firebase unavailable') : null,
    };
    view.rerender(<TestApp />);
    if (condition === 'loading') expectNoVisibleDraft();
    else expect(draftTitle()).toBe('甲原始草稿');
    state.session = principal(ACCOUNT_B);
    await refresh();
    await waitFor(() => expect(screen.getByTestId('platform-account').textContent).toBe(ACCOUNT_B));
    expectNoVisibleDraft();
    expect(screen.queryByDisplayValue('甲原始草稿')).toBeNull();
    state.session = principal();
    await refresh();
    await waitFor(() => expect(screen.getByTestId('platform-account').textContent).toBe(ACCOUNT_A));
    state.auth = { user: null, loading: false, error: null };
    view.rerender(<TestApp />);
    await ready();
    expectNoVisibleDraft();
    expect(readPersonalImports(scope())).toEqual([]);
    fillDraft('甲重新建立');
    await saveNew();
    expect(readPersonalImports(scope()).map((row) => row.title)).toEqual(['甲重新建立']);
  },
);
it('isolates drafts when the real selected-school provider switches campus and switches back', async () => {
  state.session = principal();
  await openDraft('校園甲未存稿');
  fireEvent.click(screen.getByRole('button', { name: '選合成校園乙' }));
  await ready('ntu');
  expectNoVisibleDraft();
  fillDraft('校園乙未存稿');
  fireEvent.click(screen.getByRole('button', { name: '選合成校園甲' }));
  await ready();
  expectNoVisibleDraft();
  expect(readPersonalImports(scope())).toEqual([]);
  expect(readPersonalImports(scope(`platform:${ACCOUNT_A}`, 'ntu'))).toEqual([]);
});
it('rejects a queued write granted while validation is paused and retains the draft for one retry', async () => {
  state.session = principal();
  await openDraft();
  state.holdNextLock = true;
  fireEvent.click(screen.getByRole('button', { name: '儲存行程' }));
  expect(state.lockGrants).toHaveLength(1);
  const pending = await startPausedRefresh();
  await act(async () => {
    state.lockGrants.shift()?.();
  });
  expect(readPersonalImports(scope())).toEqual([]);
  expectNoVisibleDraft();
  await finishRefresh(pending);
  expect(draftTitle()).toBe(TITLE);
  expect(screen.queryByText(personalImportSavedNotice(1))).toBeNull();
  await saveNew();
  expect(readPersonalImports(scope())).toHaveLength(1);
  expect(state.lockCalls).toBe(2);
});
it('does not offer a duplicate retry when the write completed before validation but its receipt arrives later', async () => {
  state.session = principal();
  await openDraft();
  let acknowledge: (() => void) | null = null;
  Object.defineProperty(navigator, 'locks', {
    configurable: true,
    value: {
      request: (_key: string, action: () => unknown) => {
        state.lockCalls += 1;
        return Promise.resolve()
          .then(action)
          .then(
            (value) =>
              new Promise((resolve) => {
                acknowledge = () => resolve(value);
              }),
          );
      },
    },
  });
  fireEvent.click(screen.getByRole('button', { name: '儲存行程' }));
  await waitFor(() => expect(acknowledge).not.toBeNull());
  const saved = readPersonalImports(scope());
  expect(saved).toHaveLength(1);
  const pending = await startPausedRefresh();
  await act(async () => {
    acknowledge?.();
  });
  expectNoVisibleDraft();
  await finishRefresh(pending);
  expectNoVisibleDraft();
  expect(readPersonalImports(scope())).toEqual(saved);
  expect(state.lockCalls).toBe(1);
  expect(screen.getByText(personalImportSavedNotice(1))).toBeTruthy();
});
it('rejects a queued write from the first A workspace after A→B→A without clearing the new draft', async () => {
  state.session = principal();
  await openDraft('舊甲待存稿');
  state.holdNextLock = true;
  fireEvent.click(screen.getByRole('button', { name: '儲存行程' }));
  state.session = principal(ACCOUNT_B);
  await refresh();
  await ready();
  state.session = principal();
  await refresh();
  await ready();
  fillDraft('新的甲草稿');
  await act(async () => {
    state.lockGrants.shift()?.();
  });
  expect(draftTitle()).toBe('新的甲草稿');
  expect(readPersonalImports(scope())).toEqual([]);
  expect(screen.queryByText(personalImportSavedNotice(1))).toBeNull();
  await saveNew();
  expect(readPersonalImports(scope()).map((row) => row.title)).toEqual(['新的甲草稿']);
});
it('keeps the draft on local quota failure and saves exactly one record after retry', async () => {
  state.session = principal();
  await openDraft();
  const methods: Pick<Storage, 'setItem'> = Object.hasOwn(localStorage, 'setItem')
    ? localStorage
    : Object.getPrototypeOf(localStorage);
  const setItem = localStorage.setItem.bind(localStorage);
  const failedKey = personalImportsStorageKey(scope());
  const save = vi.spyOn(methods, 'setItem').mockImplementation((key: string, value: string) => {
    if (key === failedKey) throw new Error('synthetic quota');
    setItem(key, value);
  });
  const button = screen.getByRole('button', { name: '儲存行程' });
  button.focus();
  fireEvent.click(button);
  const error = await screen.findByText(/這次沒有存成/);
  expect(document.activeElement).toBe(button);
  expect(button.getAttribute('aria-describedby')).toBe(error.id);
  expect(within(screen.getByRole('region', { name: '新增行程' })).getByRole('alert')).toBe(error);
  expect(draftTitle()).toBe(TITLE);
  expect(readPersonalImports(scope())).toEqual([]);
  save.mockRestore();
  await saveNew();
  expect(readPersonalImports(scope())).toHaveLength(1);
  expect(state.lockCalls).toBe(2);
});
it('accepts only one write when save is clicked twice before the next render', async () => {
  state.session = principal();
  await openDraft();
  state.holdNextLock = true;
  const button = screen.getByRole('button', { name: '儲存行程' });
  button.focus();
  act(() => {
    fireEvent.click(button);
    fireEvent.click(button);
  });
  expect(state.lockCalls).toBe(1);
  expect(state.lockGrants).toHaveLength(1);
  expect(document.activeElement).toBe(button);
  expect(button.getAttribute('aria-disabled')).toBe('true');
  await act(async () => {
    state.lockGrants.shift()?.();
  });
  await screen.findByText(personalImportSavedNotice(1));
  expect(readPersonalImports(scope())).toHaveLength(1);
});
it('drops a draft when logout is pending and never offers a guest editor after a failed check', async () => {
  state.session = principal();
  await openDraft('登出前未存稿');
  queueSession({ authenticated: false, pendingLogout: true, context: 'a'.repeat(43) });
  await refresh();
  await screen.findByRole('button', { name: '重試登出' });
  expectNoVisibleDraft();
  expect(screen.queryByLabelText('標題')).toBeNull();
  expect(screen.queryByRole('button', { name: '新增行程' })).toBeNull();
  queueSession({ error: 'UNAVAILABLE' }, 503);
  await refresh();
  await screen.findByRole('button', { name: '重新確認帳號' });
  expectNoVisibleDraft();
  expect(screen.queryByRole('button', { name: '新增行程' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '重新確認帳號' }));
  await ready();
  expectNoVisibleDraft();
  expect(readPersonalImports(scope())).toEqual([]);
  expect(readPersonalImports(scope('guest'))).toEqual([]);
});
it('keeps an unknown Firebase identity hidden instead of treating its error as confirmed guest', async () => {
  state.auth.user = { uid: 'synthetic-firebase-a' };
  const view = await openDraft('原帳號未存稿');
  state.auth = { user: null, loading: false, error: new Error('synthetic auth unavailable') };
  view.rerender(<TestApp />);
  await screen.findByRole('button', { name: '重新整理頁面' });
  expectNoVisibleDraft();
  expect(screen.queryByRole('button', { name: '新增行程' })).toBeNull();
  expect(readPersonalImports(scope('guest'))).toEqual([]);
  state.auth = { user: { uid: 'synthetic-firebase-a' }, loading: false, error: null };
  view.rerender(<TestApp />);
  await ready();
  expect(draftTitle()).toBe('原帳號未存稿');
  state.auth = { user: null, loading: false, error: null };
  view.rerender(<TestApp />);
  await ready();
  expectNoVisibleDraft();
});
it.each(['pending', 'error'] as const)(
  'does not revive a Firebase A draft after confirmed A→B→A while platform validation is %s',
  async (condition) => {
    state.auth.user = { uid: 'synthetic-firebase-a' };
    const view = await openDraft('舊Firebase甲草稿');
    const pending = condition === 'pending' ? await startPausedRefresh() : null;
    if (condition === 'error') {
      queueSession({ error: 'UNAVAILABLE' }, 503);
      await refresh();
      await screen.findByRole('button', { name: '重新確認帳號' });
    }
    expectNoVisibleDraft();
    state.auth = { user: { uid: 'synthetic-firebase-b' }, loading: false, error: null };
    view.rerender(<TestApp />);
    expectNoVisibleDraft();
    expect(screen.queryByDisplayValue('舊Firebase甲草稿')).toBeNull();
    state.auth = { user: { uid: 'synthetic-firebase-a' }, loading: false, error: null };
    view.rerender(<TestApp />);
    if (pending) await finishRefresh(pending);
    else {
      fireEvent.click(screen.getByRole('button', { name: '重新確認帳號' }));
      await ready();
    }
    expectNoVisibleDraft();
    fillDraft('新的Firebase甲草稿');
    await saveNew();
    expect(
      readPersonalImports(scope('school:synthetic-firebase-a')).map((row) => row.title),
    ).toEqual(['新的Firebase甲草稿']);
    expect(readPersonalImports(scope('school:synthetic-firebase-b'))).toEqual([]);
  },
);
it('does not let retained cancel or export controls act while the account is being checked', async () => {
  state.session = principal();
  await openDraft('已保存可匯出的行程');
  await saveNew();
  const saved = readPersonalImports(scope());
  fillDraft();
  const cancel = screen.getByRole('button', { name: '取消' });
  const exportButton = screen.getByRole('button', { name: '匯出所選月份' });
  const createObjectURL = vi.spyOn(URL, 'createObjectURL');
  const pending = await startPausedRefresh();
  fireEvent.click(cancel);
  fireEvent.click(exportButton);
  expect(createObjectURL).not.toHaveBeenCalled();
  await finishRefresh(pending);
  expect(draftTitle()).toBe(TITLE);
  fireEvent.click(screen.getByRole('button', { name: '取消' }));
  expectNoVisibleDraft();
  expect(readPersonalImports(scope())).toEqual(saved);
});
it('cancels an edit without changing the saved record', async () => {
  state.session = principal();
  await openDraft();
  await saveNew();
  const saved = readPersonalImports(scope());
  fireEvent.click(screen.getByRole('button', { name: '列表' }));
  fireEvent.click(screen.getByRole('button', { name: '編輯' }));
  fireEvent.change(screen.getByRole('textbox', { name: '標題' }), {
    target: { value: '不應存入的修改' },
  });
  fireEvent.click(screen.getByRole('button', { name: '取消' }));
  expectNoVisibleDraft();
  expect(readPersonalImports(scope())).toEqual(saved);
});
it('rejects a delayed local write after leaving the page', async () => {
  state.session = principal();
  const view = await openDraft();
  state.holdNextLock = true;
  fireEvent.click(screen.getByRole('button', { name: '儲存行程' }));
  view.unmount();
  await act(async () => {
    state.lockGrants.shift()?.();
  });
  expect(readPersonalImports(scope())).toEqual([]);
  render(<TestApp />);
  await ready();
  expectNoVisibleDraft();
  expect(screen.queryByText(personalImportSavedNotice(1))).toBeNull();
});
it('does not show the previous Firebase deadline on the first render for a new user under one platform account', async () => {
  state.session = principal();
  state.auth.user = { uid: 'synthetic-firebase-a' };
  vi.mocked(loadHomeData).mockResolvedValueOnce({
    courses: [],
    unreadCount: 0,
    tasks: [
      {
        id: 'a-task',
        courseId: 'a-course',
        courseName: '合成課程甲',
        title: '甲帳號合成私人期限',
        dueAt: '2026-11-03T12:00:00+08:00',
      },
    ],
  });
  const view = await openDraft();
  await screen.findByText('甲帳號合成私人期限');
  vi.mocked(loadHomeData).mockImplementationOnce(() => new Promise(() => {}));
  state.auth = { user: { uid: 'synthetic-firebase-b' }, loading: false, error: null };
  view.rerender(<TestApp />);
  const previousDeadlineOnFirstRender = within(screen.getByTestId('calendar-due')).queryByRole(
    'heading',
    { name: '甲帳號合成私人期限' },
  );
  await act(async () => {});
  expect(previousDeadlineOnFirstRender).toBeNull();
  expect(draftTitle()).toBe(TITLE);
});

it('discards the prior campus draft after explicit pu-to-ntu-to-pu selection during session error', async () => {
  state.session = principal();
  await openDraft('原校園未存稿');
  queueSession({ error: 'UNAVAILABLE' }, 503);
  await refresh();
  await screen.findByRole('button', { name: '重新確認帳號' });
  expectNoVisibleDraft();
  fireEvent.click(screen.getByRole('button', { name: '選合成校園乙' }));
  await waitFor(() => expect(screen.getByTestId('selected-school').textContent).toBe('ntu'));
  expectNoVisibleDraft();
  fireEvent.click(screen.getByRole('button', { name: '選合成校園甲' }));
  await waitFor(() => expect(screen.getByTestId('selected-school').textContent).toBe('pu'));
  fireEvent.click(screen.getByRole('button', { name: '重新確認帳號' }));
  await ready('pu');
  const revived = screen.queryByRole('textbox', { name: '標題' }) as HTMLInputElement | null;
  expect(revived).toBeNull();
});
it('retains the prior draft when only unknown-owner fallback preferences change campus without an explicit URL', async () => {
  state.search = '';
  state.session = principal();
  localStorage.setItem(schoolPreferenceKey(`|${ACCOUNT_A}`), JSON.stringify({ schoolId: 'pu' }));
  localStorage.setItem(schoolPreferenceKey(null), JSON.stringify({ schoolId: 'ntu' }));
  await openDraft('保留原帳號未存稿');
  expect(state.search).toBe('');
  queueSession({ error: 'UNAVAILABLE' }, 503);
  await refresh();
  await screen.findByRole('button', { name: '重新確認帳號' });
  await waitFor(() => expect(screen.getByTestId('selected-school').textContent).toBe('ntu'));
  expectNoVisibleDraft();
  expect(state.search).toBe('');
  fireEvent.click(screen.getByRole('button', { name: '重新確認帳號' }));
  await ready('pu');
  const restored = screen.queryByRole('textbox', { name: '標題' }) as HTMLInputElement | null;
  expect(restored?.value).toBe('保留原帳號未存稿');
});

it('queued write from the prior campus cannot commit after explicit campus ABA during session error', async () => {
  state.session = principal();
  await openDraft('舊校園排隊稿');
  state.holdNextLock = true;
  fireEvent.click(screen.getByRole('button', { name: '儲存行程' }));
  expect(state.lockGrants).toHaveLength(1);
  queueSession({ error: 'UNAVAILABLE' }, 503);
  await refresh();
  await screen.findByRole('button', { name: '重新確認帳號' });
  fireEvent.click(screen.getByRole('button', { name: '選合成校園乙' }));
  await waitFor(() => expect(screen.getByTestId('selected-school').textContent).toBe('ntu'));
  fireEvent.click(screen.getByRole('button', { name: '選合成校園甲' }));
  await waitFor(() => expect(screen.getByTestId('selected-school').textContent).toBe('pu'));
  fireEvent.click(screen.getByRole('button', { name: '重新確認帳號' }));
  await screen.findByRole('button', { name: '新增行程' });
  await waitFor(() => expect(screen.queryByRole('button', { name: '重新確認帳號' })).toBeNull());
  expectNoVisibleDraft();
  await act(async () => {
    state.lockGrants.shift()?.();
  });
  const records = readPersonalImports(scope());
  expect(records).toEqual([]);
  expect(screen.queryByText(personalImportSavedNotice(1))).toBeNull();
  await ready();
  fillDraft('新校園草稿');
  await saveNew();
  expect(readPersonalImports(scope()).map((row) => row.title)).toEqual(['新校園草稿']);
});
