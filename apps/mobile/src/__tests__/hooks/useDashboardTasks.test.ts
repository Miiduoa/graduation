import { act, renderHook } from '@testing-library/react-native';
import type { NextBestAction } from '../../data';
import { useDashboardTasks } from '../../hooks/useDashboardTasks';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const tasks = [{ id: 'school-a-reminder' }] as NextBestAction[];

test('a failed read remains an error until a successful retry confirms an empty result', async () => {
  const load = jest.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce([]);
  const view = renderHook(() => useDashboardTasks('account-a:school-a', load));
  await act(() => view.result.current.refresh());
  expect(view.result.current.status).toBe('error');
  await act(() => view.result.current.refresh());
  expect(view.result.current.status).toBe('ready');
  expect(view.result.current.tasks).toEqual([]);
});

test('a slow older read cannot replace the result of a newer refresh', async () => {
  const old = deferred<NextBestAction[]>();
  const load = jest.fn().mockReturnValueOnce(old.promise).mockResolvedValueOnce([]);
  const view = renderHook(() => useDashboardTasks('account-a:school-a', load));
  act(() => {
    void view.result.current.refresh();
  });
  await act(() => view.result.current.refresh());
  await act(async () => old.resolve(tasks));
  expect(view.result.current.status).toBe('ready');
  expect(view.result.current.tasks).toEqual([]);
});

test('masks prior school tasks immediately and ignores their delayed response after an account switch', async () => {
  const old = deferred<NextBestAction[]>();
  const load = jest
    .fn()
    .mockResolvedValueOnce(tasks)
    .mockReturnValueOnce(old.promise)
    .mockResolvedValueOnce([]);
  const view = renderHook(({ scope }) => useDashboardTasks(scope, load), {
    initialProps: { scope: 'account-a:school-a' },
  });
  await act(() => view.result.current.refresh());
  expect(view.result.current.tasks).toEqual(tasks);
  view.rerender({ scope: 'account-b:school-b' });
  expect(view.result.current.tasks).toEqual([]);
  expect(view.result.current.status).toBe('loading');
  act(() => {
    void view.result.current.refresh();
  });
  view.rerender({ scope: 'account-c:school-c' });
  await act(() => view.result.current.refresh());
  await act(async () => old.resolve(tasks));
  expect(view.result.current.status).toBe('ready');
  expect(view.result.current.tasks).toEqual([]);
});
