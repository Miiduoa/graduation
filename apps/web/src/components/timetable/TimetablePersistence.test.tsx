import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanCourse, cleanMeta } from '@campus/shared';
import { PersonalTimetable } from './PersonalTimetable';

const mocks = vi.hoisted(() => ({ load: vi.fn(), save: vi.fn() }));
vi.mock('@/components/AuthGuard', () => ({ useAuth: () => ({ user: { uid: 'alice' }, loading: false }) }));
vi.mock('@/components/SelectedSchoolProvider', () => ({ useSelectedSchool: () => ({ selectedSchoolId: 'pu', loading: false }) }));
vi.mock('@/lib/timetable/store', () => ({
  loadPersonalTimetable: mocks.load, savePersonalTimetable: mocks.save,
  loadFriendTimetable: vi.fn(), createMeetup: vi.fn(), createServerShare: vi.fn(),
  listMyMeetups: vi.fn(async () => []), respondMeetup: vi.fn(),
}));
vi.mock('@/lib/timetable/friends', () => ({ listAcceptedFriends: vi.fn(async () => []) }));
vi.mock('@/lib/useAcademicRecords', () => ({ useAcademicRecords: () => ({ state: null }) }));

const descriptors = ['showModal', 'close'].map((name) => [name, Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, name)] as const);
beforeEach(() => {
  vi.clearAllMocks();
  mocks.load.mockResolvedValue({
    courses: [cleanCourse({ id: 'database', name: '資料庫', day: 1, start: 3, end: 4 })],
    schoolId: 'pu', meta: cleanMeta({}), shareWithFriends: true, updatedAt: '2026-10-12T00:00:00Z',
  });
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: function (this: HTMLDialogElement) { this.setAttribute('open', ''); } });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value: function (this: HTMLDialogElement) { this.removeAttribute('open'); } });
});
afterEach(() => {
  cleanup();
  for (const [name, descriptor] of descriptors) {
    if (descriptor) Object.defineProperty(HTMLDialogElement.prototype, name, descriptor);
    else Reflect.deleteProperty(HTMLDialogElement.prototype, name);
  }
});

describe('local persistence and cloud sync feedback', () => {
  it('shows the locally saved version without claiming the cloud was updated', async () => {
    const cloudError = new Error('timetable-cloud-save-failed');
    cloudError.name = 'TimetableCloudSaveError';
    mocks.save.mockRejectedValue(cloudError);
    render(<PersonalTimetable />);
    fireEvent.click(await screen.findByRole('button', { name: /編輯 資料庫.*第 3 節/ }));
    const editor = within(screen.getByRole('region', { name: '編輯課程' }));
    fireEvent.change(editor.getByLabelText('課名'), { target: { value: '資料庫實習' } });
    fireEvent.click(editor.getByRole('button', { name: '儲存' }));
    await screen.findByText(/這次雲端同步沒有成功/);
    expect(screen.queryByRole('region', { name: '編輯課程' })).toBeNull();
    expect(screen.getByRole('button', { name: /編輯 資料庫實習.*第 3 節/ })).toBeTruthy();
    expect(screen.queryByText('課程已更新。')).toBeNull();
    expect(mocks.save).toHaveBeenCalledOnce();
  });

  it('keeps the draft open when neither local nor cloud persistence is confirmed', async () => {
    mocks.save.mockRejectedValue(new Error('storage-unavailable'));
    render(<PersonalTimetable />);
    fireEvent.click(await screen.findByRole('button', { name: /編輯 資料庫.*第 3 節/ }));
    const editor = within(screen.getByRole('region', { name: '編輯課程' }));
    fireEvent.change(editor.getByLabelText('課名'), { target: { value: '未儲存的課名' } });
    fireEvent.click(editor.getByRole('button', { name: '儲存' }));
    await waitFor(() => expect(editor.getByRole('status').textContent).toContain('無法確認儲存結果'));
    expect((editor.getByLabelText('課名') as HTMLInputElement).value).toBe('未儲存的課名');
    expect(screen.queryByRole('button', { name: /編輯 未儲存的課名/ })).toBeNull();
  });
});
