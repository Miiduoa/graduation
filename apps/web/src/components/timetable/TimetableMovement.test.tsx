import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanCourse, cleanMeta, WEEKDAY_LABELS, PERIOD_TIMES } from '@campus/shared';
import { TimetableGrid } from './TimetableGrid';
import { PersonalTimetable } from './PersonalTimetable';

const mocks = vi.hoisted(() => ({ load: vi.fn(), save: vi.fn(), friends: vi.fn(), friend: vi.fn(), meetups: vi.fn() }));
vi.mock('@/components/AuthGuard', () => ({ useAuth: () => ({ user: { uid: 'alice' }, loading: false }) }));
vi.mock('@/components/SelectedSchoolProvider', () => ({ useSelectedSchool: () => ({ selectedSchoolId: 'pu', loading: false }) }));
vi.mock('@/lib/timetable/store', () => ({ loadPersonalTimetable: mocks.load, savePersonalTimetable: mocks.save,
  loadFriendTimetable: mocks.friend, createMeetup: mocks.meetups, createServerShare: vi.fn(),
  listMyMeetups: vi.fn(async () => []), respondMeetup: vi.fn() }));
vi.mock('@/lib/timetable/friends', () => ({ listAcceptedFriends: mocks.friends }));
vi.mock('@/lib/useAcademicRecords', () => ({ useAcademicRecords: () => ({ state: null }) }));

const course = cleanCourse({ id: 'database', name: '資料庫', day: 1, start: 3, end: 5 });
function stored(courses = [course], schoolId = 'pu') {
  return { courses, schoolId, meta: cleanMeta({}), shareWithFriends: true, updatedAt: '2026-10-12T00:00:00Z' };
}
const descriptors = ['showModal', 'close'].map((name) => [name, Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, name)] as const);
beforeEach(() => {
  vi.clearAllMocks();
  mocks.load.mockResolvedValue(stored()); mocks.save.mockResolvedValue({ stored: 'cloud' });
  mocks.friends.mockResolvedValue([]); mocks.friend.mockResolvedValue(null);
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
function chooseMove() {
  fireEvent.click(screen.getByRole('button', { name: '移動課程' }));
  fireEvent.change(screen.getByRole('combobox', { name: '要移動的課程' }), { target: { value: course.id } });
}
function transfer() { return { setData: vi.fn(), effectAllowed: '', dropEffect: '' }; }

describe('timetable movement controls', () => {
  it('offers a non-dragging path and only opens a draft', () => {
    const edit = vi.fn(); render(<TimetableGrid courses={[course]} disabled={false} onEdit={edit} />);
    chooseMove(); fireEvent.click(screen.getByRole('button', { name: `移到${WEEKDAY_LABELS[1]}第 6 節` }));
    expect(edit).toHaveBeenCalledExactlyOnceWith({ ...course, day: 2, start: 6, end: 8 });
    expect(course).toMatchObject({ day: 1, start: 3, end: 5 });
  });
  it('rejects a move that would shorten the course', () => {
    const edit = vi.fn(); render(<TimetableGrid courses={[course]} disabled={false} onEdit={edit} />);
    chooseMove(); fireEvent.click(screen.getByRole('button', { name: `移到${WEEKDAY_LABELS[1]}第 ${PERIOD_TIMES.length} 節` }));
    expect(edit).not.toHaveBeenCalled(); expect(screen.getByRole('status').textContent).toContain('放不下');
  });
  it('preserves the grab offset when dragging a continuation period', () => {
    const edit = vi.fn(); render(<TimetableGrid courses={[course]} disabled={false} onEdit={edit} />);
    const dataTransfer = transfer();
    fireEvent.dragStart(screen.getByRole('button', { name: /編輯 資料庫.*第 4 節，續堂/ }), { dataTransfer });
    const target = document.querySelector('[data-day="2"][data-period="7"]')!;
    fireEvent.dragOver(target, { dataTransfer }); fireEvent.drop(target, { dataTransfer });
    expect(edit).toHaveBeenCalledExactlyOnceWith({ ...course, day: 2, start: 6, end: 8 });
  });
  it('does not accept externally supplied drag data', () => {
    const edit = vi.fn(); render(<TimetableGrid courses={[course]} disabled={false} onEdit={edit} />);
    fireEvent.drop(document.querySelector('[data-day="2"][data-period="7"]')!, { dataTransfer: transfer() });
    expect(edit).not.toHaveBeenCalled();
  });
  it('cancels selection with Escape and restores focus', () => {
    const edit = vi.fn(); render(<TimetableGrid courses={[course]} disabled={false} onEdit={edit} />);
    chooseMove(); fireEvent.keyDown(screen.getByRole('region', { name: '課表捲動區' }), { key: 'Escape' });
    expect(screen.queryByRole('combobox', { name: '要移動的課程' })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '移動課程' })); expect(edit).not.toHaveBeenCalled();
  });
  it('does not use an outdated selection after the course changes', () => {
    const edit = vi.fn(); const view = render(<TimetableGrid courses={[course]} disabled={false} onEdit={edit} />);
    chooseMove(); view.rerender(<TimetableGrid courses={[{ ...course, end: 6 }]} disabled={false} onEdit={edit} />);
    expect(screen.queryByRole('button', { name: `移到${WEEKDAY_LABELS[1]}第 6 節` })).toBeNull();
    expect(edit).not.toHaveBeenCalled();
  });
  it('disables moves during persistence', () => {
    const edit = vi.fn(); render(<TimetableGrid courses={[course]} disabled onEdit={edit} />);
    expect((screen.getByRole('button', { name: '移動課程' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: /編輯 資料庫.*第 3 節/ }) as HTMLButtonElement).draggable).toBe(false);
  });
});

describe('workspace safety', () => {
  it('requires confirmation before saving or discarding a moved draft', async () => {
    render(<PersonalTimetable />); await screen.findByRole('button', { name: '移動課程' });
    chooseMove(); fireEvent.click(screen.getByRole('button', { name: `移到${WEEKDAY_LABELS[1]}第 6 節` }));
    expect(mocks.save).not.toHaveBeenCalled();
    const editor = within(screen.getByRole('region', { name: '編輯課程' }));
    expect((editor.getByLabelText('開始節次') as HTMLSelectElement).value).toBe('6');
    fireEvent.click(editor.getByRole('button', { name: '取消' }));
    expect(screen.getByRole('dialog', { name: '放棄這次修改？' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '繼續編輯' }));
    fireEvent.click(editor.getByRole('button', { name: '儲存' }));
    await waitFor(() => expect(mocks.save).toHaveBeenCalledOnce());
    expect(mocks.save.mock.calls[0][1].courses).toEqual([{ ...course, day: 2, start: 6, end: 8 }]);
  });
  it.each(['empty', 'partial'])('blocks planning and invitations for a %s own timetable', async (mode) => {
    mocks.load.mockResolvedValue(stored(mode === 'empty' ? [] : [course, { ...course, id: 'pending', day: 0 }]));
    mocks.friends.mockResolvedValue([{ uid: 'bob', name: '小林' }]); mocks.friend.mockResolvedValue(stored());
    render(<PersonalTimetable />); await screen.findByRole('button', { name: '新增課程' });
    expect((screen.getByRole('button', { name: '今天空堂' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: '排讀書時間' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(await screen.findByRole('combobox', { name: '朋友' }), { target: { value: 'bob' } });
    expect(screen.queryByRole('button', { name: '約吃飯' })).toBeNull(); expect(mocks.meetups).not.toHaveBeenCalled();
  });
  it.each(['partial', 'other-campus'])('does not offer availability from a %s friend timetable', async (mode) => {
    mocks.friends.mockResolvedValue([{ uid: 'bob', name: '小林' }]);
    mocks.friend.mockResolvedValue(mode === 'partial' ? stored([course, { ...course, id: 'pending', day: 0 }]) : stored([course], 'another-campus'));
    render(<PersonalTimetable />);
    fireEvent.change(await screen.findByRole('combobox', { name: '朋友' }), { target: { value: 'bob' } });
    expect(screen.queryByRole('button', { name: '約吃飯' })).toBeNull(); expect(mocks.meetups).not.toHaveBeenCalled();
  });
  it('clears an outdated planning result after a course changes', async () => {
    render(<PersonalTimetable />); await screen.findByRole('button', { name: '移動課程' });
    fireEvent.click(screen.getByRole('button', { name: '排讀書時間' }));
    expect(screen.getByRole('heading', { name: /排 2 小時讀書/ })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /編輯 資料庫.*第 3 節/ }));
    fireEvent.click(within(screen.getByRole('region', { name: '編輯課程' })).getByRole('button', { name: '儲存' }));
    await waitFor(() => expect(screen.queryByRole('heading', { name: /排 2 小時讀書/ })).toBeNull());
  });
});
