import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mocks.push, replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/timetable',
}));

import {
  cleanCourse,
  cleanMeta,
  shareCopiedCopy,
  WEEKDAY_LABELS,
  type PersonalImportRecord,
} from '@campus/shared';
import { PersonalTimetable } from './PersonalTimetable';

const mocks = vi.hoisted(() => ({
  auth: { user: { uid: 'alice' } as { uid: string } | null, loading: false },
  school: { selectedSchoolId: 'pu', loading: false },
  load: vi.fn(),
  save: vi.fn(),
  share: vi.fn(),
  friends: vi.fn(),
  invites: vi.fn(),
  friendTimetable: vi.fn(),
  meetup: vi.fn(),
  push: vi.fn(),
  records: [] as PersonalImportRecord[],
}));
vi.mock('@/components/AuthGuard', () => ({ useAuth: () => mocks.auth }));
vi.mock('@/components/SelectedSchoolProvider', () => ({
  useSelectedSchool: () => mocks.school,
  useOptionalSelectedSchool: () => ({
    ...mocks.school,
    selectedSchool: mocks.school.selectedSchoolId
      ? { id: mocks.school.selectedSchoolId, name: '靜宜大學' }
      : null,
    catalogStatus: 'ready',
  }),
}));
vi.mock('@/lib/usePersonalImports', () => ({
  usePersonalImportScope: () => {
    const owner = mocks.auth.user ? `school:${mocks.auth.user.uid}` : 'guest';
    const schoolId = mocks.school.selectedSchoolId || 'personal';
    return {
      scope: { owner, schoolId },
      scopeKey: `${owner}:${schoolId}`,
      loading: mocks.auth.loading || mocks.school.loading,
      schoolName: '靜宜大學',
    };
  },
  usePersonalImports: () => ({ records: mocks.records, error: '', loading: false }),
}));
vi.mock('@/lib/timetable/store', () => ({
  CLOUD_NOT_READY_COPY: '這個功能還沒接通，雲端備份先不用。',
  TIMETABLE_DEVICE_ONLY_STORED_COPY: '已存在這台裝置，換手機或清除瀏覽器資料就會不見',
  TIMETABLE_DEVICE_ONLY_SUBMIT_COPY: '存在這台裝置',
  TimetableCloudSaveError: class TimetableCloudSaveError extends Error {},
  loadPersonalTimetable: mocks.load,
  savePersonalTimetable: mocks.save,
  createServerShare: mocks.share,
  listMyMeetups: mocks.invites,
  loadFriendTimetable: mocks.friendTimetable,
  respondMeetup: vi.fn(),
  createMeetup: mocks.meetup,
}));
vi.mock('@/lib/timetable/friends', () => ({ listAcceptedFriends: mocks.friends }));
vi.mock('@/lib/useAcademicRecords', () => ({
  useAcademicRecords: () => ({
    state: {
      snapshot: {
        schoolId: 'pu',
        records: {
          courses: [
            {
              id: 'school-course',
              name: '匯入資料庫',
              periods: [3, 4],
              dayOfWeek: 2,
              teacherName: '林老師',
              location: '主顧303',
            },
          ],
        },
      },
    },
  }),
}));

function timetable(name = '原本課程') {
  return {
    courses: [cleanCourse({ id: 'existing', name, day: 1, start: 1, end: 2 })],
    meta: cleanMeta({ title: '我的課表' }),
    shareWithFriends: true,
    updatedAt: '2026-10-12T00:00:00Z',
    schoolId: 'pu',
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
const dialogDescriptors = ['showModal', 'close'].map(
  (name) => [name, Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, name)] as const,
);
beforeEach(() => {
  // Keep ClassExceptions / weekday defaults off Monday fixtures so the suite
  // does not flip when CI runs on a weekday that matches course dayOfWeek.
  vi.useFakeTimers({ now: new Date('2026-10-25T04:00:00.000Z'), toFake: ['Date'] });
  vi.clearAllMocks();
  mocks.auth.user = { uid: 'alice' };
  mocks.auth.loading = false;
  mocks.school.selectedSchoolId = 'pu';
  mocks.school.loading = false;
  mocks.records = [];
  mocks.load.mockReset().mockResolvedValue(timetable());
  mocks.save.mockReset().mockResolvedValue({ stored: 'cloud' });
  mocks.share
    .mockReset()
    .mockResolvedValue({ path: '/timetable/s/test', expiresAt: '2026-10-13T00:00:00Z' });
  mocks.friends.mockReset().mockResolvedValue([]);
  mocks.invites.mockResolvedValue([]);
  mocks.friendTimetable.mockReset().mockResolvedValue(null);
  mocks.meetup.mockReset().mockResolvedValue('created');
  // jsdom has no native top layer; these stubs exercise the component lifecycle, not browser focus containment.
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.setAttribute('open', '');
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.removeAttribute('open');
    },
  });
});
afterEach(() => {
  cleanup();
  if (clipboardDescriptor) Object.defineProperty(navigator, 'clipboard', clipboardDescriptor);
  else Reflect.deleteProperty(navigator, 'clipboard');
  for (const [name, descriptor] of dialogDescriptors) {
    if (descriptor) Object.defineProperty(HTMLDialogElement.prototype, name, descriptor);
    else Reflect.deleteProperty(HTMLDialogElement.prototype, name);
  }
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
async function ready() {
  const view = render(<PersonalTimetable />);
  await screen.findByRole('button', { name: '新增課程' });
  return view;
}
function addCourse(name = '不能消失的草稿') {
  fireEvent.click(screen.getByRole('button', { name: '新增課程' }));
  const editor = within(screen.getByRole('region', { name: '編輯課程' }));
  fireEvent.change(editor.getByLabelText('課名'), { target: { value: name } });
  return editor;
}
function existingCourseButton() {
  return screen.getAllByRole('button', { name: /編輯 原本課程/ })[0];
}

describe('personal timetable data retention', () => {
  it('previews the personal weekly timetable for the selected export period', async () => {
    await ready();
    fireEvent.change(screen.getByLabelText('匯出開始日期'), { target: { value: '2026-11-02' } });
    fireEvent.change(screen.getByLabelText('匯出結束日期'), { target: { value: '2026-11-08' } });
    expect(screen.getByText('將匯出 1 堂課；略過 0 門時間未確認的課程。')).toBeTruthy();
    expect((screen.getByText('下載課表 ICS') as HTMLButtonElement).disabled).toBe(false);
  });
  it('shows official school courses on the grid without waiting for a local import', async () => {
    mocks.load.mockResolvedValue({ ...timetable(), courses: [] });
    await ready();
    expect(screen.getAllByText('匯入資料庫').length).toBeGreaterThan(0);
  });

  it('opens an imported course in the currently viewed campus', async () => {
    mocks.records = [
      {
        id: 'imported',
        kind: 'timetable',
        title: '匯入課程',
        schoolId: 'pu',
        academicYear: '115',
        semester: '1',
        dayOfWeek: 2,
        startPeriod: 3,
        endPeriod: 4,
        batchId: 'test',
        importedAt: '2026-10-25T00:00:00Z',
        source: { type: 'paste', line: 1, rawText: '' },
      },
    ];
    await ready();
    fireEvent.click(screen.getAllByRole('button', { name: /檢視匯入紀錄 匯入課程/ })[0]);
    expect(mocks.push).toHaveBeenCalledWith('/import?kind=timetable&campus=pu');
  });

  it('starts with readable weekly courses on mobile and keeps an explicitly selected view', async () => {
    let compact = true;
    const listeners = new Set<() => void>();
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({
        get matches() {
          return compact;
        },
        addEventListener: (_event: string, listener: () => void) => listeners.add(listener),
        removeEventListener: (_event: string, listener: () => void) => listeners.delete(listener),
      })),
    );
    await ready();
    expect(
      screen.getByRole('button', { name: '一週' }).getAttribute('aria-pressed'),
    ).toBe('true');
    expect(
      within(screen.getByRole('region', { name: '一週課程' })).getAllByText('原本課程'),
    ).toHaveLength(1);
    expect(screen.queryByRole('region', { name: '課表捲動區' })).toBeNull();
    expect(screen.queryByRole('combobox', { name: '上課日' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '格子' }));
    expect(screen.getByRole('region', { name: '課表捲動區' })).toBeTruthy();
    for (const width of [false, true]) {
      await act(async () => {
        compact = width;
        for (const listener of listeners) listener();
      });
      expect(
        screen.getByRole('button', { name: '格子' }).getAttribute('aria-pressed'),
      ).toBe('true');
    }
    fireEvent.click(screen.getByRole('button', { name: '單日' }));
    expect(screen.getByRole('combobox', { name: '上課日' })).toBeTruthy();
  });

  it('keeps a newly saved manual course visible when adding it from an imported semester', async () => {
    mocks.records = [
      {
        id: 'imported',
        kind: 'timetable',
        title: '匯入課程',
        schoolId: 'pu',
        academicYear: '115',
        semester: '1',
        dayOfWeek: 2,
        startPeriod: 3,
        endPeriod: 4,
        batchId: 'test',
        importedAt: '2026-10-25T00:00:00Z',
        source: { type: 'paste', line: 1, rawText: '' },
      },
    ];
    await ready();
    expect((screen.getByLabelText('顯示自行匯入的學期') as HTMLSelectElement).value).toBe('115|1');
    const editor = addCourse('剛新增的統計學');
    fireEvent.click(editor.getByRole('button', { name: '儲存' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect((screen.getByLabelText('顯示自行匯入的學期') as HTMLSelectElement).value).toBe('manual');
    expect(screen.getAllByRole('button', { name: /編輯 剛新增的統計學/ }).length).toBeGreaterThan(
      0,
    );
    expect(screen.getByRole('status').textContent).toContain('已切換至手動課表');
  });

  it('keeps an unsuccessful edit, freezes its fields while saving, and allows retry', async () => {
    const pending = deferred<{ stored: 'cloud' }>();
    mocks.save.mockReturnValueOnce(pending.promise);
    await ready();
    const editor = addCourse();
    fireEvent.click(editor.getByRole('button', { name: '儲存' }));
    fireEvent.click(editor.getByRole('button', { name: '儲存' }));
    expect(mocks.save).toHaveBeenCalledOnce();
    expect((editor.getByLabelText('課名') as HTMLInputElement).disabled).toBe(true);
    expect((editor.getByRole('button', { name: '取消' }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => pending.reject(new Error('response lost')));
    expect((editor.getByLabelText('課名') as HTMLInputElement).value).toBe('不能消失的草稿');
    expect((editor.getByRole('button', { name: '儲存' }) as HTMLButtonElement).disabled).toBe(
      false,
    );
    expect(editor.getByRole('status').textContent).toContain('無法確認儲存結果');
    fireEvent.click(editor.getByRole('button', { name: '儲存' }));
    await waitFor(() => expect(screen.queryByRole('region', { name: '編輯課程' })).toBeNull());
    expect(mocks.save).toHaveBeenCalledTimes(2);
  });

  it('does not close the editor or remove the visible course after a failed deletion', async () => {
    mocks.save.mockRejectedValue(new Error('offline'));
    await ready();
    fireEvent.click(existingCourseButton());
    fireEvent.click(
      within(screen.getByRole('region', { name: '編輯課程' })).getByRole('button', {
        name: '刪除',
      }),
    );
    expect(mocks.save).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '確認刪除' }));
    await waitFor(() =>
      expect(
        within(screen.getByRole('region', { name: '編輯課程' })).getByRole('status').textContent,
      ).toMatch(/無法確認儲存結果/),
    );
    expect(screen.getByRole('region', { name: '編輯課程' })).toBeTruthy();
    expect(existingCourseButton()).toBeTruthy();
  });

  it('retains imported drafts when persistence fails and preserves the dedicated import entry point', async () => {
    mocks.save.mockRejectedValue(new Error('offline'));
    await ready();
    const section = within(screen.getByRole('region', { name: '匯入課表' }));
    expect(section.getByRole('link', { name: '匯入截圖或檔案' }).getAttribute('href')).toBe(
      '/import?kind=timetable&campus=pu',
    );
    fireEvent.click(section.getByRole('button', { name: '從學校課表帶入' }));
    expect(section.getByText('匯入資料庫')).toBeTruthy();
    fireEvent.click(section.getByRole('button', { name: '存在這台裝置' }));
    await waitFor(() => expect(screen.getAllByText(/無法確認儲存結果/).length).toBeGreaterThan(0));
    expect(section.getByText('匯入資料庫')).toBeTruthy();
    expect(existingCourseButton()).toBeTruthy();
  });

  it('does not replace the timetable with an empty selection', async () => {
    await ready();
    const section = within(screen.getByRole('region', { name: '匯入課表' }));
    fireEvent.click(section.getByRole('button', { name: '從學校課表帶入' }));
    fireEvent.click(section.getByRole('checkbox'));
    const confirm = section.getByRole('button', { name: '存在這台裝置' }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.click(confirm);
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it('shows a retryable read failure instead of an endless loading message', async () => {
    mocks.load.mockRejectedValueOnce(new Error('offline'));
    render(<PersonalTimetable />);
    expect((await screen.findByRole('alert')).textContent).toContain('無法讀取課表');
    expect(screen.queryByText('正在讀取你的課表…')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '重新讀取課表' }));
    await screen.findByRole('button', { name: '新增課程' });
    expect(mocks.load).toHaveBeenCalledTimes(2);
  });

  it('does not claim that local-only privacy changes have changed what friends can see', async () => {
    mocks.save.mockResolvedValue({ stored: 'local' });
    await ready();
    fireEvent.click(screen.getByRole('checkbox', { name: '讓已接受的好友看這份課表' }));
    await screen.findByText(/好友可見狀態仍以雲端資料為準/);
    expect(screen.queryByText(/對方現在看不到/)).toBeNull();
  });

  it('ignores an old account read that arrives after the next account has loaded', async () => {
    const old = deferred<ReturnType<typeof timetable>>();
    mocks.load.mockImplementation((uid: string) =>
      uid === 'alice' ? old.promise : Promise.resolve(timetable('新帳號課程')),
    );
    const view = render(<PersonalTimetable />);
    mocks.auth.user = { uid: 'bob' };
    view.rerender(<PersonalTimetable />);
    await screen.findAllByRole('button', { name: /新帳號課程/ });
    await act(async () => old.resolve(timetable('舊帳號私有課程')));
    expect(screen.queryByText('舊帳號私有課程')).toBeNull();
  });

  it('does not clear the next account draft when an earlier save settles', async () => {
    const pending = deferred<{ stored: 'cloud' }>();
    mocks.save.mockReturnValueOnce(pending.promise);
    const view = await ready();
    const oldEditor = addCourse('舊帳號草稿');
    fireEvent.click(oldEditor.getByRole('button', { name: '儲存' }));
    mocks.auth.user = { uid: 'bob' };
    view.rerender(<PersonalTimetable />);
    await screen.findByRole('button', { name: '新增課程' });
    const nextEditor = addCourse('新帳號草稿');
    await act(async () => pending.resolve({ stored: 'cloud' }));
    expect((nextEditor.getByLabelText('課名') as HTMLInputElement).value).toBe('新帳號草稿');
    expect(mocks.save.mock.calls[0][0]).toBe('alice');
  });

  it('does not load private or guest data while identity is unresolved', () => {
    mocks.auth.loading = true;
    render(<PersonalTimetable />);
    expect(screen.getByRole('status').textContent).toMatch(/正在確認(帳號|課表)/);
    expect(mocks.load).not.toHaveBeenCalled();
  });
});

describe('timetable share feedback', () => {
  it.each(['denied', 'unavailable'])(
    'retains a manual-copy link when clipboard is %s',
    async (mode) => {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value:
          mode === 'denied'
            ? { writeText: vi.fn().mockRejectedValue(new Error('not allowed')) }
            : undefined,
      });
      await ready();
      fireEvent.click(screen.getByRole('button', { name: '複製分享連結' }));
      await screen.findByText(/瀏覽器(未完成|無法自動)複製/);
      const input = screen.getByRole('textbox', { name: '分享連結' }) as HTMLInputElement;
      expect(input.value).toBe(`${window.location.origin}/timetable/s/test`);
      expect(input.readOnly).toBe(true);
      expect(screen.queryByText(shareCopiedCopy('2026-10-13T00:00:00Z'))).toBeNull();
    },
  );

  it('reports copied only after clipboard resolves and prevents repeated link creation', async () => {
    const pending = deferred<void>();
    const writeText = vi.fn(() => pending.promise);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    await ready();
    fireEvent.click(screen.getByRole('button', { name: '複製分享連結' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledOnce());
    const button = screen.getByRole('button', { name: '正在產生連結…' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(mocks.share).toHaveBeenCalledOnce();
    expect(screen.queryByText(shareCopiedCopy('2026-10-13T00:00:00Z'))).toBeNull();
    await act(async () => pending.resolve());
    expect(screen.getByText(shareCopiedCopy('2026-10-13T00:00:00Z'))).toBeTruthy();
  });

  it('does not tell a signed-in account that sharing is still disconnected', async () => {
    await ready();
    expect(screen.getByRole('button', { name: '複製分享連結' })).toBeTruthy();
    expect(screen.queryByText(/登入學校帳號後就能分享課表連結/)).toBeNull();
    expect(screen.queryByText(/網站的學校帳號登入還沒開放/)).toBeNull();
    expect(screen.queryByText(/這個功能還沒接通。分享連結/)).toBeNull();
    expect(screen.queryByRole('link', { name: '登入學校帳號' })).toBeNull();
  });

  it('does not copy an old account link after switching accounts', async () => {
    const pending = deferred<{ path: string; expiresAt: string }>();
    mocks.share.mockReturnValueOnce(pending.promise);
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    const view = await ready();
    fireEvent.click(screen.getByRole('button', { name: '複製分享連結' }));
    mocks.auth.user = { uid: 'bob' };
    view.rerender(<PersonalTimetable />);
    await screen.findByRole('button', { name: '新增課程' });
    await act(async () =>
      pending.resolve({ path: '/timetable/s/old-account', expiresAt: '2026-10-13T00:00:00Z' }),
    );
    expect(writeText).not.toHaveBeenCalled();
    expect(screen.queryByRole('textbox', { name: '分享連結' })).toBeNull();
  });
});

describe('direct timetable editing', () => {
  it('opens an empty cell with its day and period prefilled and focuses the course name', async () => {
    await ready();
    fireEvent.click(screen.getByRole('button', { name: `${WEEKDAY_LABELS[2]}第 7 節新增課程` }));
    const dialog = within(screen.getByRole('dialog', { name: '新增課程' }));
    expect((dialog.getByLabelText('星期') as HTMLSelectElement).value).toBe('3');
    expect((dialog.getByLabelText('開始節次') as HTMLSelectElement).value).toBe('7');
    expect((dialog.getByLabelText('結束節次') as HTMLSelectElement).value).toBe('7');
    expect((dialog.getByLabelText('課名') as HTMLInputElement).value).toBe('');
    expect(document.activeElement).toBe(dialog.getByLabelText('課名'));
    expect(dialog.queryByRole('button', { name: '刪除' })).toBeNull();
  });

  it('keeps continuation periods occupied and opens the original course', async () => {
    await ready();
    expect(
      screen.queryByRole('button', { name: `${WEEKDAY_LABELS[0]}第 2 節新增課程` }),
    ).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /編輯 原本課程.*第 2 節，續堂/ }));
    const editor = within(screen.getByRole('region', { name: '編輯課程' }));
    expect((editor.getByLabelText('開始節次') as HTMLSelectElement).value).toBe('1');
    expect((editor.getByLabelText('結束節次') as HTMLSelectElement).value).toBe('2');
    fireEvent.click(editor.getByRole('button', { name: '儲存' }));
    await waitFor(() => expect(mocks.save).toHaveBeenCalledOnce());
    expect(mocks.save.mock.calls[0][1].courses).toHaveLength(1);
    expect(mocks.save.mock.calls[0][1].courses[0].id).toBe('existing');
  });

  it('renders every overlapping course instead of hiding the later one', async () => {
    const stored = timetable();
    stored.courses.push(
      cleanCourse({ id: 'second', name: '重疊的課程', day: 1, start: 2, end: 3 }),
    );
    mocks.load.mockResolvedValue(stored);
    await ready();
    const table = within(screen.getByRole('table', { name: '一週格子課表' }));
    expect(table.getByText('同時有 2 門課')).toBeTruthy();
    expect(table.getByRole('button', { name: /原本課程.*第 2 節/ })).toBeTruthy();
    expect(table.getByRole('button', { name: /重疊的課程.*第 2 節/ })).toBeTruthy();
  });

  it('keeps unscheduled courses editable in every view', async () => {
    const stored = timetable();
    stored.courses.push(cleanCourse({ id: 'pending', name: '時間未定課程', day: 0 }));
    mocks.load.mockResolvedValue(stored);
    await ready();
    for (const view of ['格子', '一週', '單日']) {
      fireEvent.click(screen.getByRole('button', { name: view }));
      const pending = within(screen.getByRole('region', { name: '待排時間的課程' }));
      expect(pending.getByRole('button', { name: /時間未定課程/ })).toBeTruthy();
    }
    fireEvent.click(screen.getByRole('button', { name: /時間未定課程/ }));
    expect(
      (
        within(screen.getByRole('region', { name: '編輯課程' })).getByLabelText(
          '星期',
        ) as HTMLSelectElement
      ).value,
    ).toBe('0');
  });

  it('rejects a blank name without sending or replacing it with a placeholder', async () => {
    await ready();
    const editor = addCourse('   ');
    fireEvent.click(editor.getByRole('button', { name: '儲存' }));
    expect(mocks.save).not.toHaveBeenCalled();
    expect(editor.getByText('請填寫課程名稱。')).toBeTruthy();
    expect(document.activeElement?.getAttribute('name')).toBe('name');
  });

  it('rejects reversed periods and preserves the corrected range', async () => {
    await ready();
    const editor = addCourse('新課程');
    fireEvent.change(editor.getByLabelText('開始節次'), { target: { value: '5' } });
    fireEvent.change(editor.getByLabelText('結束節次'), { target: { value: '3' } });
    fireEvent.click(editor.getByRole('button', { name: '儲存' }));
    expect(mocks.save).not.toHaveBeenCalled();
    expect(editor.getByText('結束節次不能早於開始節次。')).toBeTruthy();
    fireEvent.change(editor.getByRole('combobox', { name: /結束節次/ }), {
      target: { value: '6' },
    });
    fireEvent.click(editor.getByRole('button', { name: '儲存' }));
    await waitFor(() => expect(mocks.save).toHaveBeenCalledOnce());
    expect(mocks.save.mock.calls[0][1].courses.at(-1)).toMatchObject({
      start: 5,
      end: 6,
      name: '新課程',
    });
  });

  it('asks before deleting and initially focuses the non-destructive action', async () => {
    await ready();
    fireEvent.click(existingCourseButton());
    fireEvent.click(screen.getByRole('button', { name: '刪除' }));
    const confirm = within(screen.getByRole('dialog', { name: '刪除這門課？' }));
    expect(mocks.save).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(confirm.getByRole('button', { name: '保留課程' }));
    fireEvent.click(confirm.getByRole('button', { name: '保留課程' }));
    expect(mocks.save).not.toHaveBeenCalled();
    expect(screen.getByRole('region', { name: '編輯課程' })).toBeTruthy();
  });

  it('keeps unsaved input until discarding is explicitly confirmed', async () => {
    await ready();
    const editor = addCourse('保留我的修改');
    fireEvent.click(editor.getByRole('button', { name: '取消' }));
    fireEvent.click(screen.getByRole('button', { name: '繼續編輯' }));
    expect((editor.getByLabelText('課名') as HTMLInputElement).value).toBe('保留我的修改');
    fireEvent.click(editor.getByRole('button', { name: '取消' }));
    fireEvent.click(screen.getByRole('button', { name: '放棄修改' }));
    expect(screen.queryByRole('region', { name: '編輯課程' })).toBeNull();
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it('uses the same discard guard for Escape and clears the reload guard on closing', async () => {
    await ready();
    addCourse('不要因 Escape 遺失');
    const before = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(before);
    expect(before.defaultPrevented).toBe(true);
    fireEvent(
      screen.getByRole('dialog', { name: '新增課程' }),
      new Event('cancel', { cancelable: true }),
    );
    expect(screen.getByRole('dialog', { name: '放棄這次修改？' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '放棄修改' }));
    const after = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(after);
    expect(after.defaultPrevented).toBe(false);
  });

  it('does not show an empty day as a broken or still-loading list', async () => {
    await ready();
    fireEvent.click(screen.getByRole('button', { name: '單日' }));
    fireEvent.change(screen.getByRole('combobox', { name: '上課日' }), { target: { value: '5' } });
    expect(screen.getByText(/還沒有課程，可使用上方/)).toBeTruthy();
  });

  it.each(['unavailable', 'failed'])(
    'does not treat a %s friend timetable as all-day availability',
    async (result) => {
      mocks.friends.mockResolvedValue([{ uid: 'bob', name: '小林' }]);
      if (result === 'failed') mocks.friendTimetable.mockRejectedValue(new Error('offline'));
      await ready();
      const select = await screen.findByRole('combobox', { name: '朋友' });
      fireEvent.change(select, { target: { value: 'bob' } });
      expect(screen.getByText(/不會把缺少資料誤判為整天空堂/)).toBeTruthy();
      expect(screen.queryByRole('button', { name: '約吃飯' })).toBeNull();
      expect(screen.queryByRole('button', { name: '約讀書' })).toBeNull();
      expect(mocks.meetup).not.toHaveBeenCalled();
    },
  );

  it('still offers invitations when both schedules are available', async () => {
    mocks.friends.mockResolvedValue([{ uid: 'bob', name: '小林' }]);
    mocks.friendTimetable.mockResolvedValue(timetable('好友課程'));
    await ready();
    fireEvent.change(await screen.findByRole('combobox', { name: '朋友' }), {
      target: { value: 'bob' },
    });
    expect(screen.getAllByRole('button', { name: '約吃飯' }).length).toBeGreaterThan(0);
  });
});
