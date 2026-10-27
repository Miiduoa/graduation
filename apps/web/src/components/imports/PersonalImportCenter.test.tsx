import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import {
  PERSONAL_IMPORT_IMAGE_UNREADABLE,
  personalImportPreviewNotice,
  personalImportSavedNotice,
  personalImportUndoBody,
  personalImportUndoneNotice,
} from '@campus/shared';
import { readPersonalImportDocumentFile } from '@/lib/personalImportDocuments';
import { createPersonalImportImagePreview } from '@/lib/personalImportImagePreview';
import { recognizePersonalImportImage } from '@/lib/personalImportOcr';
import {
  deletePersonalImportAiModelCache,
  getPersonalImportAiAvailability,
  runPersonalImportAi,
} from '@/lib/personalImportAi';
import type { PersonalImportDocument } from '@campus/shared';
import { PersonalImportCenter } from './PersonalImportCenter';
import {
  personalImportsStorageKey,
  readPersonalImports,
  savePersonalImportBatch,
} from '@/lib/personalImports';
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
vi.mock('@/lib/personalImportDocuments', () => ({ readPersonalImportDocumentFile: vi.fn() }));
vi.mock('@/lib/personalImportOcr', () => ({ recognizePersonalImportImage: vi.fn() }));
vi.mock('@/lib/personalImportAi', () => ({
  getPersonalImportAiAvailability: vi.fn(),
  runPersonalImportAi: vi.fn(),
  deletePersonalImportAiModelCache: vi.fn(),
}));
vi.mock('@/lib/personalImportImagePreview', () => ({ createPersonalImportImagePreview: vi.fn() }));
beforeEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  vi.mocked(readPersonalImportDocumentFile).mockReset();
  vi.mocked(recognizePersonalImportImage).mockReset();
  vi.mocked(getPersonalImportAiAvailability).mockReset().mockReturnValue({
    available: true,
    downloadLabel: '約 1.9 GB',
  });
  vi.mocked(runPersonalImportAi).mockReset();
  vi.mocked(deletePersonalImportAiModelCache).mockReset().mockResolvedValue(undefined);
  vi.mocked(createPersonalImportImagePreview)
    .mockReset()
    .mockResolvedValue(new Blob(['safe pixels'], { type: 'image/png' }));
  URL.createObjectURL = vi.fn(() => 'blob:preview');
  URL.revokeObjectURL = vi.fn();
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
  await waitFor(() => expect(sessionStorage.getItem(personalImportDraftKey(context))).toBeNull());
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

it('keeps the reviewed draft when saving the actual records fails', async () => {
  render(<PersonalImportCenter />);
  await prepare();
  const draftKey = personalImportDraftKey(context);
  const originalDraft = sessionStorage.getItem(draftKey);
  const setItem = Storage.prototype.setItem;
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
    if (this === localStorage && key === personalImportsStorageKey(context))
      throw new DOMException('Full', 'QuotaExceededError');
    setItem.call(this, key, value);
  });
  fireEvent.click(screen.getByRole('button', { name: '確認匯入 1 筆' }));
  await screen.findByText(/這次沒有存成/);
  expect(readPersonalImports(context)).toHaveLength(0);
  expect(sessionStorage.getItem(draftKey)).toBe(originalDraft);
  expect((screen.getByLabelText('成績') as HTMLInputElement).value).toBe('85');
});

it('does not discard an unreadable previous draft after saving newly entered records', async () => {
  const draftKey = personalImportDraftKey(context);
  sessionStorage.setItem(draftKey, '{damaged');
  render(<PersonalImportCenter />);
  await prepare();
  fireEvent.click(screen.getByRole('button', { name: '確認匯入 1 筆' }));
  await screen.findByText(personalImportSavedNotice(1));
  expect(readPersonalImports(context)).toHaveLength(1);
  expect(sessionStorage.getItem(draftKey)).toBe('{damaged');
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
  expect(screen.getByText(personalImportPreviewNotice(1))).toBeTruthy();
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
  await waitFor(() => expect(recognizePersonalImportImage).toHaveBeenCalledOnce());
  context.owner = 'platform:two';
  view.rerender(<PersonalImportCenter />);
  await act(async () => resolve('課程名稱,學分,成績\n舊帳號秘密,3,90'));
  expect(screen.queryByText(/舊帳號秘密/)).toBeNull();
  expect((screen.getByLabelText('原始文字') as HTMLTextAreaElement).value).toBe('');
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:preview');
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

it('with sync enabled, saving only reports the local add and does not claim the account already has it', async () => {
  const platformAccountId = 'pa_aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
  context.owner = `platform:${platformAccountId}`;
  context.session = {
    platformAccountId,
    context: 'verified-account-context',
    isPlatformOperator: false,
  };
  vi.mocked(browserRequest).mockResolvedValue({ workspaces: [] });
  localStorage.setItem(
    personalImportsStorageKey({ owner: context.owner, schoolId: 'pu' }),
    JSON.stringify({ version: 1, records: [], sync: { enabled: true, base: null } }),
  );
  render(<PersonalImportCenter />);
  await prepare();
  fireEvent.click(screen.getByRole('button', { name: '確認匯入 1 筆' }));
  await screen.findByText(personalImportSavedNotice(1, true));
  expect(screen.queryByText(/還沒同步到你的帳號，同步狀態請看下方/)).toBeNull();
  expect(screen.queryByText(/資料只存在這台裝置/)).toBeNull();
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
  expect(screen.queryByAltText('你選擇的資料截圖，僅供核對')).toBeNull();
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:preview');
});

it('previews only the encoded PNG, keeps the original file for OCR, and releases it after saving', async () => {
  const original = new File(['original JPEG'], 'grades.jpg', { type: 'image/jpeg' });
  const png = new Blob(['encoded PNG'], { type: 'image/png' });
  vi.mocked(createPersonalImportImagePreview).mockResolvedValue(png);
  vi.mocked(recognizePersonalImportImage).mockResolvedValue('課程名稱,學分,成績\n資料庫,3,85');
  const view = render(<PersonalImportCenter />);
  fireEvent.change(screen.getByLabelText('這份資料的學年度'), { target: { value: '115' } });
  fireEvent.change(screen.getByLabelText('學期'), { target: { value: '1' } });
  fireEvent.change(screen.getByLabelText('選擇截圖或檔案'), { target: { files: [original] } });
  await screen.findByRole('button', { name: '確認匯入 1 筆' });
  expect(URL.createObjectURL).toHaveBeenCalledExactlyOnceWith(png);
  expect(URL.createObjectURL).not.toHaveBeenCalledWith(original);
  expect(recognizePersonalImportImage).toHaveBeenCalledWith(
    original,
    expect.any(AbortSignal),
    expect.any(Function),
  );
  expect(screen.getByAltText('你選擇的資料截圖，僅供核對').getAttribute('src')).toBe(
    'blob:preview',
  );
  fireEvent.click(screen.getByRole('button', { name: '確認匯入 1 筆' }));
  await screen.findByText(personalImportSavedNotice(1));
  expect(screen.queryByAltText('你選擇的資料截圖，僅供核對')).toBeNull();
  expect(URL.revokeObjectURL).toHaveBeenCalledExactlyOnceWith('blob:preview');
  view.unmount();
  expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1);
});

it('rejects a failed image preview without exposing the file or losing existing draft text', async () => {
  vi.mocked(createPersonalImportImagePreview).mockRejectedValue(
    new Error('請選 PNG、JPEG 或 WebP 圖片。'),
  );
  render(<PersonalImportCenter />);
  fireEvent.change(screen.getByLabelText('原始文字'), { target: { value: '尚未整理的原始文字' } });
  fireEvent.change(screen.getByLabelText('選擇截圖或檔案'), {
    target: {
      files: [new File(['<svg onload="alert(1)"></svg>'], 'unsafe.svg', { type: 'image/svg+xml' })],
    },
  });
  await screen.findByText('請選 PNG、JPEG 或 WebP 圖片。');
  expect(URL.createObjectURL).not.toHaveBeenCalled();
  expect(recognizePersonalImportImage).not.toHaveBeenCalled();
  expect(screen.queryByAltText('你選擇的資料截圖，僅供核對')).toBeNull();
  expect((screen.getByLabelText('原始文字') as HTMLTextAreaElement).value).toBe(
    '尚未整理的原始文字',
  );
});

it.each(['cancel', 'account', 'school', 'paused'] as const)(
  'discards a late preview after %s without starting OCR or creating a URL',
  async (change) => {
    let finish!: (blob: Blob) => void;
    vi.mocked(createPersonalImportImagePreview).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const view = render(<PersonalImportCenter />);
    fireEvent.change(screen.getByLabelText('選擇截圖或檔案'), {
      target: { files: [new File(['pixels'], 'grades.png', { type: 'image/png' })] },
    });
    expect(createPersonalImportImagePreview).toHaveBeenCalledOnce();
    if (change === 'cancel') fireEvent.click(screen.getByRole('button', { name: '取消讀取' }));
    else {
      if (change === 'account') context.owner = 'platform:two';
      if (change === 'school') context.schoolId = 'nthu';
      if (change === 'paused') context.loading = true;
      view.rerender(<PersonalImportCenter />);
    }
    await act(async () => finish(new Blob(['late pixels'], { type: 'image/png' })));
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    expect(recognizePersonalImportImage).not.toHaveBeenCalled();
    expect(screen.queryByAltText('你選擇的資料截圖，僅供核對')).toBeNull();
  },
);

it.each(['cancel', 'unmount'] as const)(
  'revokes an installed preview on %s and ignores late OCR data',
  async (change) => {
    let finish!: (text: string) => void;
    vi.mocked(recognizePersonalImportImage).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const view = render(<PersonalImportCenter />);
    fireEvent.change(screen.getByLabelText('選擇截圖或檔案'), {
      target: { files: [new File(['pixels'], 'grades.png', { type: 'image/png' })] },
    });
    await screen.findByAltText('你選擇的資料截圖，僅供核對');
    if (change === 'cancel') fireEvent.click(screen.getByRole('button', { name: '取消讀取' }));
    else view.unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalledExactlyOnceWith('blob:preview');
    await act(async () => finish('課程名稱,學分,成績\n舊檔案內容,3,85'));
    expect(screen.queryByAltText('你選擇的資料截圖，僅供核對')).toBeNull();
    expect(readPersonalImports(context)).toHaveLength(0);
    if (change === 'cancel') {
      expect((screen.getByLabelText('原始文字') as HTMLTextAreaElement).value).toBe('');
      view.unmount();
    }
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1);
  },
);

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

const pdfDocument: PersonalImportDocument = {
  name: 'grades.pdf',
  format: 'pdf',
  warnings: [],
  sections: [
    {
      id: 'page-1',
      label: '第 1 頁',
      needsOcr: false,
      warnings: [],
      rows: [
        { line: 1, cells: ['課程名稱', '學分', '成績'] },
        { line: 2, cells: ['資料庫', '3', '85'] },
      ],
    },
  ],
};
it('restores document text, selected sheets and header rows without saving records or the source file', async () => {
  const document: PersonalImportDocument = {
    ...pdfDocument,
    name: 'grades.xlsx',
    format: 'xlsx',
    sections: [
      { ...pdfDocument.sections[0], id: 'sheet-1', label: '說明' },
      {
        ...pdfDocument.sections[0],
        id: 'sheet-2',
        label: '成績',
        rows: [
          { line: 1, cells: ['115 學年度成績'] },
          { line: 2, cells: ['課程名稱', '學分', '成績'] },
          { line: 3, cells: ['英文', '2', '90'] },
        ],
      },
    ],
  };
  vi.mocked(readPersonalImportDocumentFile).mockResolvedValue(document);
  const view = render(<PersonalImportCenter />);
  fireEvent.change(screen.getByLabelText('這份資料的學年度'), { target: { value: '115' } });
  fireEvent.change(screen.getByLabelText('學期'), { target: { value: '1' } });
  fireEvent.change(screen.getByLabelText('選擇截圖或檔案'), {
    target: { files: [new File(['private-source-bytes'], 'grades.xlsx')] },
  });
  await screen.findByText('grades.xlsx');
  fireEvent.click(screen.getByRole('checkbox', { name: '說明 · 2 列' }));
  fireEvent.click(screen.getByRole('checkbox', { name: '成績 · 3 列' }));
  fireEvent.change(screen.getByLabelText('「成績」的標題列'), { target: { value: '2' } });
  view.unmount();
  const restoredView = render(<PersonalImportCenter />);
  expect((screen.getByRole('checkbox', { name: '說明 · 2 列' }) as HTMLInputElement).checked).toBe(
    false,
  );
  expect((screen.getByRole('checkbox', { name: '成績 · 3 列' }) as HTMLInputElement).checked).toBe(
    true,
  );
  expect((screen.getByLabelText('「成績」的標題列') as HTMLSelectElement).value).toBe('2');
  expect(readPersonalImports(context)).toHaveLength(0);
  expect(sessionStorage.getItem(personalImportDraftKey(context))).not.toContain(
    'private-source-bytes',
  );
  expect(readPersonalImportDocumentFile).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: '整理選取內容' }));
  const clearedDraft = vi.fn();
  const removeItem = Storage.prototype.removeItem;
  vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(function (
    this: Storage,
    key: string,
  ) {
    if (
      this === sessionStorage &&
      key === personalImportDraftKey(context) &&
      this.getItem(key) !== null
    ) {
      clearedDraft(
        readPersonalImports(context).length,
        !!screen.queryByText(personalImportSavedNotice(1)),
      );
    }
    removeItem.call(this, key);
  });
  fireEvent.click(screen.getByRole('button', { name: '確認匯入 1 筆' }));
  await screen.findByText(personalImportSavedNotice(1));
  expect(readPersonalImports(context)[0]).toMatchObject({ title: '英文', grade: '90' });
  expect(clearedDraft).toHaveBeenCalledWith(1, false);
  expect(sessionStorage.getItem(personalImportDraftKey(context))).toBeNull();
  restoredView.unmount();
  render(<PersonalImportCenter />);
  expect(screen.queryByRole('button', { name: '確認匯入 1 筆' })).toBeNull();
  expect(screen.queryByText(/已找回這個分頁尚未匯入的草稿/)).toBeNull();
  expect(readPersonalImports(context)).toHaveLength(1);
});

it('restores PDF preview and requests the original file only when re-running OCR', async () => {
  vi.mocked(readPersonalImportDocumentFile).mockResolvedValue(pdfDocument);
  const view = render(<PersonalImportCenter />);
  fireEvent.change(screen.getByLabelText('選擇截圖或檔案'), {
    target: { files: [new File(['pdf'], 'grades.pdf', { type: 'application/pdf' })] },
  });
  await screen.findByText('grades.pdf');
  view.unmount();
  render(<PersonalImportCenter />);
  expect(screen.getByText('資料庫')).toBeTruthy();
  const file = new File(['pdf'], 'grades.pdf', { type: 'application/pdf' });
  fireEvent.change(screen.getByLabelText('重新選擇原始 PDF'), { target: { files: [file] } });
  await waitFor(() =>
    expect(readPersonalImportDocumentFile).toHaveBeenLastCalledWith(file, expect.any(AbortSignal), {
      pdfMode: 'ocr',
    }),
  );
  expect(readPersonalImports(context)).toHaveLength(0);
  fireEvent.click(screen.getByRole('button', { name: '清除暫存草稿' }));
  fireEvent.click(screen.getByRole('button', { name: '確認清除草稿' }));
  expect(screen.queryByText('grades.pdf')).toBeNull();
  expect(sessionStorage.getItem(personalImportDraftKey(context))).toBeNull();
});

it('re-reads the same PDF locally and requires review before saving the recovered rows', async () => {
  vi.mocked(readPersonalImportDocumentFile)
    .mockResolvedValueOnce({
      ...pdfDocument,
      sections: [{ ...pdfDocument.sections[0], rows: [{ line: 1, cells: ['學期成績單'] }] }],
    })
    .mockResolvedValueOnce(pdfDocument);
  render(<PersonalImportCenter />);
  fireEvent.change(screen.getByLabelText('這份資料的學年度'), { target: { value: '115' } });
  fireEvent.change(screen.getByLabelText('學期'), { target: { value: '1' } });
  const file = new File(['pdf'], 'grades.pdf', { type: 'application/pdf' });
  fireEvent.change(screen.getByLabelText('選擇截圖或檔案'), { target: { files: [file] } });
  await screen.findByText('grades.pdf');
  expect(readPersonalImports(context)).toHaveLength(0);
  fireEvent.click(screen.getByRole('button', { name: '重新辨識 PDF 整頁' }));
  await waitFor(() =>
    expect(readPersonalImportDocumentFile).toHaveBeenCalledWith(file, expect.any(AbortSignal), {
      pdfMode: 'ocr',
    }),
  );
  await screen.findByText('資料庫');
  fireEvent.click(screen.getByRole('button', { name: '整理選取內容' }));
  expect(readPersonalImports(context)).toHaveLength(0);
  fireEvent.click(screen.getByRole('button', { name: '確認匯入 1 筆' }));
  await screen.findByText(personalImportSavedNotice(1));
  expect(readPersonalImports(context)[0]).toMatchObject({
    title: '資料庫',
    grade: '85',
    source: { name: 'grades.pdf · 第 1 頁' },
  });
});
it('preserves the existing PDF preview on re-read failure, then cancels and ignores a late result after a school change', async () => {
  let finish!: (value: PersonalImportDocument) => void;
  vi.mocked(readPersonalImportDocumentFile)
    .mockResolvedValueOnce(pdfDocument)
    .mockRejectedValueOnce(new Error('讀取失敗'))
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
  const view = render(<PersonalImportCenter />);
  fireEvent.change(screen.getByLabelText('選擇截圖或檔案'), {
    target: { files: [new File(['pdf'], 'grades.pdf', { type: 'application/pdf' })] },
  });
  await screen.findByText('grades.pdf');
  fireEvent.click(screen.getByRole('button', { name: '重新辨識 PDF 整頁' }));
  await screen.findByText('讀取失敗');
  expect(screen.getByText('資料庫')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '重新辨識 PDF 整頁' }));
  const signal = vi.mocked(readPersonalImportDocumentFile).mock.calls[2][1];
  fireEvent.click(screen.getByRole('button', { name: '取消讀取' }));
  expect(signal?.aborted).toBe(true);
  expect(screen.getByText('資料庫')).toBeTruthy();
  context.schoolId = 'ncku';
  view.rerender(<PersonalImportCenter />);
  await act(async () => finish(pdfDocument));
  expect(screen.queryByText('grades.pdf')).toBeNull();
  expect(readPersonalImports(context)).toHaveLength(0);
});

it('selects a course-grade table saved from a school website before any record is written', async () => {
  render(<PersonalImportCenter />);
  fireEvent.change(screen.getByLabelText('這份資料的學年度'), { target: { value: '115' } });
  fireEvent.change(screen.getByLabelText('學期'), { target: { value: '1' } });
  const html =
    '<table><tr><th>課程名稱</th><th>學分</th><th>成績</th></tr>' +
    '<tr><td>統計學</td><td>3</td><td>89</td></tr></table>';
  const file = {
    name: 'academic.html',
    size: html.length,
    type: 'text/html',
    text: async () => html,
  };
  fireEvent.change(screen.getByLabelText('選擇截圖或檔案'), { target: { files: [file] } });
  await screen.findByText('從校務網頁取出資料');
  expect(readPersonalImports(context)).toHaveLength(0);
  fireEvent.click(screen.getByRole('button', { name: /表格 1 · 1 筆/ }));
  await waitFor(() =>
    expect((screen.getAllByLabelText('成績')[0] as HTMLInputElement).value).toBe('89'),
  );
  expect(readPersonalImports(context)).toHaveLength(0);
  expect((screen.getByLabelText('原始文字') as HTMLTextAreaElement).value).toContain('統計學');
  expect(screen.getByRole('button', { name: '確認匯入 1 筆' })).toBeTruthy();
});

it('accepts rich HTML tables copied from a school site without running its scripts', async () => {
  render(<PersonalImportCenter />);
  const html =
    '<table><tr><th>課程名稱</th><th>學分</th><th>成績</th></tr>' +
    '<tr><td>英文</td><td>2</td><td>90</td></tr></table><script>alert(1)</script>';
  fireEvent.paste(screen.getByLabelText('原始文字'), {
    clipboardData: {
      getData: (format: string) => (format === 'text/html' ? html : 'HTML not text'),
    },
  });
  await screen.findByText('從校務網頁取出資料');
  fireEvent.click(screen.getByRole('button', { name: /表格 1 · 1 筆/ }));
  expect((screen.getByLabelText('原始文字') as HTMLTextAreaElement).value).not.toContain('<script');
  expect((screen.getByLabelText('原始文字') as HTMLTextAreaElement).value).toContain('英文');
  expect(readPersonalImports(context)).toHaveLength(0);
});

it('applies the school HTML term to preview rows in the same click, not just to form inputs', async () => {
  window.history.replaceState(null, '', '/import?kind=grades');
  render(<PersonalImportCenter />);
  const html =
    '<h2>115 學年度 第 1 學期成績</h2>' +
    '<table><tr><th>課程名稱</th><th>學分</th><th>成績</th></tr>' +
    '<tr><td>統計學</td><td>3</td><td>89</td></tr></table>';
  const file = {
    name: 'grades.html',
    size: html.length,
    type: 'text/html',
    text: async () => html,
  };
  fireEvent.change(screen.getByLabelText('選擇截圖或檔案'), { target: { files: [file] } });
  await screen.findByText('從校務網頁取出資料');
  fireEvent.click(screen.getByRole('button', { name: /表格 1 · 1 筆/ }));
  expect((screen.getByLabelText('這份資料的學年度') as HTMLInputElement).value).toBe('115');
  expect(
    screen.getAllByLabelText('學期').every((field) => (field as HTMLInputElement).value === '1'),
  ).toBe(true);
  await waitFor(() =>
    expect(
      JSON.parse(sessionStorage.getItem(personalImportDraftKey(context)) || '{}').draft?.rows?.[0],
    ).toMatchObject({ title: '統計學', academicYear: '115', semester: '1' }),
  );
  expect(readPersonalImports(context)).toHaveLength(0);
});

function aiGradePreview(title = '資料庫') {
  return {
    rows: [
      {
        id: 'ai-grade-1',
        kind: 'grades' as const,
        title,
        schoolId: 'pu',
        academicYear: '115',
        semester: '1',
        credits: 3,
        grade: '85',
        source: {
          type: 'screenshot' as const,
          name: 'grades.png',
          line: 1,
          rawText: `${title} 3 85`,
        },
      },
    ],
    issues: [
      {
        code: 'ai-review-required',
        severity: 'warning' as const,
        rowId: 'ai-grade-1',
        message: '請與原始資料逐筆核對。',
      },
    ],
  };
}
function chooseAiScreenshot() {
  const file = new File(['image'], 'grades.png', { type: 'image/png' });
  fireEvent.change(screen.getByLabelText('這份資料的學年度'), { target: { value: '115' } });
  fireEvent.change(screen.getByLabelText('學期'), { target: { value: '1' } });
  fireEvent.change(screen.getByLabelText('選擇交給 AI 辨識的截圖'), { target: { files: [file] } });
  return file;
}

const unstructuredDocument: PersonalImportDocument = {
  name: 'semester.xlsx',
  format: 'xlsx',
  warnings: [],
  sections: [
    {
      id: 'instructions',
      label: '說明',
      needsOcr: false,
      warnings: [],
      rows: [{ line: 1, cells: ['未選取的其他資料'] }],
    },
    {
      id: 'results',
      label: '成績',
      needsOcr: false,
      warnings: [],
      rows: [
        { line: 1, cells: ['略過的頁首'] },
        { line: 2, cells: ['應修項目', '採計單位', '評定'] },
        { line: 3, cells: ['資料庫', '3', '85'] },
      ],
    },
  ],
};

async function chooseDocumentRanges(document = unstructuredDocument) {
  vi.mocked(readPersonalImportDocumentFile).mockResolvedValue(document);
  fireEvent.change(screen.getByLabelText('這份資料的學年度'), { target: { value: '115' } });
  fireEvent.change(screen.getByLabelText('學期'), { target: { value: '1' } });
  const file = new File(['private-document-bytes'], document.name);
  fireEvent.change(screen.getByLabelText('選擇截圖或檔案'), { target: { files: [file] } });
  await screen.findByRole('region', { name: '選擇文件內容' });
  fireEvent.click(screen.getByRole('checkbox', { name: '說明 · 1 列' }));
  fireEvent.click(screen.getByRole('checkbox', { name: '成績 · 3 列' }));
  fireEvent.change(screen.getByLabelText('「成績」的標題列'), { target: { value: '2' } });
  return file;
}

function documentAiPreview(document = unstructuredDocument) {
  const preview = aiGradePreview();
  return {
    ...preview,
    rows: [
      {
        ...preview.rows[0],
        source: {
          type: 'file' as const,
          name: `${document.name} · 成績`,
          line: 3,
          rawText: '資料庫\t3\t85',
        },
      },
    ],
  };
}

it.each(['pdf', 'xlsx'] as const)(
  'organizes selected %s text with AI despite unknown headers and requires review before saving',
  async (format) => {
    const document = { ...unstructuredDocument, name: `semester.${format}`, format };
    vi.mocked(runPersonalImportAi).mockResolvedValue(documentAiPreview(document));
    render(<PersonalImportCenter />);
    await chooseDocumentRanges(document);
    expect(runPersonalImportAi).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '整理選取內容' }));
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '確認匯入 1 筆' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '用 AI 整理選取內容' }));
    const save = await screen.findByRole('button', { name: '確認匯入 1 筆' });
    expect(runPersonalImportAi).toHaveBeenCalledWith(
      expect.objectContaining({
        input: { text: '【成績】\n應修項目\t採計單位\t評定\n資料庫\t3\t85' },
        options: expect.objectContaining({
          kind: 'grades',
          schoolId: 'pu',
          academicYear: '115',
          semester: '1',
          source: { type: 'file', name: `semester.${format} · 成績` },
        }),
      }),
    );
    expect(screen.queryByRole('region', { name: '選擇文件內容' })).toBeNull();
    expect((screen.getByLabelText('原始文字') as HTMLTextAreaElement).value).toBe(
      '【成績】\n應修項目\t採計單位\t評定\n資料庫\t3\t85',
    );
    expect(screen.queryByRole('img')).toBeNull();
    expect(readPersonalImports(context)).toHaveLength(0);
    expect(save.hasAttribute('disabled')).toBe(true);
    fireEvent.click(
      screen.getByRole('checkbox', { name: '我已對照來源，逐筆核對這次 AI 整理的內容' }),
    );
    fireEvent.click(save);
    await waitFor(() => expect(readPersonalImports(context)).toHaveLength(1));
    expect(readPersonalImports(context)[0].source.name).toBe(`semester.${format} · 成績`);
  },
);

it.each(['failure', 'cancel'] as const)(
  'preserves the document and selected ranges after AI %s',
  async (outcome) => {
    let finish!: (value: ReturnType<typeof documentAiPreview>) => void;
    if (outcome === 'failure')
      vi.mocked(runPersonalImportAi).mockRejectedValue(new Error('模型目前無法載入。'));
    else
      vi.mocked(runPersonalImportAi).mockImplementation(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      );
    const view = render(<PersonalImportCenter />);
    await chooseDocumentRanges();
    fireEvent.click(screen.getByRole('button', { name: '用 AI 整理選取內容' }));
    await waitFor(() => expect(runPersonalImportAi).toHaveBeenCalledOnce());
    if (outcome === 'failure') await screen.findByText('模型目前無法載入。');
    else {
      expect(
        screen.getByRole('button', { name: '用 AI 整理選取內容' }).hasAttribute('disabled'),
      ).toBe(true);
      expect(screen.getByRole('checkbox', { name: '成績 · 3 列' }).matches(':disabled')).toBe(true);
      fireEvent.click(screen.getByRole('button', { name: '取消讀取' }));
      expect(vi.mocked(runPersonalImportAi).mock.calls[0][0].signal.aborted).toBe(true);
      await act(async () => finish(documentAiPreview()));
    }
    expect(screen.getByRole('region', { name: '選擇文件內容' })).toBeTruthy();
    expect(
      (screen.getByRole('checkbox', { name: '說明 · 1 列' }) as HTMLInputElement).checked,
    ).toBe(false);
    expect(
      (screen.getByRole('checkbox', { name: '成績 · 3 列' }) as HTMLInputElement).checked,
    ).toBe(true);
    expect((screen.getByLabelText('「成績」的標題列') as HTMLSelectElement).value).toBe('2');
    expect(
      screen.getByRole('button', { name: '用 AI 整理選取內容' }).hasAttribute('disabled'),
    ).toBe(false);
    expect(screen.queryByRole('button', { name: '確認匯入 1 筆' })).toBeNull();
    expect(readPersonalImports(context)).toHaveLength(0);
    view.unmount();
    render(<PersonalImportCenter />);
    expect((screen.getByLabelText('「成績」的標題列') as HTMLSelectElement).value).toBe('2');
    expect(
      (screen.getByRole('checkbox', { name: '說明 · 1 列' }) as HTMLInputElement).checked,
    ).toBe(false);
  },
);

it('rejects oversized document AI input before downloading and allows a smaller selected range', async () => {
  const document: PersonalImportDocument = {
    ...unstructuredDocument,
    sections: [
      unstructuredDocument.sections[0],
      {
        ...unstructuredDocument.sections[1],
        rows: [
          unstructuredDocument.sections[1].rows[0],
          { line: 2, cells: ['長'.repeat(8_001)] },
          unstructuredDocument.sections[1].rows[2],
        ],
      },
    ],
  };
  vi.mocked(runPersonalImportAi).mockResolvedValue(documentAiPreview(document));
  render(<PersonalImportCenter />);
  await chooseDocumentRanges(document);
  fireEvent.click(screen.getByRole('button', { name: '用 AI 整理選取內容' }));
  expect(screen.getByText(/選取內容超過 8,000 字元/)).toBeTruthy();
  expect(runPersonalImportAi).not.toHaveBeenCalled();
  expect(screen.getByRole('region', { name: '選擇文件內容' })).toBeTruthy();
  expect((screen.getByLabelText('「成績」的標題列') as HTMLSelectElement).value).toBe('2');
  fireEvent.change(screen.getByLabelText('「成績」的標題列'), { target: { value: '3' } });
  fireEvent.click(screen.getByRole('button', { name: '用 AI 整理選取內容' }));
  await screen.findByRole('button', { name: '確認匯入 1 筆' });
  expect(runPersonalImportAi).toHaveBeenCalledOnce();
  expect(vi.mocked(runPersonalImportAi).mock.calls[0][0].input).toEqual({
    text: '【成績】\n資料庫\t3\t85',
  });
  expect(readPersonalImports(context)).toHaveLength(0);
});

it('shows clear source choices and never starts a model download without choosing AI', async () => {
  render(<PersonalImportCenter />);
  expect(screen.getByRole('group', { name: '選擇匯入方式' })).toBeTruthy();
  expect(screen.getByText(/首次下載約 1.9 GB/)).toBeTruthy();
  expect(runPersonalImportAi).not.toHaveBeenCalled();
  await prepare();
  expect(runPersonalImportAi).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: '確認匯入 1 筆' }).hasAttribute('disabled')).toBe(
    false,
  );
});

it('explains unsupported AI while preserving ordinary import paths', async () => {
  vi.mocked(getPersonalImportAiAvailability).mockReturnValue({
    available: false,
    downloadLabel: '約 1.9 GB',
    reason: '這個瀏覽器不支援 WebGPU。請使用一般檔案讀取。',
  });
  render(<PersonalImportCenter />);
  expect(screen.getByRole('button', { name: /AI 讀取截圖/ }).hasAttribute('disabled')).toBe(true);
  expect(screen.getByText(/這個瀏覽器不支援 WebGPU/)).toBeTruthy();
  await prepare();
  fireEvent.click(screen.getByRole('button', { name: '確認匯入 1 筆' }));
  await waitFor(() => expect(readPersonalImports(context)).toHaveLength(1));
  expect(runPersonalImportAi).not.toHaveBeenCalled();
});

it('runs actual AI image integration only on request and requires source review before saving', async () => {
  vi.mocked(runPersonalImportAi).mockResolvedValue(aiGradePreview());
  render(<PersonalImportCenter />);
  const file = chooseAiScreenshot();
  const save = await screen.findByRole('button', { name: '確認匯入 1 筆' });
  expect(recognizePersonalImportImage).not.toHaveBeenCalled();
  expect(runPersonalImportAi).toHaveBeenCalledWith(
    expect.objectContaining({
      input: { image: file },
      options: expect.objectContaining({
        kind: 'grades',
        schoolId: 'pu',
        academicYear: '115',
        semester: '1',
      }),
      signal: expect.any(AbortSignal),
    }),
  );
  expect(screen.getByText('AI 辨讀的來源片段（請與原檔核對）')).toBeTruthy();
  expect(screen.getByRole('complementary', { name: '匯入來源對照' })).toBeTruthy();
  expect(readPersonalImports(context)).toHaveLength(0);
  expect(save.hasAttribute('disabled')).toBe(true);
  const reviewed = screen.getByRole('checkbox', {
    name: '我已對照來源，逐筆核對這次 AI 整理的內容',
  });
  fireEvent.click(reviewed);
  expect(save.hasAttribute('disabled')).toBe(false);
  fireEvent.change(screen.getByLabelText('成績'), { target: { value: '88' } });
  expect((reviewed as HTMLInputElement).checked).toBe(false);
  expect(save.hasAttribute('disabled')).toBe(true);
  fireEvent.click(reviewed);
  fireEvent.click(save);
  await waitFor(() => expect(readPersonalImports(context)[0]?.grade).toBe('88'));
});

it('restores AI warnings but requires a fresh acknowledgement after returning to the draft', async () => {
  vi.mocked(runPersonalImportAi).mockResolvedValue(aiGradePreview());
  const view = render(<PersonalImportCenter />);
  chooseAiScreenshot();
  await screen.findByRole('button', { name: '確認匯入 1 筆' });
  fireEvent.click(
    screen.getByRole('checkbox', { name: '我已對照來源，逐筆核對這次 AI 整理的內容' }),
  );
  view.unmount();
  render(<PersonalImportCenter />);
  expect(screen.getByRole('button', { name: '確認匯入 1 筆' }).hasAttribute('disabled')).toBe(true);
  expect(
    (
      screen.getByRole('checkbox', {
        name: '我已對照來源，逐筆核對這次 AI 整理的內容',
      }) as HTMLInputElement
    ).checked,
  ).toBe(false);
  expect(screen.queryByRole('img')).toBeNull();
});

it('requires replacement confirmation and preserves existing edits when AI fails', async () => {
  vi.mocked(runPersonalImportAi).mockRejectedValue(new Error('模型目前無法載入。'));
  render(<PersonalImportCenter />);
  await prepare();
  fireEvent.change(screen.getByLabelText('成績'), { target: { value: '88' } });
  fireEvent.click(screen.getByRole('button', { name: 'AI 整理這段文字' }));
  expect(runPersonalImportAi).not.toHaveBeenCalled();
  expect(screen.getByRole('alertdialog', { name: '重新整理這份草稿？' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '保留目前草稿' }));
  expect(runPersonalImportAi).not.toHaveBeenCalled();
  expect((screen.getByLabelText('成績') as HTMLInputElement).value).toBe('88');
  fireEvent.click(screen.getByRole('button', { name: 'AI 整理這段文字' }));
  fireEvent.click(screen.getByRole('button', { name: '確認以 AI 重新整理' }));
  await waitFor(() => expect(runPersonalImportAi).toHaveBeenCalledOnce());
  await waitFor(() => expect(screen.queryByRole('button', { name: '取消讀取' })).toBeNull());
  expect((screen.getByLabelText('成績') as HTMLInputElement).value).toBe('88');
  expect(readPersonalImports(context)).toHaveLength(0);
});

it.each(['cancel', 'account', 'school'] as const)(
  'ignores a late AI response after %s',
  async (change) => {
    let finish!: (value: ReturnType<typeof aiGradePreview>) => void;
    vi.mocked(runPersonalImportAi).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const view = render(<PersonalImportCenter />);
    chooseAiScreenshot();
    await waitFor(() => expect(runPersonalImportAi).toHaveBeenCalledOnce());
    const signal = vi.mocked(runPersonalImportAi).mock.calls[0][0].signal;
    if (change === 'cancel') fireEvent.click(screen.getByRole('button', { name: '取消讀取' }));
    else {
      if (change === 'account') context.owner = 'platform:another';
      else context.schoolId = 'nthu';
      view.rerender(<PersonalImportCenter />);
    }
    expect(signal.aborted).toBe(true);
    await act(async () => finish(aiGradePreview('舊來源的私人課程')));
    expect(screen.queryByDisplayValue('舊來源的私人課程')).toBeNull();
    expect(screen.queryByRole('button', { name: '確認匯入 1 筆' })).toBeNull();
    expect(readPersonalImports(context)).toHaveLength(0);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:preview');
  },
);

it('keeps the previous draft editable after cancelling a pending AI replacement', async () => {
  let finish!: (value: ReturnType<typeof aiGradePreview>) => void;
  vi.mocked(runPersonalImportAi).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  render(<PersonalImportCenter />);
  await prepare();
  fireEvent.change(screen.getByLabelText('成績'), { target: { value: '88' } });
  fireEvent.click(screen.getByRole('button', { name: 'AI 整理這段文字' }));
  fireEvent.click(screen.getByRole('button', { name: '確認以 AI 重新整理' }));
  await waitFor(() => expect(runPersonalImportAi).toHaveBeenCalledOnce());
  expect(screen.getByRole('button', { name: '確認匯入 1 筆' }).hasAttribute('disabled')).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: '取消讀取' }));
  await act(async () => finish(aiGradePreview('不應取代')));
  expect((screen.getByLabelText('名稱') as HTMLInputElement).value).toBe('資料庫');
  expect((screen.getByLabelText('成績') as HTMLInputElement).value).toBe('88');
  expect(screen.getByRole('button', { name: '確認匯入 1 筆' }).hasAttribute('disabled')).toBe(
    false,
  );
});

it('filters and focuses incorrect rows without removing a field while it is being corrected', async () => {
  render(<PersonalImportCenter />);
  await prepare('課程名稱,學分,成績\n資料庫,3,85\n英文,2,');
  expect(screen.getByRole('button', { name: '待修正 1 筆' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '前往第一筆待修正' }));
  expect(screen.queryByRole('checkbox', { name: /第 1 筆/ })).toBeNull();
  const grade = screen.getByLabelText('成績');
  await waitFor(() => expect(document.activeElement).toBe(grade));
  expect(grade.getAttribute('aria-invalid')).toBe('true');
  fireEvent.change(grade, { target: { value: '90' } });
  expect(screen.getByLabelText('成績')).toBe(grade);
  expect(screen.getByRole('button', { name: '待修正 0 筆' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '全部 2 筆' }));
  expect(screen.getAllByLabelText('成績')).toHaveLength(2);
  expect(screen.getByRole('button', { name: '確認匯入 2 筆' }).hasAttribute('disabled')).toBe(
    false,
  );
});

it('only clears the recognition model cache after an explicit request and preserves the import draft', async () => {
  render(<PersonalImportCenter />);
  await prepare();
  expect(deletePersonalImportAiModelCache).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '移除下載模型' }));
  await screen.findByText('已移除本瀏覽器的辨識模型快取，下次使用會重新下載。');
  expect(deletePersonalImportAiModelCache).toHaveBeenCalledOnce();
  expect((screen.getByLabelText('成績') as HTMLInputElement).value).toBe('85');
  expect(readPersonalImports(context)).toHaveLength(0);
});

it('does not report model deletion success when browser cache removal fails', async () => {
  vi.mocked(deletePersonalImportAiModelCache).mockRejectedValue(
    new Error('辨識模型快取尚未移除，請稍後再試。'),
  );
  render(<PersonalImportCenter />);
  fireEvent.click(screen.getByRole('button', { name: '移除下載模型' }));
  await screen.findByText('辨識模型快取尚未移除，請稍後再試。');
  expect(screen.queryByText('已移除本瀏覽器的辨識模型快取，下次使用會重新下載。')).toBeNull();
});

it('releases the previous screenshot when switching to a saved school table', async () => {
  vi.mocked(runPersonalImportAi).mockResolvedValue(aiGradePreview());
  render(<PersonalImportCenter />);
  chooseAiScreenshot();
  await screen.findByRole('button', { name: '確認匯入 1 筆' });
  expect(screen.getByRole('button', { name: 'AI 重新讀取圖片' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '取消這份草稿' }));
  const html =
    '<table><tr><th>課程名稱</th><th>學分</th><th>成績</th></tr><tr><td>新來源英文</td><td>2</td><td>90</td></tr></table>';
  const file = new File([html], 'new-grades.html', { type: 'text/html' });
  Object.defineProperty(file, 'text', { value: async () => html });
  fireEvent.change(screen.getByLabelText('選擇截圖或檔案'), { target: { files: [file] } });
  await screen.findByRole('region', { name: '選擇校務網頁表格' });
  expect(screen.queryByRole('button', { name: 'AI 重新讀取圖片' })).toBeNull();
  expect(screen.queryByRole('img')).toBeNull();
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:preview');
});

it('clears a stale screenshot when a new plain text file is read', async () => {
  vi.mocked(runPersonalImportAi).mockResolvedValue(aiGradePreview());
  render(<PersonalImportCenter />);
  chooseAiScreenshot();
  await screen.findByRole('button', { name: '確認匯入 1 筆' });
  fireEvent.click(screen.getByRole('button', { name: '取消這份草稿' }));
  const contents = `課程名稱,學分,成績
英文,2,90`;
  const file = new File([contents], 'new-grades.csv', { type: 'text/csv' });
  Object.defineProperty(file, 'text', { value: async () => contents });
  fireEvent.change(screen.getByLabelText('選擇截圖或檔案'), { target: { files: [file] } });
  await screen.findByRole('button', { name: '確認匯入 1 筆' });
  expect(screen.queryByRole('button', { name: 'AI 重新讀取圖片' })).toBeNull();
  expect(screen.queryByRole('img')).toBeNull();
  expect((screen.getByLabelText('名稱') as HTMLInputElement).value).toBe('英文');
});

it('copies the school capture bookmark only after the user requests it', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  render(<PersonalImportCenter />);
  expect(writeText).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText('從已登入的學校網頁擷取'));
  expect(screen.getByText(/單次擷取，不會自動同步/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '複製擷取工具' }));
  await screen.findByText('工具網址已複製。請新增一個書籤，將網址替換成剛剛複製的內容。');
  expect(writeText).toHaveBeenCalledOnce();
  expect(writeText.mock.calls[0][0]).toMatch(/^javascript:/);
  expect(document.getElementById('campus-one-school-table-capture')).toBeNull();
  expect(readPersonalImports(context)).toHaveLength(0);
});

it('provides a selectable bookmark URL when automatic clipboard access is unavailable', async () => {
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
  render(<PersonalImportCenter />);
  fireEvent.click(screen.getByText('從已登入的學校網頁擷取'));
  fireEvent.click(screen.getByRole('button', { name: '複製擷取工具' }));
  await screen.findByText(/瀏覽器未能自動複製/);
  const field = screen.getByLabelText('校務擷取書籤網址') as HTMLTextAreaElement;
  expect(field.readOnly).toBe(true);
  expect(field.value).toMatch(/^javascript:/);
  expect(field.closest('details')?.open).toBe(true);
});
