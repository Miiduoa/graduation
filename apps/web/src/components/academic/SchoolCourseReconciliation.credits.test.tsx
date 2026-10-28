import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SchoolCourseReconciliation } from './SchoolCourseReconciliation';
import type { SchoolLmsSnapshot } from '@/lib/tronClassCourses';
const mocks = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock('@/lib/academicClient', async (original) => ({
  ...await original<typeof import('@/lib/academicClient')>(), loadAcademicRecords: mocks.load,
}));
const lms: SchoolLmsSnapshot = {
  ownerUid: 'fixture', schoolId: 'pu', source: 'pu-tronclass', status: 'ongoing', fetchedAt: '2026-10-28T00:00:00Z',
  courses: [
    { id: 1, name: '資料庫', code: '0012', teachers: [], semester: '1151', status: 'ongoing', href: '', credit: 0 },
    { id: 2, name: '程式設計', code: '0013', teachers: [], semester: '1151', status: 'ongoing', href: '', credit: 3 },
  ],
};
beforeEach(() => {
  mocks.load.mockReset().mockResolvedValue({ ownerUid: 'fixture', schoolId: 'pu', fetchedAt: '2026-10-28T00:00:00Z', records: {
    semester: '1151', sourceTotalCredits: 6,
    courses: lms.courses.map((row) => ({ code: row.code, name: row.name, semester: row.semester, credits: 3,
      classOffered: '測試班', courseType: '必修', teacherName: '', timePlaceRaw: '', location: '', scheduleWarning: null })),
  } });
});
afterEach(() => cleanup());
function open() {
  return render(<SchoolCourseReconciliation uid="fixture" schoolId="pu" lms={lms} returnUrl="/school-courses" canReconnect />);
}
it('only requests the school transcript when the user chooses to compare', async () => {
  open();
  expect(mocks.load).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '核對校方課表' }));
  expect(await screen.findByText(/學分標示不同：e 校園 3 學分，WOW Class 0 學分/)).toBeTruthy();
  expect(mocks.load).toHaveBeenCalledTimes(1);
  expect(mocks.load).toHaveBeenCalledWith('courses', 'fixture', 'pu');
  expect(screen.getByText('6 學分')).toBeTruthy();
  expect(screen.getByRole('link', { name: '前往 資料庫 的對應課堂' }).getAttribute('href'))
    .toBe('https://tronclass.pu.edu.tw/course/1/content');
});
it('keeps uniquely matched courses with different credits visible in the review filter', async () => {
  open(); fireEvent.click(screen.getByRole('button', { name: '核對校方課表' }));
  const review = await screen.findByRole('button', { name: '只看待核對（1）' });
  fireEvent.click(review);
  expect(screen.getByRole('heading', { name: '資料庫' })).toBeTruthy();
  expect(screen.queryByRole('heading', { name: '程式設計' })).toBeNull();
  fireEvent.click(review);
  expect(screen.getByRole('heading', { name: '程式設計' })).toBeTruthy();
});
it('does not retain the old account comparison after the account changes', async () => {
  const view = open(); fireEvent.click(screen.getByRole('button', { name: '核對校方課表' }));
  await screen.findByText(/學分標示不同：e 校園/);
  view.rerender(<SchoolCourseReconciliation uid="another" schoolId="pu" lms={null} returnUrl="/school-courses" canReconnect />);
  expect(screen.queryByText(/學分標示不同：e 校園/)).toBeNull();
  expect(screen.queryByRole('heading', { name: '資料庫' })).toBeNull();
});
