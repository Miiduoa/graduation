import { SchoolLmsReadonlyProvider } from '@/components/SchoolLmsReadonlyProvider';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { interpretCampusRequest } from '@/lib/campusIntentClient';
import { beforeEach, expect, it, vi } from 'vitest';
import SearchPage from './page';
import { visibleCampusServices } from '@/lib/campusServices';

const selection = vi.hoisted(() => ({
  current: null as null | {
    selectedSchool: { id: string; code?: string };
    loading: boolean;
    catalogStatus: string;
  },
}));
vi.mock('@/components/SelectedSchoolProvider', () => ({
  useOptionalSelectedSchool: () => selection.current,
}));

const userState = vi.hoisted(() => ({ uid: null as string | null }));
vi.mock('@/components/AuthGuard', () => ({
  useAuth: () => ({ user: userState.uid ? { uid: userState.uid } : null }),
}));
vi.mock('@/lib/campusIntentClient', () => ({ interpretCampusRequest: vi.fn() }));
const options = { studentId: false, loading: false, error: false, retry: vi.fn() };
vi.mock('@/lib/signInOptions', () => ({ useSignInOptions: () => options }));

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(window.location.search),
}));
beforeEach(() => {
  delete (window as Window & { SpeechRecognition?: unknown }).SpeechRecognition;
  window.history.replaceState({}, '', '/search');
  selection.current = null;
  userState.uid = null;
  vi.mocked(interpretCampusRequest).mockReset();
  options.studentId = false;
  options.loading = false;
  options.error = false;
  options.retry.mockClear();
});

vi.mock('@/components/SiteShell', () => ({
  SiteShell: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));

it('keeps every service discoverable without inventing a school selection', () => {
  render(<SearchPage />);
  expect(screen.getAllByRole('link')).toHaveLength(visibleCampusServices().length);
  expect(screen.getByRole('link', { name: /^學校資訊/ }).getAttribute('href')).toBe('/school-info');
  expect(screen.getByRole('link', { name: /^校園活動/ }).getAttribute('href')).toBe('/events');
  expect(screen.getByRole('link', { name: /^宿舍/ }).getAttribute('href')).toBe('/dormitory');
  const serviceRoutes = screen.getAllByRole('link').map((link) => link.getAttribute('href'));
  expect(serviceRoutes).toContain('/leave');
  expect(serviceRoutes).toContain('/leave/review');
  const profile = screen.getByRole('link', { name: /個人資料 查看帳號資料/ });
  const destination = new URL(profile.getAttribute('href')!, 'https://campus.example');
  expect(destination.pathname).toBe('/profile');
  expect(destination.searchParams.get('schoolId')).toBeNull();
  expect(screen.getByRole('button', { name: '全部' }).getAttribute('aria-pressed')).toBe('true');
});

it('combines category filters with keyword search and restores all services after clearing', () => {
  render(<SearchPage />);
  fireEvent.click(screen.getByRole('button', { name: '校園生活' }));
  expect(screen.queryByRole('link', { name: /^課表/ })).toBeNull();
  expect(screen.getAllByRole('link')).toHaveLength(10);
  fireEvent.change(screen.getByRole('searchbox', { name: '想找什麼？' }), {
    target: { value: '借書' },
  });
  expect(screen.getAllByRole('link')).toHaveLength(1);
  expect(screen.getByRole('link', { name: /^圖書館/ })).toBeTruthy();
  expect(screen.getByRole('status').textContent).toBe('找到 1 項服務');
  fireEvent.click(screen.getByRole('button', { name: '清除篩選' }));
  expect(screen.getAllByRole('link')).toHaveLength(visibleCampusServices().length);
  expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('');
});

it('offers a recovery action when a query has no matching service', () => {
  render(<SearchPage />);
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: '無此服务' } });
  expect(screen.queryAllByRole('link')).toHaveLength(0);
  expect(screen.getByRole('heading', { name: '沒有符合的服務' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '查看所有服務' }));
  expect(screen.getAllByRole('link')).toHaveLength(visibleCampusServices().length);
});

it('matches search aliases without case or surrounding-space sensitivity', () => {
  render(<SearchPage />);
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: '  BUS  ' } });
  expect(screen.getAllByRole('link')).toHaveLength(1);
  expect(within(screen.getByRole('link')).getByRole('heading', { name: '公車' })).toBeTruthy();
});

it('keeps the existing course directory alongside the added Nuni classroom', () => {
  render(<SearchPage />);
  const paths = screen.getAllByRole('link').map((link) => link.getAttribute('href')?.split('?')[0]);
  expect(paths).toContain('/groups');
  expect(paths).toContain('/cafeteria');
  expect(paths).toContain('/food');
  expect(paths).toContain('/classroom');
  expect(paths).toContain('/grades');
  expect(paths).toContain('/timetable');
  expect(paths).toContain('/grades');
  expect(paths).toContain('/import');
  expect(paths).toContain('/calendar');
});

it('shows ordering-off copy for /food while keeping bus and announcements', () => {
  render(<SearchPage />);
  expect(screen.getByRole('link', { name: /點餐與取餐/ }).textContent).toContain(
    '目前還不能線上點餐',
  );
  expect(screen.queryByText('選餐點、查訂單、出示取餐憑證')).toBeNull();
  expect(screen.getByRole('link', { name: /^公車/ })).toBeTruthy();
  expect(screen.getByRole('link', { name: /^公告/ }).getAttribute('href')).toBe('/announcements');
  expect(screen.queryByText('Nuni 不處理這筆的付款與退款')).toBeNull();
});

it('restores a shareable search and preserves only browsing context in service links', () => {
  window.history.replaceState(
    {},
    '',
    '/search?q=%E5%80%9F%E6%9B%B8&category=campus&campus=school-b&schoolId=school-b&session=private',
  );
  render(<SearchPage />);
  expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('借書');
  const target = new URL(
    screen.getByRole('link', { name: /^圖書館/ }).getAttribute('href')!,
    'https://campus.example',
  );
  expect(target.searchParams.get('campus')).toBe('school-b');
  expect(target.searchParams.get('schoolId')).toBe('school-b');
  expect(target.searchParams.has('session')).toBe(false);
  expect(target.searchParams.has('q')).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: '清除篩選' }));
  expect(new URL(window.location.href).searchParams.get('campus')).toBe('school-b');
  expect(new URL(window.location.href).searchParams.has('q')).toBe(false);
});

it('opens the feedback tab with the selected campus and without copying the search query', () => {
  window.history.replaceState({}, '', '/search?q=回饋&campus=nthu&token=private');
  render(<SearchPage />);
  const destination = new URL(
    screen.getByRole('link', { name: /^課業成績與回饋/ }).getAttribute('href')!,
    'https://campus.example',
  );
  expect(destination.pathname).toBe('/grades');
  expect(destination.searchParams.get('tab')).toBe('feedback');
  expect(destination.searchParams.get('campus')).toBe('nthu');
  expect(destination.searchParams.has('q')).toBe(false);
  expect(destination.searchParams.has('token')).toBe(false);
});

it('restores focus when clearing filters and leaves a composing search untouched', () => {
  render(<SearchPage />);
  const search = screen.getByRole('searchbox', { name: '想找什麼？' });
  fireEvent.click(screen.getByRole('button', { name: '校園生活' }));
  fireEvent.change(search, { target: { value: '借書' } });
  fireEvent.keyDown(search, { key: 'Escape', isComposing: true });
  expect((search as HTMLInputElement).value).toBe('借書');
  fireEvent.keyDown(search, { key: 'Escape' });
  expect((search as HTMLInputElement).value).toBe('');
  expect(screen.getByRole('button', { name: '校園生活' }).getAttribute('aria-pressed')).toBe(
    'true',
  );
  fireEvent.click(screen.getByRole('button', { name: '清除篩選' }));
  expect(document.activeElement).toBe(search);
  expect(screen.getByRole('button', { name: '全部' }).getAttribute('aria-pressed')).toBe('true');
});

it('uses the current school for feedback when the address still has an earlier campus', () => {
  selection.current = {
    selectedSchool: { id: 'nthu' },
    loading: false,
    catalogStatus: 'ready',
  };
  window.history.replaceState({}, '', '/search?campus=pu&schoolId=pu&school=PU&session=private');
  render(<SearchPage />);
  const target = new URL(
    screen.getByRole('link', { name: /^課業成績與回饋/ }).getAttribute('href')!,
    'https://campus.example',
  );
  expect(target.pathname).toBe('/grades');
  expect(target.searchParams.get('tab')).toBe('feedback');
  expect(target.searchParams.get('campus')).toBe('nthu');
  expect(target.searchParams.get('schoolId')).toBe('nthu');
  expect(target.searchParams.get('school')).toBe('NTHU');
  expect(target.searchParams.has('session')).toBe(false);
});

it.each(['職涯', '實習'])(
  'finds the official school information destination when searching for %s',
  (query) => {
    window.history.replaceState({}, '', `/search?campus=nthu&q=${encodeURIComponent(query)}`);
    render(<SearchPage />);
    const target = new URL(
      screen.getByRole('link', { name: /^學校資訊/ }).getAttribute('href')!,
      'https://campus.example',
    );
    expect(target.pathname).toBe('/school-info');
    expect(target.searchParams.get('campus')).toBe('nthu');
    expect(target.searchParams.has('q')).toBe(false);
    expect(screen.getAllByRole('link')).toHaveLength(1);
  },
);

it('finds tasks using separated words and full-width Latin characters', () => {
  render(<SearchPage />);
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: '繳交 作業' } });
  expect(screen.getByRole('link', { name: /^課程空間/ })).toBeTruthy();
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'ＢＵＳ' } });
  expect(screen.getAllByRole('link')).toHaveLength(1);
  expect(screen.getByRole('link', { name: /^公車/ })).toBeTruthy();
  expect(new URL(window.location.href).searchParams.get('q')).toBe('ＢＵＳ');
});
it('makes management and school qualifications discoverable without implying authorization', () => {
  render(<SearchPage />);
  expect(
    screen.getByRole('link', { name: /管理員入口.*需平台管理權限/ }).getAttribute('href'),
  ).toBe('/admin');
  expect(screen.getByRole('link', { name: /學校資格.*Google 帳號/ }).getAttribute('href')).toBe(
    '/classroom/account',
  );
});
it('restores filters after navigation and ignores unsupported categories', () => {
  const view = render(<SearchPage />);
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: '公車' } });
  window.history.replaceState({}, '', '/search?q=%E5%80%9F%E6%9B%B8&category=missing');
  view.rerender(<SearchPage />);
  expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('借書');
  expect(screen.getByRole('button', { name: '全部' }).getAttribute('aria-pressed')).toBe('true');
  expect(screen.getByRole('link', { name: /^圖書館/ })).toBeTruthy();
});

it('shows a school login limitation before opening a service without hiding its entry', () => {
  const view = render(<SearchPage />);
  expect(screen.getByRole('link', { name: /^成績/ }).textContent).toContain('尚未開放登入');
  options.studentId = true;
  view.rerender(<SearchPage />);
  expect(screen.getByRole('link', { name: /^成績/ }).textContent).not.toContain('尚未開放登入');
});

it('retains a search and public destinations when login availability fails, and offers retry', () => {
  window.history.replaceState({}, '', '/search?schoolId=pu&q=公車');
  options.error = true;
  render(<SearchPage />);
  expect(screen.queryByText(/尚未開放登入/)).toBeNull();
  expect(screen.getByRole('link', { name: /^公車/ }).getAttribute('href')).toContain('schoolId=pu');
  fireEvent.click(screen.getByRole('button', { name: '重新確認登入方式' }));
  expect(options.retry).toHaveBeenCalledOnce();
  expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('公車');
});

it('confirms the provider and exact draft before requesting cloud service suggestions', async () => {
  userState.uid = 'alice';
  selection.current = { selectedSchool: { id: 'pu' }, loading: false, catalogStatus: 'ready' };
  vi.mocked(interpretCampusRequest).mockResolvedValue({
    status: 'understood',
    source: 'model',
    checkedAt: '2026-11-01T16:30:00.000Z',
    summary: '想先確認課表，再找讀書和吃飯的地點。',
    destinations: ['/timetable', '/library', '/cafeteria'],
    clarifyingQuestion: null,
  });
  render(<SearchPage />);
  fireEvent.change(screen.getByRole('searchbox'), {
    target: { value: '明天沒有課的話我想去讀書再吃個飯' },
  });
  expect(interpretCampusRequest).not.toHaveBeenCalled();
  confirmCloudDraft();
  expect(await screen.findByText('想先確認課表，再找讀書和吃飯的地點。')).toBeTruthy();
  expect(screen.getByText('AI 建議先開啟')).toBeTruthy();
  expect(interpretCampusRequest).toHaveBeenCalledTimes(1);
});

it('hides readonly homework by default and restores it when enabled', () => {
  const view = render(<SearchPage />);
  expect(screen.queryByRole('link', { name: /玩課雲作業與教材/ })).toBeNull();
  view.rerender(
    <SchoolLmsReadonlyProvider enabled={true}>
      <SearchPage />
    </SchoolLmsReadonlyProvider>,
  );
  expect(screen.getByRole('link', { name: /玩課雲作業與教材/ }).getAttribute('href')).toContain(
    '/school-lms',
  );
});

it('keeps a final voice transcript editable without sending it to the cloud', () => {
  userState.uid = 'alice';
  selection.current = { selectedSchool: { id: 'pu' }, loading: false, catalogStatus: 'ready' };
  let recognized: ((event: unknown) => void) | null = null;
  class Recognition {
    onresult: ((event: unknown) => void) | null = null;
    onerror = null;
    onend = null;
    start() {
      recognized = this.onresult;
    }
    stop() {}
    abort() {}
  }
  Object.defineProperty(window, 'SpeechRecognition', { configurable: true, value: Recognition });
  render(<SearchPage />);
  fireEvent.click(screen.getByRole('button', { name: '使用語音輸入' }));
  act(() => recognized?.({ results: [{ isFinal: true, 0: { transcript: '借書' } }] }));
  expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('借書');
  expect(interpretCampusRequest).not.toHaveBeenCalled();
  expect(screen.getByRole('link', { name: /^圖書館/ })).toBeTruthy();
  delete (window as Window & { SpeechRecognition?: unknown }).SpeechRecognition;
});

it('clears a draft and its URL binding when accounts change, including A to B to A', () => {
  userState.uid = 'alice';
  selection.current = { selectedSchool: { id: 'pu' }, loading: false, catalogStatus: 'ready' };
  const view = render(<SearchPage />);
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: '借書' } });
  userState.uid = 'bob';
  view.rerender(<SearchPage />);
  expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('');
  expect(new URL(window.location.href).searchParams.has('q')).toBe(false);
  userState.uid = 'alice';
  view.rerender(<SearchPage />);
  expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('');
  expect(interpretCampusRequest).not.toHaveBeenCalled();
});

function confirmCloudDraft() {
  fireEvent.click(screen.getByRole('button', { name: '查看傳送內容' }));
  expect(interpretCampusRequest).not.toHaveBeenCalled();
  expect(screen.getByText(/openai\/gpt-oss-120b/)).toBeTruthy();
  fireEvent.click(screen.getByRole('checkbox', { name: '我同意將以上文字與校園代碼傳給 Groq' }));
  fireEvent.click(screen.getByRole('button', { name: '確認並找入口' }));
}

function setupSpeech() {
  const captures: Array<{
    onresult: ((event: unknown) => void) | null;
    onerror: ((event: { error: string }) => void) | null;
    onend: (() => void) | null;
    abort: ReturnType<typeof vi.fn>;
  }> = [];
  class Recognition {
    onresult: ((event: unknown) => void) | null = null;
    onerror: ((event: { error: string }) => void) | null = null;
    onend: (() => void) | null = null;
    abort = vi.fn();
    start() {
      captures.push(this);
    }
    stop() {}
  }
  Object.defineProperty(window, 'SpeechRecognition', { configurable: true, value: Recognition });
  return captures;
}

function cloudResult(summary = '雲端建議') {
  return {
    status: 'understood' as const,
    source: 'model' as const,
    checkedAt: '2026-11-01T16:30:00.000Z',
    summary,
    destinations: ['/library' as const],
    clarifyingQuestion: null,
    previews: [],
  };
}

it('keeps quota cooldown across search draft remounts until a new consented manual retry', async () => {
  vi.useFakeTimers();
  try {
    userState.uid = 'alice';
    selection.current = { selectedSchool: { id: 'pu' }, loading: false, catalogStatus: 'ready' };
    vi.mocked(interpretCampusRequest).mockResolvedValue(cloudResult());
    vi.mocked(interpretCampusRequest).mockResolvedValueOnce({
      ...cloudResult(), status: 'unavailable', source: 'fallback', destinations: [],
      reason: 'rate_limited', retryAfterSeconds: 2,
    });
    render(<SearchPage />);
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '我要借書' } });
    confirmCloudDraft();
    await act(async () => { await Promise.resolve(); });
    expect(interpretCampusRequest).toHaveBeenCalledTimes(1);
    const firstId = vi.mocked(interpretCampusRequest).mock.calls[0][0].requestId;
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '我要找公車' } });
    fireEvent.click(screen.getByRole('button', { name: '查看傳送內容' }));
    const consent = screen.getByRole('checkbox') as HTMLInputElement;
    expect(consent.checked).toBe(false);
    fireEvent.click(consent);
    const submit = screen.getByRole('button', { name: '確認並找入口' }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    fireEvent.click(submit);
    expect(interpretCampusRequest).toHaveBeenCalledTimes(1);
    await act(async () => vi.advanceTimersByTime(1000));
    expect(submit.disabled).toBe(true);
    await act(async () => vi.advanceTimersByTime(1000));
    expect(submit.disabled).toBe(false);
    expect(interpretCampusRequest).toHaveBeenCalledTimes(1);
    await act(async () => fireEvent.click(submit));
    expect(interpretCampusRequest).toHaveBeenCalledTimes(2);
    expect(vi.mocked(interpretCampusRequest).mock.calls[1][0]).toMatchObject({
      utterance: '我要找公車', consent: { utterance: '我要找公車' },
    });
    expect(vi.mocked(interpretCampusRequest).mock.calls[1][0].requestId).not.toBe(firstId);
  } finally {
    vi.useRealTimers();
  }
});

it('cancels cloud waiting without accepting a late result or losing the editable draft', async () => {
  userState.uid = 'alice';
  selection.current = { selectedSchool: { id: 'pu' }, loading: false, catalogStatus: 'ready' };
  let finish!: (value: ReturnType<typeof cloudResult>) => void;
  vi.mocked(interpretCampusRequest).mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  render(<SearchPage />);
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: '想讀書' } });
  confirmCloudDraft();
  expect(interpretCampusRequest).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole('button', { name: '停止等待' }));
  await act(async () => finish(cloudResult('不可出現的晚到結果')));
  expect(screen.queryByText('不可出現的晚到結果')).toBeNull();
  expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('想讀書');
  expect(screen.getByRole('button', { name: '查看傳送內容' })).toBeTruthy();
});

it('aborts the old speech session when opening the data review and ignores its saved callback', () => {
  userState.uid = 'alice';
  selection.current = { selectedSchool: { id: 'pu' }, loading: false, catalogStatus: 'ready' };
  const captures = setupSpeech();
  render(<SearchPage />);
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: '借書' } });
  fireEvent.click(screen.getByRole('button', { name: '使用語音輸入' }));
  const lateResult = captures[0].onresult;
  fireEvent.click(screen.getByRole('button', { name: '查看傳送內容' }));
  expect(captures[0].abort).toHaveBeenCalledOnce();
  act(() => lateResult?.({ results: [{ isFinal: true, 0: { transcript: '舊語音' } }] }));
  expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('借書');
  expect(interpretCampusRequest).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '取消' }));
  expect(screen.queryByRole('checkbox')).toBeNull();
});

it('clears campus-bound drafts and discards speech captured before a campus switch', () => {
  userState.uid = 'alice';
  selection.current = { selectedSchool: { id: 'pu' }, loading: false, catalogStatus: 'ready' };
  const captures = setupSpeech();
  const view = render(<SearchPage />);
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: '公車' } });
  fireEvent.click(screen.getByRole('button', { name: '使用語音輸入' }));
  const lateResult = captures[0].onresult;
  selection.current.selectedSchool.id = 'nthu';
  view.rerender(<SearchPage />);
  expect(captures[0].abort).toHaveBeenCalledOnce();
  act(() => lateResult?.({ results: [{ isFinal: true, 0: { transcript: '舊校園草稿' } }] }));
  expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('');
  expect(new URL(window.location.href).searchParams.has('q')).toBe(false);
  selection.current.selectedSchool.id = 'pu';
  view.rerender(<SearchPage />);
  expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('');
  expect(interpretCampusRequest).not.toHaveBeenCalled();
});

it.each(['edit', 'filter', 'history'])(
  'invalidates a pending result on %s even when the same query returns',
  async (change) => {
    userState.uid = 'alice';
    selection.current = { selectedSchool: { id: 'pu' }, loading: false, catalogStatus: 'ready' };
    let finish!: (value: ReturnType<typeof cloudResult>) => void;
    vi.mocked(interpretCampusRequest).mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const view = render(<SearchPage />);
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '借書' } });
    confirmCloudDraft();
    if (change === 'edit') {
      fireEvent.change(screen.getByRole('searchbox'), { target: { value: '公車' } });
      fireEvent.change(screen.getByRole('searchbox'), { target: { value: '借書' } });
    } else if (change === 'filter') {
      fireEvent.click(screen.getByRole('button', { name: '校園生活' }));
    } else {
      window.history.replaceState({}, '', '/search?q=公車');
      view.rerender(<SearchPage />);
      window.history.replaceState({}, '', '/search?q=借書');
      view.rerender(<SearchPage />);
    }
    await act(async () => finish(cloudResult('失效的建議')));
    expect(screen.queryByText('失效的建議')).toBeNull();
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.getByRole('button', { name: '查看傳送內容' })).toBeTruthy();
    expect(interpretCampusRequest).toHaveBeenCalledOnce();
  },
);

it('keeps local search available while the school is still resolving', () => {
  userState.uid = 'alice';
  selection.current = { selectedSchool: { id: 'pu' }, loading: true, catalogStatus: 'loading' };
  render(<SearchPage />);
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: '借書' } });
  expect(screen.getByRole('link', { name: /^圖書館/ })).toBeTruthy();
  expect((screen.getByRole('button', { name: '查看傳送內容' }) as HTMLButtonElement).disabled).toBe(
    true,
  );
  expect(interpretCampusRequest).not.toHaveBeenCalled();
});

it('never restores a previous account result after switching A to B to A', async () => {
  userState.uid = 'alice';
  selection.current = { selectedSchool: { id: 'pu' }, loading: false, catalogStatus: 'ready' };
  let finish!: (value: ReturnType<typeof cloudResult>) => void;
  vi.mocked(interpretCampusRequest).mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const view = render(<SearchPage />);
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: '借書' } });
  confirmCloudDraft();
  userState.uid = 'bob';
  view.rerender(<SearchPage />);
  userState.uid = 'alice';
  view.rerender(<SearchPage />);
  await act(async () => finish(cloudResult('上一段登入的結果')));
  expect(screen.queryByText('上一段登入的結果')).toBeNull();
  expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('');
  expect(screen.queryByRole('checkbox')).toBeNull();
  expect(new URL(window.location.href).searchParams.has('q')).toBe(false);
  expect(interpretCampusRequest).toHaveBeenCalledOnce();
});

it('preserves an initial URL draft when the same selected campus finishes loading', () => {
  userState.uid = 'alice';
  selection.current = { selectedSchool: { id: 'pu' }, loading: true, catalogStatus: 'loading' };
  window.history.replaceState({}, '', '/search?q=借書&category=campus&schoolId=pu');
  const view = render(<SearchPage />);
  expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('借書');
  expect(screen.getByRole('button', { name: '校園生活' }).getAttribute('aria-pressed')).toBe(
    'true',
  );
  selection.current.loading = false;
  selection.current.catalogStatus = 'ready';
  view.rerender(<SearchPage />);
  expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('借書');
  expect(screen.getByRole('button', { name: '校園生活' }).getAttribute('aria-pressed')).toBe(
    'true',
  );
  expect(new URL(window.location.href).searchParams.get('q')).toBe('借書');
  expect(new URL(window.location.href).searchParams.get('category')).toBe('campus');
  expect(interpretCampusRequest).not.toHaveBeenCalled();
});

it('revokes cloud consent and pending results when same-campus permission readiness changes', async () => {
  userState.uid = 'alice';
  selection.current = { selectedSchool: { id: 'pu' }, loading: false, catalogStatus: 'ready' };
  let finish!: (value: ReturnType<typeof cloudResult>) => void;
  vi.mocked(interpretCampusRequest).mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const view = render(<SearchPage />);
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: '借書' } });
  confirmCloudDraft();
  selection.current.loading = true;
  selection.current.catalogStatus = 'loading';
  view.rerender(<SearchPage />);
  expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('借書');
  expect(screen.queryByRole('checkbox')).toBeNull();
  await act(async () => finish(cloudResult('權限重新確認前的結果')));
  selection.current.loading = false;
  selection.current.catalogStatus = 'ready';
  view.rerender(<SearchPage />);
  expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('借書');
  expect(screen.queryByText('權限重新確認前的結果')).toBeNull();
  expect(screen.queryByRole('checkbox')).toBeNull();
  expect(screen.getByRole('button', { name: '查看傳送內容' })).toBeTruthy();
  expect(interpretCampusRequest).toHaveBeenCalledOnce();
});

it('clears an unresolved URL campus draft when a different actual campus is selected', () => {
  userState.uid = 'alice';
  window.history.replaceState({}, '', '/search?q=借書&category=campus&schoolId=pu');
  const view = render(<SearchPage />);
  expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('借書');
  selection.current = { selectedSchool: { id: 'nthu' }, loading: false, catalogStatus: 'ready' };
  view.rerender(<SearchPage />);
  expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('');
  expect(screen.getByRole('button', { name: '全部' }).getAttribute('aria-pressed')).toBe('true');
  expect(new URL(window.location.href).searchParams.has('q')).toBe(false);
  expect(new URL(window.location.href).searchParams.has('category')).toBe(false);
  expect(interpretCampusRequest).not.toHaveBeenCalled();
});

it('aborts a speech capture when same-campus readiness changes without clearing its draft', () => {
  userState.uid = 'alice';
  selection.current = { selectedSchool: { id: 'pu' }, loading: true, catalogStatus: 'loading' };
  window.history.replaceState({}, '', '/search?q=借書&schoolId=pu');
  const captures = setupSpeech();
  const view = render(<SearchPage />);
  fireEvent.click(screen.getByRole('button', { name: '使用語音輸入' }));
  const lateResult = captures[0].onresult;
  selection.current.loading = false;
  selection.current.catalogStatus = 'ready';
  view.rerender(<SearchPage />);
  expect(captures[0].abort).toHaveBeenCalledOnce();
  act(() => lateResult?.({ results: [{ isFinal: true, 0: { transcript: '舊語音結果' } }] }));
  expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('借書');
  expect(interpretCampusRequest).not.toHaveBeenCalled();
});
