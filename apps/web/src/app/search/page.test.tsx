import { directoryStorageFailures, rejectDirectoryStorage } from '@/test/directoryStorageFailures';
import { SchoolLmsReadonlyProvider } from '@/components/SchoolLmsReadonlyProvider';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { interpretCampusRequest } from '@/lib/campusIntentClient';
import Link from 'next/link';
import { isCurrentTabNavigationClick } from '@/lib/currentTabNavigation';
import { onRouterTransitionStart } from '@/instrumentation-client';
import type { ComponentProps } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SearchPage from './page';
import { visibleCampusServices } from '@/lib/campusServices';
import { DIRECTORY_SEARCH_STORAGE_KEY } from '@/lib/campusDirectorySearch';

// jsdom exposes descendants of closed <details> in role queries; check native disclosure state.
function expandedLinks() {
  return screen.getAllByRole('link').filter((link) => {
    let parent = link.parentElement;
    while (parent) {
      if (parent instanceof HTMLDetailsElement && !parent.open) return false;
      parent = parent.parentElement;
    }
    return true;
  });
}

function expandDirectory() {
  for (const detail of document.querySelectorAll<HTMLDetailsElement>('main details')) {
    if (!detail.open) fireEvent.click(detail.querySelector('summary')!);
  }
}

const selection = vi.hoisted(() => ({
  current: null as null | {
    selectedSchool: { id: string; code?: string } | null;
    loading: boolean;
    catalogStatus: string;
  },
}));
vi.mock('@/components/SelectedSchoolProvider', () => ({
  useOptionalSelectedSchool: () => selection.current,
}));

const userState = vi.hoisted(() => ({
  uid: null as string | null,
  loading: false,
  error: null as Error | null,
  platform: false,
  accountId: 'platform-account',
  context: 'platform-context',
  platformLoading: false,
  platformError: '',
  pendingLogout: false,
}));
vi.mock('@/components/AuthGuard', () => ({
  useAuth: () => ({
    user: userState.uid ? { uid: userState.uid } : null,
    loading: userState.loading,
    error: userState.error,
  }),
}));
vi.mock('@/features/nuni/Session', () => ({
  useOptionalNuniSession: () =>
    userState.platform
      ? {
          session: { platformAccountId: userState.accountId, context: userState.context },
          loading: userState.platformLoading,
          error: userState.platformError,
          pendingLogout: userState.pendingLogout,
        }
      : null,
}));
vi.mock('@/lib/campusIntentClient', () => ({ interpretCampusRequest: vi.fn() }));
vi.mock('@/components/VoiceDictationButton', () => ({
  VoiceDictationButton: ({ onTranscript }: { onTranscript: (value: string) => void }) => (
    <button type="button" onClick={() => onTranscript('明天沒有課，我想讀書再吃飯')}>
      模擬語音輸入
    </button>
  ),
}));
const options = { studentId: false, loading: false, error: false, retry: vi.fn() };
vi.mock('@/lib/signInOptions', () => ({ useSignInOptions: () => options }));

const router = vi.hoisted(() => ({ search: null as string | null }));
// Simulate the App Router's synchronous dispatch separately from its delayed history commit.
vi.mock('next/link', () => ({
  default: ({
    onNavigate,
    ...props
  }: ComponentProps<'a'> & { onNavigate?: () => void }) => (
    <a
      {...props}
      onClick={(event) => {
        if (!isCurrentTabNavigationClick(event, event.currentTarget)) return;
        onNavigate?.();
        onRouterTransitionStart(props.href!, 'push');
      }}
    />
  ),
}));
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(router.search ?? window.location.search),
}));
beforeEach(() => {
  router.search = null;
  window.history.replaceState({}, '', '/search');
  sessionStorage.clear();
  selection.current = null;
  userState.uid = null;
  userState.loading = false;
  userState.error = null;
  userState.platform = false;
  userState.accountId = 'platform-account';
  userState.context = 'platform-context';
  userState.platformLoading = false;
  userState.platformError = '';
  userState.pendingLogout = false;
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
  expandDirectory();
  expect(screen.getAllByRole('link')).toHaveLength(visibleCampusServices().length);
  expect(screen.getByRole('link', { name: /^學校資訊/ }).getAttribute('href')).toBe('/school-info');
  expect(screen.getByRole('link', { name: /^校園活動/ }).getAttribute('href')).toBe('/events');
  expect(screen.getByRole('link', { name: /^宿舍/ }).getAttribute('href')).toBe('/dormitory');
  expect(screen.getByRole('link', { name: /^課程與群組/ }).getAttribute('href')).toBe('/groups');
  expect(screen.getByRole('link', { name: /^成績回饋/ }).getAttribute('href')).toBe(
    '/grades?tab=feedback',
  );
  expect(screen.getByRole('link', { name: /^校方課程/ }).getAttribute('href')).toBe(
    '/school-courses',
  );
  expect(screen.getByRole('link', { name: /^餐廳/ }).getAttribute('href')).toBe('/cafeteria');
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
  expandDirectory();
  expect(screen.getAllByRole('link')).toHaveLength(11);
  expect(screen.queryByRole('link', { name: /^數位學生證/ })).toBeNull();
  fireEvent.change(screen.getByRole('searchbox', { name: '想找什麼？' }), {
    target: { value: '借書' },
  });
  expect(screen.getAllByRole('link')).toHaveLength(1);
  expect(screen.getByRole('link', { name: /^圖書館/ })).toBeTruthy();
  expect(screen.getByRole('status').textContent).toBe('找到 1 項服務');
  fireEvent.click(screen.getByRole('button', { name: '清除篩選' }));
  expandDirectory();
  expect(screen.getAllByRole('link')).toHaveLength(visibleCampusServices().length);
  expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('');
  fireEvent.click(screen.getByRole('button', { name: '帳號與協助' }));
  expect(screen.getByRole('link', { name: /^數位學生證/ }).getAttribute('href')).toBe(
    '/student-card',
  );
});

it('offers a recovery action when a query has no matching service', () => {
  render(<SearchPage />);
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: '無此服务' } });
  expect(screen.queryAllByRole('link')).toHaveLength(0);
  expect(screen.getByRole('heading', { name: '沒有符合的服務' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '查看所有服務' }));
  expandDirectory();
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
  expandDirectory();
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
    screen.getByRole('link', { name: /^成績回饋/ }).getAttribute('href')!,
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
  expandDirectory();
  const target = new URL(
    screen.getByRole('link', { name: /^成績回饋/ }).getAttribute('href')!,
    'https://campus.example',
  );
  expect(target.pathname).toBe('/grades');
  expect(target.searchParams.get('tab')).toBe('feedback');
  expect(target.searchParams.get('campus')).toBe('nthu');
  expect(target.searchParams.get('schoolId')).toBe('nthu');
  expect(target.searchParams.get('school')).toBe('NTHU');
  expect(target.searchParams.has('session')).toBe(false);
});

it.each(['職涯', '實習', '校內工讀'])(
  'finds the public career workspace when searching for %s',
  (query) => {
    window.history.replaceState({}, '', `/search?campus=nthu&q=${encodeURIComponent(query)}`);
    render(<SearchPage />);
    const target = new URL(
      screen.getByRole('link', { name: /^職涯/ }).getAttribute('href')!,
      'https://campus.example',
    );
    expect(target.pathname).toBe('/career');
    expect(target.searchParams.get('campus')).toBe('nthu');
    expect(target.searchParams.has('q')).toBe(false);
    expect(screen.getByRole('link', { name: /^職涯/ }).getAttribute('href')).toBe(
      '/career?campus=nthu',
    );
    // A matching catalog result already provides the destination; do not
    // repeat the same career entry as an additional quick action.
    expect(screen.getAllByRole('link')).toHaveLength(1);
  },
);

it('finds tasks using separated words and full-width Latin characters', () => {
  render(<SearchPage />);
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: '繳交 作業' } });
  expect(screen.getByRole('link', { name: /^課程與作業/ })).toBeTruthy();
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'ＢＵＳ' } });
  expect(screen.getAllByRole('link')).toHaveLength(1);
  expect(screen.getByRole('link', { name: /^公車/ })).toBeTruthy();
  expect(new URL(window.location.href).searchParams.get('q')).toBe('ＢＵＳ');
});
it('makes management and school qualifications discoverable without implying authorization', () => {
  render(<SearchPage />);
  expandDirectory();
  expect(
    screen.getByRole('link', { name: /管理員入口.*需平台管理權限/ }).getAttribute('href'),
  ).toBe('/admin');
  expect(screen.getByRole('link', { name: /學校資格.*Google 帳號/ }).getAttribute('href')).toBe(
    '/classroom/account',
  );
});
it('restores directory filters after returning from a service without the query in the address', () => {
  const view = render(<SearchPage />);
  fireEvent.click(screen.getByRole('button', { name: '校園生活' }));
  fireEvent.change(screen.getByRole('searchbox', { name: '想找什麼？' }), {
    target: { value: '借書' },
  });
  fireEvent.click(screen.getByRole('link', { name: /^圖書館/ }));
  view.unmount();
  window.history.replaceState({}, '', '/library');
  window.history.replaceState({}, '', '/search');
  render(<SearchPage />);
  expect((screen.getByRole('searchbox', { name: '想找什麼？' }) as HTMLInputElement).value).toBe(
    '借書',
  );
  expect(screen.getByRole('button', { name: '校園生活' }).getAttribute('aria-pressed')).toBe(
    'true',
  );
  expect(screen.getByRole('link', { name: /^圖書館/ })).toBeTruthy();
});

it('does not restore directory filters after they have been cleared', () => {
  const view = render(<SearchPage />);
  fireEvent.change(screen.getByRole('searchbox', { name: '想找什麼？' }), {
    target: { value: '借書' },
  });
  fireEvent.click(screen.getByRole('button', { name: '清除篩選' }));
  view.unmount();
  window.history.replaceState({}, '', '/search');
  render(<SearchPage />);
  expect((screen.getByRole('searchbox', { name: '想找什麼？' }) as HTMLInputElement).value).toBe(
    '',
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
  expandDirectory();
  expect(screen.getByRole('link', { name: /^成績 查詢/ }).textContent).toContain('尚未開放登入');
  options.studentId = true;
  view.rerender(<SearchPage />);
  expect(screen.getByRole('link', { name: /^成績 查詢/ }).textContent).not.toContain(
    '尚未開放登入',
  );
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

it('recognizes a complex signed-in campus request using AI instead of only keyword results', async () => {
  userState.uid = 'alice';
  vi.mocked(interpretCampusRequest).mockResolvedValue({
    status: 'understood',
    source: 'model',
    summary: '想先確認課表，再找讀書和吃飯的地點。',
    destinations: ['/timetable', '/library', '/cafeteria'],
    clarifyingQuestion: null,
  });
  render(<SearchPage />);
  fireEvent.change(screen.getByRole('searchbox'), {
    target: { value: '明天沒有課的話我想去讀書再吃個飯' },
  });
  expect(interpretCampusRequest).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '用 AI 理解需求' }));
  expect(await screen.findByText('想先確認課表，再找讀書和吃飯的地點。')).toBeTruthy();
  expect(screen.getByText('AI 建議先開啟')).toBeTruthy();
  expect(interpretCampusRequest).toHaveBeenCalledTimes(1);
});

it('hides readonly homework by default and restores it when enabled', () => {
  const view = render(<SearchPage />);
  expect(screen.queryByRole('link', { name: /^校方作業與教材/ })).toBeNull();
  view.rerender(
    <SchoolLmsReadonlyProvider enabled={true}>
      <SearchPage />
    </SchoolLmsReadonlyProvider>,
  );
  expandDirectory();
  expect(screen.getByRole('link', { name: /^校方作業與教材/ }).getAttribute('href')).toContain(
    '/school-lms',
  );
});

it('opens the selected campus semester grades and keeps feedback previews on their own tab', async () => {
  userState.uid = 'alice';
  window.history.replaceState({}, '', '/search?schoolId=nthu');
  vi.mocked(interpretCampusRequest).mockResolvedValue({
    status: 'understood',
    source: 'model',
    summary: '查看成績與回饋',
    destinations: ['/grades', '/grades?tab=feedback'],
    clarifyingQuestion: null,
    previews: [
      {
        destination: '/grades',
        status: 'available',
        source: 'campus-platform',
        message: '學期資料已匯入',
        items: [],
      },
      {
        destination: '/grades?tab=feedback',
        status: 'empty',
        source: 'campus-platform',
        message: '尚無回饋紀錄',
        items: [],
      },
    ],
  });
  render(<SearchPage />);
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: '這學期表現怎樣' } });
  fireEvent.click(screen.getByRole('button', { name: '用 AI 理解需求' }));
  const semester = await screen.findByRole('link', { name: /學期資料已匯入/ });
  expect(semester.getAttribute('href')).toBe('/grades?tab=semester&schoolId=nthu');
  expect(screen.getByRole('link', { name: /尚無回饋紀錄/ }).getAttribute('href')).toBe(
    '/grades?tab=feedback&schoolId=nthu',
  );
});

it('opens device bookmarks in the selected campus classroom and describes the account requirement', () => {
  window.history.replaceState({}, '', '/search?campus=nthu&q=' + encodeURIComponent('書籤'));
  render(<SearchPage />);
  const bookmarks = screen.getByRole('link', { name: /教材收藏.*這台裝置.*Google 帳號/ });
  expect(bookmarks.getAttribute('href')).toBe('/classroom/material-bookmarks?campus=nthu');
});

it.each([false, true])(
  'shows App restaurant orders only when ordering is enabled (%s)',
  (enabled) => {
    vi.stubEnv('NEXT_PUBLIC_ONLINE_ORDERING', String(enabled));
    try {
      window.history.replaceState({}, '', '/search?campus=nthu&q=' + encodeURIComponent('訂單'));
      render(<SearchPage />);
      const orders = screen.queryByRole('link', { name: /App 餐廳訂單/ });
      expect(orders?.getAttribute('href')).toBe(enabled ? '/orders?campus=nthu' : undefined);
      expect(screen.getByRole('link', { name: /^點餐與取餐/ }).getAttribute('href')).toBe(
        '/food?campus=nthu',
      );
    } finally {
      vi.unstubAllEnvs();
    }
  },
);

it.each([
  ['打開我的訂單', '我的訂單', '/food'],
  ['打開 App 餐廳訂單', 'App 餐廳訂單', '/orders'],
])(
  'resolves a named order service for a platform account before building search links: %s',
  (query, label, path) => {
    userState.platform = true;
    vi.stubEnv('NEXT_PUBLIC_ONLINE_ORDERING', 'true');
    try {
      window.history.replaceState({}, '', '/search?campus=nthu&q=' + encodeURIComponent(query));
      render(<SearchPage />);
      expect(
        screen.getByRole('link', { name: (name) => name.startsWith(label) }).getAttribute('href'),
      ).toBe(`${path}?campus=nthu`);
      expect(interpretCampusRequest).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllEnvs();
    }
  },
);

it('shows disabled ordering copy after resolving platform search shortcuts to food', () => {
  userState.platform = true;
  vi.stubEnv('NEXT_PUBLIC_ONLINE_ORDERING', 'false');
  try {
    window.history.replaceState(
      {},
      '',
      '/search?campus=nthu&q=' + encodeURIComponent('打開我的訂單'),
    );
    render(<SearchPage />);
    const orders = screen.getByRole('link', { name: /^我的訂單/ });
    expect(orders.getAttribute('href')).toBe('/food?campus=nthu');
    expect(orders.textContent).toContain('目前還不能線上點餐');
    expect(screen.queryByRole('link', { name: /^App 餐廳訂單/ })).toBeNull();
  } finally {
    vi.unstubAllEnvs();
  }
});

it('sends a Google account search to the full assistant with its original request and campus', () => {
  userState.platform = true;
  window.history.replaceState({}, '', '/search?campus=pu&schoolId=pu&token=private');
  render(<SearchPage />);
  fireEvent.click(screen.getByRole('button', { name: '模擬語音輸入' }));
  expect(interpretCampusRequest).not.toHaveBeenCalled();
  expect(screen.queryByRole('button', { name: '用 AI 理解需求' })).toBeNull();
  expect(screen.queryByText(/登入者會自動使用 AI/)).toBeNull();
  const url = new URL(
    screen.getByRole('link', { name: '交給校園助理' }).getAttribute('href')!,
    'https://campus.example',
  );
  expect(url.pathname).toBe('/ai-assistant');
  expect(url.searchParams.get('q')).toBe('明天沒有課，我想讀書再吃飯');
  expect(url.searchParams.get('campus')).toBe('pu');
  expect(url.searchParams.get('schoolId')).toBe('pu');
  expect(url.searchParams.has('token')).toBe(false);
  expect(screen.getByText(/帶入校園助理，檢查後再送出/)).toBeTruthy();
});

it('describes guest voice input as service search and does not run school analysis', () => {
  render(<SearchPage />);
  fireEvent.click(screen.getByRole('button', { name: '模擬語音輸入' }));
  expect(interpretCampusRequest).not.toHaveBeenCalled();
  expect(screen.queryByRole('link', { name: '交給校園助理' })).toBeNull();
  expect(screen.queryByRole('button', { name: '用 AI 理解需求' })).toBeNull();
  expect(screen.getByText(/登入 Google 或學校帳號後，可使用校園助理/)).toBeTruthy();
});

it.each(['school-loading', 'school-error', 'platform-loading', 'platform-error', 'signing-out'])(
  'retains keyword search without account AI claims when %s',
  (status) => {
    userState.uid = 'alice';
    if (status === 'school-loading') userState.loading = true;
    if (status === 'school-error') userState.error = new Error('expired');
    if (status.startsWith('platform') || status === 'signing-out') {
      userState.uid = null;
      userState.platform = true;
      userState.platformLoading = status === 'platform-loading';
      userState.platformError = status === 'platform-error' ? 'expired' : '';
      userState.pendingLogout = status === 'signing-out';
    }
    render(<SearchPage />);
    fireEvent.click(screen.getByRole('button', { name: '模擬語音輸入' }));
    expect(screen.queryByRole('button', { name: '用 AI 理解需求' })).toBeNull();
    expect(screen.queryByRole('link', { name: '交給校園助理' })).toBeNull();
    expect(interpretCampusRequest).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '公車' } });
    expect(screen.getByRole('link', { name: /^公車/ })).toBeTruthy();
  },
);

it('preserves an explicitly shared search while the initial account is being confirmed', () => {
  userState.platform = true;
  userState.platformLoading = true;
  window.history.replaceState({}, '', '/search?schoolId=pu&q=' + encodeURIComponent('借書'));
  const view = render(<SearchPage />);
  expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('借書');
  userState.platformLoading = false;
  view.rerender(<SearchPage />);
  expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('借書');
  expect(screen.getByRole('link', { name: /^圖書館/ })).toBeTruthy();
  expect(interpretCampusRequest).not.toHaveBeenCalled();
});

it.each(['account', 'session', 'campus'])(
  'clears the earlier query and rejects late interpretation after changing %s',
  async (change) => {
    userState.uid = 'alice';
    userState.platform = true;
    let resolve!: (result: Awaited<ReturnType<typeof interpretCampusRequest>>) => void;
    vi.mocked(interpretCampusRequest).mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const view = render(<SearchPage />);
    fireEvent.click(screen.getByRole('button', { name: '模擬語音輸入' }));
    if (change === 'account') userState.accountId = 'second-account';
    if (change === 'session') userState.context = 'second-session';
    if (change === 'campus')
      selection.current = {
        selectedSchool: { id: 'nthu' },
        loading: false,
        catalogStatus: 'ready',
      };
    view.rerender(<SearchPage />);
    expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('');
    expect(new URL(window.location.href).searchParams.has('q')).toBe(false);
    await act(async () =>
      resolve({
        status: 'understood',
        source: 'model',
        summary: '之前帳號的搜尋結果',
        destinations: ['/map'],
        clarifyingQuestion: null,
      }),
    );
    expect(screen.queryByText('之前帳號的搜尋結果')).toBeNull();
    userState.accountId = 'platform-account';
    userState.context = 'platform-context';
    selection.current = null;
    view.rerender(<SearchPage />);
    expect(screen.queryByText('之前帳號的搜尋結果')).toBeNull();
    expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('');
  },
);

it('does not restore a search saved by a different platform account after returning', () => {
  userState.platform = true;
  const view = render(<SearchPage />);
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: '借書' } });
  fireEvent.click(screen.getByRole('link', { name: /^圖書館/ }));
  view.unmount();
  userState.accountId = 'second-account';
  window.history.replaceState({}, '', '/search');
  render(<SearchPage />);
  expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('');
});

it('keeps a same-account draft during refresh and does not revive a previously accepted result', async () => {
  userState.uid = 'alice';
  userState.platform = true;
  vi.mocked(interpretCampusRequest).mockResolvedValue({
    status: 'understood',
    source: 'model',
    summary: '刷新前的建議',
    destinations: ['/map'],
    clarifyingQuestion: null,
  });
  const view = render(<SearchPage />);
  fireEvent.click(screen.getByRole('button', { name: '模擬語音輸入' }));
  await screen.findByText('刷新前的建議');
  userState.platformLoading = true;
  view.rerender(<SearchPage />);
  expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe(
    '明天沒有課，我想讀書再吃飯',
  );
  expect(screen.queryByText('刷新前的建議')).toBeNull();
  userState.platformLoading = false;
  view.rerender(<SearchPage />);
  expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe(
    '明天沒有課，我想讀書再吃飯',
  );
  expect(screen.queryByText('刷新前的建議')).toBeNull();
  expect(interpretCampusRequest).toHaveBeenCalledTimes(1);
});

it.each(['profile-default', 'schoolId-alias', 'all', 'personal'])(
  'preserves a shared search through initial campus resolution: %s',
  (source) => {
    userState.uid = 'alice';
    selection.current = { selectedSchool: null, loading: true, catalogStatus: 'ready' };
    const campusQuery =
      source === 'profile-default'
        ? ''
        : source === 'schoolId-alias'
          ? '&schoolId=pu'
          : `&campus=${source}`;
    window.history.replaceState(
      {},
      '',
      `/search?q=${encodeURIComponent('借書')}&category=campus${campusQuery}`,
    );
    const view = render(<SearchPage />);
    expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('借書');
    selection.current = {
      selectedSchool: source === 'all' || source === 'personal' ? null : { id: 'pu', code: 'PU' },
      loading: false,
      catalogStatus: 'ready',
    };
    view.rerender(<SearchPage />);
    expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('借書');
    expect(screen.getByRole('button', { name: '校園生活' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    expect(new URL(window.location.href).searchParams.get('q')).toBe('借書');
    expect(new URL(window.location.href).searchParams.get('category')).toBe('campus');
    expect(interpretCampusRequest).not.toHaveBeenCalled();

    selection.current.selectedSchool = { id: 'nthu', code: 'NTHU' };
    view.rerender(<SearchPage />);
    expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('');
    expect(new URL(window.location.href).searchParams.has('q')).toBe(false);
    expect(new URL(window.location.href).searchParams.has('category')).toBe(false);
  },
);

it('keeps pending-campus edits in the URL without saving an unconfirmed scope', () => {
  userState.uid = 'alice';
  selection.current = { selectedSchool: null, loading: true, catalogStatus: 'ready' };
  const view = render(<SearchPage />);
  fireEvent.click(screen.getByRole('button', { name: '校園生活' }));
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: '借書' } });
  fireEvent.click(screen.getByRole('link', { name: /^圖書館/ }));
  expect(sessionStorage.getItem(DIRECTORY_SEARCH_STORAGE_KEY)).toBeNull();
  selection.current = {
    selectedSchool: { id: 'pu', code: 'PU' },
    loading: false,
    catalogStatus: 'ready',
  };
  view.rerender(<SearchPage />);
  expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('借書');
  expect(screen.getByRole('button', { name: '校園生活' }).getAttribute('aria-pressed')).toBe(
    'true',
  );
  expect(new URL(window.location.href).searchParams.get('q')).toBe('借書');
  fireEvent.click(screen.getByRole('link', { name: /^圖書館/ }));
  expect(sessionStorage.getItem(DIRECTORY_SEARCH_STORAGE_KEY)).toContain('pu');
});

it.each(['loading', 'error'])('keeps voice input local while the campus is %s', (status) => {
  userState.uid = 'alice';
  selection.current = {
    selectedSchool: null,
    loading: status === 'loading',
    catalogStatus: status,
  };
  const view = render(<SearchPage />);
  fireEvent.click(screen.getByRole('button', { name: '模擬語音輸入' }));
  expect(interpretCampusRequest).not.toHaveBeenCalled();
  expect(screen.queryByRole('button', { name: '用 AI 理解需求' })).toBeNull();
  selection.current = { selectedSchool: { id: 'pu' }, loading: false, catalogStatus: 'ready' };
  view.rerender(<SearchPage />);
  expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe(
    '明天沒有課，我想讀書再吃飯',
  );
  expect(interpretCampusRequest).not.toHaveBeenCalled();
});

it.each(['account', 'session'])(
  'clears pending-campus search filters across a real %s switch',
  (change) => {
    userState.platform = true;
    selection.current = { selectedSchool: null, loading: true, catalogStatus: 'ready' };
    const view = render(<SearchPage />);
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '私人讀書安排' } });
    if (change === 'account') userState.accountId = 'second-account';
    else userState.context = 'second-session';
    view.rerender(<SearchPage />);
    expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('');
    selection.current = { selectedSchool: { id: 'pu' }, loading: false, catalogStatus: 'ready' };
    view.rerender(<SearchPage />);
    expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('');
    expect(new URL(window.location.href).searchParams.has('q')).toBe(false);
  },
);

it.each([
  ['pu', 'loading'],
  ['all', 'loading'],
  ['all', 'error'],
] as const)(
  'keeps %s filters through campus %s but rejects an earlier analysis',
  async (campus, status) => {
    userState.uid = 'alice';
    selection.current = {
      selectedSchool: campus === 'pu' ? { id: 'pu', code: 'PU' } : null,
      loading: false,
      catalogStatus: 'ready',
    };
    window.history.replaceState(
      {},
      '',
      campus === 'pu' ? '/search?schoolId=pu&campus=pu&school=PU' : '/search?campus=all',
    );
    let finish!: (result: Awaited<ReturnType<typeof interpretCampusRequest>>) => void;
    vi.mocked(interpretCampusRequest).mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const view = render(<SearchPage />);
    fireEvent.click(screen.getByRole('button', { name: '模擬語音輸入' }));
    selection.current.loading = status === 'loading';
    selection.current.catalogStatus = status;
    view.rerender(<SearchPage />);
    expect(screen.queryByRole('button', { name: '用 AI 理解需求' })).toBeNull();
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
    selection.current.loading = false;
    selection.current.catalogStatus = 'ready';
    view.rerender(<SearchPage />);
    expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe(
      '明天沒有課，我想讀書再吃飯',
    );
    expect(screen.queryByText('重查校園前的結果')).toBeNull();
    expect(interpretCampusRequest).toHaveBeenCalledTimes(1);
  },
);

it.each([false, true])(
  'does not overwrite pending-campus edits when History writes fail (initial account pending: %s)',
  (initialAccountPending) => {
    userState.uid = 'alice';
    selection.current = { selectedSchool: { id: 'pu' }, loading: false, catalogStatus: 'ready' };
    const first = render(<SearchPage />);
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '借書' } });
    fireEvent.click(screen.getByRole('link', { name: /^圖書館/ }));
    first.unmount();
    window.history.replaceState({}, '', '/search');
    if (initialAccountPending) {
      userState.uid = null;
      userState.loading = true;
    }
    selection.current = { selectedSchool: null, loading: true, catalogStatus: 'ready' };
    const view = render(<SearchPage />);
    expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('');
    const history = vi.spyOn(window.history, 'replaceState').mockImplementation(() => {
      throw new Error('denied');
    });
    try {
      fireEvent.change(screen.getByRole('searchbox'), { target: { value: '公車' } });
      if (initialAccountPending) {
        userState.uid = 'alice';
        userState.loading = false;
        view.rerender(<SearchPage />);
        expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('公車');
      }
      selection.current = { selectedSchool: { id: 'pu' }, loading: false, catalogStatus: 'ready' };
      view.rerender(<SearchPage />);
      expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('公車');
      expect(screen.getByRole('link', { name: /^公車/ })).toBeTruthy();
    } finally {
      history.mockRestore();
    }
  },
);

it('shows everyday services first while searchable secondary entries remain reachable', () => {
  render(<SearchPage />);
  expect(expandedLinks()).toHaveLength(16);
  expect(screen.getByRole('link', { name: /^刪除帳號/ }).closest('details')!.open).toBe(false);
  expect(screen.getByRole('link', { name: /^教材收藏/ }).closest('details')!.open).toBe(false);
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: '書籤' } });
  expect(screen.getByRole('link', { name: /^教材收藏/ })).toBeTruthy();
  expect(screen.getByRole('status').textContent).toBe('找到 1 項服務');
});

it('returns to the expanded family after opening a secondary service', () => {
  const view = render(<SearchPage />);
  fireEvent.click(screen.getByText(/更多學習與課務服務/));
  fireEvent.click(screen.getByLabelText('成績的相關服務'));
  fireEvent.click(screen.getByRole('link', { name: /^成績回饋/ }));
  view.unmount();
  render(<SearchPage />);
  const feedback = screen.getByRole('link', { name: /^成績回饋/ });
  const family = feedback.closest('details')!;
  expect(family.open).toBe(true);
  expect(family.parentElement!.closest('details')!.open).toBe(true);
  expect(feedback.getAttribute('href')).toBe('/grades?tab=feedback');
});

it('keeps the newest draft while earlier Router URL updates arrive after typing', () => {
  router.search = '';
  const view = render(<SearchPage />);
  const search = screen.getByRole('searchbox') as HTMLInputElement;
  fireEvent.change(search, { target: { value: '借' } });
  const earlier = window.location.search;
  fireEvent.change(search, { target: { value: '借書' } });
  const latest = window.location.search;
  expect(new URLSearchParams(latest).get('q')).toBe('借書');

  router.search = earlier;
  view.rerender(<SearchPage />);
  expect(search.value).toBe('借書');
  expect(screen.getByRole('link', { name: /^圖書館/ })).toBeTruthy();
  router.search = latest;
  view.rerender(<SearchPage />);
  expect(search.value).toBe('借書');
});

it('keeps the latest search after more than 32 edits when the first Router update arrives late', () => {
  router.search = '';
  const view = render(<SearchPage />);
  const search = screen.getByRole('searchbox') as HTMLInputElement;
  fireEvent.change(search, { target: { value: '借書1' } });
  const earliest = window.location.search;
  for (let index = 2; index <= 40; index += 1) {
    fireEvent.change(search, { target: { value: `借書${index}` } });
  }
  const latest = window.location.search;
  router.search = earliest;
  view.rerender(<SearchPage />);
  expect(window.location.search).toBe(latest);
  expect(search.value).toBe('借書40');
  router.search = latest;
  view.rerender(<SearchPage />);
  expect(search.value).toBe('借書40');
});

it('publishes a completed composition without losing its draft to an earlier Router update', () => {
  router.search = '';
  const view = render(<SearchPage />);
  const search = screen.getByRole('searchbox') as HTMLInputElement;
  search.focus();
  fireEvent.change(search, { target: { value: '借' } });
  const earlier = window.location.search;
  const saved = sessionStorage.getItem(DIRECTORY_SEARCH_STORAGE_KEY);

  fireEvent.compositionStart(search);
  fireEvent.change(search, { target: { value: '借書' } });
  expect(window.location.search).toBe(earlier);
  expect(sessionStorage.getItem(DIRECTORY_SEARCH_STORAGE_KEY)).toBe(saved);
  router.search = earlier;
  view.rerender(<SearchPage />);
  expect(search.value).toBe('借書');
  fireEvent.keyDown(search, { key: 'Escape' });
  fireEvent.keyDown(search, { key: 'Enter', isComposing: true });
  fireEvent.submit(screen.getByRole('search', { name: '尋找服務' }));
  expect(search.value).toBe('借書');
  expect(document.activeElement).toBe(search);
  expect(interpretCampusRequest).not.toHaveBeenCalled();

  fireEvent.compositionEnd(search);
  expect(new URL(window.location.href).searchParams.get('q')).toBe('借書');
  expect(sessionStorage.getItem(DIRECTORY_SEARCH_STORAGE_KEY)).toContain('借書');
});

it('lets a real Back traversal to an empty directory override queued drafts and session restore', () => {
  router.search = '';
  const view = render(<SearchPage />);
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: '公車' } });
  const pending = window.location.search;
  expect(sessionStorage.getItem(DIRECTORY_SEARCH_STORAGE_KEY)).toContain('公車');
  window.history.replaceState(null, '', '/search');
  act(() => window.dispatchEvent(new PopStateEvent('popstate')));
  expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('');

  router.search = pending;
  view.rerender(<SearchPage />);
  expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('');
  router.search = '';
  view.rerender(<SearchPage />);
  expect(screen.getByRole('heading', { name: '服務目錄' })).toBeTruthy();
  view.unmount();
  render(<SearchPage />);
  expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('');
});

it('lets a history traversal to an earlier pending query win over newer typing', () => {
  router.search = '';
  const view = render(<SearchPage />);
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: '公車' } });
  const earlier = window.location.search;
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: '借書' } });
  window.history.replaceState(null, '', '/search' + earlier);
  act(() => window.dispatchEvent(new PopStateEvent('popstate')));
  router.search = earlier;
  view.rerender(<SearchPage />);
  expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('公車');
  expect(screen.getByRole('link', { name: /^公車/ })).toBeTruthy();
});

it('publishes filters through the Router without echoing its private history state', () => {
  const original = window.history.replaceState.bind(window.history);
  original({ __NA: true, __PRIVATE_NEXTJS_INTERNALS_TREE: ['search'] }, '', '/search');
  router.search = '';
  const history = vi
    .spyOn(window.history, 'replaceState')
    .mockImplementation((data, title, url) => {
      original(data, title, url);
      // Next skips its URL notification when a caller supplies one of its own internal entries.
      if (!data?.__NA) router.search = window.location.search;
    });
  try {
    const view = render(<SearchPage />);
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '借書' } });
    view.rerender(<SearchPage />);
    expect(new URLSearchParams(router.search!).get('q')).toBe('借書');
    expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('借書');
  } finally {
    history.mockRestore();
  }
});

it.each(['submit', 'button'] as const)(
  'moves to results on %s without sending typed text to AI or opening a service',
  (action) => {
    userState.uid = 'alice';
    render(<SearchPage />);
    const search = screen.getByRole('searchbox');
    fireEvent.change(search, { target: { value: '借書' } });
    search.focus();
    const address = window.location.href;
    if (action === 'submit') fireEvent.submit(screen.getByRole('search', { name: '尋找服務' }));
    else fireEvent.click(screen.getByRole('button', { name: '查看結果' }));
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: '搜尋結果' }));
    expect(interpretCampusRequest).not.toHaveBeenCalled();
    expect(window.location.href).toBe(address);
  },
);

it('clears only the search phrase and returns focus to the input while keeping its category', () => {
  render(<SearchPage />);
  fireEvent.click(screen.getByRole('button', { name: '校園生活' }));
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: '借書' } });
  fireEvent.click(screen.getByRole('button', { name: '清除搜尋' }));
  expect(document.activeElement).toBe(screen.getByRole('searchbox'));
  expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('');
  expect(screen.getByRole('button', { name: '校園生活' }).getAttribute('aria-pressed')).toBe(
    'true',
  );
  expect(new URL(window.location.href).searchParams.get('category')).toBe('campus');
  expect(new URL(window.location.href).searchParams.has('q')).toBe(false);
});

describe.each(directoryStorageFailures)('search navigation with storage %s', (failure) => {
  it.each([
    [/^圖書館/, '/library'],
    ['交給校園助理', '/ai-assistant'],
  ] as const)('follows %s', (name, path) => {
    userState.uid = 'alice';
    render(<SearchPage />);
    const storage = rejectDirectoryStorage(failure);
    try {
      fireEvent.change(screen.getByRole('searchbox', { name: '想找什麼？' }), {
        target: { value: '借書' },
      });
      const link = screen.getByRole<HTMLAnchorElement>('link', { name });
      expect(fireEvent.click(link)).toBe(true);
      expect(new URL(link.href).pathname).toBe(path);
    } finally {
      storage.mockRestore();
    }
  });
});

const replaceHistoryForTraversal = window.history.replaceState.bind(window.history);

describe('continuing a search after opening a service', () => {
  const nextState = { __NA: true, __PRIVATE_NEXTJS_INTERNALS_TREE: ['search'], unrelated: 7 };
  const librarySearch = '/search?campus=pu&q=%E5%80%9F%E6%9B%B8&category=campus';
  const scroll = vi.fn();
  const stopScroll = vi.fn();
  const frames = new Map<number, FrameRequestCallback>();
  let frameSequence = 0;
  let originalScroll: PropertyDescriptor | undefined;
  let originalWindowMethods: Record<string, PropertyDescriptor | undefined>;

  function nextFrame() {
    act(() => {
      const callbacks = [...frames.values()];
      frames.clear();
      callbacks.forEach((callback) => callback(performance.now()));
    });
  }

  function renderAfterFrame() {
    const view = render(<SearchPage />);
    nextFrame();
    return {
      ...view,
      rerender(ui: Parameters<typeof view.rerender>[0]) {
        view.rerender(ui);
        nextFrame();
      },
    };
  }

  function move(url: string, state: unknown = nextState) {
    window.history.replaceState(state, '', url);
  }

  function traverse(url: string, state: unknown) {
    replaceHistoryForTraversal(state, '', url);
    act(() => window.dispatchEvent(new PopStateEvent('popstate', { state })));
  }

  async function go(delta: number) {
    await act(async () => {
      await new Promise<void>((resolve) => {
        window.addEventListener('popstate', () => resolve(), { once: true });
        window.history.go(delta);
      });
    });
  }

  function leaveLibrary(url = librarySearch) {
    move(url);
    const view = renderAfterFrame();
    const link = screen.getByRole('link', { name: /^圖書館/ });
    fireEvent.click(link);
    const entry = window.history.state;
    view.unmount();
    window.history.pushState(nextState, '', link.getAttribute('href')!);
    return entry;
  }

  beforeEach(() => {
    originalScroll = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView');
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: scroll,
    });
    scroll.mockClear();
    stopScroll.mockClear();
    frames.clear();
    frameSequence = 0;
    originalWindowMethods = Object.fromEntries(
      ['requestAnimationFrame', 'cancelAnimationFrame', 'scrollTo'].map((name) => [
        name,
        Object.getOwnPropertyDescriptor(window, name),
      ]),
    );
    Object.defineProperties(window, {
      requestAnimationFrame: {
        configurable: true,
        value: (callback: FrameRequestCallback) => {
          const id = ++frameSequence;
          frames.set(id, callback);
          return id;
        },
      },
      cancelAnimationFrame: {
        configurable: true,
        value: (id: number) => frames.delete(id),
      },
      scrollTo: { configurable: true, value: stopScroll },
    });
    traverse('/search', nextState);
  });

  afterEach(() => {
    if (originalScroll)
      Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', originalScroll);
    else Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView');
    for (const [name, descriptor] of Object.entries(originalWindowMethods)) {
      if (descriptor) Object.defineProperty(window, name, descriptor);
      else Reflect.deleteProperty(window, name);
    }
  });

  it('Back restores the original result and search filters, once, even when received while unmounted', () => {
    const entry = leaveLibrary();
    expect(entry).toMatchObject(nextState);
    replaceHistoryForTraversal(entry, '', librarySearch);
    // The Router can replace the arriving state before our popstate listener runs.
    move(librarySearch, entry);
    act(() => window.dispatchEvent(new PopStateEvent('popstate', { state: window.history.state })));
    const view = renderAfterFrame();
    const library = screen.getByRole('link', { name: /^圖書館/ });
    expect(document.activeElement).toBe(library);
    expect(scroll).toHaveBeenCalledWith({
      block: 'nearest',
      inline: 'nearest',
      behavior: 'instant',
    });
    expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('借書');
    expect(screen.getByRole('button', { name: '校園生活' }).getAttribute('aria-pressed')).toBe(
      'true',
    );

    const search = screen.getByRole('searchbox');
    search.focus();
    view.rerender(<SearchPage />);
    expect(document.activeElement).toBe(search);
    expect(scroll).toHaveBeenCalledTimes(1);
    expect(window.history.state).toEqual(entry);
  });

  it('Forward and Back can resume the same entry again without replaying it on a fresh visit', async () => {
    const entry = leaveLibrary();
    await go(-1);
    const view = renderAfterFrame();
    expect(document.activeElement).toBe(screen.getByRole('link', { name: /^圖書館/ }));
    view.unmount();
    await go(1);
    move('/library?campus=pu#information');
    await go(-1);
    const returned = renderAfterFrame();
    expect(document.activeElement).toBe(screen.getByRole('link', { name: /^圖書館/ }));
    returned.unmount();

    // Reusing the URL/history data without a traversal must not opt into restoration.
    move(librarySearch, entry);
    renderAfterFrame();
    expect(document.activeElement).not.toBe(screen.getByRole('link', { name: /^圖書館/ }));
    expect(scroll).toHaveBeenCalledTimes(2);
  });

  it('does not restore a previous result after an unrelated later visit from the same search entry', () => {
    const entry = leaveLibrary();
    traverse(librarySearch, entry);
    const view = renderAfterFrame();
    expect(document.activeElement).toBe(screen.getByRole('link', { name: /^圖書館/ }));
    view.unmount();
    // Bottom navigation away from search, then Back to the same history item.
    window.history.pushState(nextState, '', '/life');
    traverse(librarySearch, entry);
    renderAfterFrame();
    expect(document.activeElement).not.toBe(screen.getByRole('link', { name: /^圖書館/ }));
    expect(scroll).toHaveBeenCalledTimes(1);
  });

  it('does not restore after a later departure that shares the remembered result path', () => {
    const entry = leaveLibrary();
    traverse(librarySearch, entry);
    const view = renderAfterFrame();
    const library = screen.getByRole('link', { name: /^圖書館/ });
    expect(document.activeElement).toBe(library);
    const href = library.getAttribute('href')!;
    view.unmount();
    // Bottom navigation can land on the same path as the remembered result.
    window.history.pushState(nextState, '', href);
    traverse(librarySearch, entry);
    renderAfterFrame();
    expect(document.activeElement).not.toBe(screen.getByRole('link', { name: /^圖書館/ }));
    expect(scroll).toHaveBeenCalledTimes(1);
  });

  it('does not let bottom navigation claim an uncommitted result with the same destination', async () => {
    move('/search?q=課表');
    const view = render(
      <>
        <SearchPage />
        <nav aria-label="主要導覽">
          <Link href="/timetable">課務</Link>
        </nav>
      </>,
    );
    nextFrame();
    const result = screen.getByRole('link', { name: /^課表/ });
    expect(result.getAttribute('href')).toBe('/timetable');
    fireEvent.click(result);
    expect(window.location.pathname).toBe('/search');
    expect(window.history.state).toHaveProperty('__campusSearchResultReturn.href', '/timetable');
    const bottomLink = screen.getByRole('link', { name: '課務' });
    expect(bottomLink.getAttribute('href')).toBe(result.getAttribute('href'));
    fireEvent.click(bottomLink);
    window.history.pushState(nextState, '', '/timetable');
    view.unmount();

    await go(-1);
    renderAfterFrame();
    expect(document.activeElement).not.toBe(screen.getByRole('link', { name: /^課表/ }));
    expect(scroll).not.toHaveBeenCalled();
  });

  it.each(['object', 'array'] as const)(
    'removes the original search identity from a subclass of %s on Back/Forward',
    async (shape) => {
      class CopiedHistoryState {}
      class CopiedArrayHistoryState extends Array<string> {}
      const entry = leaveLibrary();
      const destination = window.history.state;
      const copy = Object.assign(
        shape === 'array' ? new CopiedArrayHistoryState('payload') : new CopiedHistoryState(),
        entry,
      );
      window.history.pushState(copy, '', librarySearch);
      await go(-1);
      expect(window.location.pathname).toBe('/library');
      expect(window.history.state).toEqual(destination);
      await go(1);

      renderAfterFrame();
      expect(document.activeElement).not.toBe(screen.getByRole('link', { name: /^圖書館/ }));
      expect(scroll).not.toHaveBeenCalled();
      expect(window.history.state.unrelated).toBe(7);
      expect(window.history.state.__campusSearchHistoryEntry).not.toBe(entry.__campusSearchHistoryEntry);
      expect(window.history.state).not.toHaveProperty('__campusSearchResultReturn');
      if (shape === 'array') {
        expect(Array.isArray(window.history.state)).toBe(true);
        expect(window.history.state[0]).toBe('payload');
      }
    },
  );

  it('keeps an earlier campus return armed after an unrelated cross-campus traversal', async () => {
    const entry = leaveLibrary();
    window.history.pushState(nextState, '', '/search?campus=nthu&q=公車');
    router.search = window.location.search;
    const later = renderAfterFrame();
    expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('公車');

    await go(-2);
    expect(scroll).not.toHaveBeenCalled();
    router.search = null;
    later.rerender(<SearchPage />);
    expect(window.location.search).toBe(new URL(librarySearch, window.location.origin).search);
    expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('借書');
    expect(document.activeElement).not.toBe(screen.getByRole('link', { name: /^圖書館/ }));
    expect(scroll).not.toHaveBeenCalled();
    expect(window.history.state).toEqual(entry);
    later.unmount();

    await go(1);
    expect(window.location.pathname).toBe('/library');
    await go(-1);
    renderAfterFrame();
    expect(document.activeElement).toBe(screen.getByRole('link', { name: /^圖書館/ }));
    expect(scroll).toHaveBeenCalledTimes(1);
  });

  it('still restores an earlier search entry after a later search has been resumed', () => {
    const first = leaveLibrary();
    const firstDestination = window.history.state;
    const laterSearch = '/search?campus=pu&q=%E5%9C%96%E6%9B%B8%E9%A4%A8';
    window.history.pushState(nextState, '', laterSearch);
    const laterView = renderAfterFrame();
    fireEvent.click(screen.getByRole('link', { name: /^圖書館/ }));
    const second = window.history.state;
    laterView.unmount();
    window.history.pushState(nextState, '', '/library?campus=pu');
    traverse(laterSearch, second);
    const resumed = renderAfterFrame();
    expect(document.activeElement).toBe(screen.getByRole('link', { name: /^圖書館/ }));
    resumed.unmount();
    traverse('/library?campus=pu', firstDestination);
    traverse(librarySearch, first);
    renderAfterFrame();
    expect(document.activeElement).toBe(screen.getByRole('link', { name: /^圖書館/ }));
    expect(scroll).toHaveBeenCalledTimes(2);
  });

  it('does not restore onto a copied history state while a return is still pending', () => {
    const entry = leaveLibrary();
    userState.loading = true;
    traverse(librarySearch, entry);
    const view = renderAfterFrame();
    expect(scroll).not.toHaveBeenCalled();
    window.history.pushState(entry, '', librarySearch);
    userState.loading = false;
    view.rerender(<SearchPage />);
    expect(document.activeElement).not.toBe(screen.getByRole('link', { name: /^圖書館/ }));
    expect(scroll).not.toHaveBeenCalled();
  });

  it('does not restore when Back and Forward revisit copies of the pending search entry', async () => {
    const entry = leaveLibrary();
    await go(-1);
    userState.loading = true;
    const view = renderAfterFrame();
    expect(scroll).not.toHaveBeenCalled();
    window.history.pushState(entry, '', librarySearch);
    window.history.pushState(entry, '', librarySearch);
    view.unmount();

    userState.loading = false;
    await go(-1);
    const copied = renderAfterFrame();
    expect(document.activeElement).not.toBe(screen.getByRole('link', { name: /^圖書館/ }));
    expect(scroll).not.toHaveBeenCalled();
    copied.unmount();
    await go(1);
    renderAfterFrame();
    expect(document.activeElement).not.toBe(screen.getByRole('link', { name: /^圖書館/ }));
    expect(scroll).not.toHaveBeenCalled();
  });

  it.each(['home', 'bottom navigation', 'same destination URL'] as const)(
    'rejects a traversal from %s into the armed search entry',
    async (origin) => {
      move('/');
      window.history.pushState(nextState, '', librarySearch);
      leaveLibrary();
      if (origin === 'home') {
        await go(-2);
        expect(window.location.pathname).toBe('/');
        await go(1);
      } else {
        const url = origin === 'bottom navigation' ? '/life' : '/library?campus=pu';
        window.history.pushState(window.history.state, '', url);
        await go(-2);
      }
      expect(window.location.pathname).toBe('/search');
      const unrelated = renderAfterFrame();
      expect(document.activeElement).not.toBe(screen.getByRole('link', { name: /^圖書館/ }));
      expect(scroll).not.toHaveBeenCalled();
      unrelated.unmount();

      await go(1);
      await go(-1);
      renderAfterFrame();
      expect(document.activeElement).toBe(screen.getByRole('link', { name: /^圖書館/ }));
      expect(scroll).toHaveBeenCalledTimes(1);
    },
  );

  it('restores an earlier unfiltered entry over the later search draft after remounting', async () => {
    move('/');
    window.history.pushState(nextState, '', '/search');
    const earlier = renderAfterFrame();
    const library = screen.getByRole('link', { name: /^圖書館/ });
    const destination = library.getAttribute('href')!;
    fireEvent.click(library);
    earlier.unmount();
    window.history.pushState(nextState, '', destination);

    window.history.pushState(nextState, '', '/search');
    const later = renderAfterFrame();
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '公車' } });
    expect(sessionStorage.getItem(DIRECTORY_SEARCH_STORAGE_KEY)).toContain('公車');
    later.unmount();

    await go(-1);
    expect(window.location.pathname).toBe('/library');
    await go(-1);
    expect(window.location.search).toBe('');
    renderAfterFrame();
    expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('');
    expect(document.activeElement).toBe(screen.getByRole('link', { name: /^圖書館/ }));
    expect(scroll).toHaveBeenCalledTimes(1);
  });

  it('opens both enclosing disclosures and resumes the exact secondary service', () => {
    move('/search?campus=pu');
    const view = renderAfterFrame();
    fireEvent.click(screen.getByText(/更多學習與課務服務/));
    fireEvent.click(screen.getByLabelText('成績的相關服務'));
    fireEvent.click(screen.getByLabelText('課程與作業的相關服務'));
    fireEvent.click(screen.getByRole('link', { name: /^成績回饋/ }));
    const entry = window.history.state;
    view.unmount();
    window.history.pushState(nextState, '', '/grades?tab=feedback&campus=pu');
    traverse('/search?campus=pu', entry);
    renderAfterFrame();
    const feedback = screen.getByRole('link', { name: /^成績回饋/ });
    const family = feedback.closest('details')!;
    expect(family.open).toBe(true);
    expect(family.parentElement!.closest('details')!.open).toBe(true);
    expect(
      screen.getByLabelText('課程與作業的相關服務').parentElement!.getAttribute('open'),
    ).not.toBeNull();
    expect(document.activeElement).toBe(feedback);
  });

  it('restores an available recommendation without resending the request to AI', () => {
    userState.uid = 'alice';
    const url = '/search?campus=pu&q=' + encodeURIComponent('今天要上什麼課？');
    move(url);
    const view = renderAfterFrame();
    const recommendations = screen.getByRole('region', { name: '根據需求推薦的服務' });
    const link = within(recommendations).getAllByRole('link')[0];
    const href = link.getAttribute('href')!;
    fireEvent.click(link);
    const entry = window.history.state;
    view.unmount();
    window.history.pushState(nextState, '', href);
    traverse(url, entry);
    renderAfterFrame();
    const resumed = within(screen.getByRole('region', { name: '根據需求推薦的服務' }))
      .getAllByRole('link')
      .find((item) => item.getAttribute('href') === href);
    expect(document.activeElement).toBe(resumed);
    expect(interpretCampusRequest).not.toHaveBeenCalled();
  });

  it('resumes at results when a request-only AI recommendation is gone, without retaining its private preview', async () => {
    userState.uid = 'alice';
    vi.mocked(interpretCampusRequest).mockResolvedValue({
      status: 'understood',
      source: 'model',
      summary: '查看本學期',
      destinations: ['/grades'],
      clarifyingQuestion: null,
      previews: [
        {
          destination: '/grades',
          status: 'available',
          source: 'campus-platform',
          message: '個人成績摘要',
          items: [],
        },
      ],
    });
    const url = '/search?campus=pu&q=' + encodeURIComponent('這學期表現怎樣');
    move(url);
    const view = renderAfterFrame();
    fireEvent.click(screen.getByRole('button', { name: '用 AI 理解需求' }));
    fireEvent.click(await screen.findByRole('link', { name: /個人成績摘要/ }));
    const entry = window.history.state;
    expect(JSON.stringify(entry)).not.toContain('個人成績摘要');
    expect(sessionStorage.getItem(DIRECTORY_SEARCH_STORAGE_KEY)).not.toContain('個人成績摘要');
    view.unmount();
    window.history.pushState(nextState, '', '/grades?tab=semester&campus=pu');
    traverse(url, entry);
    renderAfterFrame();
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: '搜尋結果' }));
    expect(screen.queryByText('個人成績摘要')).toBeNull();
    expect(interpretCampusRequest).toHaveBeenCalledTimes(1);
  });

  it('returns to the assistant handoff without sending the preserved question', () => {
    userState.uid = 'alice';
    move(librarySearch);
    const view = renderAfterFrame();
    const link = screen.getByRole('link', { name: '交給校園助理' });
    const destination = link.getAttribute('href')!;
    fireEvent.click(link);
    const entry = window.history.state;
    view.unmount();
    window.history.pushState(nextState, '', destination);
    traverse(librarySearch, entry);
    renderAfterFrame();
    expect(document.activeElement).toBe(screen.getByRole('link', { name: '交給校園助理' }));
    expect(interpretCampusRequest).not.toHaveBeenCalled();
  });

  it('waits for the Router URL and rendered results to agree before restoring', () => {
    const entry = leaveLibrary();
    traverse(librarySearch, entry);
    router.search = '?campus=pu&q=%E5%85%AC%E8%BB%8A';
    const view = renderAfterFrame();
    expect(scroll).not.toHaveBeenCalled();
    router.search = new URL(librarySearch, window.location.origin).search;
    view.rerender(<SearchPage />);
    expect(document.activeElement).toBe(screen.getByRole('link', { name: /^圖書館/ }));
    expect(scroll).toHaveBeenCalledTimes(1);
  });

  it.each(['pointer', 'keyboard', 'scroll', 'focus'] as const)(
    'does not take focus after a person continues by %s while the Router catches up',
    (interaction) => {
      const entry = leaveLibrary();
      traverse(librarySearch, entry);
      router.search = '?campus=pu';
      const view = renderAfterFrame();
      const search = screen.getByRole('searchbox');
      if (interaction === 'pointer') fireEvent.pointerDown(search);
      if (interaction === 'keyboard') fireEvent.keyDown(search, { key: 'Tab' });
      if (interaction === 'scroll') fireEvent.wheel(window);
      if (interaction === 'focus') search.focus();
      router.search = new URL(librarySearch, window.location.origin).search;
      view.rerender(<SearchPage />);
      expect(document.activeElement).not.toBe(screen.getByRole('link', { name: /^圖書館/ }));
      expect(scroll).not.toHaveBeenCalled();
    },
  );

  it('respects interaction before the search page remounts', () => {
    const entry = leaveLibrary();
    traverse(librarySearch, entry);
    fireEvent.touchStart(window);
    renderAfterFrame();
    expect(scroll).not.toHaveBeenCalled();
  });

  it('waits for the same account to resolve and discards a return into a different account', () => {
    userState.uid = 'alice';
    const entry = leaveLibrary();
    const destination = window.history.state;
    traverse(librarySearch, entry);
    userState.loading = true;
    const view = renderAfterFrame();
    expect(scroll).not.toHaveBeenCalled();
    userState.loading = false;
    view.rerender(<SearchPage />);
    expect(document.activeElement).toBe(screen.getByRole('link', { name: /^圖書館/ }));
    view.unmount();

    traverse('/library?campus=pu', destination);
    traverse(librarySearch, entry);
    userState.uid = 'bob';
    renderAfterFrame();
    expect(document.activeElement).not.toBe(screen.getByRole('link', { name: /^圖書館/ }));
    expect(scroll).toHaveBeenCalledTimes(1);
  });

  it('does not restore after the resolved campus changes even when the search URL is unchanged', () => {
    selection.current = {
      selectedSchool: { id: 'pu', code: 'PU' },
      loading: false,
      catalogStatus: 'ready',
    };
    move('/search?q=%E5%80%9F%E6%9B%B8');
    const view = renderAfterFrame();
    fireEvent.click(screen.getByRole('link', { name: /^圖書館/ }));
    const entry = window.history.state;
    view.unmount();
    window.history.pushState(nextState, '', '/library?campus=pu');
    selection.current = {
      selectedSchool: { id: 'nthu', code: 'NTHU' },
      loading: false,
      catalogStatus: 'ready',
    };
    traverse('/search?q=%E5%80%9F%E6%9B%B8', entry);
    renderAfterFrame();
    expect(screen.getByRole('link', { name: /^圖書館/ }).getAttribute('href')).toContain(
      'campus=nthu',
    );
    expect(scroll).not.toHaveBeenCalled();
  });

  it('waits for the same campus to finish resolving before moving focus', () => {
    selection.current = {
      selectedSchool: { id: 'pu', code: 'PU' },
      loading: false,
      catalogStatus: 'ready',
    };
    const entry = leaveLibrary();
    traverse(librarySearch, entry);
    selection.current.loading = true;
    const view = renderAfterFrame();
    expect(scroll).not.toHaveBeenCalled();
    selection.current.loading = false;
    view.rerender(<SearchPage />);
    expect(document.activeElement).toBe(screen.getByRole('link', { name: /^圖書館/ }));
  });

  it.each(['error', 'signing-out', 'different session'] as const)(
    'does not restore across an unavailable or replaced platform session: %s',
    (state) => {
      userState.platform = true;
      const entry = leaveLibrary();
      traverse(librarySearch, entry);
      userState.platformLoading = true;
      const view = renderAfterFrame();
      expect(scroll).not.toHaveBeenCalled();
      userState.platformLoading = false;
      if (state === 'error') userState.platformError = 'Session unavailable';
      if (state === 'signing-out') userState.pendingLogout = true;
      if (state === 'different session') userState.context = 'different-context';
      view.rerender(<SearchPage />);
      expect(scroll).not.toHaveBeenCalled();
      userState.platformError = '';
      userState.pendingLogout = false;
      userState.context = 'platform-context';
      view.rerender(<SearchPage />);
      expect(scroll).not.toHaveBeenCalled();
    },
  );

  it.each([
    '/search?campus=nthu&q=%E5%80%9F%E6%9B%B8&category=campus',
    '/search?campus=pu&q=%E5%80%9F%E6%9B%B8',
    librarySearch + '#another-position',
  ])('does not use a saved return in another URL: %s', (url) => {
    const entry = leaveLibrary();
    traverse(url, entry);
    renderAfterFrame();
    expect(scroll).not.toHaveBeenCalled();
  });

  it.each([
    { ctrlKey: true },
    { metaKey: true },
    { shiftKey: true },
    { altKey: true },
    { button: 1 },
  ])('does not mark the original entry when opening with %j', (modifier) => {
    move(librarySearch);
    renderAfterFrame();
    const entry = window.history.state;
    fireEvent.click(screen.getByRole('link', { name: /^圖書館/ }), modifier);
    expect(window.history.state).toEqual(entry);
  });

  it('editing the search invalidates its prior return even before composition is published', () => {
    move(librarySearch);
    const view = renderAfterFrame();
    fireEvent.click(screen.getByRole('link', { name: /^圖書館/ }));
    const search = screen.getByRole('searchbox');
    fireEvent.compositionStart(search);
    fireEvent.change(search, { target: { value: '借書館' } });
    const entry = window.history.state;
    view.unmount();
    window.history.pushState(nextState, '', '/library?campus=pu');
    traverse(librarySearch, entry);
    renderAfterFrame();
    expect(scroll).not.toHaveBeenCalled();
  });

  it('keeps service navigation available when History access is denied', () => {
    move(librarySearch);
    renderAfterFrame();
    const history = vi.spyOn(window.history, 'replaceState').mockImplementation(() => {
      throw new DOMException('History unavailable', 'SecurityError');
    });
    try {
      const link = screen.getByRole('link', { name: /^圖書館/ });
      expect(fireEvent.click(link)).toBe(true);
      expect(link.getAttribute('href')).toBe('/library?campus=pu');
    } finally {
      history.mockRestore();
    }
  });

  it('waits until the traversal finishes, stops native smooth scrolling, then reveals the result once', () => {
    const entry = leaveLibrary();
    traverse(librarySearch, entry);
    render(<SearchPage />);
    expect(scroll).not.toHaveBeenCalled();
    expect(stopScroll).not.toHaveBeenCalled();
    expect(document.activeElement).not.toBe(screen.getByRole('link', { name: /^圖書館/ }));
    nextFrame();
    expect(document.activeElement).toBe(screen.getByRole('link', { name: /^圖書館/ }));
    expect(stopScroll).toHaveBeenCalledWith({
      top: window.scrollY,
      left: window.scrollX,
      behavior: 'instant',
    });
    expect(stopScroll.mock.invocationCallOrder[0]).toBeLessThan(scroll.mock.invocationCallOrder[0]);
    nextFrame();
    expect(scroll).toHaveBeenCalledTimes(1);
  });

  it.each(['pointer', 'keyboard', 'wheel', 'touch', 'focus'] as const)(
    'abandons a ready return when the person chooses a new %s interaction before the next frame',
    (interaction) => {
      const entry = leaveLibrary();
      traverse(librarySearch, entry);
      render(<SearchPage />);
      const search = screen.getByRole('searchbox');
      if (interaction === 'pointer') fireEvent.pointerDown(search);
      if (interaction === 'keyboard') fireEvent.keyDown(search, { key: 'Tab' });
      if (interaction === 'wheel') fireEvent.wheel(window);
      if (interaction === 'touch') fireEvent.touchStart(window);
      if (interaction === 'focus') screen.getByRole('heading', { name: '搜尋結果' }).focus();
      nextFrame();
      expect(document.activeElement).not.toBe(screen.getByRole('link', { name: /^圖書館/ }));
      expect(scroll).not.toHaveBeenCalled();
      expect(stopScroll).not.toHaveBeenCalled();
    },
  );

  it.each(['account', 'campus', 'entry', 'url', 'unmount'] as const)(
    'rechecks the %s boundary before applying a scheduled return',
    (change) => {
      userState.uid = 'alice';
      const entry = leaveLibrary();
      traverse(librarySearch, entry);
      const view = render(<SearchPage />);
      if (change === 'account') {
        userState.uid = 'bob';
        view.rerender(<SearchPage />);
      }
      if (change === 'campus') {
        selection.current = {
          selectedSchool: { id: 'nthu', code: 'NTHU' },
          loading: false,
          catalogStatus: 'ready',
        };
        view.rerender(<SearchPage />);
      }
      if (change === 'entry') move(librarySearch, nextState);
      if (change === 'url') move(librarySearch + '#changed', entry);
      if (change === 'unmount') view.unmount();
      nextFrame();
      expect(scroll).not.toHaveBeenCalled();
      expect(stopScroll).not.toHaveBeenCalled();
    },
  );
});
