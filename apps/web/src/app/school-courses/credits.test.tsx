import type { ReactNode } from 'react';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import SchoolCoursesPage from './page';
const mocks = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock('next/navigation', () => ({ usePathname: () => '/school-courses', useSearchParams: () => new URLSearchParams() }));
vi.mock('@/components/AuthGuard', () => ({ useAuth: () => ({ user: { uid: 'fixture' }, loading: false, error: null }) }));
vi.mock('@/components/SiteShell', () => ({ SiteShell: ({ children }: { children: ReactNode }) => <main>{children}</main> }));
vi.mock('@/components/academic/SchoolCourseReconciliation', () => ({ SchoolCourseReconciliation: () => null }));
vi.mock('@/lib/useCampusBrowseContext', () => ({ useCampusBrowseContext: () => ({ status: 'ready', schoolId: 'pu', schoolName: '靜宜大學', schoolSearch: '' }) }));
vi.mock('@/lib/signInOptions', () => ({ useSignInOptions: () => ({ loading: false, studentId: true }) }));
vi.mock('@/lib/tronClassCourses', () => ({ loadTronClassCourses: mocks.load }));
beforeEach(() => {
  mocks.load.mockReset().mockResolvedValue({ ownerUid: 'fixture', schoolId: 'pu', source: 'pu-tronclass',
    fetchedAt: '2026-10-28T00:00:00Z', status: 'ongoing', courses: [
      { id: 1, name: '零學分課程', code: '0001', teachers: [], semester: '1151', credit: 0 },
      { id: 2, name: '微學分課程', code: '0002', teachers: [], semester: '1151', credit: 0.5 },
      { id: 3, name: '學分未提供課程', code: '0003', teachers: [], semester: '1151', credit: null },
      { id: 4, name: '舊版資料課程', code: '0004', teachers: [], semester: '1151' },
    ].map((course) => ({ ...course, status: 'ongoing', href: `https://tronclass.pu.edu.tw/course/${course.id}/content` })),
  });
});
afterEach(() => cleanup());
it('displays source zero and fractional credits, while missing and legacy fields stay unknown', async () => {
  render(<SchoolCoursesPage />);
  for (const [name, expected] of [['零學分課程', '0 學分'], ['微學分課程', '0.5 學分'], ['學分未提供課程', '未提供'], ['舊版資料課程', '未提供']]) {
    const heading = await screen.findByRole('heading', { name });
    const card = heading.closest('li')!;
    const label = within(card).getByText('WOW Class 標示學分');
    expect(label.nextElementSibling?.textContent).toBe(expected);
  }
  expect(screen.getByText(/不代表已修得或畢業採計/)).toBeTruthy();
});
