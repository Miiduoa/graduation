import { SchoolLmsReadonlyProvider } from '@/components/SchoolLmsReadonlyProvider';
import { fireEvent, render, screen, within } from '@testing-library/react';
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


it('recognizes a complex signed-in campus request using AI instead of only keyword results', async () => {
  userState.uid = 'alice';
  vi.mocked(interpretCampusRequest).mockResolvedValue({
    status: 'understood', source: 'model', summary: '想先確認課表，再找讀書和吃飯的地點。',
    destinations: ['/timetable', '/library', '/cafeteria'], clarifyingQuestion: null,
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
  expect(screen.queryByRole('link', { name: /玩課雲作業與教材/ })).toBeNull();
  view.rerender(<SchoolLmsReadonlyProvider enabled={true}><SearchPage /></SchoolLmsReadonlyProvider>);
  expect(screen.getByRole('link', { name: /玩課雲作業與教材/ }).getAttribute('href')).toContain('/school-lms');
});
