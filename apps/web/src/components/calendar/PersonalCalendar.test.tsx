import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import {
  emptyPersonalEventDraft,
  personalImportSavedNotice,
  type PersonalImportRecord,
} from '@campus/shared';
import { PersonalCalendar } from './PersonalCalendar';
import {
  changePersonalImport,
  personalImportsStorageKey,
  readPersonalImports,
  savePersonalImportBatch,
} from '@/lib/personalImports';

const context = vi.hoisted(() => ({
  owner: 'platform:one',
  schoolId: 'pu',
  loading: false,
}));

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
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

beforeEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  context.owner = 'platform:one';
  context.schoolId = 'pu';
  context.loading = false;
  Object.defineProperty(navigator, 'locks', {
    configurable: true,
    value: { request: (_key: string, fn: () => unknown) => Promise.resolve().then(fn) },
  });
  URL.createObjectURL = vi.fn(() => 'blob:calendar');
  URL.revokeObjectURL = vi.fn();
  window.confirm = vi.fn(() => true);
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
