import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { personalImportSavedNotice, type PersonalImportRecord } from '@campus/shared';
import { PersonalCalendar } from './PersonalCalendar';
import workspaceStyles from './PersonalCalendar.module.css';
import { loadNuniCalendarDeadlines } from '@/lib/calendarCourseDeadlines';
import {
  changePersonalImport,
  personalImportsStorageKey,
  readPersonalImports,
} from '@/lib/personalImports';

const state = vi.hoisted(() => ({
  accountId: 'calendar-flow-account',
  schoolId: 'pu',
  loading: false,
}));

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(`campus=${state.schoolId}`),
}));
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));
vi.mock('@/components/AuthGuard', () => ({
  useAuth: () => ({ user: null, loading: false, error: null }),
}));
vi.mock('@/components/SelectedSchoolProvider', () => ({
  useOptionalSelectedSchool: () => ({
    loading: false,
    catalogStatus: 'ready',
    selectedSchoolId: state.schoolId,
    selectedSchool: { id: state.schoolId, name: '合成校園' },
  }),
}));
vi.mock('@/features/nuni/Session', () => ({
  useOptionalNuniSession: () => ({
    session: { context: 'synthetic-calendar-context', platformAccountId: state.accountId },
    loading: state.loading,
    error: null,
    pendingLogout: false,
  }),
  browserRequest: vi.fn(),
}));
vi.mock('@/lib/homeOverview', () => ({
  loadHomeData: vi.fn(async () => ({ courses: [], tasks: [], unreadCount: 0 })),
}));
vi.mock('@/lib/calendarCourseDeadlines', async (actual) => ({
  ...(await actual<typeof import('@/lib/calendarCourseDeadlines')>()),
  loadNuniCalendarDeadlines: vi.fn(async () => []),
}));
vi.mock('@/lib/usePersonalImports', async (actual) => ({
  ...(await actual<typeof import('@/lib/usePersonalImports')>()),
  usePersonalImportScope: () => {
    const scope = { owner: `platform:${state.accountId}`, schoolId: state.schoolId };
    return {
      scope,
      scopeKey: personalImportsStorageKey(scope),
      loading: state.loading,
      schoolName: '合成校園',
    };
  },
}));

const DISCARD = '尚有未儲存的修改，要捨棄這些內容嗎？';
const scope = () => ({ owner: `platform:${state.accountId}`, schoolId: state.schoolId });

beforeEach(() => {
  vi.restoreAllMocks();
  vi.mocked(loadNuniCalendarDeadlines).mockReset().mockResolvedValue([]);
  vi.useFakeTimers({ toFake: ['Date'] });
  // 台灣已經是 11/24；不能用 UTC 日期代替畫面上的「今天」。
  vi.setSystemTime(new Date('2026-11-23T16:30:00.000Z'));
  state.accountId = 'calendar-flow-account';
  state.schoolId = 'pu';
  state.loading = false;
  localStorage.clear();
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(
    () => new DOMRect(20, 60, 100, 40),
  );
  vi.spyOn(window, 'scrollBy').mockImplementation(() => {});
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  Object.defineProperty(navigator, 'locks', {
    configurable: true,
    value: { request: (_key: string, action: () => unknown) => Promise.resolve().then(action) },
  });
});

afterEach(() => {
  vi.useRealTimers();
  Reflect.deleteProperty(window, 'visualViewport');
});

function event(id: string, title: string, date: string): PersonalImportRecord {
  return {
    id,
    batchId: `batch-${id}`,
    kind: 'events',
    schoolId: 'pu',
    academicYear: '',
    semester: '',
    title,
    date,
    allDay: false,
    startTime: '09:00',
    endTime: '10:00',
    importedAt: '2026-11-01T00:00:00.000Z',
    source: { type: 'paste', name: '合成行程', line: 1, rawText: title },
  };
}

function seed(rows: PersonalImportRecord[]) {
  localStorage.setItem(
    personalImportsStorageKey(scope()),
    JSON.stringify({ version: 1, records: rows }),
  );
}

function activate(control: HTMLElement) {
  act(() => {
    control.focus();
    fireEvent.click(control);
  });
}

async function ready() {
  await waitFor(() =>
    expect((screen.getByRole('button', { name: '新增行程' }) as HTMLButtonElement).disabled).toBe(
      false,
    ),
  );
}

function titleField() {
  return screen.getByRole('textbox', { name: '標題' }) as HTMLInputElement;
}

function formDate() {
  return screen.getByLabelText('日期') as HTMLInputElement;
}

function dayHeading(date: string) {
  return screen.getByRole('heading', { name: `${date} 的行程` });
}

function editEvent(title: string) {
  const row = screen.getByRole('heading', { name: title }).closest('li');
  if (!row) throw new Error('Expected the saved event in the visible day list');
  return within(row).getByRole('button', { name: '編輯' });
}

it('creates on the selected day, focuses the title and returns to its trigger when an unchanged form is cancelled', async () => {
  render(<PersonalCalendar />);
  await ready();
  activate(screen.getByRole('button', { name: '2026-11-14' }));
  const trigger = screen.getByRole('button', { name: '新增行程' });
  activate(trigger);
  expect(formDate().value).toBe('2026-11-14');
  await waitFor(() => expect(document.activeElement).toBe(titleField()));

  activate(screen.getByRole('button', { name: '取消' }));
  expect(screen.queryByRole('textbox', { name: '標題' })).toBeNull();
  expect(window.confirm).not.toHaveBeenCalled();
  await waitFor(() => expect(document.activeElement).toBe(trigger));
  expect(dayHeading('2026-11-14')).toBeTruthy();
  expect(readPersonalImports(scope())).toEqual([]);
});

it.each([
  ['2026-11', '2026-11-24'],
  ['2027-02', '2027-02-01'],
])('defaults a new event in unselected %s to %s', async (month, date) => {
  render(<PersonalCalendar />);
  await ready();
  fireEvent.change(screen.getByLabelText('查看月份'), { target: { value: month } });
  activate(screen.getByRole('button', { name: '新增行程' }));
  expect(formDate().value).toBe(date);
  expect(readPersonalImports(scope())).toEqual([]);
});

it.each(['列表', '查看整月列表'])(
  'clears the day filter for personal events and deadlines when opening the month list via %s',
  async (entry) => {
    seed([
      event('one', '合成當日安排', '2026-11-14'),
      event('two', '合成隔日安排', '2026-11-15'),
      event('outside', '合成下月安排', '2026-12-01'),
    ]);
    vi.mocked(loadNuniCalendarDeadlines).mockResolvedValue(
      [
        { id: 'same-day', title: '合成當日作業', dueDate: '2026-11-14' },
        { id: 'next-day', title: '合成隔日作業', dueDate: '2026-11-15' },
        { id: 'next-month', title: '合成下月作業', dueDate: '2026-12-01' },
      ].map((deadline) => ({
        ...deadline,
        courseId: 'course',
        courseName: '合成課程',
        href: `/classroom/course/course#assignment-${deadline.id}`,
        source: 'nuni' as const,
        sourceLabel: 'nuni 課程',
      })),
    );

    render(<PersonalCalendar />);
    await ready();
    await screen.findByRole('heading', { name: '合成隔日作業' });
    activate(screen.getByRole('button', { name: '2026-11-14' }));
    expect(dayHeading('2026-11-14')).toBeTruthy();
    expect(screen.getByRole('heading', { name: '合成當日安排' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: '合成當日作業' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: '合成隔日安排' })).toBeNull();
    expect(screen.queryByRole('heading', { name: '合成隔日作業' })).toBeNull();

    activate(screen.getByRole('button', { name: entry }));
    expect(screen.getByRole('button', { name: '列表' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.queryByRole('heading', { name: '2026-11-14 的行程' })).toBeNull();
    const events = within(screen.getByRole('list', { name: '個人行程列表' }));
    expect(events.getAllByRole('heading').map((heading) => heading.textContent)).toEqual([
      '合成當日安排',
      '合成隔日安排',
    ]);
    const deadlines = within(screen.getByTestId('calendar-due-list'));
    expect(deadlines.getAllByRole('heading').map((heading) => heading.textContent)).toEqual([
      '合成當日作業',
      '合成隔日作業',
    ]);

    activate(screen.getByRole('button', { name: '月格' }));
    expect(screen.getByRole('button', { name: '2026-11-14' }).getAttribute('aria-pressed')).toBe(
      'false',
    );
  },
);

it('retains a dirty draft when cancellation is declined and discards it without writing after confirmation', async () => {
  render(<PersonalCalendar />);
  await ready();
  activate(screen.getByRole('button', { name: '2026-11-14' }));
  const trigger = screen.getByRole('button', { name: '新增行程' });
  activate(trigger);
  fireEvent.change(titleField(), { target: { value: '尚未保存的合成安排' } });
  vi.mocked(window.confirm).mockReturnValueOnce(false);
  activate(screen.getByRole('button', { name: '取消' }));
  expect(window.confirm).toHaveBeenLastCalledWith(DISCARD);
  expect(titleField().value).toBe('尚未保存的合成安排');
  expect(formDate().value).toBe('2026-11-14');
  expect(readPersonalImports(scope())).toEqual([]);

  activate(screen.getByRole('button', { name: '取消' }));
  expect(screen.queryByRole('textbox', { name: '標題' })).toBeNull();
  await waitFor(() => expect(document.activeElement).toBe(trigger));
  expect(readPersonalImports(scope())).toEqual([]);
});

it('does not replace a dirty create draft with another editor until the discard is confirmed', async () => {
  const stored = event('existing', '原本的合成行程', '2026-11-14');
  seed([stored]);
  render(<PersonalCalendar />);
  await ready();
  activate(screen.getByRole('button', { name: '2026-11-14' }));
  activate(screen.getByRole('button', { name: '新增行程' }));
  fireEvent.change(titleField(), { target: { value: '還在寫的新安排' } });
  vi.mocked(window.confirm).mockReturnValueOnce(false);
  activate(editEvent(stored.title));
  expect(window.confirm).toHaveBeenLastCalledWith(DISCARD);
  expect(titleField().value).toBe('還在寫的新安排');
  expect(screen.getByRole('button', { name: '儲存行程' })).toBeTruthy();
  expect(readPersonalImports(scope())).toEqual([stored]);

  activate(editEvent(stored.title));
  expect(titleField().value).toBe(stored.title);
  expect(screen.getByRole('button', { name: '儲存修改' })).toBeTruthy();
  await waitFor(() => expect(document.activeElement).toBe(titleField()));
  expect(readPersonalImports(scope())).toEqual([stored]);
});

it('keeps an edited draft when opening a new event is declined', async () => {
  const stored = event('existing', '原本的合成行程', '2026-11-14');
  seed([stored]);
  render(<PersonalCalendar />);
  await ready();
  activate(screen.getByRole('button', { name: '2026-11-14' }));
  activate(editEvent(stored.title));
  fireEvent.change(titleField(), { target: { value: '尚未儲存的修改' } });
  vi.mocked(window.confirm).mockReturnValueOnce(false);
  activate(screen.getByRole('button', { name: '新增行程' }));
  expect(window.confirm).toHaveBeenLastCalledWith(DISCARD);
  expect(titleField().value).toBe('尚未儲存的修改');
  expect(screen.getByRole('button', { name: '儲存修改' })).toBeTruthy();
  expect(readPersonalImports(scope())).toEqual([stored]);
});

it.each(['列表', '月格'])(
  'reopens the latest version from %s after a cross-tab conflict',
  async (view) => {
    const stored = event('shared', '原本的合成行程', '2026-11-24');
    seed([stored]);
    render(<PersonalCalendar />);
    await ready();
    activate(screen.getByRole('button', { name: stored.date }));
    if (view === '列表') activate(screen.getByRole('button', { name: '列表' }));
    const edit = (title: string) =>
      view === '列表' ? editEvent(title) : screen.getByRole('button', { name: title });

    activate(edit(stored.title));
    fireEvent.change(titleField(), { target: { value: '此分頁未儲存的修改' } });
    activate(edit(stored.title));
    expect(document.activeElement).toBe(titleField());
    expect(window.confirm).not.toHaveBeenCalled();
    expect(titleField().value).toBe('此分頁未儲存的修改');

    const latestTitle = '另一分頁已儲存的修改';
    const current = readPersonalImports(scope()).find((row) => row.id === stored.id);
    if (!current) throw new Error(`找不到行程 ${stored.id}`);
    await act(async () => {
      await changePersonalImport(scope(), current, {
        ...stored,
        title: latestTitle,
      });
    });
    activate(screen.getByRole('button', { name: '儲存修改' }));
    const conflict = await screen.findByText('這筆資料已在另一個頁面變更，請重新開啟再編輯。');

    vi.mocked(window.confirm).mockReturnValueOnce(false);
    activate(edit(latestTitle));
    expect(window.confirm).toHaveBeenLastCalledWith(DISCARD);
    expect(titleField().value).toBe('此分頁未儲存的修改');
    expect(conflict.isConnected).toBe(true);

    activate(edit(latestTitle));
    expect(window.confirm).toHaveBeenCalledTimes(2);
    expect(titleField().value).toBe(latestTitle);
    expect(document.activeElement).toBe(titleField());
    expect(conflict.isConnected).toBe(false);
    fireEvent.change(titleField(), { target: { value: '重新開啟後儲存的修改' } });
    activate(screen.getByRole('button', { name: '儲存修改' }));
    await screen.findByText('個人行程已更新。');
    expect(readPersonalImports(scope()).map(({ id, title }) => ({ id, title }))).toEqual([
      { id: stored.id, title: '重新開啟後儲存的修改' },
    ]);
  },
);

it('preserves an unfinished form while changing the visible day and view', async () => {
  render(<PersonalCalendar />);
  await ready();
  activate(screen.getByRole('button', { name: '2026-11-14' }));
  activate(screen.getByRole('button', { name: '新增行程' }));
  fireEvent.change(titleField(), { target: { value: '繼續編輯的合成安排' } });
  activate(screen.getByRole('button', { name: '2026-11-15' }));
  expect(dayHeading('2026-11-15')).toBeTruthy();
  activate(screen.getByRole('button', { name: '列表' }));
  expect(screen.queryByRole('heading', { name: '2026-11-15 的行程' })).toBeNull();
  expect(titleField().value).toBe('繼續編輯的合成安排');
  expect(formDate().value).toBe('2026-11-14');
  expect(window.confirm).not.toHaveBeenCalled();
  expect(readPersonalImports(scope())).toEqual([]);
});

it('shows a saved event on its actual day and restores focus to that day after the editor closes', async () => {
  render(<PersonalCalendar />);
  await ready();
  activate(screen.getByRole('button', { name: '2026-11-14' }));
  activate(screen.getByRole('button', { name: '新增行程' }));
  fireEvent.change(titleField(), { target: { value: '已保存的合成安排' } });
  fireEvent.change(formDate(), { target: { value: '2027-02-08' } });
  activate(screen.getByRole('button', { name: '儲存行程' }));
  await screen.findByText(personalImportSavedNotice(1));
  expect((screen.getByLabelText('查看月份') as HTMLInputElement).value).toBe('2027-02');
  expect(screen.getByRole('heading', { name: '已保存的合成安排' })).toBeTruthy();
  expect(screen.queryByRole('textbox', { name: '標題' })).toBeNull();
  await waitFor(() => expect(document.activeElement).toBe(dayHeading('2027-02-08')));
  expect(readPersonalImports(scope())).toMatchObject([
    { title: '已保存的合成安排', date: '2027-02-08' },
  ]);
  expect(window.confirm).not.toHaveBeenCalled();
});

it('編輯並儲存既有行程後保留整月列表與其他日期的行程及作業', async () => {
  const stored = event('existing', '待修改行程', '2026-11-14');
  seed([stored, event('other-day', '隔日行程', '2026-11-15')]);
  vi.mocked(loadNuniCalendarDeadlines).mockResolvedValue([
    {
      id: 'next-day',
      title: '隔日作業',
      dueDate: '2026-11-15',
      courseId: 'course',
      courseName: '合成課程',
      href: '/classroom/course/course#assignment-next-day',
      source: 'nuni',
      sourceLabel: 'nuni 課程',
    },
  ]);

  render(<PersonalCalendar />);
  await ready();
  activate(screen.getByRole('button', { name: '列表' }));
  await screen.findByRole('heading', { name: '隔日作業' });
  activate(editEvent(stored.title));
  fireEvent.change(titleField(), { target: { value: '已修改行程' } });
  activate(screen.getByRole('button', { name: '儲存修改' }));
  await screen.findByText('個人行程已更新。');

  expect(screen.getByRole('button', { name: '列表' }).getAttribute('aria-pressed')).toBe('true');
  expect(screen.queryByRole('heading', { name: '2026-11-14 的行程' })).toBeNull();
  expect(screen.getByRole('heading', { name: '隔日行程' })).toBeTruthy();
  expect(screen.getByRole('heading', { name: '隔日作業' })).toBeTruthy();
  expect(document.activeElement).toBe(editEvent('已修改行程'));
  expect(readPersonalImports(scope()).find((record) => record.id === stored.id)?.title).toBe(
    '已修改行程',
  );
});

it('在整月列表儲存跨月行程後仍留在目前查看的月份', async () => {
  const stored = { ...event('crossing', '跨月行程', '2026-10-31'), endDate: '2026-11-02' };
  seed([stored, event('november-only', '十一月行程', '2026-11-15')]);
  render(<PersonalCalendar />);
  await ready();
  activate(screen.getByRole('button', { name: '列表' }));
  await screen.findByRole('heading', { name: '十一月行程' });
  expect((screen.getByLabelText('查看月份') as HTMLInputElement).value).toBe('2026-11');
  activate(editEvent(stored.title));
  fireEvent.change(titleField(), { target: { value: '已修改跨月行程' } });
  activate(screen.getByRole('button', { name: '儲存修改' }));
  await screen.findByText('個人行程已更新。');
  expect((screen.getByLabelText('查看月份') as HTMLInputElement).value).toBe('2026-11');
  expect(screen.getByRole('button', { name: '列表' }).getAttribute('aria-pressed')).toBe('true');
  expect(screen.getByRole('heading', { name: '十一月行程' })).toBeTruthy();
  expect(screen.getByRole('heading', { name: '已修改跨月行程' })).toBeTruthy();
});

it('在單日檢視修改跨月行程標題後保留選取日期、當日其他行程與作業截止', async () => {
  const stored = { ...event('crossing', '跨月行程', '2026-10-31'), endDate: '2026-11-02' };
  seed([stored, event('same-day', '當日其他行程', '2026-11-01')]);
  vi.mocked(loadNuniCalendarDeadlines).mockResolvedValue([
    {
      id: 'same-day-due',
      title: '當日作業',
      dueDate: '2026-11-01',
      courseId: 'course',
      courseName: '合成課程',
      href: '/classroom/course/course#assignment-same-day-due',
      source: 'nuni',
      sourceLabel: 'nuni 課程',
    },
  ]);
  render(<PersonalCalendar />);
  await ready();
  const dateControl = screen.getByRole('button', { name: '2026-11-01' });
  activate(dateControl);
  await screen.findByRole('heading', { name: '當日作業' });
  activate(editEvent(stored.title));
  fireEvent.change(titleField(), { target: { value: '已修改跨月行程' } });
  activate(screen.getByRole('button', { name: '儲存修改' }));
  await screen.findByText('個人行程已更新。');

  expect((screen.getByLabelText('查看月份') as HTMLInputElement).value).toBe('2026-11');
  expect(dateControl.getAttribute('aria-pressed')).toBe('true');
  expect(dayHeading('2026-11-01')).toBeTruthy();
  expect(screen.getByRole('heading', { name: '當日其他行程' })).toBeTruthy();
  expect(screen.getByRole('heading', { name: '當日作業' })).toBeTruthy();
  expect(screen.getByRole('heading', { name: '已修改跨月行程' })).toBeTruthy();
  expect(readPersonalImports(scope()).find((row) => row.id === stored.id)).toMatchObject({
    title: '已修改跨月行程',
    date: stored.date,
    endDate: stored.endDate,
  });
});

it.each([
  ['黏性頁首', 60, -20],
  ['固定底部導覽', 580, 52],
])('開啟編輯器時將被%s遮住的標題欄捲入可見範圍', async (_edge, titleTop, distance) => {
  vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(640);
  const stored = event('existing', '合成行程', '2026-11-14');
  seed([stored]);
  render(
    <>
      <header data-testid="sticky-header" style={{ position: 'sticky', opacity: 1 }} />
      <PersonalCalendar />
      <nav data-testid="fixed-navigation" style={{ position: 'fixed', opacity: 1 }} />
    </>,
  );
  await ready();
  activate(screen.getByRole('button', { name: '列表' }));
  const header = screen.getByTestId('sticky-header');
  const navigation = screen.getByTestId('fixed-navigation');
  let pageOffset = 0;
  vi.mocked(Element.prototype.getBoundingClientRect).mockImplementation(function (this: Element) {
    if (this === header) return new DOMRect(0, 0, 320, 80);
    if (this === navigation) return new DOMRect(0, 568, 320, 72);
    if (this.matches('input[type="text"]')) return new DOMRect(20, titleTop - pageOffset, 100, 40);
    return new DOMRect(20, 100, 100, 40);
  });
  vi.mocked<(options: ScrollToOptions) => void>(window.scrollBy).mockImplementation((options) => {
    pageOffset += options.top ?? 0;
  });

  activate(editEvent(stored.title));

  const title = titleField();
  expect(document.activeElement).toBe(title);
  expect(window.scrollBy).toHaveBeenCalledExactlyOnceWith({
    left: 0,
    top: distance,
    behavior: 'instant',
  });
  expect(title.getBoundingClientRect().top).toBeGreaterThanOrEqual(80);
  expect(title.getBoundingClientRect().bottom).toBeLessThanOrEqual(568);
});

it('remeasures the focused title after the soft keyboard shrinks the visual viewport', async () => {
  vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(640);
  const listeners = new Map<string, Set<() => void>>();
  const viewport = {
    height: 640,
    width: 320,
    offsetTop: 0,
    offsetLeft: 0,
    addEventListener: vi.fn((name: string, listener: () => void) => {
      const bag = listeners.get(name) ?? new Set();
      bag.add(listener);
      listeners.set(name, bag);
    }),
    removeEventListener: vi.fn((name: string, listener: () => void) => {
      listeners.get(name)?.delete(listener);
    }),
  };
  Object.defineProperty(window, 'visualViewport', {
    configurable: true,
    writable: true,
    value: viewport,
  });
  const stored = event('existing', '合成行程', '2026-11-14');
  seed([stored]);
  render(<PersonalCalendar />);
  await ready();
  activate(screen.getByRole('button', { name: '列表' }));
  let pageOffset = 0;
  vi.mocked(Element.prototype.getBoundingClientRect).mockImplementation(function (this: Element) {
    if (this.matches('input[type="text"]')) return new DOMRect(20, 500 - pageOffset, 100, 40);
    return new DOMRect(20, 100, 100, 40);
  });
  vi.mocked<(options: ScrollToOptions) => void>(window.scrollBy).mockImplementation((options) => {
    pageOffset += options.top ?? 0;
  });

  activate(editEvent(stored.title));
  expect(document.activeElement).toBe(titleField());
  expect(window.scrollBy).not.toHaveBeenCalled();

  viewport.height = 400;
  for (const listener of listeners.get('resize') ?? []) listener();
  expect(window.scrollBy).toHaveBeenCalledWith({ left: 0, top: 140, behavior: 'instant' });
  expect(titleField().getBoundingClientRect().bottom).toBeLessThanOrEqual(400);
});

it('does not scroll the title back when another editor field has focus during a visual viewport change', async () => {
  vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(640);
  const listeners = new Map<string, Set<() => void>>();
  const viewport = {
    height: 640,
    width: 320,
    offsetTop: 0,
    offsetLeft: 0,
    addEventListener: vi.fn((name: string, listener: () => void) => {
      const bag = listeners.get(name) ?? new Set();
      bag.add(listener);
      listeners.set(name, bag);
    }),
    removeEventListener: vi.fn((name: string, listener: () => void) => {
      listeners.get(name)?.delete(listener);
    }),
  };
  Object.defineProperty(window, 'visualViewport', {
    configurable: true,
    writable: true,
    value: viewport,
  });
  const stored = event('existing', '合成行程', '2026-11-14');
  seed([stored]);
  render(<PersonalCalendar />);
  await ready();
  activate(screen.getByRole('button', { name: '列表' }));
  activate(editEvent(stored.title));
  expect(document.activeElement).toBe(titleField());
  const location = screen.getByLabelText('地點（選填）') as HTMLInputElement;
  location.focus();
  expect(document.activeElement).toBe(location);
  vi.mocked(window.scrollBy).mockClear();
  viewport.height = 400;
  for (const listener of listeners.get('resize') ?? []) listener();
  expect(window.scrollBy).not.toHaveBeenCalled();
});

it.each([false, true])(
  '在整月列表改期後跟隨新的月份（儲存期間焦點移出編輯器：%s）',
  async (moveFocus) => {
    let release: (() => void) | undefined;
    Object.defineProperty(navigator, 'locks', {
      configurable: true,
      value: {
        request: (_key: string, action: () => unknown) =>
          new Promise((resolve, reject) => {
            release = () => {
              void Promise.resolve().then(action).then(resolve, reject);
            };
          }),
      },
    });
    const stored = event('existing', '整月列表改期的合成行程', '2026-11-14');
    seed([stored, event('november-only', '十一月行程', '2026-11-15')]);
    render(<PersonalCalendar />);
    await ready();
    activate(screen.getByRole('button', { name: '列表' }));
    await screen.findByRole('heading', { name: '十一月行程' });
    expect((screen.getByLabelText('查看月份') as HTMLInputElement).value).toBe('2026-11');
    activate(editEvent(stored.title));
    fireEvent.change(formDate(), { target: { value: '2026-12-02' } });
    activate(screen.getByRole('button', { name: '儲存修改' }));
    await waitFor(() => expect(release).toBeTypeOf('function'));
    const monthControl = screen.getByLabelText('查看月份') as HTMLInputElement;
    if (moveFocus) {
      // jsdom does not implement Tab navigation. Focus an outside control without activating it.
      monthControl.focus();
      expect(document.activeElement).toBe(monthControl);
    }
    await act(async () => {
      release?.();
    });
    await screen.findByText('個人行程已更新。');
    expect(monthControl.value).toBe('2026-12');
    expect(screen.getByRole('heading', { name: stored.title })).toBeTruthy();
    expect(document.activeElement).toBe(moveFocus ? monthControl : dayHeading('2026-12-02'));
    expect(readPersonalImports(scope()).find((row) => row.id === stored.id)).toMatchObject({
      id: stored.id,
      source: stored.source,
      date: '2026-12-02',
    });
  },
);

it('follows a rescheduled event into its new month while preserving its identity and provenance', async () => {
  const stored = event('existing', '跨月改期的合成行程', '2026-11-14');
  seed([stored]);
  render(<PersonalCalendar />);
  await ready();
  activate(screen.getByRole('button', { name: '2026-11-14' }));
  activate(editEvent(stored.title));
  fireEvent.change(formDate(), { target: { value: '2026-12-02' } });
  activate(screen.getByRole('button', { name: '儲存修改' }));
  await screen.findByText('個人行程已更新。');
  expect((screen.getByLabelText('查看月份') as HTMLInputElement).value).toBe('2026-12');
  expect(screen.getByRole('heading', { name: stored.title })).toBeTruthy();
  await waitFor(() => expect(document.activeElement).toBe(dayHeading('2026-12-02')));
  expect(readPersonalImports(scope())).toHaveLength(1);
  expect(readPersonalImports(scope()).find((row) => row.id === stored.id)).toMatchObject({
    id: stored.id,
    source: stored.source,
    date: '2026-12-02',
  });
});

it('returns a cancelled edit to the original event control without changing its record', async () => {
  const stored = event('existing', '合成行程', '2026-11-14');
  seed([stored]);
  render(<PersonalCalendar />);
  await ready();
  activate(screen.getByRole('button', { name: '2026-11-14' }));
  const trigger = editEvent(stored.title);
  activate(trigger);
  await waitFor(() => expect(document.activeElement).toBe(titleField()));
  activate(screen.getByRole('button', { name: '取消' }));
  await waitFor(() => expect(document.activeElement).toBe(trigger));
  expect(window.confirm).not.toHaveBeenCalled();
  expect(readPersonalImports(scope())).toEqual([stored]);
});

it.each([0, 80])(
  '取消編輯時，月格裡被水平裁切的原控制改由新增行程接收焦點（scrollLeft=%i）',
  async (scrollLeft) => {
    const stored = event('existing', '合成月格行程', '2026-11-14');
    seed([stored]);
    render(<PersonalCalendar />);
    await ready();

    const trigger = screen.getByRole('button', { name: stored.title });
    const viewport = screen.getByRole('region', { name: '2026-11 月格，週日起始' });
    viewport.style.overflowX = 'auto';
    vi.spyOn(viewport, 'clientWidth', 'get').mockReturnValue(216);
    vi.mocked(Element.prototype.getBoundingClientRect).mockImplementation(function (this: Element) {
      if (this === viewport) return new DOMRect(40, 100, 216, 400);
      if (this === trigger) return new DOMRect(300 - viewport.scrollLeft, 200, 88, 40);
      return new DOMRect(20, 60, 100, 40);
    });

    viewport.scrollLeft = 160;
    activate(trigger);
    expect(document.activeElement).toBe(titleField());
    viewport.scrollLeft = scrollLeft;
    activate(screen.getByRole('button', { name: '取消' }));

    expect(document.activeElement).toBe(screen.getByRole('button', { name: '新增行程' }));
    expect(viewport.scrollLeft).toBe(scrollLeft);
  },
);

it.each([
  ['黏性頁首', 40, true],
  ['黏性頁尾', 580, true],
  ['可見區域', 120, false],
])('選日後依量測的可見範圍處理焦點（%s）', async (_edge, dateTop, covered) => {
  vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(640);
  render(
    <>
      <header data-testid="sticky-header" style={{ position: 'sticky', opacity: 1 }} />
      <PersonalCalendar />
      <footer data-testid="sticky-footer" style={{ position: 'fixed', opacity: 1 }} />
    </>,
  );
  await ready();
  const header = screen.getByTestId('sticky-header');
  const footer = screen.getByTestId('sticky-footer');
  const date = screen.getByRole('button', { name: '2026-11-24' });
  let pageOffset = 0;
  vi.mocked(Element.prototype.getBoundingClientRect).mockImplementation(function (this: Element) {
    if (this === header) return new DOMRect(0, 0, 320, 80);
    if (this === footer) return new DOMRect(0, 568, 320, 72);
    if (this === date) return new DOMRect(20, dateTop + 220 - pageOffset, 80, 32);
    if (this.classList.contains(workspaceStyles.daySummary)) {
      return new DOMRect(20, 300 - pageOffset, 280, 60);
    }
    return new DOMRect(20, 60, 100, 40);
  });
  vi.mocked<(options: ScrollToOptions) => void>(window.scrollBy).mockImplementation((options) => {
    pageOffset += options.top ?? 0;
  });

  activate(date);

  const heading = dayHeading('2026-11-24');
  const summary = heading.closest<HTMLElement>(`.${workspaceStyles.daySummary}`)!;
  expect(window.scrollBy).toHaveBeenCalledExactlyOnceWith({ left: 0, top: 220, behavior: 'instant' });
  expect(summary.getBoundingClientRect().top).toBe(80);
  expect(summary.style.scrollMarginBottom).toBe('72px');
  expect(document.activeElement).toBe(covered ? heading : date);
});

it.each(['列表', '下一月'])(
  '切換到「%s」後取消編輯，將焦點移到可見的新增行程按鈕',
  async (navigation) => {
    const stored = event('existing', '合成月格行程', '2026-11-14');
    seed([stored]);
    render(<PersonalCalendar />);
    await ready();
    const trigger = screen.getByRole('button', { name: stored.title });
    activate(trigger);
    await waitFor(() => expect(document.activeElement).toBe(titleField()));
    activate(screen.getByRole('button', { name: navigation }));
    expect(trigger.isConnected).toBe(false);

    const createButton = screen.getByRole('button', { name: '新增行程' });
    // JSDOM has no layout. Simulate the page position after reaching the cancel button.
    let pageOffset = window.innerHeight;
    vi.spyOn(createButton, 'getBoundingClientRect').mockImplementation(
      () => new DOMRect(20, 60 - pageOffset, 100, 40),
    );
    vi.mocked<(options: ScrollToOptions) => void>(window.scrollBy).mockImplementation((options) => {
      pageOffset += options.top ?? 0;
    });
    expect(createButton.getBoundingClientRect().bottom).toBeLessThan(0);

    activate(screen.getByRole('button', { name: '取消' }));
    expect(document.activeElement).toBe(createButton);
    const { top, bottom, left, right } = createButton.getBoundingClientRect();
    expect(top).toBeGreaterThanOrEqual(0);
    expect(bottom).toBeLessThanOrEqual(window.innerHeight);
    expect(left).toBeGreaterThanOrEqual(0);
    expect(right).toBeLessThanOrEqual(window.innerWidth);
    expect(readPersonalImports(scope())).toEqual([stored]);
  },
);

it('does not steal focus from another control when a pending save completes', async () => {
  let release: (() => void) | undefined;
  Object.defineProperty(navigator, 'locks', {
    configurable: true,
    value: {
      request: (_key: string, action: () => unknown) =>
        new Promise((resolve, reject) => {
          release = () => {
            void Promise.resolve().then(action).then(resolve, reject);
          };
        }),
    },
  });
  render(<PersonalCalendar />);
  await ready();
  activate(screen.getByRole('button', { name: '新增行程' }));
  fireEvent.change(titleField(), { target: { value: '延遲保存的合成安排' } });
  activate(screen.getByRole('button', { name: '儲存行程' }));
  const otherControl = screen.getByRole('button', { name: '列表' });
  activate(otherControl);
  await act(async () => {
    release?.();
  });
  await screen.findByText(personalImportSavedNotice(1));
  expect(document.activeElement).toBe(otherControl);
  expect(screen.getByRole('heading', { name: '延遲保存的合成安排' })).toBeTruthy();
  expect(readPersonalImports(scope())).toHaveLength(1);
});

it('preserves the newly selected day when a completed write is acknowledged during revalidation', async () => {
  let acknowledge: (() => void) | undefined;
  Object.defineProperty(navigator, 'locks', {
    configurable: true,
    value: {
      request: (_key: string, action: () => unknown) =>
        Promise.resolve()
          .then(action)
          .then(
            (value) =>
              new Promise((resolve) => {
                acknowledge = () => resolve(value);
              }),
          ),
    },
  });
  const app = (
    <>
      <button type="button">畫面外的合成控制</button>
      <PersonalCalendar />
    </>
  );
  const view = render(app);
  await ready();
  activate(screen.getByRole('button', { name: '2026-11-14' }));
  activate(screen.getByRole('button', { name: '新增行程' }));
  fireEvent.change(titleField(), { target: { value: '重驗期間完成的合成安排' } });
  activate(screen.getByRole('button', { name: '儲存行程' }));
  await waitFor(() => expect(acknowledge).toBeTypeOf('function'));
  expect(readPersonalImports(scope())).toMatchObject([{ date: '2026-11-14' }]);
  activate(screen.getByRole('button', { name: '下一月' }));
  activate(screen.getByRole('button', { name: '2026-12-15' }));
  expect(dayHeading('2026-12-15')).toBeTruthy();
  state.loading = true;
  view.rerender(
    <>
      <button type="button">畫面外的合成控制</button>
      <PersonalCalendar />
    </>,
  );
  expect(screen.queryByRole('textbox', { name: '標題' })).toBeNull();
  const outside = screen.getByRole('button', { name: '畫面外的合成控制' });
  outside.focus();
  await act(async () => {
    acknowledge?.();
  });
  expect(document.activeElement).toBe(outside);
  state.loading = false;
  view.rerender(
    <>
      <button type="button">畫面外的合成控制</button>
      <PersonalCalendar />
    </>,
  );
  await ready();
  await screen.findByText(personalImportSavedNotice(1));
  expect((screen.getByLabelText('查看月份') as HTMLInputElement).value).toBe('2026-12');
  expect(dayHeading('2026-12-15')).toBeTruthy();
  expect(screen.getByRole('button', { name: '2026-12-15' }).getAttribute('aria-pressed')).toBe(
    'true',
  );
  expect(document.activeElement).toBe(outside);
  expect(screen.queryByRole('textbox', { name: '標題' })).toBeNull();
  expect(readPersonalImports(scope())).toHaveLength(1);
});

it.each(['selected date', 'document.body'])(
  'preserves the newly selected month and date when an earlier day finishes saving with focus on %s',
  async (focusTarget) => {
    let release: (() => void) | undefined;
    Object.defineProperty(navigator, 'locks', {
      configurable: true,
      value: {
        request: (_key: string, action: () => unknown) =>
          new Promise((resolve, reject) => {
            release = () => {
              void Promise.resolve().then(action).then(resolve, reject);
            };
          }),
      },
    });
    render(<PersonalCalendar />);
    await ready();
    activate(screen.getByRole('button', { name: '2026-11-14' }));
    activate(screen.getByRole('button', { name: '新增行程' }));
    fireEvent.change(titleField(), { target: { value: '前一月等待保存的合成安排' } });
    activate(screen.getByRole('button', { name: '儲存行程' }));
    await waitFor(() => expect(release).toBeTypeOf('function'));

    activate(screen.getByRole('button', { name: '下一月' }));
    const dateControl = screen.getByRole('button', { name: '2026-12-15' });
    activate(dateControl);
    expect(dayHeading('2026-12-15')).toBeTruthy();
    if (focusTarget === 'document.body') dateControl.blur();
    const expectedFocus = focusTarget === 'document.body' ? document.body : dateControl;
    expect(document.activeElement).toBe(expectedFocus);
    expect(readPersonalImports(scope())).toEqual([]);

    await act(async () => {
      release?.();
    });
    await screen.findByText(personalImportSavedNotice(1));
    expect((screen.getByLabelText('查看月份') as HTMLInputElement).value).toBe('2026-12');
    expect(dayHeading('2026-12-15')).toBeTruthy();
    expect(dateControl.getAttribute('aria-pressed')).toBe('true');
    expect(document.activeElement).toBe(expectedFocus);
    expect(screen.queryByRole('textbox', { name: '標題' })).toBeNull();
    expect(readPersonalImports(scope())).toMatchObject([
      { title: '前一月等待保存的合成安排', date: '2026-11-14' },
    ]);
    expect(window.confirm).not.toHaveBeenCalled();
  },
);
