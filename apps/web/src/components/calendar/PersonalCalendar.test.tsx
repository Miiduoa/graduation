import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi, type Mock } from 'vitest';
import {
  emptyPersonalEventDraft,
  personalImportSavedNotice,
  type PersonalImportRecord,
} from '@campus/shared';
import { PersonalCalendar } from './PersonalCalendar';
import * as personalImports from '@/lib/personalImports';
import * as personalImportHooks from '@/lib/usePersonalImports';
import {
  changePersonalImport,
  personalImportsStorageKey,
  readPersonalImports,
  savePersonalImportBatch,
} from '@/lib/personalImports';

const context = vi.hoisted(() => {
  type HomeTaskRow = {
    id: string;
    courseId: string;
    courseName: string;
    title: string;
    dueAt: string | null;
    href?: string;
  };
  type HomeDataRow = {
    courses: { id: string; name: string; role: string; unreadCount: number }[];
    tasks: HomeTaskRow[];
    unreadCount: number;
  };
  type DeadlineRow = {
    id: string;
    title: string;
    courseName: string;
    courseId: string;
    dueDate: string;
    href: string;
    source: 'nuni' | 'lms';
    sourceLabel: string;
  };
  return {
    owner: 'platform:one',
    schoolId: 'pu',
    search: '',
    loading: false,
    user: null as { uid: string } | null,
    nuni: null as {
      session: { context: string; platformAccountId: string };
      loading: boolean;
    } | null,
    loadHomeData: vi.fn() as Mock<(uid: string) => Promise<HomeDataRow>>,
    loadNuniCalendarDeadlines: vi.fn() as Mock<
      (
        transport: unknown,
        platformAccountId: string,
        fence?: { cancelled(): boolean },
      ) => Promise<DeadlineRow[]>
    >,
  };
});

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(context.search),
}));

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock('@/components/AuthGuard', () => ({
  useAuth: () => ({ user: context.user, loading: false }),
}));

vi.mock('@/features/nuni/Session', () => ({
  useOptionalNuniSession: () => context.nuni,
  browserRequest: vi.fn(),
}));

vi.mock('@/lib/homeOverview', () => ({
  loadHomeData: (uid: string) => context.loadHomeData(uid),
}));

vi.mock('@/lib/calendarCourseDeadlines', async (actual) => ({
  ...(await actual<typeof import('@/lib/calendarCourseDeadlines')>()),
  loadNuniCalendarDeadlines: (
    transport: unknown,
    platformAccountId: string,
    fence?: { cancelled(): boolean },
  ) => context.loadNuniCalendarDeadlines(transport, platformAccountId, fence),
}));

vi.mock('@/lib/usePersonalImports', async (actual) => ({
  ...(await actual<typeof import('@/lib/usePersonalImports')>()),
  usePersonalImportScope: () => ({
    scope: { owner: context.owner, schoolId: context.schoolId },
    scopeKey: personalImportsStorageKey({ owner: context.owner, schoolId: context.schoolId }),
    loading: context.loading,
    schoolName: '靜宜大學',
  }),
}));

const originalBounds = Element.prototype.getBoundingClientRect;

beforeEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  context.owner = 'platform:one';
  context.schoolId = 'pu';
  context.search = '';
  context.loading = false;
  context.user = null;
  context.nuni = null;
  context.loadHomeData.mockReset().mockResolvedValue({ courses: [], tasks: [], unreadCount: 0 });
  context.loadNuniCalendarDeadlines.mockReset().mockResolvedValue([]);
  Object.defineProperty(navigator, 'locks', {
    configurable: true,
    value: { request: (_key: string, fn: () => unknown) => Promise.resolve().then(fn) },
  });
  URL.createObjectURL = vi.fn(() => 'blob:calendar');
  URL.revokeObjectURL = vi.fn();
  window.confirm = vi.fn(() => true);
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    // JSDOM does not lay out the linked agenda row.
    if (this.matches('li[aria-current="true"]')) return new DOMRect(20, 100, 150, 60);
    return originalBounds.call(this);
  });
});

afterEach(() => {
  Reflect.deleteProperty(window, 'visualViewport');
});

async function createTimedEvent(title = '期中考') {
  const view = renderCalendar();
  await screen.findByRole('button', { name: '新增行程' });
  fireEvent.click(screen.getByRole('button', { name: '新增行程' }));
  fireEvent.change(screen.getByLabelText('標題'), { target: { value: title } });
  fireEvent.change(screen.getByLabelText('日期'), { target: { value: '2026-10-20' } });
  fireEvent.change(screen.getByLabelText('開始時間'), { target: { value: '09:00' } });
  fireEvent.change(screen.getByLabelText('結束時間'), { target: { value: '10:30' } });
  fireEvent.change(screen.getByLabelText('地點（選填）'), { target: { value: '主顧 301' } });
  fireEvent.click(screen.getByRole('button', { name: '儲存行程' }));
  await screen.findByText(personalImportSavedNotice(1));
  return view;
}

it('creates, edits and deletes personal events through the storage contract', async () => {
  const view = await createTimedEvent();
  const scope = { owner: context.owner, schoolId: context.schoolId };
  expect(readPersonalImports(scope)).toHaveLength(1);
  expect(readPersonalImports(scope)[0]).toMatchObject({
    title: '期中考',
    date: '2026-10-20',
    startTime: '09:00',
    endTime: '10:30',
    location: '主顧 301',
    kind: 'events',
  });

  fireEvent.click(screen.getByRole('button', { name: '編輯' }));
  fireEvent.change(screen.getByLabelText('標題'), { target: { value: '期中考（改期）' } });
  fireEvent.change(screen.getByLabelText('結束日期（跨日才填）'), {
    target: { value: '2026-10-21' },
  });
  fireEvent.change(screen.getByLabelText('結束時間'), { target: { value: '01:00' } });
  fireEvent.change(screen.getByLabelText('開始時間'), { target: { value: '22:00' } });
  const beforeEdit = readPersonalImports(scope)[0];
  fireEvent.click(screen.getByRole('button', { name: '儲存修改' }));
  await screen.findByText('個人行程已更新。');
  const edited = readPersonalImports(scope)[0];
  expect(edited.id).toBe(beforeEdit.id);
  expect(edited.source).toEqual(beforeEdit.source);
  expect(edited).toMatchObject({
    title: '期中考（改期）',
    date: '2026-10-20',
    endDate: '2026-10-21',
    startTime: '22:00',
    endTime: '01:00',
  });

  fireEvent.click(screen.getByRole('button', { name: '編輯' }));
  fireEvent.click(screen.getByRole('button', { name: '刪除這筆' }));
  await screen.findByText('已刪除這筆個人行程。');
  expect(readPersonalImports(scope)).toEqual([]);
  view.unmount();
});

it('開啟時間無效的既有行程時立即顯示原因，修正後才可儲存', async () => {
  const record: PersonalImportRecord = {
    id: 'legacy-event',
    kind: 'events',
    title: '舊行程',
    schoolId: 'pu',
    academicYear: '',
    semester: '',
    date: '2026-10-20',
    startTime: '18:00',
    endTime: '17:00',
    batchId: 'legacy-batch',
    importedAt: '2026-10-01T00:00:00Z',
    source: { type: 'paste', line: 1, rawText: '舊行程' },
  };
  // Current storage validation rejects this record, so supply it at the editor's data boundary.
  vi.spyOn(personalImportHooks, 'usePersonalImports').mockReturnValue({
    records: [record],
    ready: true,
    loading: false,
    error: '',
    syncEnabled: false,
  });
  const change = vi.spyOn(personalImports, 'changePersonalImport').mockResolvedValue(undefined);
  renderCalendar();
  fireEvent.click(await screen.findByRole('button', { name: '編輯' }));

  const reason = /結束時間必須晚於開始時間/;
  expect(screen.getByText(reason)).toBeTruthy();
  const save = screen.getByRole<HTMLButtonElement>('button', { name: '儲存修改' });
  expect(save.disabled).toBe(true);
  fireEvent.click(save);
  expect(change).not.toHaveBeenCalled();

  fireEvent.change(screen.getByLabelText('結束時間'), { target: { value: '19:00' } });
  expect(screen.queryByText(reason)).toBeNull();
  expect(save.disabled).toBe(false);
  fireEvent.click(save);
  await screen.findByText('個人行程已更新。');
  expect(change).toHaveBeenCalledExactlyOnceWith(
    { owner: context.owner, schoolId: context.schoolId },
    record,
    expect.objectContaining({ id: record.id, endTime: '19:00' }),
    expect.any(Function),
  );
});

it('keeps the draft when validation or persistence fails and does not overwrite on load errors', async () => {
  const view = renderCalendar();
  await screen.findByRole('button', { name: '新增行程' });
  fireEvent.click(screen.getByRole('button', { name: '新增行程' }));
  fireEvent.change(screen.getByLabelText('標題'), { target: { value: '結束太早' } });
  fireEvent.change(screen.getByLabelText('日期'), { target: { value: '2026-10-20' } });
  fireEvent.change(screen.getByLabelText('開始時間'), { target: { value: '18:00' } });
  fireEvent.change(screen.getByLabelText('結束時間'), { target: { value: '17:00' } });
  expect(screen.getByText(/結束時間必須晚於開始時間/)).toBeTruthy();
  expect((screen.getByRole('button', { name: '儲存行程' }) as HTMLButtonElement).disabled).toBe(
    true,
  );
  expect((screen.getByLabelText('標題') as HTMLInputElement).value).toBe('結束太早');

  fireEvent.change(screen.getByLabelText('結束時間'), { target: { value: '19:00' } });
  const storageMethods = Object.hasOwn(localStorage, 'setItem')
    ? localStorage
    : Object.getPrototypeOf(localStorage);
  vi.spyOn(storageMethods, 'setItem').mockImplementation(() => {
    throw new Error('quota');
  });
  fireEvent.click(screen.getByRole('button', { name: '儲存行程' }));
  await screen.findByText(/沒有存成/);
  expect((screen.getByLabelText('標題') as HTMLInputElement).value).toBe('結束太早');
  vi.mocked(storageMethods.setItem).mockRestore();
  view.unmount();

  const key = personalImportsStorageKey({ owner: context.owner, schoolId: context.schoolId });
  localStorage.setItem(key, '{damaged');
  const broken = renderCalendar();
  await waitFor(() => expect(screen.getByText(/原始資料仍保留/)).toBeTruthy());
  expect((screen.getByRole('button', { name: '新增行程' }) as HTMLButtonElement).disabled).toBe(
    true,
  );
  expect(localStorage.getItem(key)).toBe('{damaged');
  broken.unmount();
});

it('isolates accounts and schools, and preserves other records plus import provenance on edit', async () => {
  const scope = { owner: context.owner, schoolId: context.schoolId };
  const imported: PersonalImportRecord = {
    id: 'import-keep',
    kind: 'events',
    title: '校慶',
    schoolId: 'pu',
    academicYear: '',
    semester: '',
    date: '2026-10-25',
    allDay: true,
    batchId: 'batch-import',
    importedAt: '2026-10-01T00:00:00.000Z',
    source: { type: 'file', name: '公告.ics', line: 4, rawText: 'SUMMARY:校慶' },
  };
  await savePersonalImportBatch(scope, [imported]);
  const view = await createTimedEvent('自己的安排');
  expect(readPersonalImports(scope)).toHaveLength(2);

  const list = screen.getByText('自己的安排').closest('li');
  expect(list).toBeTruthy();
  fireEvent.click(within(list as HTMLElement).getByRole('button', { name: '編輯' }));
  fireEvent.change(screen.getByLabelText('標題'), { target: { value: '自己的安排（改）' } });
  fireEvent.click(screen.getByRole('button', { name: '儲存修改' }));
  await screen.findByText('個人行程已更新。');
  const rows = readPersonalImports(scope);
  expect(rows).toHaveLength(2);
  expect(rows.find((row) => row.source.name === '公告.ics')?.source).toEqual(imported.source);
  view.unmount();

  context.owner = 'platform:two';
  const other = renderCalendar();
  await screen.findByText(/還沒有行程/);
  expect(readPersonalImports({ owner: 'platform:two', schoolId: 'pu' })).toEqual([]);
  other.unmount();

  context.owner = 'platform:one';
  context.schoolId = 'ntu';
  const otherSchool = renderCalendar();
  await screen.findByText(/還沒有行程/);
  otherSchool.unmount();
});

it('blocks stale saves after an account switch and supports retry after a failed load', async () => {
  const view = await createTimedEvent('切換前');
  const scope = { owner: 'platform:one', schoolId: 'pu' };
  const original = readPersonalImports(scope)[0];
  let active = true;
  const pending = changePersonalImport(
    scope,
    original,
    { ...original, title: '不該寫入' },
    () => active,
  );
  active = false;
  await expect(pending).rejects.toThrow('帳號或校園已切換');
  expect(readPersonalImports(scope)[0].title).toBe('切換前');
  view.unmount();

  const key = personalImportsStorageKey(scope);
  localStorage.setItem(key, '{damaged');
  const broken = renderCalendar();
  await screen.findByText(/原始資料仍保留/);
  broken.unmount();

  localStorage.setItem(
    key,
    JSON.stringify({ version: 1, records: [original], sync: { enabled: false, base: null } }),
  );
  const recovered = renderCalendar();
  await screen.findByText('切換前');
  expect((screen.getByRole('button', { name: '新增行程' }) as HTMLButtonElement).disabled).toBe(
    false,
  );
  recovered.unmount();
});

it('exports the current personal events as ICS without claiming RSVP', async () => {
  const view = await createTimedEvent('匯出我');
  const anchor = {
    click: vi.fn(),
    href: '',
    download: '',
  } as unknown as HTMLAnchorElement;
  const realCreate = document.createElement.bind(document);
  vi.spyOn(document, 'createElement').mockImplementation(((
    tag: string,
    options?: ElementCreationOptions,
  ) => {
    if (tag === 'a') return anchor;
    return realCreate(tag, options);
  }) as typeof document.createElement);
  fireEvent.click(screen.getByRole('button', { name: '月格' }));
  fireEvent.click(screen.getByRole('button', { name: '2026-10-20' }));
  fireEvent.click(screen.getByRole('button', { name: '匯出所選月份' }));
  await waitFor(() => expect(anchor.click).toHaveBeenCalled());
  expect(await screen.findByText(/已匯出 1 筆個人行程快照/)).toBeTruthy();
  expect(screen.getByText(/不會代你報名或設定提醒/)).toBeTruthy();
  view.unmount();
});

it('clears edit selection on cancel so list export includes every visible row', async () => {
  const scope = { owner: context.owner, schoolId: context.schoolId };
  await savePersonalImportBatch(scope, [
    {
      id: 'event-a',
      kind: 'events',
      title: '行程甲',
      schoolId: 'pu',
      academicYear: '',
      semester: '',
      date: '2026-10-20',
      startTime: '09:00',
      endTime: '10:00',
      source: { type: 'paste', name: '手動新增', line: 1, rawText: '行程甲' },
    },
    {
      id: 'event-b',
      kind: 'events',
      title: '行程乙',
      schoolId: 'pu',
      academicYear: '',
      semester: '',
      date: '2026-10-21',
      startTime: '11:00',
      endTime: '12:00',
      source: { type: 'paste', name: '手動新增', line: 1, rawText: '行程乙' },
    },
  ]);
  const view = renderCalendar();
  await screen.findByText('行程甲');
  fireEvent.click(
    within(screen.getByText('行程甲').closest('li') as HTMLElement).getByRole('button', {
      name: '編輯',
    }),
  );
  expect(screen.getByRole('button', { name: '匯出這筆' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '取消' }));
  expect(screen.queryByRole('button', { name: '匯出這筆' })).toBeNull();

  const downloads: string[] = [];
  const realCreate = document.createElement.bind(document);
  vi.spyOn(document, 'createElement').mockImplementation(((
    tag: string,
    options?: ElementCreationOptions,
  ) => {
    if (tag === 'a') {
      return {
        click: vi.fn(),
        set href(_value: string) {},
        get href() {
          return '';
        },
        set download(value: string) {
          downloads.push(value);
        },
        get download() {
          return downloads.at(-1) || '';
        },
      } as unknown as HTMLAnchorElement;
    }
    return realCreate(tag, options);
  }) as typeof document.createElement);
  const createObjectURL = vi.fn((blob: Blob) => {
    void blob.text().then((text) => {
      (createObjectURL as unknown as { lastContent?: string }).lastContent = text;
    });
    return 'blob:calendar';
  });
  URL.createObjectURL = createObjectURL as unknown as typeof URL.createObjectURL;

  fireEvent.click(screen.getByRole('button', { name: '月格' }));
  fireEvent.click(screen.getByRole('button', { name: '2026-10-20' }));
  fireEvent.click(screen.getByRole('button', { name: '匯出所選月份' }));
  await waitFor(() => expect(downloads[0]).toBe('campus-one-personal-events.ics'));
  await waitFor(async () => {
    const blob = createObjectURL.mock.calls[0][0] as Blob;
    const text = await blob.text();
    expect(text.match(/BEGIN:VEVENT/g)).toHaveLength(2);
    expect(text).toContain('SUMMARY:行程甲');
    expect(text).toContain('SUMMARY:行程乙');
  });
  view.unmount();
});

it('preserves imported course metadata when only location is edited', async () => {
  const scope = { owner: context.owner, schoolId: context.schoolId };
  const imported = {
    id: 'import-meta',
    kind: 'events' as const,
    title: '專題發表',
    schoolId: 'pu',
    academicYear: '',
    semester: '',
    courseCode: 'IM499',
    teacher: '李老師',
    className: '專題班',
    date: '2026-10-22',
    startTime: '14:00',
    endTime: '16:00',
    location: '舊教室',
    source: { type: 'file' as const, name: '課表.ics', line: 2, rawText: 'SUMMARY:專題發表' },
  };
  const other = {
    id: 'other-keep',
    kind: 'events' as const,
    title: '另一筆',
    schoolId: 'pu',
    academicYear: '',
    semester: '',
    date: '2026-10-23',
    allDay: true,
    source: { type: 'paste' as const, name: '手動新增', line: 1, rawText: '另一筆' },
  };
  await savePersonalImportBatch(scope, [imported, other]);
  const view = renderCalendar();
  await screen.findByText('專題發表');
  fireEvent.click(
    within(screen.getByText('專題發表').closest('li') as HTMLElement).getByRole('button', {
      name: '編輯',
    }),
  );
  fireEvent.change(screen.getByLabelText('地點（選填）'), { target: { value: '新教室' } });
  fireEvent.click(screen.getByRole('button', { name: '儲存修改' }));
  await screen.findByText('個人行程已更新。');
  const rows = readPersonalImports(scope);
  expect(rows).toHaveLength(2);
  expect(rows.find((row) => row.id === 'import-meta')).toMatchObject({
    id: 'import-meta',
    courseCode: 'IM499',
    teacher: '李老師',
    className: '專題班',
    location: '新教室',
    source: imported.source,
  });
  expect(rows.find((row) => row.id === 'other-keep')?.title).toBe('另一筆');
  view.unmount();
});

function renderCalendar() {
  const view = render(<PersonalCalendar />);
  fireEvent.change(view.getByLabelText('查看月份'), { target: { value: '2026-10' } });
  fireEvent.click(view.getByRole('button', { name: '列表' }));
  return view;
}

it('顯示 nuni 課程作業截止，標示來源並連到 classroom 作業', async () => {
  const courseId = 'cw_11111111-1111-4111-8111-111111111111';
  const assignmentId = 'cwa_22222222-2222-4222-8222-222222222222';
  context.user = { uid: 'alice' };
  context.nuni = {
    session: { context: 'ctx', platformAccountId: 'pa_1' },
    loading: false,
  };
  context.loadHomeData.mockResolvedValue({
    courses: [],
    tasks: [
      {
        id: 'dup',
        courseId,
        courseName: '資料庫',
        title: '專題一',
        dueAt: '2026-10-22T10:00:00.000Z',
        href: `/course/${courseId}#assignment-${assignmentId}`,
      },
    ],
    unreadCount: 0,
  });
  context.loadNuniCalendarDeadlines.mockResolvedValue([
    {
      id: `${courseId}:${assignmentId}`,
      title: '專題一',
      courseName: '資料庫',
      courseId,
      dueDate: '2026-10-22',
      href: `/classroom/course/${courseId}?view=assignments#assignment-${assignmentId}`,
      source: 'nuni',
      sourceLabel: 'nuni 課程',
    },
  ]);
  renderCalendar();
  const due = await screen.findByTestId('calendar-due-list');
  expect(within(due).getByText('專題一')).toBeTruthy();
  expect(within(due).getByText(/nuni 課程/)).toBeTruthy();
  expect(within(due).getByRole('link', { name: '查看作業' }).getAttribute('href')).toBe(
    `/classroom/course/${courseId}?view=assignments#assignment-${assignmentId}`,
  );
  expect(context.loadNuniCalendarDeadlines).toHaveBeenCalled();
});

it('未登入時作業截止區保持說明，不因缺少課程而壞頁', async () => {
  renderCalendar();
  const due = await screen.findByTestId('calendar-due');
  expect(due.textContent).toContain('登入後');
  expect(screen.queryByTestId('calendar-due-list')).toBeNull();
  expect(context.loadHomeData).not.toHaveBeenCalled();
  expect(context.loadNuniCalendarDeadlines).not.toHaveBeenCalled();
});

it('LMS 失敗時仍顯示 nuni 作業截止', async () => {
  const courseId = 'cw_11111111-1111-4111-8111-111111111111';
  const assignmentId = 'cwa_22222222-2222-4222-8222-222222222222';
  context.user = { uid: 'alice' };
  context.nuni = {
    session: { context: 'ctx', platformAccountId: 'pa_1' },
    loading: false,
  };
  context.loadHomeData.mockRejectedValue(new Error('lms down'));
  context.loadNuniCalendarDeadlines.mockResolvedValue([
    {
      id: `${courseId}:${assignmentId}`,
      title: '專題一',
      courseName: '資料庫',
      courseId,
      dueDate: '2026-10-22',
      href: `/classroom/course/${courseId}?view=assignments#assignment-${assignmentId}`,
      source: 'nuni',
      sourceLabel: 'nuni 課程',
    },
  ]);
  renderCalendar();
  const due = await screen.findByTestId('calendar-due-list');
  expect(within(due).getByText('專題一')).toBeTruthy();
  expect(within(due).getByText(/nuni 課程/)).toBeTruthy();
  expect(screen.queryByRole('alert')).toBeNull();
});

it('nuni 失敗時仍顯示 LMS 作業截止', async () => {
  const courseId = 'cw_11111111-1111-4111-8111-111111111111';
  context.user = { uid: 'alice' };
  context.nuni = {
    session: { context: 'ctx', platformAccountId: 'pa_1' },
    loading: false,
  };
  context.loadHomeData.mockResolvedValue({
    courses: [],
    tasks: [
      {
        id: 'lms-only',
        courseId,
        courseName: '作業系統',
        title: '期中報告',
        dueAt: '2026-10-25T02:00:00.000Z',
        href: `/course/${courseId}`,
      },
    ],
    unreadCount: 0,
  });
  context.loadNuniCalendarDeadlines.mockRejectedValue(new Error('nuni down'));
  renderCalendar();
  const due = await screen.findByTestId('calendar-due-list');
  expect(within(due).getByText('期中報告')).toBeTruthy();
  expect(within(due).getByText(/校園 LMS／匯入/)).toBeTruthy();
  expect(screen.queryByRole('alert')).toBeNull();
});

it('月格切月、選日期、編輯及回今天沿用同一份資料', async () => {
  const view = await createTimedEvent('合成安排');
  fireEvent.click(screen.getByRole('button', { name: '月格' }));
  fireEvent.click(screen.getByRole('button', { name: '2026-10-20' }));
  expect(screen.getByText('2026-10-20 的行程')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '編輯' }));
  expect((screen.getByLabelText('標題') as HTMLInputElement).value).toBe('合成安排');
  fireEvent.click(screen.getByRole('button', { name: '取消' }));
  fireEvent.click(screen.getByRole('button', { name: '下一月' }));
  expect((screen.getByLabelText('查看月份') as HTMLInputElement).value).toBe('2026-11');
  expect(screen.queryByText('2026-10-20 的行程')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '上一月' }));
  expect(screen.getByRole('button', { name: '合成安排' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '回今天' }));
  expect((screen.getByLabelText('查看月份') as HTMLInputElement).value).toBe(
    emptyPersonalEventDraft().date.slice(0, 7),
  );
  view.unmount();
});

function focusEvent(id = 'verified-event', patch: Partial<PersonalImportRecord> = {}): PersonalImportRecord {
  return {
    id, batchId: id, kind: 'events', schoolId: 'pu', academicYear: '', semester: '',
    title: '已核對的複習安排', date: '2027-03-14', allDay: false, startTime: '15:00', endTime: '16:00',
    importedAt: '2026-11-07T10:00:00.000Z', source: { type: 'paste', name: '助理確認', line: 1, rawText: '' },
    ...patch,
  };
}

function seedFocusedEvents(rows: PersonalImportRecord[], owner = context.owner, schoolId = context.schoolId) {
  localStorage.setItem(personalImportsStorageKey({ owner, schoolId }), JSON.stringify({ version: 1, records: rows }));
}

it('does not describe an acknowledged server event as device-only when device sync is disabled', async () => {
  const record = focusEvent();
  localStorage.setItem(personalImportsStorageKey({ owner: context.owner, schoolId: context.schoolId }), JSON.stringify({
    version: 1, records: [record],
    sync: { enabled: false, base: null, acknowledged: [{ record, revision: 1 }] },
  }));
  render(<PersonalCalendar />);
  await screen.findByText(/裝置同步尚未開啟/);
  expect(screen.getByText(/先前已存入帳號的資料仍以帳號紀錄為準/)).toBeTruthy();
  expect(screen.queryByText(/目前只存在這台裝置，換裝置或清除資料就會不見/)).toBeNull();
});

it('locates only a stored event by ID, selects its actual date and month, and focuses its list row without opening an edit form', async () => {
  const target = focusEvent();
  seedFocusedEvents([target, focusEvent('other-day', { title: '另一日', date: '2027-03-15' })]);
  context.search = 'eventId=verified-event&date=1999-01-01&title=URL%E5%81%87%E8%B3%87%E6%96%99';
  const before = localStorage.getItem(personalImportsStorageKey({ owner: context.owner, schoolId: context.schoolId }));
  render(<PersonalCalendar />);
  expect(await screen.findByText('已定位到「已核對的複習安排」。')).toBeTruthy();
  await waitFor(() => expect((screen.getByLabelText('查看月份') as HTMLInputElement).value).toBe('2027-03'));
  expect(screen.getByText('2027-03-14 的行程')).toBeTruthy();
  expect(screen.getByRole('button', { name: '列表' }).getAttribute('aria-pressed')).toBe('true');
  const row = screen.getByRole('heading', { name: target.title }).closest('li');
  expect(row?.getAttribute('aria-current')).toBe('true');
  expect(document.activeElement).toBe(row);
  expect(screen.queryByLabelText('標題')).toBeNull();
  expect(screen.queryByText('URL假資料')).toBeNull();
  expect(screen.queryByRole('heading', { name: '另一日' })).toBeNull();
  expect(localStorage.getItem(personalImportsStorageKey({ owner: context.owner, schoolId: context.schoolId }))).toBe(before);
});

it.each(['可視視窗平移', '頁面捲動'])('行程深連結等待%s，確認行程列在雙軸皆可見才聚焦', async (source) => {
  const target = focusEvent();
  seedFocusedEvents([target, focusEvent('same-title', { date: target.date })]);
  context.search = `eventId=${target.id}`;
  const viewport = Object.assign(new EventTarget(), {
    offsetLeft: 260, offsetTop: 80, width: 180, height: 240,
  });
  Object.defineProperty(window, 'visualViewport', { configurable: true, value: viewport });

  let rowLeft = 40;
  let rowTop = 420;
  vi.mocked(Element.prototype.getBoundingClientRect).mockImplementation(function (this: Element) {
    if (this.matches('li[aria-current="true"]')) return new DOMRect(rowLeft, rowTop, 140, 60);
    return originalBounds.call(this);
  });
  const scroll = vi.spyOn(window, 'scrollBy');
  scroll.mockImplementation(() => {});

  render(<PersonalCalendar />);
  const list = await screen.findByRole('list', { name: '個人行程列表' });
  expect(within(list).getAllByRole('heading', { name: target.title })).toHaveLength(2);
  const row = list.querySelector('li[aria-current="true"]')!;
  expect(row).toBeTruthy();
  const scrollIntoView = vi.fn();
  Object.defineProperty(row, 'scrollIntoView', { value: scrollIntoView });
  expect(scroll).toHaveBeenCalledExactlyOnceWith({ left: -220, top: 160, behavior: 'instant' });
  expect(document.activeElement).toBe(document.body);

  const scrollView = source === '頁面捲動'
    ? () => fireEvent.scroll(document)
    : () => viewport.dispatchEvent(new Event('scroll'));
  if (source === '頁面捲動') {
    rowLeft = 260;
    rowTop = 260;
    scrollView();
    expect(row?.getBoundingClientRect()).toMatchObject({ left: 260, right: 400, top: 260, bottom: 320 });
  } else {
    viewport.offsetTop = 420;
    scrollView();
    expect(document.activeElement).toBe(document.body);
    expect(scroll).toHaveBeenCalledTimes(1);
    expect(scrollIntoView).not.toHaveBeenCalled();

    viewport.offsetLeft = 40;
    viewport.offsetTop = 80;
    scrollView();
    expect(document.activeElement).toBe(document.body);
    expect(scroll).toHaveBeenCalledTimes(1);
    expect(scrollIntoView).not.toHaveBeenCalled();

    viewport.offsetTop = 420;
    scrollView();
  }
  expect(document.activeElement).toBe(row);
  expect(scroll).toHaveBeenCalledTimes(1);
  expect(scrollIntoView).not.toHaveBeenCalled();
});

it.each([
  ['頁面本體', '保留焦點'],
  ['頁面本體', '移到其他控制項'],
  ['頁面本體', '移到其他控制項後離開'],
  ['月份欄位', '因工作區隱藏而失焦'],
  ['月份欄位', '隱藏後移到其他控制項'],
  ['月份欄位', '隱藏後移到其他控制項又回到頁面本體'],
  ['月份欄位', '隱藏前主動離開'],
  ['日列表編輯按鈕', '因工作區卸載而失焦'],
  ['日列表編輯按鈕', '隱藏前主動離開'],
  ['月份欄位', '因工作區隱藏而失焦', 'offsetLeft'],
  ['月份欄位', '保留焦點', 'offsetLeft'],
  ['月份欄位', '暫停期間主動離開', 'offsetLeft'],
  ['月份欄位', '恢復後主動離開', 'offsetLeft'],
  ['日列表編輯按鈕', '因工作區卸載而失焦', 'offsetTop'],
] as const)('深連結從%s等待揭露時，重新驗證前後%s（恢復時裁切軸：%s）', async (origin, action, clippedAxis?) => {
  const target = focusEvent();
  const previous = focusEvent('previous-event', { title: '同日的另一筆行程' });
  const startsInDayList = origin === '日列表編輯按鈕';
  seedFocusedEvents(startsInDayList ? [previous, target] : [target]);
  const viewport = Object.assign(new EventTarget(), {
    offsetLeft: 260, offsetTop: 80, width: 180, height: 240,
  });
  Object.defineProperty(window, 'visualViewport', { configurable: true, value: viewport });
  const scroll = vi.spyOn(window, 'scrollBy').mockImplementation(() => {});
  const scrollIntoView = vi.fn();
  vi.mocked(Element.prototype.getBoundingClientRect).mockImplementation(function (this: Element) {
    if (this.matches('li[aria-current="true"]')) {
      Object.defineProperty(this, 'scrollIntoView', { configurable: true, value: scrollIntoView });
      return new DOMRect(40, 100, 140, 60);
    }
    return originalBounds.call(this);
  });

  function Page() {
    return (
      <>
        <button type="button">其他控制項</button>
        <PersonalCalendar />
      </>
    );
  }
  const search = `eventId=${target.id}`;
  if (origin === '頁面本體') context.search = search;
  if (startsInDayList) context.search = `eventId=${previous.id}`;
  const view = render(<Page />);
  const monthControl = await screen.findByLabelText('查看月份');
  let originControl: HTMLElement = document.body;
  if (startsInDayList) {
    const previousRow = await screen.findByRole('listitem', { current: true });
    originControl = within(previousRow).getByRole('button', { name: '編輯' });
    scroll.mockClear();
  } else if (origin === '月份欄位') {
    originControl = monthControl;
  }
  if (originControl !== document.body) {
    originControl.focus();
    context.search = search;
    view.rerender(<Page />);
  }
  await screen.findByText(`已定位到「${target.title}」。`);
  expect(scroll).toHaveBeenCalledExactlyOnceWith({ left: -220, top: 0, behavior: 'instant' });
  expect(document.activeElement).toBe(originControl);

  if (action === '因工作區卸載而失焦') {
    const list = screen.getByRole('list', { name: '個人行程列表' });
    const parent = list.parentNode!;
    const removeChild = parent.removeChild.bind(parent);
    vi.spyOn(parent, 'removeChild').mockImplementation((child) => {
      // Chromium emits focusout while the removed control is still connected.
      if (child === list && document.activeElement === originControl) originControl.blur();
      return removeChild(child);
    });
  }
  if (action === '隱藏前主動離開') {
    originControl.blur();
    expect(document.activeElement).toBe(document.body);
    expect(originControl.isConnected).toBe(true);
  }
  context.loading = true;
  view.rerender(<Page />);
  expect(screen.queryByRole('heading', { name: target.title })).toBeNull();
  const outside = screen.getByRole('button', { name: '其他控制項' });
  expect(originControl.isConnected).toBe(!startsInDayList);
  expect(monthControl.closest('[hidden]')).toBeTruthy();
  const blursAfterResume = action === '恢復後主動離開';
  const blursDuringPause = action === '暫停期間主動離開';
  if (blursDuringPause) {
    expect(document.activeElement).toBe(monthControl);
    monthControl.blur();
    expect(document.activeElement).toBe(document.body);
  } else if (action.startsWith('因工作區隱藏') || action.startsWith('隱藏後')) {
    expect(document.activeElement).toBe(monthControl);
    // JSDOM does not run the browser's focus fixup after the hidden commit.
    HTMLElement.prototype.blur.call(monthControl);
    expect(document.activeElement).toBe(document.body);
  }
  if (action.includes('移到其他控制項')) outside.focus();
  if (action === '移到其他控制項後離開' || action === '隱藏後移到其他控制項又回到頁面本體') {
    outside.blur();
  }
  const focusDuringPause = document.activeElement;
  viewport.offsetLeft = clippedAxis === 'offsetLeft' ? 80 : 0;
  if (clippedAxis === 'offsetTop' || blursDuringPause) viewport.offsetTop = 120;
  scroll.mockClear();
  scrollIntoView.mockClear();
  viewport.dispatchEvent(new Event(clippedAxis ? 'scroll' : 'resize'));
  expect(document.activeElement).toBe(focusDuringPause);

  context.loading = false;
  view.rerender(<Page />);
  const row = await screen.findByRole('listitem', { current: true });
  expect(screen.getByLabelText('查看月份')).toBe(monthControl);
  const shouldHandoff =
    action === '保留焦點' || action === '因工作區隱藏而失焦' || action === '因工作區卸載而失焦';
  expect(scroll).not.toHaveBeenCalled();
  expect(scrollIntoView).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(shouldHandoff && !clippedAxis ? row : focusDuringPause);
  if (clippedAxis) {
    fireEvent.resize(window);
    expect(document.activeElement).toBe(focusDuringPause);
    expect(scroll).not.toHaveBeenCalled();
    expect(scrollIntoView).not.toHaveBeenCalled();

    viewport.height = 200;
    viewport.dispatchEvent(new Event('resize'));
    expect(document.activeElement).toBe(focusDuringPause);
    expect(scroll).not.toHaveBeenCalled();
    expect(scrollIntoView).not.toHaveBeenCalled();

    if (blursAfterResume) {
      expect(monthControl.closest('[hidden]')).toBeNull();
      monthControl.blur();
      expect(document.activeElement).toBe(document.body);
    }
    viewport[clippedAxis] = 0;
    viewport.dispatchEvent(new Event(clippedAxis === 'offsetLeft' ? 'scroll' : 'resize'));
    if (blursDuringPause) {
      expect(document.activeElement).toBe(document.body);
      viewport.offsetTop = 80;
      viewport.dispatchEvent(new Event('scroll'));
    }
    expect(document.activeElement).toBe(shouldHandoff ? row : document.body);
    expect(scroll).not.toHaveBeenCalled();
    expect(scrollIntoView).not.toHaveBeenCalled();
  }
});

it.each(['切月後回今天', '切換檢視'])('指標操作%s時，結束仍在等待的深連結聚焦', async (navigation) => {
  const date = emptyPersonalEventDraft().date;
  const target = focusEvent('today-target', { date });
  const previous = focusEvent('today-origin', { date, title: '同日的另一筆行程' });
  seedFocusedEvents([previous, target]);
  const viewport = Object.assign(new EventTarget(), {
    offsetLeft: 260, offsetTop: 80, width: 180, height: 240,
  });
  Object.defineProperty(window, 'visualViewport', { configurable: true, value: viewport });
  const scroll = vi.spyOn(window, 'scrollBy').mockImplementation(() => {});
  context.search = `eventId=${previous.id}`;
  const view = render(<PersonalCalendar />);
  await screen.findByText(`已定位到「${previous.title}」。`);
  const list = screen.getByRole('list', { name: '個人行程列表' });
  const origin = within(list.querySelector('li[aria-current="true"]')!).getByRole('button', { name: '編輯' });
  origin.focus();
  scroll.mockClear();
  context.search = `eventId=${target.id}`;
  view.rerender(<PersonalCalendar />);
  await screen.findByText(`已定位到「${target.title}」。`);
  expect(scroll).toHaveBeenCalled();
  expect(document.activeElement).toBe(origin);
  scroll.mockClear();

  // A pointer click can activate navigation without moving focus to its button.
  if (navigation === '切月後回今天') {
    fireEvent.click(screen.getByRole('button', { name: '下一月' }));
    expect(origin.isConnected).toBe(false);
    expect(document.activeElement).toBe(document.body);
    fireEvent.click(screen.getByRole('button', { name: '回今天' }));
    expect(document.activeElement).toBe(document.body);
  } else {
    fireEvent.click(screen.getByRole('button', { name: '月格' }));
    expect(document.activeElement).toBe(origin);
    fireEvent.click(screen.getByRole('button', { name: '回今天' }));
  }
  expect(screen.getByRole('heading', { name: target.title })).toBeTruthy();
  const focusAfterNavigation = document.activeElement;
  viewport.offsetLeft = 0;
  viewport.dispatchEvent(new Event('scroll'));
  viewport.dispatchEvent(new Event('resize'));
  expect(scroll).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(focusAfterNavigation);
});

it.each([
  ['another owner', 'platform:two', 'pu'],
  ['another school', 'platform:one', 'ntu'],
])('does not locate an event belonging to %s even when URL fields request that scope', async (_label, owner, schoolId) => {
  seedFocusedEvents([focusEvent(undefined, { schoolId })], owner, schoolId);
  context.search = 'eventId=verified-event&owner=platform%3Atwo&date=2027-03-14&title=%E4%B8%8D%E5%8F%AF%E4%BF%A1';
  render(<PersonalCalendar />);
  expect(await screen.findByText(/目前帳號與校園的個人行事曆找不到這筆行程/)).toBeTruthy();
  expect(screen.queryByRole('heading', { name: '已核對的複習安排' })).toBeNull();
  expect(screen.queryByLabelText('標題')).toBeNull();
});

it('can locate an event that arrives after the initial read, without navigating back after the user changes months', async () => {
  context.search = 'eventId=verified-event';
  render(<PersonalCalendar />);
  await screen.findByText(/找不到這筆行程/);
  await act(async () => {
    seedFocusedEvents([focusEvent()]);
    window.dispatchEvent(new Event('campus-personal-imports-change'));
  });
  expect(await screen.findByText('2027-03-14 的行程')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '下一月' }));
  expect((screen.getByLabelText('查看月份') as HTMLInputElement).value).toBe('2027-04');
  await act(async () => { window.dispatchEvent(new Event('campus-personal-imports-change')); });
  expect((screen.getByLabelText('查看月份') as HTMLInputElement).value).toBe('2027-04');
});

it('discards the previously located row on identity switch and only resolves the same ID in the new owner ledger', async () => {
  seedFocusedEvents([focusEvent()]);
  context.search = 'eventId=verified-event';
  const view = render(<PersonalCalendar />);
  await screen.findByText('已定位到「已核對的複習安排」。');
  context.owner = 'platform:two';
  view.rerender(<PersonalCalendar />);
  await screen.findByText(/目前帳號與校園的個人行事曆找不到這筆行程/);
  expect(screen.queryByRole('heading', { name: '已核對的複習安排' })).toBeNull();
  expect(screen.queryByLabelText('標題')).toBeNull();
});

it('does not expose a non-event record through eventId or call a failed ledger read an absent event', async () => {
  const grade = focusEvent(undefined, { kind: 'grades', title: '私人成績', academicYear: '115', semester: '1', grade: 'A', credits: 3 });
  seedFocusedEvents([grade]);
  context.search = 'eventId=verified-event';
  const view = render(<PersonalCalendar />);
  await screen.findByText(/找不到這筆行程/);
  expect(screen.queryByText('私人成績')).toBeNull();
  view.unmount();
  localStorage.setItem(personalImportsStorageKey({ owner: context.owner, schoolId: context.schoolId }), '{damaged');
  render(<PersonalCalendar />);
  await screen.findByText(/原始資料仍保留/);
  expect(screen.queryByText(/找不到這筆行程/)).toBeNull();
});

it('responds to a new eventId without changing either event or entering edit mode', async () => {
  seedFocusedEvents([focusEvent(), focusEvent('next-event', { title: '下一個安排', date: '2027-05-02' })]);
  context.search = 'eventId=verified-event';
  const view = render(<PersonalCalendar />);
  await screen.findByText('2027-03-14 的行程');
  context.search = 'eventId=next-event';
  view.rerender(<PersonalCalendar />);
  await screen.findByText('2027-05-02 的行程');
  expect((screen.getByLabelText('查看月份') as HTMLInputElement).value).toBe('2027-05');
  expect(document.activeElement).toBe(screen.getByRole('heading', { name: '下一個安排' }).closest('li'));
  expect(screen.queryByLabelText('標題')).toBeNull();
  expect(readPersonalImports({ owner: context.owner, schoolId: context.schoolId })).toHaveLength(2);
});

it.each(['移動焦點', '開始編輯'])(
  '深連結首次揭露失敗後，使用者%s會取消定位重試',
  async (action) => {
    const target = focusEvent();
    seedFocusedEvents([target]);
    context.search = `eventId=${target.id}`;
    const viewport = Object.assign(new EventTarget(), {
      offsetLeft: 260, offsetTop: 80, width: 180, height: 240,
    });
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: viewport });
    vi.spyOn(window, 'scrollBy').mockImplementation(() => {});
    vi.mocked(Element.prototype.getBoundingClientRect).mockImplementation(function (this: Element) {
      if (this.matches('li[aria-current="true"]')) return new DOMRect(40, 100, 140, 60);
      return originalBounds.call(this);
    });

    render(<PersonalCalendar />);
    const row = (await screen.findByRole('heading', { name: target.title })).closest('li');
    expect(row?.getAttribute('aria-current')).toBe('true');
    expect(window.scrollBy).toHaveBeenCalledWith({ left: -220, top: 0, behavior: 'instant' });
    expect(document.activeElement).toBe(document.body);

    const outside = screen.getByRole('button', { name: '回今天' });
    if (action === '開始編輯') {
      // A click can open the editor without moving focus to the edit button first.
      fireEvent.click(within(row!).getByRole('button', { name: /編輯/ }));
    } else {
      outside.focus();
      outside.blur();
    }
    const expected = action === '開始編輯' ? screen.getByRole('textbox', { name: '標題' }) : document.body;
    expect(document.activeElement).toBe(expected);
    viewport.offsetLeft = 0;
    viewport.dispatchEvent(new Event('resize'));
    expect(document.activeElement).toBe(expected);
  },
);
