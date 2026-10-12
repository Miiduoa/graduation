import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanCourse, cleanMeta, shareCopiedCopy } from '@campus/shared';
import { PersonalTimetable } from './PersonalTimetable';

const mocks = vi.hoisted(() => ({
  auth: { user: { uid: 'alice' } as { uid: string } | null, loading: false },
  school: { selectedSchoolId: 'pu', loading: false },
  load: vi.fn(), save: vi.fn(), share: vi.fn(),
  friends: vi.fn(), invites: vi.fn(),
}));
vi.mock('@/components/AuthGuard', () => ({ useAuth: () => mocks.auth }));
vi.mock('@/components/SelectedSchoolProvider', () => ({ useSelectedSchool: () => mocks.school }));
vi.mock('@/lib/timetable/store', () => ({
  loadPersonalTimetable: mocks.load,
  savePersonalTimetable: mocks.save,
  createServerShare: mocks.share,
  listMyMeetups: mocks.invites,
  loadFriendTimetable: vi.fn().mockResolvedValue(null),
  respondMeetup: vi.fn(), createMeetup: vi.fn(),
}));
vi.mock('@/lib/timetable/friends', () => ({ listAcceptedFriends: mocks.friends }));
vi.mock('@/lib/useAcademicRecords', () => ({
  useAcademicRecords: () => ({ state: { snapshot: { records: { courses: [
    { id: 'school-course', name: '匯入資料庫', periods: [3, 4], dayOfWeek: 2, teacherName: '林老師', location: '主顧303' },
  ] } } } }),
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
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.user = { uid: 'alice' };
  mocks.auth.loading = false;
  mocks.school.selectedSchoolId = 'pu';
  mocks.school.loading = false;
  mocks.load.mockReset().mockResolvedValue(timetable());
  mocks.save.mockReset().mockResolvedValue({ stored: 'cloud' });
  mocks.share.mockReset().mockResolvedValue({ path: '/timetable/share/test', expiresAt: '2026-10-13T00:00:00Z' });
  mocks.friends.mockResolvedValue([]);
  mocks.invites.mockResolvedValue([]);
});
afterEach(() => {
  cleanup();
  if (clipboardDescriptor) Object.defineProperty(navigator, 'clipboard', clipboardDescriptor);
  else Reflect.deleteProperty(navigator, 'clipboard');
  vi.restoreAllMocks();
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

describe('personal timetable data retention', () => {
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
    expect((editor.getByRole('button', { name: '儲存' }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByRole('status').textContent).toContain('無法確認儲存結果');
    fireEvent.click(editor.getByRole('button', { name: '儲存' }));
    await waitFor(() => expect(screen.queryByRole('region', { name: '編輯課程' })).toBeNull());
    expect(mocks.save).toHaveBeenCalledTimes(2);
  });

  it('does not close the editor or remove the visible course after a failed deletion', async () => {
    mocks.save.mockRejectedValue(new Error('offline'));
    await ready();
    fireEvent.click(screen.getByRole('button', { name: /原本課程/ }));
    fireEvent.click(within(screen.getByRole('region', { name: '編輯課程' })).getByRole('button', { name: '刪除' }));
    await screen.findByText(/無法確認儲存結果/);
    expect(screen.getByRole('region', { name: '編輯課程' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /原本課程/ })).toBeTruthy();
  });

  it('retains both imported drafts and pasted text when persistence fails', async () => {
    mocks.save.mockRejectedValue(new Error('offline'));
    await ready();
    const section = within(screen.getByRole('region', { name: '匯入課表' }));
    fireEvent.change(section.getByRole('textbox'), { target: { value: '我的原始課表文字' } });
    fireEvent.click(section.getByRole('button', { name: '從學校課表帶入' }));
    fireEvent.click(section.getByRole('button', { name: '確認匯入' }));
    await screen.findByText(/無法確認儲存結果/);
    expect(section.getByText('匯入資料庫')).toBeTruthy();
    expect((section.getByRole('textbox') as HTMLTextAreaElement).value).toBe('我的原始課表文字');
    expect(screen.getByRole('button', { name: /原本課程/ })).toBeTruthy();
  });

  it('does not replace the timetable with an empty selection', async () => {
    await ready();
    const section = within(screen.getByRole('region', { name: '匯入課表' }));
    fireEvent.click(section.getByRole('button', { name: '從學校課表帶入' }));
    fireEvent.click(section.getByRole('checkbox'));
    const confirm = section.getByRole('button', { name: '確認匯入' }) as HTMLButtonElement;
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
    mocks.load.mockImplementation((uid: string) => uid === 'alice' ? old.promise : Promise.resolve(timetable('新帳號課程')));
    const view = render(<PersonalTimetable />);
    mocks.auth.user = { uid: 'bob' };
    view.rerender(<PersonalTimetable />);
    await screen.findByRole('button', { name: /新帳號課程/ });
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
    expect(screen.getByRole('status').textContent).toContain('正在確認帳號');
    expect(mocks.load).not.toHaveBeenCalled();
  });
});

describe('timetable share feedback', () => {
  it.each(['denied', 'unavailable'])('retains a manual-copy link when clipboard is %s', async (mode) => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: mode === 'denied' ? { writeText: vi.fn().mockRejectedValue(new Error('not allowed')) } : undefined,
    });
    await ready();
    fireEvent.click(screen.getByRole('button', { name: '複製分享連結' }));
    await screen.findByText(/瀏覽器未完成複製/);
    const input = screen.getByRole('textbox', { name: '分享連結' }) as HTMLInputElement;
    expect(input.value).toBe(`${window.location.origin}/timetable/share/test`);
    expect(input.readOnly).toBe(true);
    expect(screen.queryByText(shareCopiedCopy('2026-10-13T00:00:00Z'))).toBeNull();
  });

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
    await act(async () => pending.resolve({ path: '/timetable/share/old-account', expiresAt: '2026-10-13T00:00:00Z' }));
    expect(writeText).not.toHaveBeenCalled();
    expect(screen.queryByRole('textbox', { name: '分享連結' })).toBeNull();
  });
});
