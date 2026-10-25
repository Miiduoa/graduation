import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useLayoutEffect } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import { writeDemoRole } from '@/lib/demoRole';
import AppealsPage from './page';

const store = vi.hoisted(() => ({
  appealOfferingId: (course: { name: string; teacher?: string }) =>
    `${course.name}｜${course.teacher}`,
  createCourseAppeal: vi.fn(async () => 'r1'),
  listCourseAppeals: vi.fn<(schoolId: string, uid: string) => Promise<unknown[]>>(),
  loadAppealTeacherStatus: vi.fn(async () => ({}) as Record<string, boolean>),
  loadPersonalTimetable: vi.fn(),
  withdrawCourseAppeal: vi.fn<(id: string) => Promise<void>>(),
}));
vi.mock('@/lib/timetable/store', () => store);
const auth = vi.hoisted(() => ({
  user: { uid: 'stu' } as { uid: string } | null,
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

const courseA = {
  id: 'c-a',
  name: '學校A課',
  teacher: '甲老師',
  day: 1,
  start: 1,
  end: 2,
  room: 'A101',
  color: 'blue',
};
const courseB = {
  id: 'c-b',
  name: '學校B課',
  teacher: '乙老師',
  day: 2,
  start: 3,
  end: 4,
  room: 'B202',
  color: 'green',
};
const appealA = {
  id: 'appeal-a',
  schoolId: 'pu',
  studentUid: 'stu',
  courseId: 'c-a',
  courseName: '學校A課',
  offeringId: '學校A課｜甲老師',
  title: 'A校申訴',
  body: '只有A校看得到',
  status: 'pending',
  teacherNote: '',
  createdAt: '2026-10-01',
  updatedAt: '2026-10-01',
};
const appealB = {
  ...appealA,
  id: 'appeal-b',
  schoolId: 'nthu',
  courseId: 'c-b',
  courseName: '學校B課',
  offeringId: '學校B課｜乙老師',
  title: 'B校申訴',
  body: '只有B校看得到',
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

function timetable(courses: typeof courseA[], schoolId: string) {
  return { courses, meta: {}, shareWithFriends: false, schoolId };
}

beforeEach(() => {
  vi.clearAllMocks();
  auth.user = { uid: 'stu' };
  auth.loading = false;
  school.selectedSchoolId = 'pu';
  school.loading = false;
  store.loadPersonalTimetable.mockImplementation(async (_uid: string, schoolId: string) =>
    timetable(schoolId === 'nthu' ? [courseB] : [courseA], schoolId),
  );
  store.listCourseAppeals.mockImplementation(async (schoolId: string) =>
    schoolId === 'nthu' ? [appealB] : [appealA],
  );
  store.loadAppealTeacherStatus.mockResolvedValue({});
  store.createCourseAppeal.mockResolvedValue('r1');
  store.withdrawCourseAppeal.mockResolvedValue(undefined);
});

it('school or account change clears private list and drafts immediately', async () => {
  const view = render(<AppealsPage />);
  await screen.findByText('A校申訴');
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'c-a' } });
  fireEvent.change(screen.getByLabelText('主旨'), { target: { value: 'A校草稿主旨' } });
  fireEvent.change(screen.getByLabelText('說明'), { target: { value: 'A校草稿說明文字' } });

  school.selectedSchoolId = 'nthu';
  view.rerender(<AppealsPage />);
  expect(screen.queryByText('A校申訴')).toBeNull();
  expect(screen.queryByDisplayValue('A校草稿主旨')).toBeNull();
  expect(screen.queryByDisplayValue('A校草稿說明文字')).toBeNull();
  await screen.findByText('B校申訴');
  expect((screen.getByLabelText('主旨') as HTMLInputElement).value).toBe('');

  fireEvent.change(screen.getByLabelText('主旨'), { target: { value: 'B校草稿' } });
  auth.user = { uid: 'other' };
  view.rerender(<AppealsPage />);
  expect(screen.queryByDisplayValue('B校草稿')).toBeNull();
  expect(screen.queryByText('B校申訴')).toBeNull();
});

it('pending A-B-A reads cannot overwrite the newer A state', async () => {
  const firstA = deferred<unknown[]>();
  const secondA = deferred<unknown[]>();
  let puReads = 0;
  store.listCourseAppeals.mockImplementation(async (schoolId: string) => {
    if (schoolId !== 'pu') return [appealB];
    puReads += 1;
    return puReads === 1 ? firstA.promise : secondA.promise;
  });

  const view = render(<AppealsPage />);
  await waitFor(() => expect(store.listCourseAppeals).toHaveBeenCalledTimes(1));
  school.selectedSchoolId = 'nthu';
  view.rerender(<AppealsPage />);
  await screen.findByText('B校申訴');

  school.selectedSchoolId = 'pu';
  view.rerender(<AppealsPage />);
  await act(async () => secondA.resolve([{ ...appealA, title: '較新的A申訴' }]));
  expect(await screen.findByText('較新的A申訴')).toBeTruthy();

  await act(async () => firstA.resolve([{ ...appealA, title: '過期的A申訴' }]));
  expect(screen.queryByText('過期的A申訴')).toBeNull();
  expect(screen.getByText('較新的A申訴')).toBeTruthy();
});

it('pending withdraw cannot update the next school or reload it', async () => {
  const pendingWithdraw = deferred<void>();
  store.withdrawCourseAppeal.mockReturnValue(pendingWithdraw.promise);
  const view = render(<AppealsPage />);
  await screen.findByText('A校申訴');
  const withdraw = screen.getByRole('button', { name: '撤回' });
  fireEvent.click(withdraw);

  school.selectedSchoolId = 'nthu';
  view.rerender(<AppealsPage />);
  await screen.findByText('B校申訴');
  const nthuReads = store.listCourseAppeals.mock.calls.filter((call) => call[0] === 'nthu').length;

  await act(async () => pendingWithdraw.resolve());
  expect(screen.queryByText('已撤回。')).toBeNull();
  expect(store.listCourseAppeals.mock.calls.filter((call) => call[0] === 'nthu').length).toBe(
    nthuReads,
  );
});

it('retained submit and withdraw callbacks are invalid before the next scope layout effects', async () => {
  const retained: { invoke?: () => void } = {};
  function SwitchCommit({ invoke }: { invoke: boolean }) {
    useLayoutEffect(() => {
      if (invoke) retained.invoke?.();
    }, [invoke]);
    return <AppealsPage />;
  }
  const view = render(<SwitchCommit invoke={false} />);
  await screen.findByText('A校申訴');
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'c-a' } });
  fireEvent.change(screen.getByLabelText('主旨'), { target: { value: '原學校草稿主旨' } });
  fireEvent.change(screen.getByLabelText('說明'), { target: { value: '原學校草稿說明要保留' } });
  // Retain actual React callbacks, as a delayed confirmation/queued action would.
  const handler = (button: HTMLElement): (() => void) => {
    const key = Object.keys(button).find((value) => value.startsWith('__reactProps$'))!;
    return (button as unknown as Record<string, { onClick: () => void }>)[key].onClick;
  };
  const submit = handler(screen.getByRole('button', { name: '送出' }));
  const withdraw = handler(screen.getByRole('button', { name: '撤回' }));
  retained.invoke = () => { submit(); withdraw(); };
  school.selectedSchoolId = 'nthu';
  view.rerender(<SwitchCommit invoke />);
  await screen.findByText('B校申訴');
  expect(store.createCourseAppeal).not.toHaveBeenCalled();
  expect(store.withdrawCourseAppeal).not.toHaveBeenCalled();
  // Returning to the same school must not revive the original component instance.
  school.selectedSchoolId = 'pu';
  view.rerender(<SwitchCommit invoke={false} />);
  await screen.findByText('A校申訴');
  act(() => retained.invoke?.());
  expect(store.createCourseAppeal).not.toHaveBeenCalled();
  expect(store.withdrawCourseAppeal).not.toHaveBeenCalled();
});

it('pending submit cannot set new scope state or trigger new scope reads', async () => {
  const pendingCreate = deferred<string>();
  store.createCourseAppeal.mockReturnValue(pendingCreate.promise);
  const view = render(<AppealsPage />);
  await screen.findByText('A校申訴');
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'c-a' } });
  fireEvent.change(screen.getByLabelText('主旨'), { target: { value: '跨校送出主旨' } });
  fireEvent.change(screen.getByLabelText('說明'), {
    target: { value: '跨校送出說明要夠長' },
  });
  fireEvent.click(screen.getByRole('button', { name: '送出' }));

  school.selectedSchoolId = 'nthu';
  view.rerender(<AppealsPage />);
  await screen.findByText('B校申訴');
  const nthuReadsBefore = store.listCourseAppeals.mock.calls.filter(
    (call) => call[0] === 'nthu',
  ).length;

  await act(async () => pendingCreate.resolve('created'));
  expect(screen.queryByRole('status')).toBeNull();
  expect(screen.queryByText('已送出，等老師看。')).toBeNull();
  expect(screen.queryByText('這次沒有送出，請稍後再試。')).toBeNull();
  expect(store.listCourseAppeals.mock.calls.filter((call) => call[0] === 'nthu').length).toBe(
    nthuReadsBefore,
  );
  expect(store.createCourseAppeal).toHaveBeenCalledWith(
    expect.objectContaining({ schoolId: 'pu', courseId: 'c-a' }),
    expect.anything(),
    expect.anything(),
  );
});

it('same-scope rerender retains drafts', async () => {
  const view = render(<AppealsPage />);
  await screen.findByText('A校申訴');
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'c-a' } });
  fireEvent.change(screen.getByLabelText('主旨'), { target: { value: '同範圍草稿' } });
  fireEvent.change(screen.getByLabelText('說明'), { target: { value: '同範圍說明保留' } });
  view.rerender(<AppealsPage />);
  expect((screen.getByLabelText('主旨') as HTMLInputElement).value).toBe('同範圍草稿');
  expect((screen.getByLabelText('說明') as HTMLTextAreaElement).value).toBe('同範圍說明保留');
  expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('c-a');
});

it('presentation role changes clear the prior draft without granting a school identity', async () => {
  render(<AppealsPage />);
  await screen.findByText('A校申訴');
  fireEvent.change(screen.getByLabelText('主旨'), { target: { value: '原角色私有草稿' } });
  act(() => writeDemoRole('teacher'));
  expect(screen.queryByDisplayValue('原角色私有草稿')).toBeNull();
  await screen.findByText('A校申訴');
  expect(store.listCourseAppeals).toHaveBeenLastCalledWith('pu', 'stu');
});

it('null selected school does not call stores with pu', async () => {
  school.selectedSchoolId = null;
  render(<AppealsPage />);
  expect((await screen.findByRole('status')).textContent).toBe('選擇校園');
  expect(store.listCourseAppeals).not.toHaveBeenCalled();
  expect(store.loadPersonalTimetable).not.toHaveBeenCalled();
  expect(store.loadAppealTeacherStatus).not.toHaveBeenCalled();
});

it('rejected submit keeps drafts and isolates busy/notice from a later school', async () => {
  const pendingCreate = deferred<string>();
  store.createCourseAppeal.mockReturnValue(pendingCreate.promise);
  const view = render(<AppealsPage />);
  await screen.findByText('A校申訴');
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'c-a' } });
  fireEvent.change(screen.getByLabelText('主旨'), { target: { value: '失敗仍保留' } });
  fireEvent.change(screen.getByLabelText('說明'), {
    target: { value: '失敗時說明仍需保留住' },
  });
  fireEvent.click(screen.getByRole('button', { name: '送出' }));
  expect(screen.getByRole('button', { name: '送出中…' })).toBeTruthy();

  await act(async () => pendingCreate.reject(new Error('unavailable')));
  expect(screen.getByRole('status').textContent).toBe('這次沒有送出，請稍後再試。');
  expect((screen.getByLabelText('主旨') as HTMLInputElement).value).toBe('失敗仍保留');
  expect(screen.getByRole('button', { name: '送出' })).toBeTruthy();

  school.selectedSchoolId = 'nthu';
  view.rerender(<AppealsPage />);
  await screen.findByText('B校申訴');
  expect(screen.queryByText('這次沒有送出，請稍後再試。')).toBeNull();
  expect(screen.queryByDisplayValue('失敗仍保留')).toBeNull();
  expect(screen.queryByRole('button', { name: '送出中…' })).toBeNull();
});

it('same-frame duplicate submit only sends once', async () => {
  const pendingCreate = deferred<string>();
  store.createCourseAppeal.mockReturnValue(pendingCreate.promise);
  render(<AppealsPage />);
  await screen.findByText('A校申訴');
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'c-a' } });
  fireEvent.change(screen.getByLabelText('主旨'), { target: { value: '連按只送一次' } });
  fireEvent.change(screen.getByLabelText('說明'), { target: { value: '說明也要夠長才行' } });
  const button = screen.getByRole('button', { name: '送出' });
  fireEvent.click(button);
  fireEvent.click(button);
  expect(store.createCourseAppeal).toHaveBeenCalledTimes(1);
  await act(async () => pendingCreate.resolve('ok'));
  await waitFor(() => expect(screen.getByRole('status')).toBeTruthy());
});
