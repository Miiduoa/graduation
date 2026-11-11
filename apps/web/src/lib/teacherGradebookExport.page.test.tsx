import type { ReactNode } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import TeacherGradebookPage from '@/app/teacher/course/[courseId]/gradebook/page';
import { useTeacherCourse } from './useTeacherCourse';

const context = vi.hoisted(() => ({ ready: true, schoolId: 'synthetic-school', schoolSearch: '' }));
vi.mock('./useTeacherCourse', () => ({ useTeacherCourse: vi.fn() }));
vi.mock('./useBrowsingSchoolPageContext', () => ({ useBrowsingSchoolPageContext: () => context }));
vi.mock('@/components/SiteShell', () => ({ SiteShell: ({ children }: { children: ReactNode }) => <main>{children}</main> }));
vi.mock('@/components/SchoolScopePlaceholder', () => ({ SchoolScopePlaceholder: () => <p>等待學校</p> }));
vi.mock('@/components/SchoolAccountRequired', () => ({ SchoolAccountRequired: () => <p>請登入</p> }));

function ready(courseId = 'synthetic-a'): ReturnType<typeof useTeacherCourse> {
  return {
    authLoading: false, signedIn: true, refresh: vi.fn(),
    state: { scope: courseId, status: 'ready', data: {
      course: { id: courseId, name: '合成課程', description: '', role: 'instructor' },
      rows: [{ id: 'row', uid: `${courseId}-student`, name: null, finalScore: null,
        result: null, published: null, publishedAt: null }],
    } },
  };
}
const button = () => screen.queryByRole('button', { name: '匯出可見列 CSV' });
beforeEach(() => { vi.clearAllMocks(); context.ready = true; });
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it.each(['scope', 'auth', 'signed-out', 'loading', 'error', 'wrong-course'])
  ('prevents export when access is unavailable: %s', async (mode) => {
    const value = ready();
    if (mode === 'scope') context.ready = false;
    if (mode === 'auth') value.authLoading = true;
    if (mode === 'signed-out') value.signedIn = false;
    if (mode === 'loading') value.state = { scope: 'a', status: 'loading' };
    if (mode === 'error') value.state = { scope: 'a', status: 'error', error: '合成錯誤' };
    vi.mocked(useTeacherCourse).mockReturnValue(value);
    await act(async () => {
      render(<TeacherGradebookPage params={Promise.resolve({ courseId: mode === 'wrong-course' ? 'synthetic-b' : 'synthetic-a' })} />);
    });
    expect(button()).toBeNull();
  });

it('downloads only on click and follows the current course through a loading transition', async () => {
  const blobs: Blob[] = [];
  const createObjectURL = vi.fn((blob: Blob) => { blobs.push(blob); return 'blob:synthetic'; });
  const revokeObjectURL = vi.fn();
  vi.stubGlobal('URL', class extends URL {
    static createObjectURL = createObjectURL;
    static revokeObjectURL = revokeObjectURL;
  });
  const downloads: string[] = [];
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    downloads.push(this.download);
  });
  vi.mocked(useTeacherCourse).mockReturnValue(ready());
  const a = Promise.resolve({ courseId: 'synthetic-a' });
  const b = Promise.resolve({ courseId: 'synthetic-b' });
  let view!: ReturnType<typeof render>;
  await act(async () => { view = render(<TeacherGradebookPage params={a} />); });
  expect(createObjectURL).not.toHaveBeenCalled();
  expect(screen.getByText(/CSV 匯出：1 列，未知欄位共 5 個/)).toBeTruthy();
  fireEvent.click(button()!);
  expect(downloads).toEqual(['gradebook-synthetic-a.csv']);
  await act(async () => { view.rerender(<TeacherGradebookPage params={b} />); });
  expect(button()).toBeNull();
  vi.mocked(useTeacherCourse).mockReturnValue({ ...ready('synthetic-b'), state: null });
  await act(async () => { view.rerender(<TeacherGradebookPage params={b} />); });
  expect(button()).toBeNull();
  vi.mocked(useTeacherCourse).mockReturnValue(ready('synthetic-b'));
  await act(async () => { view.rerender(<TeacherGradebookPage params={b} />); });
  fireEvent.click(button()!);
  expect(downloads).toEqual(['gradebook-synthetic-a.csv', 'gradebook-synthetic-b.csv']);
  expect(blobs).toHaveLength(2);
  // FileReader works in jsdom even when Blob.text is unavailable.
  const text = await new Promise<string>((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.readAsText(blobs[1]);
  });
  expect(text).toContain('synthetic-b-student');
  expect(text).not.toContain('synthetic-a');
  expect(document.querySelector('a[download]')).toBeNull();
});
