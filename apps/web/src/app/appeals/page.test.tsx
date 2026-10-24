import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import AppealsPage from './page';

const store = vi.hoisted(() => ({
  appealOfferingId: (course: { name: string; teacher?: string }) =>
    `${course.name}｜${course.teacher}`,
  createCourseAppeal: vi.fn(async () => 'r1'),
  listCourseAppeals: vi.fn(async () => [] as unknown[]),
  loadAppealTeacherStatus: vi.fn(async () => ({}) as Record<string, boolean>),
  loadPersonalTimetable: vi.fn(),
  withdrawCourseAppeal: vi.fn(async () => undefined),
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

const course = {
  id: 'c1',
  name: '資料庫',
  teacher: '王老師',
  day: 1,
  start: 3,
  end: 4,
  room: '主顧303',
  color: 'blue',
};
const pending = {
  id: 'a1',
  schoolId: 'pu',
  studentUid: 'stu',
  courseId: 'c1',
  courseName: '資料庫',
  offeringId: '資料庫｜王老師',
  title: '期中考成績',
  body: '第三題的分數',
  status: 'pending',
  teacherNote: '',
  createdAt: '2026-10-01',
  updatedAt: '2026-10-01',
};
const NO_TEACHER = '這門課還沒對應老師，申訴暫時只有學校看得到。';

beforeEach(() => {
  vi.clearAllMocks();
  auth.user = { uid: 'stu' };
  auth.loading = false;
  school.selectedSchoolId = 'pu';
  school.loading = false;
  store.loadPersonalTimetable.mockResolvedValue({
    courses: [course],
    meta: {},
    shareWithFriends: false,
    schoolId: 'pu',
  });
  store.listCourseAppeals.mockResolvedValue([]);
  store.loadAppealTeacherStatus.mockResolvedValue({});
  store.createCourseAppeal.mockResolvedValue('r1');
  store.withdrawCourseAppeal.mockResolvedValue(undefined);
});

it('沒有對應老師時，頂卡、清單和送出後都說只有學校看得到，不說等老師看', async () => {
  store.listCourseAppeals.mockResolvedValue([pending]);
  store.loadAppealTeacherStatus.mockResolvedValue({});
  await act(async () => {
    render(<AppealsPage />);
  });
  await waitFor(() => expect(screen.getAllByText(NO_TEACHER)).toHaveLength(2));
  expect(screen.queryByText('已送出，等老師看。')).toBeNull();

  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'c1' } });
  fireEvent.change(screen.getByLabelText('主旨'), { target: { value: '出缺席紀錄' } });
  fireEvent.change(screen.getByLabelText('說明'), { target: { value: '當天有請假單可以補' } });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: '送出' }));
  });
  await waitFor(() => expect(screen.getByRole('status').textContent).toBe(NO_TEACHER));
  expect(document.body.textContent).not.toMatch(/會通知/);
});

it('有對應老師時，頂卡、清單和送出後都是「已送出，等老師看。」', async () => {
  store.listCourseAppeals.mockResolvedValue([pending]);
  store.loadAppealTeacherStatus.mockResolvedValue({ '資料庫｜王老師': true });
  await act(async () => {
    render(<AppealsPage />);
  });
  await waitFor(() => expect(screen.getAllByText('已送出，等老師看。')).toHaveLength(2));
  expect(screen.queryByText(NO_TEACHER)).toBeNull();
  expect(store.loadAppealTeacherStatus).toHaveBeenCalledWith('pu', ['資料庫｜王老師']);

  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'c1' } });
  fireEvent.change(screen.getByLabelText('主旨'), { target: { value: '出缺席紀錄' } });
  fireEvent.change(screen.getByLabelText('說明'), { target: { value: '當天有請假單可以補' } });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: '送出' }));
  });
  await waitFor(() => expect(screen.getByRole('status').textContent).toBe('已送出，等老師看。'));
});

it('舊申訴沒有開課代號：就算課有對應老師，也照實說只有學校看得到；核准後是「老師已核准。」', async () => {
  const legacy = {
    ...pending,
    id: 'old',
    offeringId: undefined,
    createdAt: '2026-09-01',
    updatedAt: '2026-09-01',
  };
  const approved = {
    ...pending,
    id: 'a2',
    title: '作業分數',
    status: 'approved',
    updatedAt: '2026-10-05',
  };
  store.listCourseAppeals.mockResolvedValue([legacy, approved]);
  store.loadAppealTeacherStatus.mockResolvedValue({ '資料庫｜王老師': true });
  await act(async () => {
    render(<AppealsPage />);
  });
  await waitFor(() => expect(screen.getAllByText('老師已核准。')).toHaveLength(2));
  expect(screen.getByText(NO_TEACHER)).toBeTruthy();
});
