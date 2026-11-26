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
  courseTimeLabel,
  shareCopiedCopy,
  WEEKDAY_LABELS,
  type PersonalImportRecord,
} from '@campus/shared';
import { TimetableCloudSaveError } from '@/lib/timetable/store';
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
function chooseImportEdit() {
  fireEvent.click(screen.getByRole('button', { name: '回到匯入編輯' }));
}

function activateCourseWork(link: HTMLElement, gesture: MouseEventInit = {}) {
  const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ...gesture });
  let preventedByEditor = false;
  const preventJsdomNavigation = (click: Event) => {
    if (click !== event) return;
    // Observe the real link handler before stopping jsdom's document navigation.
    preventedByEditor = click.defaultPrevented;
    click.preventDefault();
  };
  document.addEventListener('click', preventJsdomNavigation);
  try {
    fireEvent(link, event);
  } finally {
    document.removeEventListener('click', preventJsdomNavigation);
  }
  return preventedByEditor;
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
    expect(screen.getByRole('link', { name: '作業與教材' })).toBeTruthy();
    chooseImportEdit();
    expect(mocks.push).toHaveBeenCalledWith('/import?kind=timetable&campus=pu');
  });

  it('offers a course-work exit beside timetable editing for a placed course', async () => {
    await ready();
    fireEvent.click(existingCourseButton());
    expect(screen.getByRole('region', { name: '編輯課程' })).toBeTruthy();
    const exit = within(screen.getByTestId('timetable-course-work-exit'));
    expect(exit.getByRole('link', { name: '作業與教材' }).getAttribute('href')).toBe(
      '/classroom?q=%E5%8E%9F%E6%9C%AC%E8%AA%B2%E7%A8%8B&from=timetable',
    );
  });

  it('keeps a renamed draft until confirmation, then opens the original saved course', async () => {
    await ready();
    fireEvent.click(existingCourseButton());
    const editor = within(screen.getByRole('region', { name: '編輯課程' }));
    fireEvent.change(editor.getByLabelText('課名'), { target: { value: '修改後的課名' } });
    fireEvent.change(editor.getByLabelText('教室'), { target: { value: '主顧 303' } });
    const exit = editor.getByRole('link', { name: '作業與教材' });
    const destination = '/classroom?q=%E5%8E%9F%E6%9C%AC%E8%AA%B2%E7%A8%8B&from=timetable';
    expect(exit.getAttribute('href')).toBe(destination);

    expect(activateCourseWork(exit)).toBe(true);
    const confirmation = within(screen.getByRole('dialog', { name: '放棄修改並開啟課業？' }));
    expect(document.activeElement).toBe(confirmation.getByRole('button', { name: '繼續編輯' }));
    expect(mocks.push).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
    fireEvent.click(confirmation.getByRole('button', { name: '繼續編輯' }));
    expect(document.activeElement).toBe(exit);
    expect((editor.getByLabelText('課名') as HTMLInputElement).value).toBe('修改後的課名');
    expect((editor.getByLabelText('教室') as HTMLInputElement).value).toBe('主顧 303');

    expect(activateCourseWork(exit)).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '放棄修改並開啟' }));
    expect(mocks.push).toHaveBeenCalledExactlyOnceWith(destination);
    expect(mocks.save).not.toHaveBeenCalled();
    expect(screen.queryByRole('region', { name: '編輯課程' })).toBeNull();
    const unload = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(false);
  });

  it.each(['', '   '])('keeps the saved course entry when its draft name is blank (%j)', async (name) => {
    await ready();
    fireEvent.click(existingCourseButton());
    const editor = within(screen.getByRole('region', { name: '編輯課程' }));
    fireEvent.change(editor.getByLabelText('課名'), { target: { value: name } });
    const exit = editor.getByRole('link', { name: '作業與教材' });
    const destination = '/classroom?q=%E5%8E%9F%E6%9C%AC%E8%AA%B2%E7%A8%8B&from=timetable';
    expect(exit.getAttribute('href')).toBe(destination);
    expect(activateCourseWork(exit)).toBe(true);
    expect(mocks.push).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '放棄修改並開啟' }));
    expect(mocks.push).toHaveBeenCalledExactlyOnceWith(destination);
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it('uses a new unsaved course name for its search entry and hides that entry when blank', async () => {
    await ready();
    const editor = addCourse('新課程草稿');
    const exit = editor.getByRole('link', { name: '作業與教材' });
    const destination = new URL(exit.getAttribute('href')!, 'https://campus.local');
    expect(destination.pathname).toBe('/classroom');
    expect(destination.searchParams.get('q')).toBe('新課程草稿');
    expect(destination.searchParams.get('from')).toBe('timetable');
    fireEvent.change(editor.getByLabelText('課名'), { target: { value: '' } });
    expect(editor.queryByRole('link', { name: '作業與教材' })).toBeNull();
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it('cancels only the coursework departure when Escape closes its confirmation', async () => {
    await ready();
    const editor = addCourse('保留這門新課');
    const exit = editor.getByRole('link', { name: '作業與教材' });
    activateCourseWork(exit);
    fireEvent(
      screen.getByRole('dialog', { name: '放棄修改並開啟課業？' }),
      new Event('cancel', { cancelable: true }),
    );
    expect(screen.queryByRole('dialog', { name: '放棄修改並開啟課業？' })).toBeNull();
    expect((editor.getByLabelText('課名') as HTMLInputElement).value).toBe('保留這門新課');
    expect(document.activeElement).toBe(exit);
    expect(mocks.push).not.toHaveBeenCalled();
    const unload = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(true);
  });

  it('lets an unchanged course open coursework without a discard prompt', async () => {
    await ready();
    fireEvent.click(existingCourseButton());
    expect(activateCourseWork(screen.getByRole('link', { name: '作業與教材' }))).toBe(false);
    expect(screen.queryByRole('dialog', { name: '放棄修改並開啟課業？' })).toBeNull();
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it.each([
    { label: 'Command', gesture: { metaKey: true }, target: '' },
    { label: 'Control', gesture: { ctrlKey: true }, target: '' },
    { label: 'Shift', gesture: { shiftKey: true }, target: '' },
    { label: 'middle button', gesture: { button: 1 }, target: '' },
    { label: 'new tab target', gesture: {}, target: '_blank' },
  ])('preserves the draft and browser intent for a $label coursework link', async ({ gesture, target }) => {
    await ready();
    const editor = addCourse('留在原分頁的草稿');
    const exit = editor.getByRole('link', { name: '作業與教材' });
    if (target) exit.setAttribute('target', target);
    expect(activateCourseWork(exit, gesture)).toBe(false);
    expect(screen.queryByRole('dialog', { name: '放棄修改並開啟課業？' })).toBeNull();
    expect((editor.getByLabelText('課名') as HTMLInputElement).value).toBe('留在原分頁的草稿');
    expect(mocks.push).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it('keeps a cancelled coursework click from opening a discard confirmation', async () => {
    await ready();
    const editor = addCourse('不要執行取消的導覽');
    const event = new MouseEvent('click', { bubbles: true, cancelable: true });
    event.preventDefault();
    fireEvent(editor.getByRole('link', { name: '作業與教材' }), event);
    expect(screen.queryByRole('dialog', { name: '放棄修改並開啟課業？' })).toBeNull();
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it('blocks coursework departure during a save and restores the choice after a failed save', async () => {
    const saving = deferred<{ stored: 'cloud' }>();
    mocks.save.mockReturnValueOnce(saving.promise);
    await ready();
    const editor = addCourse('儲存中不能離開');
    const exit = editor.getByRole('link', { name: '作業與教材' });
    fireEvent.click(editor.getByRole('button', { name: '儲存' }));
    expect(exit.getAttribute('aria-disabled')).toBe('true');
    expect(activateCourseWork(exit)).toBe(true);
    expect(screen.queryByRole('dialog', { name: '放棄修改並開啟課業？' })).toBeNull();
    expect(mocks.push).not.toHaveBeenCalled();
    expect(mocks.save).toHaveBeenCalledOnce();

    await act(async () => { saving.reject(new Error('offline')); });
    expect(exit.hasAttribute('aria-disabled')).toBe(false);
    expect((editor.getByLabelText('課名') as HTMLInputElement).value).toBe('儲存中不能離開');
    expect(mocks.push).not.toHaveBeenCalled();
    expect(activateCourseWork(exit)).toBe(true);
    expect(screen.getByRole('dialog', { name: '放棄修改並開啟課業？' })).toBeTruthy();
  });

  it('opens linked course work directly when the imported row has linkedCourseId', async () => {
    mocks.records = [
      {
        id: 'imported',
        kind: 'timetable',
        title: '匯入課程',
        courseCode: 'CS301',
        schoolId: 'pu',
        academicYear: '115',
        semester: '1',
        dayOfWeek: 2,
        startPeriod: 3,
        endPeriod: 4,
        batchId: 'test',
        importedAt: '2026-10-25T00:00:00Z',
        linkedCourseId: 'cw_11111111-1111-4111-8111-111111111111',
        source: { type: 'paste', line: 1, rawText: '' },
      },
    ];
    await ready();
    fireEvent.click(screen.getAllByRole('button', { name: /檢視匯入紀錄 匯入課程/ })[0]);
    expect(screen.getByRole('link', { name: '作業與教材' }).getAttribute('href')).toBe(
      '/classroom/course/cw_11111111-1111-4111-8111-111111111111',
    );
  });

  it('searches classroom by course name and code when the import has no linkedCourseId', async () => {
    mocks.records = [
      {
        id: 'imported',
        kind: 'timetable',
        title: '匯入課程',
        courseCode: 'CS301',
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
    expect(screen.getByRole('link', { name: '作業與教材' }).getAttribute('href')).toBe(
      '/classroom?q=%E5%8C%AF%E5%85%A5%E8%AA%B2%E7%A8%8B&from=timetable&code=CS301',
    );
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

  it('groups the week by weekday and identifies each course by its time and room', async () => {
    await ready();
    fireEvent.click(screen.getByRole('button', { name: '一週' }));
    const week = within(screen.getByRole('region', { name: '一週課程' }));
    expect(week.getAllByRole('heading').map((heading) => heading.textContent)).toEqual(
      WEEKDAY_LABELS,
    );
    // Empty weekdays stay visible, without placeholder course rows.
    expect(week.getAllByText('尚無已排課程')).toHaveLength(WEEKDAY_LABELS.length - 2);
    const time = courseTimeLabel({ day: 1, start: 1, end: 2 }, 'pu');
    const row = week.getByRole('button', { name: `編輯 原本課程，${WEEKDAY_LABELS[0]} ${time}，教室未填` });
    expect(Array.from(row.querySelectorAll('time'), (clock) => clock.dateTime).join('–')).toBe(time);
    expect(row.textContent).toContain('教室未填');
    const school = week.getByRole('button', {
      name: `編輯 匯入資料庫，${WEEKDAY_LABELS[1]} ${courseTimeLabel({ day: 2, start: 3, end: 4 }, 'pu')}，教室 主顧303，教師 林老師`,
    });
    expect(school.textContent).toContain('主顧303 · 林老師');
    fireEvent.click(row);
    expect(screen.getByRole('region', { name: '編輯課程' })).toBeTruthy();
  });

  it('uses the same agenda rows and verified time labels in the single-day view', async () => {
    await ready();
    fireEvent.click(screen.getByRole('button', { name: '一週' }));
    const weekRow = within(screen.getByRole('region', { name: '一週課程' })).getByRole('button', {
      name: /原本課程/,
    });
    fireEvent.click(screen.getByRole('button', { name: '單日' }));
    expect(screen.queryByRole('region', { name: '一週課程' })).toBeNull();
    const day = within(screen.getByRole('region', { name: '單日課程' }));
    expect(day.getAllByRole('heading').map((heading) => heading.textContent)).toEqual([
      WEEKDAY_LABELS[0],
    ]);
    const row = day.getByRole('button', { name: /編輯 原本課程/ });
    expect(row.getAttribute('aria-label')).toBe(weekRow.getAttribute('aria-label'));
    expect(row.querySelector('time')?.textContent).toBe(
      weekRow.querySelector('time')?.textContent,
    );
    fireEvent.change(screen.getByRole('combobox', { name: '上課日' }), { target: { value: '2' } });
    expect(
      within(screen.getByRole('region', { name: '單日課程' })).getByRole('button', {
        name: /編輯 匯入資料庫/,
      }),
    ).toBeTruthy();
    fireEvent.change(screen.getByRole('combobox', { name: '上課日' }), { target: { value: '4' } });
    expect(screen.getByText('這天尚無已排定的課程。')).toBeTruthy();
    expect(screen.queryAllByRole('button', { name: /^編輯 / })).toHaveLength(0);
  });

  it('keeps imported agenda rows as an import-record action in week and day views', async () => {
    mocks.records = [
      {
        id: 'imported',
        kind: 'timetable',
        title: '匯入課程',
        schoolId: 'pu',
        academicYear: '115',
        semester: '1',
        dayOfWeek: 3,
        startPeriod: 5,
        endPeriod: 6,
        teacher: '王老師',
        location: 'M101',
        batchId: 'test',
        importedAt: '2026-10-25T00:00:00Z',
        source: { type: 'paste', line: 1, rawText: '' },
      },
    ];
    await ready();
    for (const view of ['一週', '單日']) {
      fireEvent.click(screen.getByRole('button', { name: view }));
      if (view === '單日')
        fireEvent.change(screen.getByRole('combobox', { name: '上課日' }), { target: { value: '3' } });
      const row = screen.getByRole('button', { name: /檢視匯入紀錄 匯入課程，.*教室 M101，教師 王老師/ });
      expect(row.textContent).toContain('M101 · 王老師');
    }
    fireEvent.click(screen.getByRole('button', { name: /檢視匯入紀錄 匯入課程/ }));
    chooseImportEdit();
    expect(mocks.push).toHaveBeenCalledWith('/import?kind=timetable&campus=pu');
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
    expect(document.activeElement).toBe(screen.getAllByRole('button', { name: /編輯 剛新增的統計學/ })[0]);
    const savedNotice = screen.getByText(/已切換至手動課表/);
    expect(savedNotice.getAttribute('role')).toBe('status');
    expect(savedNotice.textContent).toContain('課程已更新。');
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
    expect(document.activeElement).toBe(nextEditor.getByLabelText('課名'));
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
    expect(screen.getByText('這天尚無已排定的課程。')).toBeTruthy();
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

describe('focus after confirmed timetable changes', () => {
  const saveEditor = () =>
    fireEvent.click(
      within(screen.getByRole('region', { name: '編輯課程' })).getByRole('button', { name: '儲存' }),
    );
  const editorClosed = () => waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  const savedButton = (name: string) => screen.getAllByRole('button', { name: new RegExp(`編輯 ${name}`) })[0];

  it('focuses the first grid period of an edited course, not its focused continuation opener', async () => {
    await ready();
    const opener = screen.getByRole('button', { name: /編輯 原本課程.*第 2 節，續堂/ });
    opener.focus();
    fireEvent.click(opener);
    fireEvent.change(screen.getByLabelText('課名'), { target: { value: '改名課程' } });
    saveEditor();
    await editorClosed();
    expect(document.activeElement).toBe(savedButton('改名課程'));
    expect(document.activeElement?.getAttribute('aria-label')).not.toContain('續堂');
  });

  it('focuses a new course after its empty-cell opener disappears', async () => {
    await ready();
    const opener = screen.getByRole('button', { name: `${WEEKDAY_LABELS[2]}第 7 節新增課程` });
    opener.focus();
    fireEvent.click(opener);
    fireEvent.change(screen.getByLabelText('課名'), { target: { value: '新格位課程' } });
    saveEditor();
    await editorClosed();
    expect(opener.isConnected).toBe(false);
    expect(document.activeElement).toBe(savedButton('新格位課程'));
  });

  it('focuses the saved course in the week list', async () => {
    await ready();
    fireEvent.click(screen.getByRole('button', { name: '一週' }));
    const opener = screen.getByRole('button', { name: '新增課程' });
    opener.focus();
    addCourse('一週新課');
    saveEditor();
    await editorClosed();
    const week = screen.getByRole('region', { name: '一週課程' });
    expect(document.activeElement).toBe(within(week).getByRole('button', { name: /一週新課/ }));
  });

  it('shows the changed day before focusing a course in the single-day view', async () => {
    await ready();
    fireEvent.click(screen.getByRole('button', { name: '單日' }));
    fireEvent.click(screen.getByRole('button', { name: /原本課程/ }));
    fireEvent.change(within(screen.getByRole('region', { name: '編輯課程' })).getByLabelText('星期'), {
      target: { value: '3' },
    });
    saveEditor();
    await editorClosed();
    expect((screen.getByLabelText('上課日') as HTMLSelectElement).value).toBe('3');
    const saved = screen.getByRole('button', { name: /原本課程/ });
    expect(document.activeElement).toBe(saved);
  });

  it.each([
    ['device-only', () => mocks.save.mockResolvedValue({ stored: 'local' }), /已存在這台裝置/],
    [
      'cloud-failed',
      () => mocks.save.mockRejectedValue(new TimetableCloudSaveError('cloud')),
      /雲端同步沒有成功/,
    ],
  ])('keeps the %s receipt visible while focusing the saved course', async (_name, arrange, receipt) => {
    arrange();
    await ready();
    addCourse('保留收據課程');
    saveEditor();
    await editorClosed();
    expect(screen.getByRole('status').textContent).toMatch(receipt);
    expect(document.activeElement).toBe(savedButton('保留收據課程'));
  });

  it('focuses the stable add action after a confirmed deletion', async () => {
    await ready();
    const opener = savedButton('原本課程');
    opener.focus();
    fireEvent.click(opener);
    fireEvent.click(screen.getByRole('button', { name: '刪除' }));
    fireEvent.click(screen.getByRole('button', { name: '確認刪除' }));
    await editorClosed();
    expect(screen.queryByRole('button', { name: /編輯 原本課程/ })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '新增課程' }));
  });

  it('returns focus to the empty timetable action after deleting the only course', async () => {
    mocks.school.selectedSchoolId = 'ncku';
    mocks.load.mockResolvedValue({ ...timetable(), schoolId: 'ncku' });
    await ready();
    fireEvent.click(screen.getByRole('button', { name: '一週' }));
    const week = within(screen.getByRole('region', { name: '一週課程' }));
    fireEvent.click(week.getByRole('button', { name: /編輯 原本課程/ }));
    fireEvent.click(screen.getByRole('button', { name: '刪除' }));
    fireEvent.click(screen.getByRole('button', { name: '確認刪除' }));
    await editorClosed();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '手動新增課程' }));
  });

  it('keeps default focus restoration when an unchanged editor is cancelled', async () => {
    await ready();
    const opener = savedButton('原本課程');
    opener.focus();
    fireEvent.click(opener);
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it('keeps focus in the editor for validation and failed saves', async () => {
    mocks.save.mockRejectedValueOnce(new Error('response lost'));
    await ready();
    const editor = addCourse('');
    fireEvent.click(editor.getByRole('button', { name: '儲存' }));
    const name = editor.getByRole('textbox', { name: /課名/ });
    expect(document.activeElement).toBe(name);
    fireEvent.change(name, { target: { value: '失敗後保留' } });
    fireEvent.click(editor.getByRole('button', { name: '儲存' }));
    await waitFor(() => expect(editor.getByRole('status').textContent).toMatch(/無法確認儲存結果/));
    expect(screen.getByRole('region', { name: '編輯課程' })).toBeTruthy();
    expect(document.activeElement).toBe(name);
    expect(mocks.save).toHaveBeenCalledOnce();
  });
});
