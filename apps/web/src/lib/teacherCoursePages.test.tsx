import { act, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import TeacherCoursePage from '@/app/teacher/course/[courseId]/page';
import TeacherGradebookPage from '@/app/teacher/course/[courseId]/gradebook/page';
import { useTeacherCourse } from './useTeacherCourse';
vi.mock('@/components/AppHeader', () => ({ AppHeader: () => <header>Campus One</header> }));
vi.mock('@/components/teaching/TeacherAssignments', () => ({
  TeacherAssignments: () => <div>教師作業管理</div>,
}));
vi.mock('./useTeacherCourse', () => ({ useTeacherCourse: vi.fn() }));
vi.mock('./pageContext', () => ({
  resolveSchoolPageContext: () => ({
    schoolId: 'pu',
    schoolName: '靜宜大學',
    schoolSearch: '?schoolId=pu',
  }),
}));
const course = { id: 'course-a', name: '資料結構', description: '', role: 'instructor' };
const refresh = vi.fn();
beforeEach(() => vi.clearAllMocks());
it('keeps missing and zero grades distinct without offering a fake publish action', async () => {
  vi.mocked(useTeacherCourse).mockReturnValue({
    state: {
      scope: 'a',
      status: 'ready',
      data: {
        course,
        rows: [
          {
            id: 'a',
            uid: 'student-a',
            name: '甲同學',
            finalScore: null,
            result: null,
            published: null,
            publishedAt: null,
          },
          {
            id: 'b',
            uid: 'student-b',
            name: '乙同學',
            finalScore: 0,
            result: 'failed',
            published: false,
            publishedAt: null,
          },
          {
            id: 'c',
            uid: 'student-c',
            name: '丙同學',
            finalScore: 80,
            result: 'passed',
            published: true,
            publishedAt: null,
          },
        ],
      },
    },
    refresh,
    authLoading: false,
    signedIn: true,
  });
  await act(async () => {
    render(<TeacherGradebookPage params={Promise.resolve({ courseId: 'course-a' })} />);
  });
  expect(screen.getByText('未登錄')).toBeTruthy();
  expect(screen.getByText(/平均 40.0 分/)).toBeTruthy();
  expect(screen.getByRole('cell', { name: '0' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: /發布|撤回/ })).toBeNull();
});
it('shows source course content and working destinations with a dedicated permission-scoped assignment editor', async () => {
  vi.mocked(useTeacherCourse).mockReturnValue({
    state: {
      scope: 'a',
      status: 'ready',
      data: {
        course,
        modules: [
          {
            id: 'm',
            title: 'Trees',
            description: '',
            resourceUrl: 'https://school.test/notes',
            resourceLabel: 'Lecture notes',
            order: 1,
          },
        ],
        assignments: [
          { id: 'work', title: 'Tree report', description: '', dueAt: null, points: null },
        ],
      },
    },
    refresh,
    authLoading: false,
    signedIn: true,
  });
  await act(async () => {
    render(<TeacherCoursePage params={Promise.resolve({ courseId: 'course-a' })} />);
  });
  expect(screen.getByRole('link', { name: 'Lecture notes ↗' }).getAttribute('href')).toBe(
    'https://school.test/notes',
  );
  expect(screen.getByRole('link', { name: '課堂點名' }).getAttribute('href')).toContain(
    '/teacher/course/course-a/attendance',
  );
  expect(screen.getByText('教師作業管理')).toBeTruthy();
});
it('does not render records or tool links while access is denied', async () => {
  vi.mocked(useTeacherCourse).mockReturnValue({
    state: { scope: 'a', status: 'error', error: '沒有課程權限' },
    refresh,
    authLoading: false,
    signedIn: true,
  });
  await act(async () => {
    render(<TeacherCoursePage params={Promise.resolve({ courseId: 'course-a' })} />);
  });
  expect(screen.getByRole('alert').textContent).toBe('沒有課程權限');
  expect(screen.queryByRole('link', { name: '課堂點名' })).toBeNull();
  expect(screen.queryByText('資料結構')).toBeNull();
});
