import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import {
  PERSONAL_IMPORT_IMAGE_UNREADABLE,
  personalImportSavedNotice,
  personalImportUndoBody,
  personalImportUndoneNotice,
} from '@campus/shared';
import { PersonalImportCenter } from './PersonalImportCenter';
import { readPersonalImports, savePersonalImportBatch } from '@/lib/personalImports';
import { serializePersonalImportBackup, type PersonalImportRecord } from '@campus/shared';
import { browserRequest } from '@/features/nuni/Session';
import { personalImportDraftKey } from '@/lib/personalImportDrafts';
const context = vi.hoisted(() => ({
  owner: 'guest',
  schoolId: 'pu',
  loading: false,
  session: null as {
    platformAccountId: string;
    context: string;
    isPlatformOperator: boolean;
  } | null,
}));
vi.mock('@/lib/usePersonalImports', async (actual) => ({
  ...(await actual<typeof import('@/lib/usePersonalImports')>()),
  usePersonalImportScope: () => ({
    scope: { owner: context.owner, schoolId: context.schoolId },
    scopeKey: `${context.owner}:${context.schoolId}`,
    loading: context.loading,
    schoolName: '靜宜大學',
  }),
}));
vi.mock('@/features/nuni/Session', () => ({
  useOptionalNuniSession: () => (context.session ? { session: context.session } : null),
  browserRequest: vi.fn(),
}));
vi.mock('@/lib/personalImportOcr', () => ({ recognizePersonalImportImage: vi.fn() }));
beforeEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  context.owner = 'guest';
  context.session = null;
  vi.mocked(browserRequest).mockReset();
  context.schoolId = 'pu';
  context.loading = false;
  window.history.replaceState(null, '', '/import?kind=grades');
  Object.defineProperty(navigator, 'locks', {
    configurable: true,
    value: { request: (_key: string, fn: () => unknown) => Promise.resolve().then(fn) },
  });
  Element.prototype.scrollIntoView = vi.fn();
});
it('restores reviewed edits and excluded rows after returning to the same tab without importing them', async () => {
  const view = render(<PersonalImportCenter />);
  await prepare('課程名稱,學分,成績\n資料庫,3,85\n英文,2,90');
  fireEvent.change(screen.getAllByLabelText('成績')[0], { target: { value: '88' } });
  fireEvent.click(screen.getByRole('checkbox', { name: /第 2 筆/ }));
  view.unmount();
  render(<PersonalImportCenter />);
  expect((screen.getAllByLabelText('成績')[0] as HTMLInputElement).value).toBe('88');
  expect((screen.getByRole('checkbox', { name: /第 2 筆/ }) as HTMLInputElement).checked).toBe(
    false,
  );
  expect(readPersonalImports(context)).toHaveLength(0);
  fireEvent.click(screen.getByRole('button', { name: '確認匯入 1 筆' }));
  await screen.findByText(personalImportSavedNotice(1));
  expect(readPersonalImports(context)[0].grade).toBe('88');
  expect(sessionStorage.getItem(personalImportDraftKey(context))).toBeNull();
});

it('preserves structural parse errors when restoring a draft', async () => {
  const view = render(<PersonalImportCenter />);
  await prepare('課程名稱,學分,成績\n資料庫,3,85,錯位欄位');
  view.unmount();
  render(<PersonalImportCenter />);
  expect(
    (screen.getByRole('button', { name: '確認匯入 1 筆' }) as HTMLButtonElement).disabled,
  ).toBe(true);
  expect(screen.getByText(/欄位數與標題不同/)).toBeTruthy();
});

it('keeps saved drafts isolated by account and school while allowing the original owner to resume', async () => {
  const view = render(<PersonalImportCenter />);
  await prepare();
  context.owner = 'platform:two';
  view.rerender(<PersonalImportCenter />);
  expect(screen.queryByLabelText('成績')).toBeNull();
  context.owner = 'guest';
  context.schoolId = 'ntu';
  view.rerender(<PersonalImportCenter />);
  expect(screen.queryByLabelText('成績')).toBeNull();
  context.schoolId = 'pu';
  view.rerender(<PersonalImportCenter />);
  expect((screen.getByLabelText('成績') as HTMLInputElement).value).toBe('85');
});

it('keeps a damaged stored draft until the user explicitly clears it', async () => {
  const key = personalImportDraftKey(context);
  sessionStorage.setItem(key, '{damaged');
  render(<PersonalImportCenter />);
  expect(screen.getByText(/上次的暫存草稿無法還原/)).toBeTruthy();
  await prepare();
  expect(sessionStorage.getItem(key)).toBe('{damaged');
  fireEvent.click(screen.getByRole('button', { name: '清除暫存草稿' }));
  fireEvent.click(screen.getByRole('button', { name: '繼續核對' }));
  expect(sessionStorage.getItem(key)).toBe('{damaged');
  fireEvent.click(screen.getByRole('button', { name: '清除暫存草稿' }));
  fireEvent.click(screen.getByRole('button', { name: '確認清除草稿' }));
  expect(sessionStorage.getItem(key)).toBeNull();
  expect((screen.getByLabelText('原始文字') as HTMLTextAreaElement).value).toBe('');
});

it('warns when draft storage fails and preserves edits for a later successful retry', async () => {
  render(<PersonalImportCenter />);
  const write = vi
    .spyOn(Object.getPrototypeOf(sessionStorage), 'setItem')
    .mockImplementation(() => {
      throw new Error('quota');
    });
  await prepare();
  expect(screen.getByText(/草稿暫存沒有成功/)).toBeTruthy();
  expect((screen.getByLabelText('成績') as HTMLInputElement).value).toBe('85');
  write.mockRestore();
  fireEvent.change(screen.getByLabelText('成績'), { target: { value: '88' } });
  expect(screen.queryByText(/草稿暫存沒有成功/)).toBeNull();
  expect(sessionStorage.getItem(personalImportDraftKey(context))).toContain('88');
});
async function prepare(text = '課程名稱,學分,成績\n資料庫,3,85') {
  fireEvent.change(screen.getByLabelText('這份資料的學年度'), { target: { value: '115' } });
  fireEvent.change(screen.getByLabelText('學期'), { target: { value: '1' } });
  fireEvent.change(screen.getByLabelText('原始文字'), { target: { value: text } });
  fireEvent.click(screen.getByRole('button', { name: '整理成待確認清單' }));
}
async function confirmUndo() {
  fireEvent.click(screen.getByRole('button', { name: '撤銷上次匯入' }));
  fireEvent.click(screen.getByRole('button', { name: '撤銷' }));
}
it('reviews edits before persistence, reimport dedupes, undo only reverses the new batch', async () => {
  render(<PersonalImportCenter />);
  await prepare();
  expect(readPersonalImports(context)).toHaveLength(0);
  fireEvent.change(screen.getByLabelText('成績'), { target: { value: '88' } });
  fireEvent.click(screen.getByRole('button', { name: '確認匯入 1 筆' }));
  await screen.findByText(personalImportSavedNotice(1));
  expect(readPersonalImports(context)[0].grade).toBe('88');
  await prepare('課程名稱,學分,成績\n資料庫,3,88');
  fireEvent.click(screen.getByRole('button', { name: '確認匯入 1 筆' }));
  await screen.findByText(personalImportSavedNotice(0));
  await confirmUndo();
  await screen.findByText(personalImportUndoneNotice(1));
  await waitFor(() => expect(readPersonalImports(context)).toHaveLength(0));
});
it('blocks malformed table rows despite otherwise valid fields', async () => {
  render(<PersonalImportCenter />);
  await prepare('課程名稱,學分,成績\n資料庫,3,85,錯位欄位');
  expect(
    (screen.getByRole('button', { name: '確認匯入 1 筆' }) as HTMLButtonElement).disabled,
  ).toBe(true);
  expect(screen.getByText(/欄位數與標題不同/)).toBeTruthy();
  expect(readPersonalImports(context)).toHaveLength(0);
});
it('clears draft and private records synchronously on account change', async () => {
  const view = render(<PersonalImportCenter />);
  await prepare();
  context.owner = 'platform:two';
  view.rerender(<PersonalImportCenter />);
  expect(screen.queryByRole('button', { name: '確認匯入 1 筆' })).toBeNull();
  expect((screen.getByLabelText('原始文字') as HTMLTextAreaElement).value).toBe('');
});
it('starts new pasted data without inheriting the previous screenshot source', async () => {
  const { recognizePersonalImportImage } = await import('@/lib/personalImportOcr');
  vi.mocked(recognizePersonalImportImage).mockResolvedValue('課程名稱,學分,成績\n資料庫,3,85');
  URL.createObjectURL = vi.fn(() => 'blob:preview');
  URL.revokeObjectURL = vi.fn();
  render(<PersonalImportCenter />);
  fireEvent.change(screen.getByLabelText('這份資料的學年度'), { target: { value: '115' } });
  fireEvent.change(screen.getByLabelText('學期'), { target: { value: '1' } });
  fireEvent.change(screen.getByLabelText('選擇截圖或檔案'), {
    target: { files: [new File(['test'], 'grades.png', { type: 'image/png' })] },
  });
  await screen.findByRole('button', { name: '確認匯入 1 筆' });
  fireEvent.click(screen.getByRole('button', { name: '確認匯入 1 筆' }));
  await screen.findByText(personalImportSavedNotice(1));
  await prepare('課程名稱,學分,成績\n英文,2,90');
  fireEvent.click(screen.getByRole('button', { name: '確認匯入 1 筆' }));
  await waitFor(() => expect(readPersonalImports(context)).toHaveLength(2));
  expect(readPersonalImports(context)[0].source).toMatchObject({
    type: 'screenshot',
    name: 'grades.png',
  });
  expect(readPersonalImports(context)[1].source).toMatchObject({ type: 'paste' });
  expect(readPersonalImports(context)[1].source.name).toBeUndefined();
});
it('imports an all-day event and keeps academic fields optional', async () => {
  window.history.replaceState(null, '', '/import?kind=events');
  render(<PersonalImportCenter />);
  fireEvent.change(screen.getByLabelText('原始文字'), {
    target: { value: '活動名稱,日期,全天\n校慶,2026-10-24,是' },
  });
  fireEvent.click(screen.getByRole('button', { name: '整理成待確認清單' }));
  fireEvent.click(screen.getByRole('button', { name: '確認匯入 1 筆' }));
  await waitFor(() => expect(readPersonalImports(context)).toHaveLength(1));
  expect(readPersonalImports(context)[0]).toMatchObject({
    title: '校慶',
    allDay: true,
    date: '2026-10-24',
  });
});
it('ignores OCR completion after switching accounts', async () => {
  const { recognizePersonalImportImage } = await import('@/lib/personalImportOcr');
  let resolve!: (text: string) => void;
  vi.mocked(recognizePersonalImportImage).mockReturnValue(
    new Promise((done) => {
      resolve = done;
    }),
  );
  URL.createObjectURL = vi.fn(() => 'blob:preview');
  URL.revokeObjectURL = vi.fn();
  const view = render(<PersonalImportCenter />);
  fireEvent.change(screen.getByLabelText('選擇截圖或檔案'), {
    target: { files: [new File(['test'], 'grades.png', { type: 'image/png' })] },
  });
  context.owner = 'platform:two';
  view.rerender(<PersonalImportCenter />);
  await act(async () => resolve('課程名稱,學分,成績\n舊帳號秘密,3,90'));
  expect(screen.queryByText(/舊帳號秘密/)).toBeNull();
  expect((screen.getByLabelText('原始文字') as HTMLTextAreaElement).value).toBe('');
});
it('keeps a same-account draft hidden while the session revalidates', async () => {
  const view = render(<PersonalImportCenter />);
  await prepare();
  context.loading = true;
  view.rerender(<PersonalImportCenter />);
  expect(screen.queryByRole('button', { name: '確認匯入 1 筆' })).toBeNull();
  context.loading = false;
  view.rerender(<PersonalImportCenter />);
  expect(screen.getByRole('button', { name: '確認匯入 1 筆' })).toBeTruthy();
  expect((screen.getByLabelText('名稱') as HTMLInputElement).value).toBe('資料庫');
});
it('allows a corrected OCR field without dismissing unrelated structural errors', async () => {
  window.history.replaceState(null, '', '/import?kind=timetable');
  render(<PersonalImportCenter />);
  await prepare('課程名稱,星期,開始節次,結束節次\n資料庫,星期一上午,3,4');
  expect(
    (screen.getByRole('button', { name: '確認匯入 1 筆' }) as HTMLButtonElement).disabled,
  ).toBe(true);
  fireEvent.change(screen.getByLabelText('星期'), { target: { value: '1' } });
  expect(
    (screen.getByRole('button', { name: '確認匯入 1 筆' }) as HTMLButtonElement).disabled,
  ).toBe(false);
});
it('cannot flatten a recurring ICS event into one confirmed personal record', async () => {
  window.history.replaceState(null, '', '/import?kind=events');
  render(<PersonalImportCenter />);
  fireEvent.change(screen.getByLabelText('原始文字'), {
    target: {
      value:
        'BEGIN:VCALENDAR\nVERSION:2.0\nBEGIN:VEVENT\nSUMMARY:每週讀書\nDTSTART;TZID=Asia/Taipei:20261020T180000\nDTEND;TZID=Asia/Taipei:20261020T190000\nRRULE:FREQ=WEEKLY;COUNT=10\nEND:VEVENT\nEND:VCALENDAR',
    },
  });
  fireEvent.click(screen.getByRole('button', { name: '整理成待確認清單' }));
  expect(
    (screen.getByRole('button', { name: '確認匯入 1 筆' }) as HTMLButtonElement).disabled,
  ).toBe(true);
  expect(readPersonalImports(context)).toHaveLength(0);
});

it('saves only an explicitly selected accessible class as a personal link without granting membership', async () => {
  const platformAccountId = 'pa_aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
  const linkedWorkspaceId = 'cw_aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
  const archivedId = 'cw_bbbbbbbb-cccc-4ddd-8eee-ffffffffffff';
  context.owner = `platform:${platformAccountId}`;
  context.session = {
    platformAccountId,
    context: 'verified-account-context',
    isPlatformOperator: false,
  };
  vi.mocked(browserRequest).mockResolvedValue({
    workspaces: [
      { id: linkedWorkspaceId, title: '資料庫', state: 'active', memberRole: 'student' },
      { id: archivedId, title: '上學期資料庫', state: 'archived', memberRole: 'student' },
    ],
  });
  render(<PersonalImportCenter />);
  await prepare();
  const selector = screen.getByLabelText('連結我的課程') as HTMLSelectElement;
  await waitFor(() =>
    expect(Array.from(selector.options, (option) => option.value)).toEqual(['', linkedWorkspaceId]),
  );
  // A same-name course does not auto-link; the user must choose from the returned active list.
  expect(selector.value).toBe('');
  expect(readPersonalImports(context)).toHaveLength(0);
  fireEvent.change(selector, { target: { value: linkedWorkspaceId } });
  fireEvent.click(screen.getByRole('button', { name: '確認匯入 1 筆' }));
  await screen.findByText(personalImportSavedNotice(1));
  expect(readPersonalImports(context)).toEqual([
    expect.objectContaining({
      kind: 'grades',
      title: '資料庫',
      linkedCourseId: linkedWorkspaceId,
      grade: '85',
      credits: 3,
    }),
  ]);
  expect(readPersonalImports({ owner: 'guest', schoolId: 'pu' })).toHaveLength(0);
  expect(screen.getByRole('link', { name: '開啟連結的課程 →' }).getAttribute('href')).toBe(
    `/classroom/course/${linkedWorkspaceId}`,
  );
  // The only server call is the accessible-list GET; import never submits membership/role changes.
  expect(vi.mocked(browserRequest).mock.calls).toEqual([
    ['class-workspaces', 'verified-account-context', undefined],
  ]);
});

it('asks before undoing and keeps records when the person chooses not to', async () => {
  render(<PersonalImportCenter />);
  await prepare();
  fireEvent.click(screen.getByRole('button', { name: '確認匯入 1 筆' }));
  await screen.findByText(personalImportSavedNotice(1));
  fireEvent.click(screen.getByRole('button', { name: '撤銷上次匯入' }));
  const dialog = screen.getByRole('dialog', { name: '撤銷上次匯入？' });
  expect(dialog).toBeTruthy();
  expect(screen.getByText(personalImportUndoBody(1))).toBeTruthy();
  await waitFor(() =>
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '先不要' })),
  );
  fireEvent.click(screen.getByRole('button', { name: '先不要' }));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(readPersonalImports(context)).toHaveLength(1);
});

it('shows a Chinese notice when the screenshot file cannot be opened', async () => {
  const { recognizePersonalImportImage } = await import('@/lib/personalImportOcr');
  vi.mocked(recognizePersonalImportImage).mockRejectedValue(
    new Error('The source image could not be decoded.'),
  );
  URL.createObjectURL = vi.fn(() => 'blob:preview');
  URL.revokeObjectURL = vi.fn();
  render(<PersonalImportCenter />);
  fireEvent.change(screen.getByLabelText('選擇截圖或檔案'), {
    target: { files: [new File(['test'], 'broken.png', { type: 'image/png' })] },
  });
  await screen.findByText(PERSONAL_IMPORT_IMAGE_UNREADABLE);
  expect(screen.queryByText(/could not be decoded/i)).toBeNull();
});

it('keeps course application and personal-import controls in the same timetable review', async () => {
  window.history.replaceState(null, '', '/import?kind=timetable');
  context.owner = 'platform:pa_aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
  context.session = {
    platformAccountId: 'pa_aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
    context: 'course-integration-test',
    isPlatformOperator: false,
  };
  vi.mocked(browserRequest).mockResolvedValue({ workspaces: [] });
  render(<PersonalImportCenter />);
  await prepare('課程名稱,星期,開始節次,結束節次,教師,課號\n資料庫,一,3,4,王老師,CS301');
  expect(screen.getByText('查找課班與申請加入')).toBeTruthy();
  expect(screen.getByLabelText('連結我的課程')).toBeTruthy();
  expect(
    (screen.getByRole('button', { name: '確認匯入 1 筆' }) as HTMLButtonElement).disabled,
  ).toBe(false);
  expect(readPersonalImports(context)).toHaveLength(0);
});

function backupRecords(): PersonalImportRecord[] {
  const base = {
    schoolId: 'pu',
    academicYear: '115',
    semester: '1',
    batchId: 'old-batch',
    importedAt: '2026-10-12T12:00:00.000Z',
    source: { type: 'screenshot' as const, name: '成績.png', line: 2, rawText: '原始學校文字' },
  };
  return [
    {
      ...base,
      id: 'old-grade',
      kind: 'grades',
      title: '備份成績',
      credits: 3,
      grade: '85',
      linkedCourseId: 'old-course-reference',
    },
    {
      ...base,
      id: 'old-course',
      kind: 'timetable',
      title: '備份課表',
      dayOfWeek: 1,
      startPeriod: 3,
      endPeriod: 4,
    },
    {
      ...base,
      id: 'old-event',
      kind: 'events',
      title: '備份活動',
      academicYear: '',
      semester: '',
      date: '2026-11-01',
      allDay: true,
    },
  ];
}
function uploadBackup(
  content = serializePersonalImportBackup(backupRecords(), { schoolId: 'pu' }),
) {
  const file = new File([content], 'campus-one-backup.json', { type: 'application/json' });
  Object.defineProperty(file, 'text', { value: () => Promise.resolve(content) });
  fireEvent.change(screen.getByLabelText('選擇截圖或檔案'), { target: { files: [file] } });
}
it('restores all kinds and original terms only after review, without adopting a file class link', async () => {
  render(<PersonalImportCenter />);
  uploadBackup();
  await screen.findByRole('button', { name: '確認匯入 3 筆' });
  expect(readPersonalImports(context)).toEqual([]);
  expect(
    screen
      .getAllByLabelText('連結我的課程')
      .every((node) => (node as HTMLSelectElement).value === ''),
  ).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: '確認匯入 3 筆' }));
  await screen.findByText(personalImportSavedNotice(3));
  const saved = readPersonalImports(context);
  expect(saved.map((row) => row.kind)).toEqual(['grades', 'timetable', 'events']);
  expect(saved[0]).toMatchObject({
    academicYear: '115',
    semester: '1',
    source: backupRecords()[0].source,
  });
  expect(
    saved.every(
      (row) => row.batchId !== 'old-batch' && !row.id.startsWith('old-') && !row.linkedCourseId,
    ),
  ).toBe(true);
  uploadBackup();
  await screen.findByRole('button', { name: '確認匯入 3 筆' });
  fireEvent.click(screen.getByRole('button', { name: '確認匯入 3 筆' }));
  await screen.findByText(personalImportSavedNotice(0));
  expect(readPersonalImports(context)).toHaveLength(3);
});
it('rejects a wrong-school or corrupt backup without replacing existing records', async () => {
  await savePersonalImportBatch(context, [backupRecords()[0]]);
  render(<PersonalImportCenter />);
  uploadBackup(
    serializePersonalImportBackup(
      backupRecords().map((row) => ({ ...row, schoolId: 'ntu' })),
      { schoolId: 'ntu' },
    ),
  );
  await screen.findByText(/這份備份屬於其他校園/);
  expect(screen.queryByRole('button', { name: /確認匯入 \d+ 筆/ })).toBeNull();
  uploadBackup('{broken');
  await waitFor(() => expect(screen.queryByText(/這份備份屬於其他校園/)).toBeNull());
  expect(readPersonalImports(context)).toHaveLength(1);
  expect(screen.queryByRole('button', { name: /確認匯入 \d+ 筆/ })).toBeNull();
});
it('ignores backup file completion after changing accounts', async () => {
  let resolve!: (text: string) => void;
  const file = new File([], 'backup.json');
  Object.defineProperty(file, 'text', {
    value: () =>
      new Promise<string>((done) => {
        resolve = done;
      }),
  });
  const view = render(<PersonalImportCenter />);
  fireEvent.change(screen.getByLabelText('選擇截圖或檔案'), { target: { files: [file] } });
  context.owner = 'platform:two';
  view.rerender(<PersonalImportCenter />);
  await act(async () =>
    resolve(serializePersonalImportBackup(backupRecords(), { schoolId: 'pu' })),
  );
  expect(screen.queryByRole('button', { name: '確認匯入 3 筆' })).toBeNull();
  expect(readPersonalImports(context)).toEqual([]);
});
it('keeps selection across backup pages and imports only checked rows', async () => {
  const records = Array.from({ length: 26 }, (_, index) => ({
    ...backupRecords()[0],
    id: `record-${index}`,
    title: `課程 ${index}`,
    linkedCourseId: undefined,
  }));
  render(<PersonalImportCenter />);
  uploadBackup(serializePersonalImportBackup(records, { schoolId: 'pu' }));
  await screen.findByRole('button', { name: '確認匯入 26 筆' });
  expect(screen.getAllByLabelText('名稱')).toHaveLength(25);
  fireEvent.click(screen.getByRole('button', { name: '全部取消勾選' }));
  fireEvent.click(screen.getByRole('button', { name: '下一頁' }));
  fireEvent.click(screen.getByRole('checkbox', { name: /第 26 筆/ }));
  fireEvent.click(screen.getByRole('button', { name: '確認匯入 1 筆' }));
  await screen.findByText(personalImportSavedNotice(1));
  expect(readPersonalImports(context).map((row) => row.title)).toEqual(['課程 25']);
});
it('downloads the full current-school ledger even while a kind and search are selected', async () => {
  await savePersonalImportBatch(context, backupRecords());
  const otherSchool = { owner: context.owner, schoolId: 'ntu' };
  await savePersonalImportBatch(otherSchool, [{ ...backupRecords()[0], schoolId: 'ntu' }]);
  const blobs: Blob[] = [];
  URL.createObjectURL = vi.fn((blob: Blob) => {
    blobs.push(blob);
    return 'blob:backup';
  });
  URL.revokeObjectURL = vi.fn();
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
  render(<PersonalImportCenter />);
  fireEvent.change(screen.getByLabelText('搜尋個人紀錄'), { target: { value: '找不到' } });
  fireEvent.click(screen.getByRole('button', { name: '下載完整備份' }));
  expect(click).toHaveBeenCalledTimes(1);
  const content = await new Promise<string>((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.readAsText(blobs[0]);
  });
  expect(JSON.parse(content).records).toHaveLength(3);
  expect(JSON.parse(content).schoolId).toBe('pu');
  expect(JSON.parse(content).owner).toBeUndefined();
  click.mockRestore();
});
