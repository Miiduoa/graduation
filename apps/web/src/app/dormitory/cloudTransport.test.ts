import { beforeEach, expect, it, vi } from 'vitest';
import { subscribeDormCloud } from './cloud';

const calls = vi.hoisted(() => ({
  queries: [] as unknown[][],
  paths: [] as unknown[][],
  stop: vi.fn(),
}));
vi.mock('@/lib/firebase', () => ({ getDb: () => 'db', areFunctionsConfigured: () => false }));
vi.mock('firebase/firestore', () => ({
  collection: (...args: unknown[]) => {
    calls.paths.push(args);
    return args;
  },
  doc: (...args: unknown[]) => args,
  where: (...args: unknown[]) => args,
  query: (...args: unknown[]) => {
    calls.queries.push(args);
    return args;
  },
  onSnapshot: () => calls.stop,
}));
beforeEach(() => {
  calls.queries = [];
  calls.paths = [];
  calls.stop.mockClear();
});
it('reads only the signed-in recipient and repair author at the selected canonical school', () => {
  const stop = subscribeDormCloud('tw-pu', 'student-a', vi.fn());
  expect(calls.paths).toEqual([
    ['db', 'schools', 'pu', 'packages'],
    ['db', 'schools', 'pu', 'repairRequests'],
  ]);
  expect(calls.queries[0][1]).toEqual(['recipientId', '==', 'student-a']);
  expect(calls.queries[1][1]).toEqual(['userId', '==', 'student-a']);
  stop();
  expect(calls.stop).toHaveBeenCalledTimes(3);
});
it('does not fallback to another school or root collections for an empty school result', () => {
  subscribeDormCloud('nthu', 'student-b', vi.fn())();
  expect(calls.paths.every((path) => path[2] === 'nthu')).toBe(true);
  expect(calls.paths).toHaveLength(2);
});

it('does not overwrite the last private projection with later legacy snapshots or loss of availability', async () => {
  const { watchDormParcels } = await import('@campus/shared/src/dormitoryCloud');
  type Rows = Array<{ id: string; data: Record<string, unknown> }>;
  let legacyRows!: (value: Rows) => void;
  let availability!: (value: boolean) => void;
  const rows = vi.fn();
  const error = vi.fn();
  const privateRows = [{ id: 'dw_private', data: { description: '待領包裹' } }];
  const stop = watchDormParcels(
    (next) => {
      legacyRows = next;
      next([]);
      return () => {};
    },
    (next) => {
      availability = next;
      next(true);
      return () => {};
    },
    async () => ({ rows: privateRows }),
    rows,
    error,
  );
  try {
    await Promise.resolve();
    expect(rows).toHaveBeenLastCalledWith(privateRows);
    rows.mockClear();
    legacyRows([{ id: 'legacy', data: {} }]);
    expect(rows).not.toHaveBeenCalled();
    availability(false);
    expect(rows).toHaveBeenLastCalledWith([{ id: 'legacy', data: {} }, ...privateRows]);
    legacyRows([]);
    expect(rows).toHaveBeenLastCalledWith(privateRows);
    expect(error).toHaveBeenCalledTimes(2);
  } finally {
    stop();
  }
});
