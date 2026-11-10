import React from 'react';
import { Text } from 'react-native';
// Own cleanup ordering: RNTL's automatic afterEach can wait on fake timers
// before this file gets a chance to flush them and restore real timers.
import { act, cleanupAsync, render } from '@testing-library/react-native/pure';
import { useLoadable, type Loadable } from '../screens/lmsV2/_courseV2Shell';

jest.mock('../ui/theme', () => ({ theme: {} }));
jest.mock('../ui/useThemeStyleSheet', () => ({ useThemeStyleSheet: jest.fn() }));

type Snapshot = { scope: string | undefined; data: string | null; loading: boolean; error: string | null };
let current: Loadable<string>;
let snapshots: Snapshot[];

function Probe({ query, scope }: { query: () => Promise<string>; scope?: string }) {
  current = useLoadable(query, scope);
  snapshots.push({ scope, data: current.data, loading: current.loading, error: current.error });
  return <Text>{current.loading ? 'loading' : current.error ?? current.data ?? 'empty'}</Text>;
}

function delayed(value: string, delay: number, reject = false) {
  return jest.fn(() => new Promise<string>((resolve, fail) => {
    setTimeout(() => reject ? fail(new Error(value)) : resolve(value), delay);
  }));
}

async function advance(ms: number) {
  await act(async () => { jest.advanceTimersByTime(ms); });
}

beforeEach(() => {
  jest.useFakeTimers();
  snapshots = [];
});
afterEach(async () => {
  try {
    await cleanupAsync();
    await act(async () => { jest.runOnlyPendingTimers(); });
  } finally {
    jest.useRealTimers();
  }
});

it.each([
  ['course', ['course-a', 'user-a'], ['course-b', 'user-a']],
  ['identity', ['course-a', 'user-a'], ['course-a', 'user-b']],
  ['topic', ['course-a', 'topic-a', 'user-a'], ['course-a', 'topic-b', 'user-a']],
])('isolates %s changes, including an older request resolving last', async (_, before, after) => {
  const oldScope = JSON.stringify(before);
  const newScope = JSON.stringify(after);
  const view = render(<Probe query={delayed('old-data', 10)} scope={oldScope} />);
  await advance(10);
  expect(view.getByText('old-data')).toBeTruthy();
  // Leave another request in flight while there is already visible old data.
  act(() => { void current.refresh(); });
  view.rerender(<Probe query={delayed('new-data', 5)} scope={newScope} />);
  expect(view.getByText('loading')).toBeTruthy();
  expect(current.data).toBeNull();
  await advance(5);
  expect(view.getByText('new-data')).toBeTruthy();
  await advance(5);
  expect(view.getByText('new-data')).toBeTruthy();
  const newScopeRenders = snapshots.filter(s => s.scope === newScope);
  expect(newScopeRenders[0]).toEqual({ scope: newScope, data: null, loading: true, error: null });
  expect(newScopeRenders.every(s => s.data === null || s.data === 'new-data')).toBe(true);
});

it('keeps the newest request when same-scope requests resolve in reverse order', async () => {
  const oldQuery = delayed('old', 100);
  const newQuery = delayed('new', 10);
  const view = render(<Probe query={oldQuery} scope="course" />);
  const savedRefresh = current.refresh;
  view.rerender(<Probe query={newQuery} scope="course" />);
  expect(newQuery).not.toHaveBeenCalled();
  act(() => { void savedRefresh(); });
  await advance(10);
  expect(current.data).toBe('new');
  await advance(90);
  expect(current.data).toBe('new');
  expect(current.error).toBeNull();
  expect(current.loading).toBe(false);
});

it('ignores an old rejection without clearing the new request loading state', async () => {
  const view = render(<Probe query={delayed('old failure', 10, true)} scope="old" />);
  view.rerender(<Probe query={delayed('new', 100)} scope="new" />);
  await advance(10);
  expect(current).toMatchObject({ data: null, loading: true, error: null });
  await advance(90);
  expect(current.data).toBe('new');
});

it('does not reuse an earlier generation when switching back to the same scope', async () => {
  const view = render(<Probe query={delayed('first A', 100)} scope="A" />);
  view.rerender(<Probe query={delayed('B', 50)} scope="B" />);
  view.rerender(<Probe query={delayed('latest A', 10)} scope="A" />);
  await advance(100);
  expect(current.data).toBe('latest A');
});

it('uses the latest scope and query when retrying through a saved refresh', async () => {
  const view = render(<Probe query={delayed('old', 100)} scope="old" />);
  const retry = current.refresh;
  const failedQuery = delayed('retry me', 5, true);
  view.rerender(<Probe query={failedQuery} scope="new" />);
  await advance(5);
  expect(current.error).toBe('retry me');
  const latestQuery = delayed('retried new', 5);
  view.rerender(<Probe query={latestQuery} scope="new" />);
  act(() => { void retry(); });
  expect(latestQuery).toHaveBeenCalledTimes(1);
  expect(current).toMatchObject({ data: null, loading: true, error: null });
  await advance(100);
  expect(current).toMatchObject({ data: 'retried new', loading: false, error: null });
});

it.each([undefined, 'explicit-scope'])('fences unmount for scope %s, including late failures', async scope => {
  const error = jest.spyOn(console, 'error').mockImplementation(() => {});
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  try {
    const success = delayed('late success', 20);
    const view = render(<Probe query={success} scope={scope} />);
    const failure = delayed('late failure', 30, true);
    view.rerender(<Probe query={failure} scope={scope} />);
    act(() => { void current.refresh(); });
    const retry = current.refresh;
    view.unmount();
    const renderCount = snapshots.length;
    await advance(30);
    await act(async () => { await retry(); });
    expect(snapshots).toHaveLength(renderCount);
    expect(success).toHaveBeenCalledTimes(1);
    expect(failure).toHaveBeenCalledTimes(1);
    expect(error).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  } finally {
    error.mockRestore();
    warn.mockRestore();
  }
});

it('keeps the one-argument signature usable and retries with the latest query', async () => {
  function Legacy({ query }: { query: () => Promise<string> }) {
    current = useLoadable(query);
    return null;
  }
  const view = render(<Legacy query={delayed('first', 5)} />);
  await advance(5);
  expect(current.data).toBe('first');
  const latestQuery = delayed('latest', 5);
  view.rerender(<Legacy query={latestQuery} />);
  act(() => { void current.refresh(); });
  await advance(5);
  expect(current.data).toBe('latest');
});
