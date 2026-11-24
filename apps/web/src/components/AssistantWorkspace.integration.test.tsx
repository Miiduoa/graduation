import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useRef } from 'react';
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { AssistantEnabledProvider } from './AssistantEnabledProvider';
import { AssistantWorkspaceProvider } from './AssistantWorkspaceProvider';
import { AppHeader } from './AppHeader';
import { TodayAssistantDisclosure, type TodayAssistantHandle } from './TodayCampusEntry';

const state = vi.hoisted(() => ({
  account: 'alpha',
  context: 'a'.repeat(43) as string | null,
  school: 'pu',
  pathname: '/',
  search: 'campus=pu',
  pendingLogout: false,
  nuniLoading: false,
  campusLoading: false,
}));
vi.mock('./AuthGuard', () => ({ useAuth: () => ({ user: null, loading: false, error: null }) }));
vi.mock('./SchoolSelector', () => ({ SchoolSelector: () => null }));
vi.mock('./CampusServiceMenu', () => ({ CampusServiceMenu: () => null }));
vi.mock('@/features/nuni/Session', () => {
  const session = () => ({
    session: state.context ? { context: state.context, platformAccountId: state.account } : null,
    loading: state.nuniLoading,
    error: null,
    pendingLogout: state.pendingLogout,
  });
  return { useNuniSession: session, useOptionalNuniSession: session };
});
vi.mock('./SelectedSchoolProvider', () => ({
  useOptionalSelectedSchool: () => ({
    selectedSchool:
      state.school && !state.campusLoading
        ? { id: state.school, name: state.school === 'pu' ? '靜宜大學' : '中興大學' }
        : null,
    selectedSchoolId: state.campusLoading ? null : state.school || null,
    catalogStatus: 'ready',
    loading: state.campusLoading,
  }),
}));
vi.mock('next/navigation', () => ({
  usePathname: () => state.pathname,
  useSearchParams: () => new URLSearchParams(state.search),
}));
vi.mock('@/lib/functionsUrl', async (original) => ({
  ...(await original<typeof import('@/lib/functionsUrl')>()),
  areFunctionsConfigured: () => true,
}));

const fetcher = vi.fn();
// Compile the large, lazy assistant module before timing its user interactions.
beforeAll(async () => {
  await import('@/features/nuni/Assistant');
}, 15000);
function Fixture() {
  const entry = useRef<TodayAssistantHandle>(null);
  return (
    <AssistantEnabledProvider enabled>
      <AssistantWorkspaceProvider>
        <AppHeader />
        <label>
          頁面筆記
          <input />
        </label>
        {state.pathname === '/' ? (
          <TodayAssistantDisclosure ref={entry} onOpenChange={() => {}} />
        ) : (
          <h1>課程工作區</h1>
        )}
      </AssistantWorkspaceProvider>
    </AssistantEnabledProvider>
  );
}
function askRequests() {
  return fetcher.mock.calls.filter(([url]) => url === '/api/nuni/assistant/ask');
}
async function openQuestion(text: string) {
  fireEvent.change(screen.getByLabelText('想完成的事'), { target: { value: text } });
  fireEvent.submit(screen.getByRole('form', { name: '開始校園任務' }));
  const panel = await screen.findByRole('region', { name: '校園助理' });
  await within(panel).findByRole('textbox', { name: '問題' }, { timeout: 5000 });
  return panel;
}
beforeEach(() => {
  Object.assign(state, {
    account: 'alpha',
    context: 'a'.repeat(43),
    school: 'pu',
    pathname: '/',
    search: 'campus=pu',
    pendingLogout: false,
    nuniLoading: false,
    campusLoading: false,
  });
  localStorage.clear();
  sessionStorage.clear();
  window.history.replaceState({}, '', '/');
  fetcher.mockReset().mockImplementation((url) => {
    if (url === '/api/nuni/assistant/capability')
      return Promise.resolve(Response.json({ version: 2, enabled: true, ready: true }));
    if (url === '/api/nuni/assistant/ask')
      return Promise.resolve(
        Response.json({ answer: '先整理目標，再確認需要的資料。', steps: [], cards: [] }),
      );
    throw new Error('Unexpected request: ' + url);
  });
  vi.stubGlobal('fetch', fetcher);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it('carries the real conversation, consent and draft through page navigation without repeating a request', async () => {
  const view = render(<Fixture />);
  const panel = await openQuestion('協助我思考報告的開場');
  expect((within(panel).getByLabelText('問題') as HTMLTextAreaElement).value).toBe(
    '協助我思考報告的開場',
  );
  expect(askRequests()).toHaveLength(0);
  fireEvent.click(within(panel).getByRole('checkbox'));
  fireEvent.submit(within(panel).getByRole('form', { name: '傳送問題' }));
  await within(panel).findByText('先整理目標，再確認需要的資料。');
  fireEvent.change(within(panel).getByLabelText('問題'), { target: { value: '保留第二段問題' } });
  state.pathname = '/classroom';
  state.search = 'campus=pu&tab=assignments';
  view.rerender(<Fixture />);
  expect(screen.queryByRole('region', { name: '校園助理' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '開啟校園助理' }));
  const resumed = await screen.findByRole('region', { name: '校園助理' });
  expect(resumed).toBe(panel);
  expect(within(resumed).getByText('先整理目標，再確認需要的資料。')).toBeTruthy();
  expect((within(resumed).getByLabelText('問題') as HTMLTextAreaElement).value).toBe(
    '保留第二段問題',
  );
  expect((within(resumed).getByRole('checkbox') as HTMLInputElement).checked).toBe(true);
  expect(askRequests()).toHaveLength(1);
  expect(
    fetcher.mock.calls.filter(([url]) => url === '/api/nuni/assistant/capability'),
  ).toHaveLength(1);
});

it('shares edits in both directions and keeps IME confirmation from opening or closing the workspace', async () => {
  render(<Fixture />);
  const homeDraft = screen.getByLabelText('想完成的事');
  fireEvent.compositionStart(homeDraft);
  fireEvent.keyDown(homeDraft, { key: 'Enter', isComposing: true });
  expect(screen.queryByRole('region', { name: '校園助理' })).toBeNull();
  fireEvent.compositionEnd(homeDraft);
  fireEvent.click(screen.getByRole('button', { name: '這禮拜有什麼要交的' }));
  expect(askRequests()).toHaveLength(0);
  const panel = await openQuestion('保留我的原始問題');
  fireEvent.change(within(panel).getByLabelText('問題'), {
    target: { value: '在助理內修改過的內容' },
  });
  fireEvent.keyDown(panel, { key: 'Escape', isComposing: true });
  expect(screen.getByRole('region', { name: '校園助理' })).toBe(panel);
  fireEvent.click(within(panel).getByRole('button', { name: '收合' }));
  expect((screen.getByLabelText('想完成的事') as HTMLTextAreaElement).value).toBe(
    '在助理內修改過的內容',
  );
  expect(askRequests()).toHaveLength(0);
});

it('discards a late response and consent when the account changes', async () => {
  let finish!: (value: Response) => void;
  let oldSignal: AbortSignal | undefined;
  fetcher.mockImplementation((url, init) => {
    if (url === '/api/nuni/assistant/capability')
      return Promise.resolve(Response.json({ version: 2, enabled: true, ready: true }));
    if (url === '/api/nuni/assistant/ask') {
      oldSignal = init.signal;
      return new Promise<Response>((resolve) => {
        finish = resolve;
      });
    }
    throw new Error('Unexpected request: ' + url);
  });
  const view = render(<Fixture />);
  const panel = await openQuestion('第一個帳號的報告問題');
  fireEvent.click(within(panel).getByRole('checkbox'));
  fireEvent.submit(within(panel).getByRole('form', { name: '傳送問題' }));
  await waitFor(() => expect(askRequests()).toHaveLength(1));
  state.account = 'beta';
  state.context = 'b'.repeat(43);
  view.rerender(<Fixture />);
  expect(screen.queryByRole('region', { name: '校園助理' })).toBeNull();
  expect((screen.getByLabelText('想完成的事') as HTMLTextAreaElement).value).toBe('');
  expect(oldSignal?.aborted).toBe(true);
  await act(async () => {
    finish(Response.json({ answer: '前一個帳號的私人回覆', steps: [], cards: [] }));
  });
  fireEvent.click(screen.getByRole('button', { name: '開啟校園助理' }));
  const next = await screen.findByRole('region', { name: '校園助理' });
  await within(next).findByRole('checkbox');
  expect(within(next).queryByText('前一個帳號的私人回覆')).toBeNull();
  expect((within(next).getByRole('checkbox') as HTMLInputElement).checked).toBe(false);
});

it('clears drafts when the campus changes and shares a guest request with local service search', async () => {
  const view = render(<Fixture />);
  await openQuestion('校園 A 的私人草稿');
  state.school = 'nchu';
  state.search = 'campus=nchu';
  view.rerender(<Fixture />);
  expect((screen.getByLabelText('想完成的事') as HTMLTextAreaElement).value).toBe('');
  state.context = null;
  view.rerender(<Fixture />);
  fireEvent.change(screen.getByLabelText('想完成的事'), { target: { value: '圖書館' } });
  fireEvent.submit(screen.getByRole('form', { name: '開始校園任務' }));
  const search = await screen.findByRole('searchbox', { name: '想做什麼？' });
  expect((search as HTMLInputElement).value).toBe('圖書館');
  fireEvent.change(search, { target: { value: '公車' } });
  fireEvent.click(screen.getByRole('button', { name: '收合' }));
  expect((screen.getByLabelText('想完成的事') as HTMLTextAreaElement).value).toBe('公車');
  expect(askRequests()).toHaveLength(0);
});

it('pauses private content during a same-session recheck, then restores history and the unsent draft', async () => {
  const view = render(<Fixture />);
  const panel = await openQuestion('協助我思考報告的開場');
  fireEvent.click(within(panel).getByRole('checkbox'));
  fireEvent.submit(within(panel).getByRole('form', { name: '傳送問題' }));
  await within(panel).findByText('先整理目標，再確認需要的資料。');
  fireEvent.change(within(panel).getByLabelText('問題'), { target: { value: '等我回來的第二題' } });
  state.nuniLoading = true;
  state.campusLoading = true;
  view.rerender(<Fixture />);
  expect(screen.queryByRole('log', { name: '對話紀錄' })).toBeNull();
  expect((screen.getByLabelText('想完成的事') as HTMLTextAreaElement).value).toBe('');
  expect((screen.getByLabelText('想完成的事') as HTMLTextAreaElement).disabled).toBe(true);
  screen.getByLabelText('頁面筆記').focus();
  fireEvent.change(screen.getByLabelText('頁面筆記'), { target: { value: '切回來繼續寫筆記' } });
  state.nuniLoading = false;
  state.campusLoading = false;
  view.rerender(<Fixture />);
  expect(screen.getByRole('region', { name: '校園助理' })).toBe(panel);
  expect(within(panel).getByText('先整理目標，再確認需要的資料。')).toBeTruthy();
  expect((within(panel).getByLabelText('問題') as HTMLTextAreaElement).value).toBe(
    '等我回來的第二題',
  );
  expect((within(panel).getByRole('checkbox') as HTMLInputElement).checked).toBe(true);
  expect(askRequests()).toHaveLength(1);
  expect(document.activeElement).toBe(screen.getByLabelText('頁面筆記'));
});

it('stops an in-flight answer on revalidation and never resumes it automatically', async () => {
  let finish!: (value: Response) => void;
  let oldSignal: AbortSignal | undefined;
  fetcher.mockImplementation((url, init) => {
    if (url === '/api/nuni/assistant/capability')
      return Promise.resolve(Response.json({ version: 2, enabled: true, ready: true }));
    if (url === '/api/nuni/assistant/ask') {
      oldSignal = init.signal;
      return new Promise<Response>((resolve) => {
        finish = resolve;
      });
    }
    throw new Error('Unexpected request: ' + url);
  });
  const view = render(<Fixture />);
  const panel = await openQuestion('還在思考的報告問題');
  fireEvent.click(within(panel).getByRole('checkbox'));
  fireEvent.submit(within(panel).getByRole('form', { name: '傳送問題' }));
  await waitFor(() => expect(askRequests()).toHaveLength(1));
  state.nuniLoading = true;
  state.campusLoading = true;
  view.rerender(<Fixture />);
  expect(oldSignal?.aborted).toBe(true);
  await act(async () => {
    finish(Response.json({ answer: '過期回覆不應重新出現', steps: [], cards: [] }));
  });
  state.nuniLoading = false;
  state.campusLoading = false;
  view.rerender(<Fixture />);
  expect(screen.queryByText('過期回覆不應重新出現')).toBeNull();
  expect(askRequests()).toHaveLength(1);
  expect(screen.getByRole('region', { name: '校園助理' })).toBe(panel);
});

it('keeps an unconfirmed action visible across navigation without confirming or replaying it', async () => {
  fetcher.mockImplementation((url) => {
    if (url === '/api/nuni/assistant/capability')
      return Promise.resolve(Response.json({ version: 2, enabled: true, ready: true }));
    if (url === '/api/nuni/assistant/ask')
      return Promise.resolve(
        Response.json({
          answer: '先核對這個準備時段。',
          steps: [],
          cards: [
            {
              tool: 'propose_personal_event',
              token: 'workspace-test-token',
              mutationId: 'workspace-event-1',
              schoolId: 'pu',
              destination: '個人行事曆',
              args: {
                title: '報告準備',
                date: '2030-11-04',
                allDay: false,
                startTime: '20:00',
                endTime: '21:00',
              },
            },
          ],
        }),
      );
    throw new Error('Unexpected mutation: ' + url);
  });
  const view = render(<Fixture />);
  const panel = await openQuestion('幫我排作業');
  fireEvent.click(within(panel).getByRole('checkbox'));
  fireEvent.submit(within(panel).getByRole('form', { name: '傳送問題' }));
  const confirmation = await within(panel).findByRole('button', { name: '確認' });
  state.pathname = '/calendar';
  view.rerender(<Fixture />);
  fireEvent.click(screen.getByRole('button', { name: '開啟校園助理' }));
  expect(within(panel).getByRole('button', { name: '確認' })).toBe(confirmation);
  expect(within(panel).getByRole('heading', { name: '報告準備' })).toBeTruthy();
  expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
    '/api/nuni/assistant/capability',
    '/api/nuni/assistant/ask',
  ]);
});
