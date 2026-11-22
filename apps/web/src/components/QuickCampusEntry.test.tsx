import { directoryDraftCases } from '@/test/directoryDraftCases';
import { directoryStorageFailures, rejectDirectoryStorage } from '@/test/directoryStorageFailures';
import { SchoolLmsReadonlyProvider } from '@/components/SchoolLmsReadonlyProvider';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QuickCampusEntry } from './QuickCampusEntry';
import { interpretCampusRequest } from '@/lib/campusIntentClient';
import { DIRECTORY_SEARCH_STORAGE_KEY } from '@/lib/campusDirectorySearch';

const state = vi.hoisted(() => ({
  uid: 'alice' as string | null,
  loading: false,
  error: null as Error | null,
  platform: false,
  accountId: 'platform-account',
  context: 'platform-context',
  platformLoading: false,
  platformError: '',
  pendingLogout: false,
  school: null as null | { id: string; code: string },
  schoolProvider: false,
  schoolLoading: false,
  schoolStatus: 'ready' as 'loading' | 'ready' | 'error',
}));
vi.mock('./AuthGuard', () => ({
  useAuth: () => ({
    user: state.uid ? { uid: state.uid } : null,
    loading: state.loading,
    error: state.error,
  }),
}));
vi.mock('./SelectedSchoolProvider', () => ({
  useOptionalSelectedSchool: () =>
    state.schoolProvider || state.school
      ? {
          selectedSchool: state.school,
          loading: state.schoolLoading,
          catalogStatus: state.schoolStatus,
        }
      : null,
}));
vi.mock('@/features/nuni/Session', () => ({
  useOptionalNuniSession: () =>
    state.platform || state.pendingLogout || state.platformError || state.platformLoading
      ? {
          session: state.platform ? { platformAccountId: state.accountId, context: state.context } : null,
          loading: state.platformLoading,
          error: state.platformError,
          pendingLogout: state.pendingLogout,
        }
      : null,
}));
vi.mock('@/lib/campusIntentClient', () => ({
  interpretCampusRequest: vi.fn(),
}));
vi.mock('./VoiceDictationButton', () => ({
  VoiceDictationButton: ({ onTranscript }: { onTranscript: (value: string) => void }) => (
    <button type="button" onClick={() => onTranscript('明天沒課，我想讀書再吃飯')}>
      模擬語音輸入
    </button>
  ),
}));

beforeEach(() => {
  state.uid = 'alice';
  state.loading = false;
  state.error = null;
  state.platform = false;
  state.accountId = 'platform-account';
  state.context = 'platform-context';
  state.platformLoading = false;
  state.platformError = '';
  state.pendingLogout = false;
  state.school = null;
  state.schoolProvider = false;
  state.schoolLoading = false;
  state.schoolStatus = 'ready';
  vi.clearAllMocks();
  sessionStorage.clear();
  window.history.replaceState({}, '', '/');
});
afterEach(() => vi.unstubAllEnvs());

it('sends the finished voice transcript through AI and renders multiple validated actions', async () => {
  vi.mocked(interpretCampusRequest).mockResolvedValue({
    status: 'understood',
    source: 'model',
    summary: '想確認空堂，再找地方讀書和吃飯。',
    destinations: ['/timetable', '/library', '/cafeteria'],
    clarifyingQuestion: null,
  });
  render(<QuickCampusEntry />);
  fireEvent.click(screen.getByText('模擬語音輸入'));
  expect(interpretCampusRequest).toHaveBeenCalledWith({
    uid: 'alice',
    schoolId: '',
    utterance: '明天沒課，我想讀書再吃飯',
  });
  expect(await screen.findByText('想確認空堂，再找地方讀書和吃飯。')).toBeTruthy();
  expect(screen.getByText('AI 建議先開啟')).toBeTruthy();
  expect(screen.getByRole('link', { name: /課表/ })).toBeTruthy();
  expect(screen.getByRole('link', { name: /圖書館/ })).toBeTruthy();
});

it('keeps manually typed questions private until the user asks for AI interpretation', async () => {
  vi.mocked(interpretCampusRequest).mockResolvedValue({
    status: 'clarify',
    source: 'model',
    summary: '還需要再確認。',
    destinations: [],
    clarifyingQuestion: '要讀書還是借書？',
  });
  render(<QuickCampusEntry />);
  fireEvent.change(screen.getByRole('searchbox', { name: '想做什麼？' }), {
    target: { value: '有點累' },
  });
  expect(interpretCampusRequest).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '用 AI 理解這句話' }));
  expect(await screen.findByText('要讀書還是借書？')).toBeTruthy();
});

it.each(['school', 'platform'] as const)(
  'confirms a local search without interpreting or handing off the %s account request',
  (account) => {
    if (account === 'platform') {
      state.uid = null;
      state.platform = true;
    }
    const onAsk = vi.fn();
    render(<QuickCampusEntry compact onAsk={onAsk} />);
    const input = screen.getByRole('searchbox', { name: '想做什麼？' });
    const form = screen.getByRole('search', { name: '快速尋找服務' });
    fireEvent.change(input, { target: { value: '想安排讀書時間再去借書' } });
    input.focus();

    // An IME commit must stay in the input, including WebKit's 229 fallback
    // after compositionend. fireEvent.submit separately models native submission.
    fireEvent.compositionStart(input);
    expect(fireEvent.keyDown(input, { key: 'Enter', isComposing: true })).toBe(false);
    fireEvent.submit(form);
    expect(document.activeElement).toBe(input);
    fireEvent.compositionEnd(input);
    expect(fireEvent.keyDown(input, { key: 'Enter', keyCode: 229 })).toBe(false);
    expect(document.activeElement).toBe(input);
    expect(fireEvent.keyDown(input, { key: 'Enter', keyCode: 13 })).toBe(true);
    fireEvent.submit(form);

    expect(document.activeElement).toBe(screen.getByRole('region', { name: '服務搜尋結果' }));
    expect(interpretCampusRequest).not.toHaveBeenCalled();
    expect(onAsk).not.toHaveBeenCalled();
    expect(window.location.pathname).toBe('/');
    expect((input as HTMLInputElement).value).toBe('想安排讀書時間再去借書');
  },
);

it('lets its containing assistant close on Escape without clearing the draft', () => {
  const closeAssistant = vi.fn();
  render(
    <div
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !event.defaultPrevented) closeAssistant();
      }}
    >
      <QuickCampusEntry compact />
    </div>,
  );
  const input = screen.getByRole('searchbox', { name: '想做什麼？' });
  fireEvent.change(input, { target: { value: '明天下課後想去圖書館' } });
  fireEvent.compositionStart(input);
  fireEvent.keyDown(input, { key: 'Escape', isComposing: true });
  expect(closeAssistant).not.toHaveBeenCalled();
  fireEvent.compositionEnd(input);
  fireEvent.keyDown(input, { key: 'Escape' });
  expect(closeAssistant).toHaveBeenCalledOnce();
  expect((input as HTMLInputElement).value).toBe('明天下課後想去圖書館');
});

it('keeps labels and submitted result focus local when two quick entries are mounted', () => {
  render(
    <>
      <QuickCampusEntry />
      <QuickCampusEntry compact />
    </>,
  );
  const first = screen.getByRole('region', { name: '想做什麼？從這裡開始。' });
  const second = screen.getByRole('region', { name: '搜尋服務' });
  const firstInput = within(first).getByRole('searchbox', {
    name: '想做什麼？',
  }) as HTMLInputElement;
  const secondInput = within(second).getByRole('searchbox', {
    name: '想做什麼？',
  }) as HTMLInputElement;
  expect(firstInput.id).not.toBe(secondInput.id);
  expect(firstInput.labels?.[0]?.control).toBe(firstInput);
  expect(secondInput.labels?.[0]?.control).toBe(secondInput);
  expect(document.getElementById(first.getAttribute('aria-labelledby')!)).toBe(
    within(first).getByRole('heading'),
  );
  expect(document.getElementById(second.getAttribute('aria-labelledby')!)).toBe(
    within(second).getByRole('heading'),
  );

  fireEvent.change(firstInput, { target: { value: '借書' } });
  fireEvent.change(secondInput, { target: { value: '搭公車' } });
  fireEvent.submit(within(second).getByRole('search', { name: '快速尋找服務' }));
  expect(document.activeElement).toBe(within(second).getByRole('region', { name: '服務搜尋結果' }));
  fireEvent.click(within(second).getByRole('button', { name: '重新輸入' }));
  expect(document.activeElement).toBe(secondInput);
  expect(secondInput.value).toBe('');
  expect(firstInput.value).toBe('借書');
  expect(interpretCampusRequest).not.toHaveBeenCalled();
});

it('offers an explicit private-message destination without sending the instruction to a model', () => {
  render(<QuickCampusEntry />);
  fireEvent.change(screen.getByRole('searchbox', { name: '想做什麼？' }), {
    target: { value: '開啟私人訊息' },
  });
  expect(screen.getByRole('link', { name: /^訊息查看自己的私人對話/ }).getAttribute('href')).toBe(
    '/dms',
  );
  expect(screen.queryByRole('button', { name: '用 AI 理解這句話' })).toBeNull();
  expect(interpretCampusRequest).not.toHaveBeenCalled();
});

it.each([
  ['開啟 App 餐廳訂單', 'App 餐廳訂單', '/orders'],
  ['開啟我的訂單', '我的訂單', '/food'],
  ['開啟教材收藏', '教材收藏', '/classroom/material-bookmarks'],
])('keeps the requested service for a platform account: %s', (phrase, label, href) => {
  state.platform = true;
  vi.stubEnv('NEXT_PUBLIC_ONLINE_ORDERING', 'true');
  const view = render(<QuickCampusEntry />);
  fireEvent.change(screen.getByRole('searchbox', { name: '想做什麼？' }), {
    target: { value: phrase },
  });
  const link = screen.getByRole('link', { name: (name) => name.startsWith(label) });
  expect(link.getAttribute('href')).toBe(href);
  fireEvent.click(link);
  view.unmount();
  window.history.replaceState({}, '', href);
  window.history.replaceState({}, '', '/');
  render(<QuickCampusEntry />);
  expect((screen.getByRole('searchbox', { name: '想做什麼？' }) as HTMLInputElement).value).toBe(
    phrase,
  );
  expect(
    screen.getByRole('link', { name: (name) => name.startsWith(label) }).getAttribute('href'),
  ).toBe(href);
  expect(screen.queryByRole('button', { name: '用 AI 理解這句話' })).toBeNull();
  expect(interpretCampusRequest).not.toHaveBeenCalled();
});

it('presents the resolved platform food availability without offering disabled App orders', () => {
  state.platform = true;
  vi.stubEnv('NEXT_PUBLIC_ONLINE_ORDERING', 'false');
  render(<QuickCampusEntry />);
  const input = screen.getByRole('searchbox', { name: '想做什麼？' });
  fireEvent.change(input, { target: { value: '開啟我的訂單' } });
  const orders = screen.getByRole('link', { name: /^我的訂單/ });
  expect(orders.getAttribute('href')).toBe('/food');
  expect(orders.textContent).toContain('目前還不能線上點餐');
  fireEvent.change(input, { target: { value: '開啟 App 餐廳訂單' } });
  expect(screen.queryByRole('link', { name: /^App 餐廳訂單/ })).toBeNull();
});

it.each([false, true])(
  'applies the readonly flag to explicit school service commands (%s)',
  (enabled) => {
    render(
      <SchoolLmsReadonlyProvider enabled={enabled}>
        <QuickCampusEntry />
      </SchoolLmsReadonlyProvider>,
    );
    fireEvent.change(screen.getByRole('searchbox', { name: '想做什麼？' }), {
      target: { value: '開啟玩課雲作業' },
    });
    expect(
      Boolean(
        screen.queryByRole('link', { name: (_, el) => el.getAttribute('href') === '/school-lms' }),
      ),
    ).toBe(enabled);
    expect(interpretCampusRequest).not.toHaveBeenCalled();
  },
);

it('never exposes a previous AI answer after a transcript change or logout', async () => {
  let resolve!: (result: Awaited<ReturnType<typeof interpretCampusRequest>>) => void;
  vi.mocked(interpretCampusRequest).mockReturnValue(
    new Promise((done) => {
      resolve = done;
    }),
  );
  const view = render(<QuickCampusEntry />);
  fireEvent.click(screen.getByText('模擬語音輸入'));
  fireEvent.change(screen.getByRole('searchbox', { name: '想做什麼？' }), {
    target: { value: '我要交作業' },
  });
  await act(async () =>
    resolve({
      status: 'understood',
      source: 'model',
      summary: '舊的結果',
      destinations: ['/map'],
      clarifyingQuestion: null,
    }),
  );
  expect(screen.queryByText('舊的結果')).toBeNull();
  state.uid = null;
  view.rerender(<QuickCampusEntry />);
  expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('');
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: '想安排讀書時間' } });
  expect(screen.queryByText('用 AI 理解這句話')).toBeNull();
  expect(
    screen.getByText('目前顯示服務捷徑；登入 Google 或學校帳號後，可使用校園助理。'),
  ).toBeTruthy();
});

it('does not claim AI understanding if the provider is unavailable', async () => {
  vi.mocked(interpretCampusRequest).mockRejectedValue(new Error('offline'));
  render(<QuickCampusEntry />);
  fireEvent.click(screen.getByText('模擬語音輸入'));
  await waitFor(() => expect(screen.getByText(/AI 暫時無法使用/)).toBeTruthy());
  expect(screen.queryByText('AI 建議先開啟')).toBeNull();
});

it.each([false, true])(
  'filters readonly destinations from voice results with enabled=%s',
  async (enabled) => {
    vi.mocked(interpretCampusRequest).mockResolvedValue(
      JSON.parse(
        JSON.stringify({
          status: 'understood',
          source: 'model',
          summary: '查看作業',
          destinations: ['/school-lms', '/classroom'],
          clarifyingQuestion: null,
        }),
      ),
    );
    render(
      <SchoolLmsReadonlyProvider enabled={enabled}>
        <QuickCampusEntry />
      </SchoolLmsReadonlyProvider>,
    );
    fireEvent.click(screen.getByText('模擬語音輸入'));
    await screen.findByText('查看作業');
    expect(
      Boolean(
        screen.queryByRole('link', { name: (_, el) => el.getAttribute('href') === '/school-lms' }),
      ),
    ).toBe(enabled);
    expect(
      screen
        .getByRole('link', {
          name: (_, el) => (el.getAttribute('href') || '').startsWith('/classroom'),
        })
        .getAttribute('href'),
    ).toContain('/classroom');
  },
);

it('keeps the quick-entry query after returning from a matched service', () => {
  const view = render(<QuickCampusEntry />);
  fireEvent.change(screen.getByRole('searchbox', { name: '想做什麼？' }), {
    target: { value: '借書' },
  });
  fireEvent.click(screen.getByRole('link', { name: /圖書館/ }));
  view.unmount();
  window.history.replaceState({}, '', '/library');
  const away = render(<QuickCampusEntry />);
  expect((screen.getByRole('searchbox', { name: '想做什麼？' }) as HTMLInputElement).value).toBe(
    '',
  );
  away.unmount();
  window.history.replaceState({}, '', '/');
  render(<QuickCampusEntry />);
  expect((screen.getByRole('searchbox', { name: '想做什麼？' }) as HTMLInputElement).value).toBe(
    '借書',
  );
  expect(screen.getByRole('link', { name: /圖書館/ })).toBeTruthy();
});

it('reports an ordinary service selection once even when its destination is already open', () => {
  window.history.replaceState({}, '', '/library');
  const onNavigate = vi.fn();
  render(<QuickCampusEntry onNavigate={onNavigate} />);
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: '借書' } });
  fireEvent.click(screen.getByRole('link', { name: /圖書館/ }));
  expect(onNavigate).toHaveBeenCalledExactlyOnceWith('/library');
  expect(JSON.parse(sessionStorage.getItem(DIRECTORY_SEARCH_STORAGE_KEY)!).quick).toMatchObject({
    path: '/library',
    destination: '/library',
    query: '借書',
  });
});

it.each([
  { metaKey: true },
  { ctrlKey: true },
  { shiftKey: true },
  { altKey: true },
  { button: 1 },
])('preserves the current quick task and draft storage for modified clicks: %s', (gesture) => {
  const onNavigate = vi.fn();
  render(<QuickCampusEntry onNavigate={onNavigate} />);
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: '借書' } });
  fireEvent.click(screen.getByRole('link', { name: /圖書館/ }), gesture);
  expect(onNavigate).not.toHaveBeenCalled();
  expect(sessionStorage.getItem(DIRECTORY_SEARCH_STORAGE_KEY)).toBeNull();
  expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('借書');
});

it.each([
  ['target', '_blank'],
  ['target', 'service-reference'],
  ['download', ''],
])('does not treat a %s=%s link as leaving the current task', (attribute, value) => {
  const onNavigate = vi.fn();
  render(<QuickCampusEntry onNavigate={onNavigate} />);
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: '借書' } });
  const link = screen.getByRole('link', { name: /圖書館/ });
  link.setAttribute(attribute, value);
  fireEvent.click(link);
  expect(onNavigate).not.toHaveBeenCalled();
  expect(sessionStorage.getItem(DIRECTORY_SEARCH_STORAGE_KEY)).toBeNull();
});

it('does not store a return draft or close its container when navigation was cancelled', () => {
  const onNavigate = vi.fn();
  render(
    <div onClickCapture={(event) => event.preventDefault()}>
      <QuickCampusEntry onNavigate={onNavigate} />
    </div>,
  );
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: '借書' } });
  fireEvent.click(screen.getByRole('link', { name: /圖書館/ }));
  expect(onNavigate).not.toHaveBeenCalled();
  expect(sessionStorage.getItem(DIRECTORY_SEARCH_STORAGE_KEY)).toBeNull();
  expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('借書');
});

it('does not restore the quick-entry query after starting over', () => {
  const view = render(<QuickCampusEntry />);
  fireEvent.change(screen.getByRole('searchbox', { name: '想做什麼？' }), {
    target: { value: '借書' },
  });
  fireEvent.click(screen.getByRole('link', { name: /圖書館/ }));
  view.unmount();
  window.history.replaceState({}, '', '/');
  const home = render(<QuickCampusEntry />);
  expect((screen.getByRole('searchbox', { name: '想做什麼？' }) as HTMLInputElement).value).toBe(
    '借書',
  );
  fireEvent.click(screen.getByRole('button', { name: '重新輸入' }));
  expect(document.activeElement).toBe(screen.getByRole('searchbox', { name: '想做什麼？' }));
  expect(sessionStorage.getItem(DIRECTORY_SEARCH_STORAGE_KEY)).toBeNull();
  expect((screen.getByRole('searchbox', { name: '想做什麼？' }) as HTMLInputElement).value).toBe(
    '',
  );
  home.unmount();
  render(<QuickCampusEntry />);
  expect((screen.getByRole('searchbox', { name: '想做什麼？' }) as HTMLInputElement).value).toBe(
    '',
  );
});

it('offers semester grades and their preview when the model returns the shared grades destination', async () => {
  vi.mocked(interpretCampusRequest).mockResolvedValue({
    status: 'understood',
    source: 'model',
    summary: '查詢學期成績',
    destinations: ['/grades'],
    clarifyingQuestion: null,
    previews: [
      {
        destination: '/grades',
        status: 'available',
        source: 'campus-platform',
        message: '已匯入兩筆成績',
        items: [{ title: '資料庫', detail: '91 分' }],
      },
    ],
  });
  render(<QuickCampusEntry />);
  fireEvent.click(screen.getByText('模擬語音輸入'));
  const grades = await screen.findByRole('link', { name: /已匯入兩筆成績/ });
  expect(grades.getAttribute('href')).toBe('/grades?tab=semester');
  expect(grades.textContent).toContain('資料庫 · 91 分');
});

it('hands a Google account request to the inline assistant only after an explicit action', () => {
  state.uid = null;
  state.platform = true;
  state.school = { id: 'pu', code: 'PU' };
  const onAsk = vi.fn();
  render(<QuickCampusEntry onAsk={onAsk} />);
  fireEvent.click(screen.getByText('模擬語音輸入'));
  expect(interpretCampusRequest).not.toHaveBeenCalled();
  expect(onAsk).not.toHaveBeenCalled();
  expect(screen.queryByText(/登入學校帳號後，可使用 AI/)).toBeNull();
  expect(screen.queryByRole('link', { name: /校園助理/ })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '交給校園助理' }));
  expect(onAsk).toHaveBeenCalledExactlyOnceWith('明天沒課，我想讀書再吃飯');
  expect(interpretCampusRequest).not.toHaveBeenCalled();
});

it('carries the platform request and selected campus to the full assistant without school analysis', () => {
  state.uid = null;
  state.platform = true;
  state.school = { id: 'pu', code: 'PU' };
  render(<QuickCampusEntry />);
  const phrase = '明天讀書 & 午餐，要怎麼安排？';
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: phrase } });
  const handoff = screen.getByRole('link', { name: '交給校園助理' });
  const url = new URL(handoff.getAttribute('href')!, 'https://campus.example');
  expect(url.pathname).toBe('/ai-assistant');
  expect(url.searchParams.get('q')).toBe(phrase);
  expect(url.searchParams.get('schoolId')).toBe('pu');
  expect(url.searchParams.get('campus')).toBe('pu');
  expect(screen.queryByRole('button', { name: '用 AI 理解這句話' })).toBeNull();
  fireEvent.click(handoff);
  expect(sessionStorage.getItem(DIRECTORY_SEARCH_STORAGE_KEY)).not.toContain('platform-context');
  expect(interpretCampusRequest).not.toHaveBeenCalled();
});

it('respects an explicitly unavailable inline composer instead of offering a second assistant route', () => {
  state.uid = null;
  state.platform = true;
  render(<QuickCampusEntry onAsk={null} />);
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: '想安排明天' } });
  expect(screen.queryByRole('button', { name: /校園助理/ })).toBeNull();
  expect(screen.queryByRole('link', { name: /校園助理/ })).toBeNull();
  expect(interpretCampusRequest).not.toHaveBeenCalled();
});

it.each(['school-loading', 'school-error', 'platform-loading', 'platform-error', 'signing-out'])(
  'keeps unavailable account states out of school analysis and assistant handoff: %s',
  (status) => {
    if (status === 'school-loading') state.loading = true;
    if (status === 'school-error') state.error = new Error('expired');
    if (status.startsWith('platform') || status === 'signing-out') {
      state.uid = null;
      state.platform = true;
      state.platformLoading = status === 'platform-loading';
      state.platformError = status === 'platform-error' ? 'expired' : '';
      state.pendingLogout = status === 'signing-out';
    }
    const onAsk = vi.fn();
    render(<QuickCampusEntry onAsk={onAsk} />);
    fireEvent.click(screen.getByText('模擬語音輸入'));
    expect(screen.queryByRole('button', { name: '用 AI 理解這句話' })).toBeNull();
    expect(screen.queryByRole('button', { name: /校園助理/ })).toBeNull();
    expect(interpretCampusRequest).not.toHaveBeenCalled();
    expect(onAsk).not.toHaveBeenCalled();
  },
);

it.each(['account', 'session', 'campus'])(
  'clears the earlier draft and rejects a late response after changing %s',
  async (change) => {
    state.platform = true;
    let resolve!: (result: Awaited<ReturnType<typeof interpretCampusRequest>>) => void;
    vi.mocked(interpretCampusRequest).mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const view = render(<QuickCampusEntry />);
    fireEvent.click(screen.getByText('模擬語音輸入'));
    if (change === 'account') state.accountId = 'second-account';
    if (change === 'session') state.context = 'second-session';
    if (change === 'campus') state.school = { id: 'nthu', code: 'NTHU' };
    view.rerender(<QuickCampusEntry />);
    expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('');
    await act(async () =>
      resolve({
        status: 'understood',
        source: 'model',
        summary: '上一個範圍的私人結果',
        destinations: ['/map'],
        clarifyingQuestion: null,
      }),
    );
    expect(screen.queryByText('上一個範圍的私人結果')).toBeNull();
    state.accountId = 'platform-account';
    state.context = 'platform-context';
    state.school = null;
    view.rerender(<QuickCampusEntry />);
    expect(screen.queryByText('上一個範圍的私人結果')).toBeNull();
    expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('');
  },
);

it('keeps the same account draft during session refresh without allowing analysis while checking', () => {
  state.platform = true;
  const view = render(<QuickCampusEntry />);
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: '下週想安排讀書' } });
  state.platformLoading = true;
  view.rerender(<QuickCampusEntry />);
  expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('下週想安排讀書');
  expect(screen.queryByRole('button', { name: '用 AI 理解這句話' })).toBeNull();
  state.platformLoading = false;
  view.rerender(<QuickCampusEntry />);
  expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('下週想安排讀書');
  expect(screen.getByRole('button', { name: '用 AI 理解這句話' })).toBeTruthy();
  expect(interpretCampusRequest).not.toHaveBeenCalled();
});

it('does not restore an earlier platform account query after leaving and returning', () => {
  state.uid = null;
  state.platform = true;
  const view = render(<QuickCampusEntry />);
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: '借書' } });
  fireEvent.click(screen.getByRole('link', { name: /圖書館/ }));
  view.unmount();
  state.accountId = 'second-account';
  render(<QuickCampusEntry />);
  expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('');
  expect(sessionStorage.getItem(DIRECTORY_SEARCH_STORAGE_KEY)).toBeNull();
});

it.each(['pu', 'all', 'personal'])(
  'keeps the draft when the initial campus resolves to %s',
  (campus) => {
    state.schoolProvider = true;
    state.schoolLoading = true;
    window.history.replaceState({}, '', campus === 'pu' ? '/' : `/?campus=${campus}`);
    const view = render(<QuickCampusEntry />);
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '借書' } });
    state.schoolLoading = false;
    state.school = campus === 'pu' ? { id: 'pu', code: 'PU' } : null;
    view.rerender(<QuickCampusEntry />);
    expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('借書');
    const target = new URL(
      screen.getByRole('link', { name: /圖書館/ }).getAttribute('href')!,
      'https://campus.example',
    );
    expect(target.searchParams.get('campus')).toBe(campus === 'pu' ? 'pu' : 'all');
    expect(interpretCampusRequest).not.toHaveBeenCalled();

    state.school = { id: 'nthu', code: 'NTHU' };
    view.rerender(<QuickCampusEntry />);
    expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('');
  },
);

it.each(['loading', 'error'] as const)(
  'does not interpret or save a draft under an unconfirmed campus: %s',
  (status) => {
    state.schoolProvider = true;
    state.schoolLoading = status === 'loading';
    state.schoolStatus = status;
    render(<QuickCampusEntry />);
    fireEvent.click(screen.getByRole('button', { name: '模擬語音輸入' }));
    expect(interpretCampusRequest).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: '用 AI 理解這句話' })).toBeNull();
    fireEvent.click(screen.getByRole('link', { name: /所有服務/ }));
    expect(sessionStorage.getItem(DIRECTORY_SEARCH_STORAGE_KEY)).toBeNull();
    expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe(
      '明天沒課，我想讀書再吃飯',
    );
  },
);

it.each([
  ['pu', 'loading'],
  ['all', 'loading'],
  ['all', 'error'],
] as const)(
  'keeps a %s draft through campus %s and rejects an earlier interpretation',
  async (campus, status) => {
    state.schoolProvider = true;
    state.school = campus === 'pu' ? { id: 'pu', code: 'PU' } : null;
    let finish!: (result: Awaited<ReturnType<typeof interpretCampusRequest>>) => void;
    vi.mocked(interpretCampusRequest).mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const view = render(<QuickCampusEntry />);
    fireEvent.click(screen.getByRole('button', { name: '模擬語音輸入' }));
    state.schoolLoading = status === 'loading';
    state.schoolStatus = status;
    // Even a provider retaining its last school while rechecking must invalidate the result.
    view.rerender(<QuickCampusEntry />);
    expect(screen.queryByRole('button', { name: '用 AI 理解這句話' })).toBeNull();
    await act(async () =>
      finish({
        status: 'understood',
        source: 'model',
        summary: '重查校園前的結果',
        destinations: ['/map'],
        clarifyingQuestion: null,
      }),
    );
    expect(screen.queryByText('重查校園前的結果')).toBeNull();
    state.schoolLoading = false;
    state.schoolStatus = 'ready';
    view.rerender(<QuickCampusEntry />);
    expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe(
      '明天沒課，我想讀書再吃飯',
    );
    expect(screen.queryByText('重查校園前的結果')).toBeNull();
    expect(interpretCampusRequest).toHaveBeenCalledTimes(1);
  },
);

it.each(['account', 'session'])(
  'still clears an unconfirmed-campus draft when its %s changes',
  (change) => {
    state.platform = true;
    state.schoolProvider = true;
    state.schoolLoading = true;
    const view = render(<QuickCampusEntry />);
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '私人讀書安排' } });
    if (change === 'account') state.accountId = 'second-account';
    else state.context = 'second-session';
    view.rerender(<QuickCampusEntry />);
    expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('');
    state.schoolLoading = false;
    state.school = { id: 'pu', code: 'PU' };
    view.rerender(<QuickCampusEntry />);
    expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('');
  },
);

it.each([false, true])(
  'defers a saved draft until campus resolution and respects new typing (%s)',
  (editWhileLoading) => {
    state.schoolProvider = true;
    state.school = { id: 'pu', code: 'PU' };
    const first = render(<QuickCampusEntry />);
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '借書' } });
    fireEvent.click(screen.getByRole('link', { name: /圖書館/ }));
    first.unmount();
    state.school = null;
    state.schoolLoading = true;
    const view = render(<QuickCampusEntry />);
    expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('');
    if (editWhileLoading)
      fireEvent.change(screen.getByRole('searchbox'), { target: { value: '找公車' } });
    state.schoolLoading = false;
    state.school = { id: 'pu', code: 'PU' };
    view.rerender(<QuickCampusEntry />);
    expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe(
      editWhileLoading ? '找公車' : '借書',
    );
  },
);

it('does not revive a saved quick draft after another account types while its campus is pending', () => {
  state.schoolProvider = true;
  state.school = { id: 'pu', code: 'PU' };
  const view = render(<QuickCampusEntry />);
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: '借書' } });
  fireEvent.click(screen.getByRole('link', { name: /圖書館/ }));
  state.uid = 'bob';
  state.schoolLoading = true;
  view.rerender(<QuickCampusEntry />);
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: '找公車' } });
  state.schoolLoading = false;
  view.rerender(<QuickCampusEntry />);
  expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('找公車');
  state.uid = 'alice';
  view.rerender(<QuickCampusEntry />);
  expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('');
  expect(sessionStorage.getItem(DIRECTORY_SEARCH_STORAGE_KEY)).toBeNull();
});

it('keeps the saved query through sign-out and restores it after the same account returns', () => {
  state.uid = null;
  state.platform = true;
  const view = render(<QuickCampusEntry />);
  const input = screen.getByRole<HTMLInputElement>('searchbox');
  fireEvent.change(input, { target: { value: '借書' } });
  fireEvent.click(screen.getByRole('link', { name: /圖書館/ }));
  const stored = sessionStorage.getItem(DIRECTORY_SEARCH_STORAGE_KEY);
  expect(stored).toBeTruthy();

  state.pendingLogout = true;
  view.rerender(<QuickCampusEntry />);
  state.platform = false;
  view.rerender(<QuickCampusEntry />);
  expect(input.value).toBe('');
  expect(sessionStorage.getItem(DIRECTORY_SEARCH_STORAGE_KEY)).toBe(stored);

  state.platform = true;
  state.pendingLogout = false;
  view.rerender(<QuickCampusEntry />);
  expect(input.value).toBe('借書');
});

describe.each(directoryStorageFailures)('quick navigation with storage %s', (failure) => {
  it.each([
    [/圖書館/, '/library'],
    ['詢問校園助理', '/ai-assistant'],
    ['搜尋更多服務', '/search'],
  ] as const)('follows %s and invokes the panel navigation callback', (name, path) => {
    const onNavigate = vi.fn();
    render(<QuickCampusEntry onNavigate={onNavigate} />);
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '借書' } });
    const link = screen.getByRole('link', { name });
    const storage = rejectDirectoryStorage(failure);
    try {
      expect(fireEvent.click(link)).toBe(true);
    } finally {
      storage.mockRestore();
    }
    const [href] = onNavigate.mock.calls[0];
    expect(onNavigate).toHaveBeenCalledTimes(1);
    expect(new URL(href, window.location.origin).pathname).toBe(path);
    expect(sessionStorage.getItem(DIRECTORY_SEARCH_STORAGE_KEY)).toBeNull();
  });
});

it.each([['alice'], [null]])('restores the latest quick draft after a campus switch for %s', (uid) => {
  state.uid = uid;
  state.school = { id: 'pu', code: 'PU' };
  const view = render(<QuickCampusEntry />);
  const input = screen.getByRole<HTMLInputElement>('searchbox');
  fireEvent.change(input, { target: { value: '借書' } });
  fireEvent.click(screen.getByRole('link', { name: /圖書館/ }));

  state.school = { id: 'nthu', code: 'NTHU' };
  view.rerender(<QuickCampusEntry />);
  expect(input.value).toBe('');
  fireEvent.change(input, { target: { value: '找公車' } });
  fireEvent.click(screen.getByRole('link', { name: /公車/ }));
  view.unmount();
  render(<QuickCampusEntry />);
  expect(screen.getByRole<HTMLInputElement>('searchbox').value).toBe('找公車');
});

it('replaces the quick draft through account A, guest and account B', () => {
  for (const [uid, query] of [['alice', '借書'], [null, '找公車'], ['bob', '續借']] as const) {
    state.uid = uid;
    const view = render(<QuickCampusEntry />);
    const input = screen.getByRole<HTMLInputElement>('searchbox');
    expect(input.value).toBe('');
    fireEvent.change(input, { target: { value: query } });
    fireEvent.click(screen.getByRole('link', { name: uid === null ? /公車/ : /圖書館/ }));
    view.unmount();
    const returned = render(<QuickCampusEntry />);
    expect(screen.getByRole<HTMLInputElement>('searchbox').value).toBe(query);
    returned.unmount();
  }
});

it('keeps a saved quick draft while the same campus account is temporarily unverified', () => {
  const view = render(<QuickCampusEntry />);
  const input = screen.getByRole<HTMLInputElement>('searchbox');
  fireEvent.change(input, { target: { value: '借書' } });
  fireEvent.click(screen.getByRole('link', { name: /圖書館/ }));
  const stored = sessionStorage.getItem(DIRECTORY_SEARCH_STORAGE_KEY);
  expect(stored).toBeTruthy();

  state.uid = null;
  state.error = new Error('Verification unavailable');
  view.rerender(<QuickCampusEntry />);
  fireEvent.change(input, { target: { value: '找公車' } });
  fireEvent.click(screen.getByRole('link', { name: /公車/ }));
  expect(sessionStorage.getItem(DIRECTORY_SEARCH_STORAGE_KEY)).toBe(stored);

  state.uid = 'alice';
  state.error = null;
  view.rerender(<QuickCampusEntry />);
  expect(input.value).toBe('借書');
});

it.each(directoryDraftCases)('checks a saved search when $name', (entry) => {
  state.uid = entry.saved === 'platform' ? null : 'a';
  state.platform = entry.saved !== 'school';
  state.accountId = 'a';
  state.school = { id: 'pu', code: 'PU' };
  const first = render(<QuickCampusEntry />);
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: '借書' } });
  fireEvent.click(screen.getByRole('link', { name: /圖書館/ }));
  first.unmount();
  window.history.replaceState({}, '', '/');
  state.uid = entry.school === 'failed' ? null : entry.school;
  state.error = entry.school === 'failed' ? new Error('unavailable') : null;
  state.platform = entry.platform !== 'failed';
  state.accountId = entry.platform;
  state.platformError = entry.platform === 'failed' ? 'unavailable' : '';
  if ('campus' in entry) state.school = { id: entry.campus, code: 'NTHU' };
  render(<QuickCampusEntry />);
  expect(screen.getByRole<HTMLInputElement>('searchbox').value).toBe(entry.restored ? '借書' : '');
  expect(Boolean(sessionStorage.getItem(DIRECTORY_SEARCH_STORAGE_KEY))).toBe(entry.restored || 'retained' in entry);
});

it('clears a restored draft if the other source later confirms a different account', () => {
  state.uid = 'alice';
  state.platform = true;
  const first = render(<QuickCampusEntry />);
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: '借書' } });
  fireEvent.click(screen.getByRole('link', { name: /圖書館/ }));
  first.unmount();
  window.history.replaceState({}, '', '/');

  state.platform = false;
  state.platformError = 'unavailable';
  const returned = render(<QuickCampusEntry />);
  expect(screen.getByRole<HTMLInputElement>('searchbox').value).toBe('借書');
  state.platform = true;
  state.platformError = '';
  state.accountId = 'another-account';
  returned.rerender(<QuickCampusEntry />);
  expect(screen.getByRole<HTMLInputElement>('searchbox').value).toBe('');
  expect(sessionStorage.getItem(DIRECTORY_SEARCH_STORAGE_KEY)).toBeNull();
});

it('claims a provisional draft on the first successful verification', () => {
  state.uid = null;
  state.error = new Error('unavailable');
  state.platformError = 'unavailable';
  const first = render(<QuickCampusEntry />);
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: '借書' } });
  fireEvent.click(screen.getByRole('link', { name: /圖書館/ }));
  first.unmount();
  window.history.replaceState({}, '', '/');

  state.uid = 'alice';
  state.error = null;
  const returned = render(<QuickCampusEntry />);
  expect(screen.getByRole<HTMLInputElement>('searchbox').value).toBe('借書');
  returned.unmount();
  state.uid = 'another-account';
  render(<QuickCampusEntry />);
  expect(screen.getByRole<HTMLInputElement>('searchbox').value).toBe('');
});
