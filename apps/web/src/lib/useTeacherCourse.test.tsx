import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { useTeacherCourse } from './useTeacherCourse';
import { loadTeacherWorkspace, loadTeacherGradebook, watchTeacherAccess } from './teacherCourse';
const auth = vi.hoisted(() => ({ user: { uid: 'a' } as { uid: string } | null, loading: false }));
vi.mock('@/components/AuthGuard', () => ({ useAuth: () => auth }));
vi.mock('./teacherCourse', () => ({
  loadTeacherWorkspace: vi.fn(),
  loadTeacherGradebook: vi.fn(),
  watchTeacherAccess: vi.fn(),
  TeacherCourseError: class extends Error {},
}));
const data = {
  course: { id: 'course-a', name: '資料結構', description: '', role: 'instructor' },
  modules: [],
  assignments: [],
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
beforeEach(() => {
  vi.clearAllMocks();
  auth.user = { uid: 'a' };
  auth.loading = false;
  vi.mocked(loadTeacherWorkspace).mockResolvedValue(data);
  vi.mocked(loadTeacherGradebook).mockResolvedValue({ course: data.course, rows: [] });
  vi.mocked(watchTeacherAccess).mockReturnValue(vi.fn());
});
it.each(['account', 'school', 'course'] as const)(
  'hides a previous %s scope immediately and rejects late responses',
  async (changed) => {
    const pending = deferred<typeof data>();
    vi.mocked(loadTeacherWorkspace).mockReturnValueOnce(pending.promise);
    const { result, rerender } = renderHook(
      ({ school, course }) => useTeacherCourse(school, course, 'workspace'),
      { initialProps: { school: 'pu', course: 'course-a' } },
    );
    const oldGuard = vi.mocked(loadTeacherWorkspace).mock.calls[0][1]!;
    if (changed === 'account') auth.user = { uid: 'b' };
    rerender({
      school: changed === 'school' ? 'other' : 'pu',
      course: changed === 'course' ? 'course-b' : 'course-a',
    });
    expect(oldGuard()).toBe(false);
    await waitFor(() => expect(result.current.state?.status).toBe('ready'));
    await act(async () => pending.resolve({ ...data, course: { ...data.course, name: '舊資料' } }));
    expect(result.current.state?.data?.course.name).toBe('資料結構');
  },
);
it('clears sensitive rows on logout without another reader call', async () => {
  const { result, rerender } = renderHook(() => useTeacherCourse('pu', 'course-a', 'gradebook'));
  await waitFor(() => expect(result.current.state?.status).toBe('ready'));
  auth.user = null;
  rerender();
  expect(result.current.state).toBeNull();
  expect(loadTeacherGradebook).toHaveBeenCalledTimes(1);
});
it('membership revocation clears already loaded data and invalidates in-flight readers', async () => {
  const { result } = renderHook(() => useTeacherCourse('pu', 'course-a', 'workspace'));
  await waitFor(() => expect(result.current.state?.status).toBe('ready'));
  const guard = vi.mocked(loadTeacherWorkspace).mock.calls[0][1]!;
  act(() => vi.mocked(watchTeacherAccess).mock.calls[0][1]());
  expect(result.current.state?.status).toBe('error');
  expect(result.current.state?.data).toBeUndefined();
  expect(guard()).toBe(false);
});
it('retry starts a fresh server read and permission subscription after a failure', async () => {
  vi.mocked(loadTeacherWorkspace).mockRejectedValueOnce(new Error('offline'));
  const { result } = renderHook(() => useTeacherCourse('pu', 'course-a', 'workspace'));
  await waitFor(() => expect(result.current.state?.status).toBe('error'));
  const unsubscribe = vi.mocked(watchTeacherAccess).mock.results[0].value;
  act(() => result.current.refresh());
  await waitFor(() => expect(result.current.state?.status).toBe('ready'));
  expect(unsubscribe).toHaveBeenCalledTimes(1);
  expect(watchTeacherAccess).toHaveBeenCalledTimes(2);
});
it('an old permission callback cannot clear the next course data', async () => {
  const { result, rerender } = renderHook(
    ({ course }) => useTeacherCourse('pu', course, 'workspace'),
    { initialProps: { course: 'course-a' } },
  );
  await waitFor(() => expect(result.current.state?.status).toBe('ready'));
  const oldInvalidate = vi.mocked(watchTeacherAccess).mock.calls[0][1];
  rerender({ course: 'course-b' });
  await waitFor(() => expect(result.current.state?.status).toBe('ready'));
  act(() => oldInvalidate());
  expect(result.current.state?.status).toBe('ready');
});
