import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useLayoutEffect } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import { writeDemoRole } from '@/lib/demoRole';
import TeacherDeskPage from './page';

const store = vi.hoisted(() => ({
  decideCourseAppeal: vi.fn<
    (id: string, status: 'approved' | 'rejected', teacherNote: string) => Promise<void>
  >(),
  listTeacherAppeals: vi.fn(),
}));
vi.mock('@/lib/timetable/store', () => store);
const auth = vi.hoisted(() => ({
  user: { uid: 'teacher' } as { uid: string } | null,
  loading: false,
}));
vi.mock('@/components/AuthGuard', () => ({ useAuth: () => auth }));
const school = vi.hoisted(() => ({
  selectedSchoolId: 'pu' as string | null,
  loading: false,
}));
vi.mock('@/components/SelectedSchoolProvider', () => ({ useSelectedSchool: () => school }));
vi.mock('@/components/SchoolScopePlaceholder', () => ({
  SchoolScopePlaceholder: () => <p role="status">選擇校園</p>,
}));
vi.mock('@/components/AppHeader', () => ({ AppHeader: () => <header>Campus One</header> }));
vi.mock('@/components/PWAInstallBanner', () => ({ PWAInstallBanner: () => null }));

const rowA = {
  id: 'a1',
  courseName: '資料庫A',
  title: '期中成績A',
  body: 'A校申訴內容',
  status: 'pending',
  teacherNote: '',
  createdAt: '2026-10-12T02:00:00.000Z',
  updatedAt: '2026-10-12T02:00:00.000Z',
  studentName: '學生甲',
  studentNumber: 'S0001',
};
const rowB = {
  ...rowA,
  id: 'b1',
  courseName: '資料庫B',
  title: '期中成績B',
  body: 'B校申訴內容',
  studentName: '學生乙',
  studentNumber: 'S0002',
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  vi.clearAllMocks();
  auth.user = { uid: 'teacher' };
  auth.loading = false;
  school.selectedSchoolId = 'pu';
  school.loading = false;
  store.listTeacherAppeals.mockImplementation(async (schoolId: string) =>
    schoolId === 'nthu'
      ? { courses: ['資料庫B'], rows: [rowB] }
      : { courses: ['資料庫A'], rows: [rowA] },
  );
  store.decideCourseAppeal.mockResolvedValue(undefined);
});

it('school or account change clears private records and teacher notes immediately', async () => {
  const view = render(<TeacherDeskPage />);
  await screen.findByText(/學生甲.*期中成績A/);
  fireEvent.change(screen.getByLabelText('給學生的話（可不填）'), {
    target: { value: 'A校老師備註' },
  });

  school.selectedSchoolId = 'nthu';
  view.rerender(<TeacherDeskPage />);
  expect(screen.queryByText(/學生甲.*期中成績A/)).toBeNull();
  expect(screen.queryByDisplayValue('A校老師備註')).toBeNull();
  await screen.findByText(/學生乙.*期中成績B/);
  expect((screen.getByLabelText('給學生的話（可不填）') as HTMLInputElement).value).toBe('');

  fireEvent.change(screen.getByLabelText('給學生的話（可不填）'), {
    target: { value: 'B校備註' },
  });
  auth.user = { uid: 'other-teacher' };
  view.rerender(<TeacherDeskPage />);
  expect(screen.queryByDisplayValue('B校備註')).toBeNull();
  expect(screen.queryByText(/學生乙.*期中成績B/)).toBeNull();
});

it('pending A-B-A reads cannot overwrite the newer A state', async () => {
  const firstA = deferred<{ courses: string[]; rows: typeof rowA[] }>();
  const secondA = deferred<{ courses: string[]; rows: typeof rowA[] }>();
  let puReads = 0;
  store.listTeacherAppeals.mockImplementation(async (schoolId: string) => {
    if (schoolId !== 'pu') return { courses: ['資料庫B'], rows: [rowB] };
    puReads += 1;
    return puReads === 1 ? firstA.promise : secondA.promise;
  });

  const view = render(<TeacherDeskPage />);
  await waitFor(() => expect(store.listTeacherAppeals).toHaveBeenCalledTimes(1));
  school.selectedSchoolId = 'nthu';
  view.rerender(<TeacherDeskPage />);
  await screen.findByText(/學生乙.*期中成績B/);

  school.selectedSchoolId = 'pu';
  view.rerender(<TeacherDeskPage />);
  await act(async () =>
    secondA.resolve({
      courses: ['資料庫A'],
      rows: [{ ...rowA, title: '較新的A申訴' }],
    }),
  );
  expect(await screen.findByText(/較新的A申訴/)).toBeTruthy();

  await act(async () =>
    firstA.resolve({
      courses: ['資料庫A'],
      rows: [{ ...rowA, title: '過期的A申訴' }],
    }),
  );
  expect(screen.queryByText(/過期的A申訴/)).toBeNull();
  expect(screen.getByText(/較新的A申訴/)).toBeTruthy();
});

it('pending decision keeps the original document ID and cannot update the next school', async () => {
  const pendingDecide = deferred<void>();
  store.decideCourseAppeal.mockReturnValue(pendingDecide.promise);
  const view = render(<TeacherDeskPage />);
  await screen.findByText(/學生甲.*期中成績A/);
  const approve = screen.getByRole('button', { name: '核准' });
  fireEvent.click(approve);

  school.selectedSchoolId = 'nthu';
  view.rerender(<TeacherDeskPage />);
  await screen.findByText(/學生乙.*期中成績B/);
  const nthuReads = store.listTeacherAppeals.mock.calls.filter((call) => call[0] === 'nthu').length;

  await act(async () => pendingDecide.resolve());
  expect(screen.queryByText(/已核准/)).toBeNull();
  expect(store.listTeacherAppeals.mock.calls.filter((call) => call[0] === 'nthu').length).toBe(
    nthuReads,
  );
  expect(store.decideCourseAppeal).toHaveBeenCalledWith('a1', 'approved', '');
});

it('retained decision callbacks are invalid before the next scope layout effects', async () => {
  const retained: { approve?: () => void } = {};
  function SwitchCommit({ invoke }: { invoke: boolean }) {
    useLayoutEffect(() => {
      if (invoke) retained.approve?.();
    }, [invoke]);
    return <TeacherDeskPage />;
  }
  const view = render(<SwitchCommit invoke={false} />);
  await screen.findByText(/學生甲.*期中成績A/);
  const button = screen.getByRole('button', { name: '核准' });
  const key = Object.keys(button).find((value) => value.startsWith('__reactProps$'))!;
  retained.approve = (button as unknown as Record<string, { onClick: () => void }>)[key].onClick;
  school.selectedSchoolId = 'nthu';
  view.rerender(<SwitchCommit invoke />);
  await screen.findByText(/學生乙.*期中成績B/);
  expect(store.decideCourseAppeal).not.toHaveBeenCalled();
  school.selectedSchoolId = 'pu';
  view.rerender(<SwitchCommit invoke={false} />);
  await screen.findByText(/學生甲.*期中成績A/);
  act(() => retained.approve?.());
  expect(store.decideCourseAppeal).not.toHaveBeenCalled();
});

it('pending decision cannot set new scope state or trigger new scope reads', async () => {
  const pendingDecide = deferred<void>();
  store.decideCourseAppeal.mockReturnValue(pendingDecide.promise);
  const view = render(<TeacherDeskPage />);
  await screen.findByText(/學生甲.*期中成績A/);
  fireEvent.change(screen.getByLabelText('給學生的話（可不填）'), {
    target: { value: '跨校備註' },
  });
  fireEvent.click(screen.getByRole('button', { name: '核准' }));

  school.selectedSchoolId = 'nthu';
  view.rerender(<TeacherDeskPage />);
  await screen.findByText(/學生乙.*期中成績B/);
  const nthuReadsBefore = store.listTeacherAppeals.mock.calls.filter(
    (call) => call[0] === 'nthu',
  ).length;

  await act(async () => pendingDecide.resolve());
  expect(screen.queryByText(/已核准/)).toBeNull();
  expect(screen.queryByText('這次沒有存成，請稍後再試。')).toBeNull();
  expect(store.listTeacherAppeals.mock.calls.filter((call) => call[0] === 'nthu').length).toBe(
    nthuReadsBefore,
  );
});

it('same-scope rerender retains teacher notes', async () => {
  const view = render(<TeacherDeskPage />);
  await screen.findByText(/學生甲.*期中成績A/);
  fireEvent.change(screen.getByLabelText('給學生的話（可不填）'), {
    target: { value: '同範圍備註' },
  });
  view.rerender(<TeacherDeskPage />);
  expect((screen.getByLabelText('給學生的話（可不填）') as HTMLInputElement).value).toBe(
    '同範圍備註',
  );
});

it('presentation role changes clear prior teacher notes and recheck server authorization', async () => {
  render(<TeacherDeskPage />);
  await screen.findByText(/學生甲.*期中成績A/);
  fireEvent.change(screen.getByLabelText('給學生的話（可不填）'), {
    target: { value: '原角色私有備註' },
  });
  store.listTeacherAppeals.mockRejectedValueOnce(
    Object.assign(new Error('denied'), { code: 'functions/permission-denied' }),
  );
  act(() => writeDemoRole('student'));
  expect(screen.queryByDisplayValue('原角色私有備註')).toBeNull();
  expect(screen.queryByText(/學生甲.*期中成績A/)).toBeNull();
  await screen.findByText('這頁給老師用。你的帳號在這所學校不是老師身分。');
  expect(store.listTeacherAppeals).toHaveBeenLastCalledWith('pu');
});

it('null selected school does not call stores with pu', async () => {
  school.selectedSchoolId = null;
  render(<TeacherDeskPage />);
  expect((await screen.findByRole('status')).textContent).toBe('選擇校園');
  expect(store.listTeacherAppeals).not.toHaveBeenCalled();
});

it('rejected decision isolates notice/busy from a later school', async () => {
  const pendingDecide = deferred<void>();
  store.decideCourseAppeal.mockReturnValue(pendingDecide.promise);
  const view = render(<TeacherDeskPage />);
  await screen.findByText(/學生甲.*期中成績A/);
  fireEvent.click(screen.getByRole('button', { name: '核准' }));
  expect((screen.getByRole('button', { name: '核准' }) as HTMLButtonElement).disabled).toBe(true);

  await act(async () => pendingDecide.reject(new Error('unavailable')));
  expect(screen.getByRole('status').textContent).toBe('這次沒有存成，請稍後再試。');
  expect((screen.getByRole('button', { name: '核准' }) as HTMLButtonElement).disabled).toBe(false);

  school.selectedSchoolId = 'nthu';
  view.rerender(<TeacherDeskPage />);
  await screen.findByText(/學生乙.*期中成績B/);
  expect(screen.queryByText('這次沒有存成，請稍後再試。')).toBeNull();
  expect((screen.getByRole('button', { name: '核准' }) as HTMLButtonElement).disabled).toBe(false);
});

it('same-frame duplicate decide only writes once', async () => {
  const pendingDecide = deferred<void>();
  store.decideCourseAppeal.mockReturnValue(pendingDecide.promise);
  render(<TeacherDeskPage />);
  await screen.findByText(/學生甲.*期中成績A/);
  const approve = screen.getByRole('button', { name: '核准' });
  fireEvent.click(approve);
  fireEvent.click(approve);
  fireEvent.click(screen.getByRole('button', { name: '不核准' }));
  expect(store.decideCourseAppeal).toHaveBeenCalledTimes(1);
  await act(async () => pendingDecide.resolve());
  await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/已核准/));
});

it('permission-denied read shows teacher-only copy without leaking other school rows', async () => {
  store.listTeacherAppeals.mockRejectedValueOnce(
    Object.assign(new Error('denied'), { code: 'functions/permission-denied' }),
  );
  const view = render(<TeacherDeskPage />);
  await screen.findByText('這頁給老師用。你的帳號在這所學校不是老師身分。');
  expect(screen.queryByText(/學生甲/)).toBeNull();

  school.selectedSchoolId = 'nthu';
  view.rerender(<TeacherDeskPage />);
  await screen.findByText(/學生乙.*期中成績B/);
  expect(screen.queryByText('這頁給老師用。你的帳號在這所學校不是老師身分。')).toBeNull();
});
