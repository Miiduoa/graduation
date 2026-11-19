// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PublicCourseAssistantSearch } from '@campus/shared/src/publicCourseAssistant';
import { resolvePublicCourseOperation, type PublicCourseOperationSchoolId } from '@campus/shared/src/publicCourseOperations';
import type { PublicCourseFilters } from '@campus/shared/src/publicCourseFilters';
import { executePublicCourseOperation, type PublicCourseOperationResult } from '../../server/publicCourseOperations';
import { createAdapter } from './adapter';
import { withOperationSignal } from './operation';
import { PUBLIC_COURSE_TOOL_TIMEOUT_MS } from './publicCourses';

vi.mock('../../server/publicCourseOperations', () => ({ executePublicCourseOperation: vi.fn() }));

const execute = vi.mocked(executePublicCourseOperation);
const search: PublicCourseAssistantSearch = { kind: 'search', schoolId: 'nthu', query: '資料庫' };
const source = (signal = new AbortController().signal, account = 'alice') => createAdapter({
  sessionHandle: `private-session-${account}`, expiresAt: Date.now() + 60_000,
}, 'pu', signal);

function catalog(schoolId: PublicCourseOperationSchoolId = 'nthu', filters?: PublicCourseFilters): PublicCourseOperationResult {
  const operation = resolvePublicCourseOperation(schoolId, filters ? 2 : 1)!;
  const common = { schoolId, sourceUrl: operation.sourceUrl, fetchedAt: '2026-11-14T06:00:00.000Z',
    courses: [], truncated: false };
  return filters ? { ...common, filters, unresolvedCount: 0,
    operation: { id: operation.id, access: 'anonymous-public', version: 2, responseSchemaVersion: 2 } }
    : { ...common, operation: { id: operation.id, access: 'anonymous-public', version: 1, responseSchemaVersion: 1 } };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

beforeEach(() => {
  execute.mockReset();
  execute.mockResolvedValue(catalog());
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('Unexpected direct fetch'); }));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('public course adapter source boundary', () => {
  it.each(['nthu', 'ncnu'] as const)('dispatches the reviewed %s operation independently of the private campus', async schoolId => {
    const result = catalog(schoolId);
    execute.mockResolvedValue(result);
    const adapter = source();
    await expect(adapter.adapter.publicCourses!({ ...search, schoolId })).resolves.toBe(result);
    expect(execute).toHaveBeenCalledExactlyOnceWith(`${schoolId}.courses.search`, { query: '資料庫' }, 1);
    expect(fetch).not.toHaveBeenCalled();
    expect(adapter.apiCalls()).toBe(1);
    expect(adapter.adapter.remainingApiCalls!()).toBe(11);
  });

  it('projects only the canonical query and exact supported filters, without account, session or history metadata', async () => {
    const requested = { ...search, filters: { weekday: 7, credits: 0 },
      session: 'private-session-in-request', accountId: 'private-account',
      history: [{ role: 'user', content: 'private-coursework-title' }],
      headers: { Authorization: 'Bearer private-secret' }, endpoint: 'https://example.invalid/steal',
      operationId: 'private.write', version: 9999 };
    const result = catalog('nthu', requested.filters);
    execute.mockResolvedValue(result);
    await expect(source().adapter.publicCourses!(requested)).resolves.toBe(result);
    expect(execute).toHaveBeenCalledExactlyOnceWith('nthu.courses.search', { query: '資料庫', weekday: 7, credits: 0 }, 2);
    expect(JSON.stringify(execute.mock.calls)).not.toMatch(/private-|Authorization|Bearer|history|endpoint/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('retains a query-only empty filter object as v1 and permits the public catalog query length in Unicode code points', async () => {
    const query = '𠀀'.repeat(80);
    await source().adapter.publicCourses!({ ...search, query, filters: {} });
    expect(execute).toHaveBeenCalledExactlyOnceWith('nthu.courses.search', { query }, 1);
  });

  it.each([
    ['unsupported school', { ...search, schoolId: 'pu' }],
    ['caller URL as school', { ...search, schoolId: 'https://example.invalid/catalog' }],
    ['non-string query', { ...search, query: 3 }],
    ['overlong query', { ...search, query: '𠀀'.repeat(81) }],
    ['weekday zero', { ...search, filters: { weekday: 0 } }],
    ['weekday eight', { ...search, filters: { weekday: 8 } }],
    ['fractional weekday', { ...search, filters: { weekday: 2.5 } }],
    ['string credits', { ...search, filters: { credits: '3' } }],
    ['negative credits', { ...search, filters: { credits: -1 } }],
    ['excessive credits', { ...search, filters: { credits: 41 } }],
    ['non-finite credits', { ...search, filters: { credits: NaN } }],
    ['unsupported filter', { ...search, filters: { semester: '1151' } }],
    ['filter replacing school', { ...search, filters: { schoolId: 'ncnu' } }],
    ['filter replacing query', { ...search, filters: { query: '被替換的查詢' } }],
    ['null filters', { ...search, filters: null }],
    ['array filters', { ...search, filters: [] }],
  ])('rejects %s before spending a source request', async (_name, requested) => {
    const adapter = source();
    await expect(adapter.adapter.publicCourses!(requested as unknown as PublicCourseAssistantSearch)).rejects.toThrow();
    expect(execute).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect(adapter.apiCalls()).toBe(0);
    expect(adapter.adapter.remainingApiCalls!()).toBe(12);
  });

  it('rejects filter accessors without evaluating them', async () => {
    const getter = vi.fn(() => 2);
    const filters = Object.defineProperty({}, 'weekday', { enumerable: true, get: getter });
    await expect(source().adapter.publicCourses!({ ...search, filters })).rejects.toThrow();
    expect(getter).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });

  it.each(['kind', 'schoolId', 'query', 'filters'] as const)('rejects an outer %s accessor without evaluating it', async field => {
    const values = { ...search, filters: { weekday: 2 } };
    const getter = vi.fn(() => values[field]);
    const requested = Object.defineProperty({ ...values }, field, { enumerable: true, get: getter });
    const adapter = source();
    await expect(adapter.adapter.publicCourses!(requested)).rejects.toMatchObject({ status: 422, code: 'INVALID_INPUT' });
    expect(getter).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect(adapter.apiCalls()).toBe(0);
  });

  it('shares the twelve-call allowance with existing adapter reads and starts a new allowance for another turn', async () => {
    const adapter = source();
    for (let index = 0; index < 11; index++) await adapter.adapter.publicCourses!(search);
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ cafeterias: [] })));
    await adapter.adapter.dining();
    expect(adapter.adapter.remainingApiCalls!()).toBe(0);
    await expect(adapter.adapter.publicCourses!(search)).rejects.toMatchObject({ status: 429, code: 'API_BUDGET_EXCEEDED' });
    expect(execute).toHaveBeenCalledTimes(11);
    expect(fetch).toHaveBeenCalledOnce();
    const anotherTurn = source();
    await anotherTurn.adapter.publicCourses!(search);
    expect(anotherTurn.adapter.remainingApiCalls!()).toBe(11);
    expect(execute).toHaveBeenCalledTimes(12);
  });

  it('propagates a failed public source instead of inventing an empty course list', async () => {
    const failure = new Error('Public source unavailable');
    execute.mockRejectedValue(failure);
    await expect(source().adapter.publicCourses!(search)).rejects.toBe(failure);
    expect(execute).toHaveBeenCalledOnce();
  });
});

describe('public course adapter cancellation and deadline', () => {
  it.each(['parent', 'operation'] as const)('does not start a source for an already aborted %s signal', async owner => {
    const parent = new AbortController(), operation = new AbortController();
    (owner === 'parent' ? parent : operation).abort();
    const adapter = source(parent.signal);
    await expect(withOperationSignal(operation.signal, () => adapter.adapter.publicCourses!(search))).rejects.toThrow();
    expect(execute).not.toHaveBeenCalled();
    expect(adapter.apiCalls()).toBe(0);
  });

  it.each(['parent', 'operation'] as const)('stops the %s caller while leaving a shared public snapshot available to another account', async owner => {
    const pendingSource = deferred<PublicCourseOperationResult>();
    execute.mockReturnValue(pendingSource.promise);
    const parent = new AbortController(), operation = new AbortController();
    const cancelledCaller = source(parent.signal, 'alice'), otherCaller = source(undefined, 'bob');
    const first = withOperationSignal(operation.signal, () => cancelledCaller.adapter.publicCourses!(search));
    const rejected = expect(first).rejects.toMatchObject({ status: 499, code: 'ABORTED' });
    const second = otherCaller.adapter.publicCourses!(search);
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(2));
    (owner === 'parent' ? parent : operation).abort();
    await rejected;
    const result = catalog();
    pendingSource.resolve(result);
    await expect(second).resolves.toBe(result);
    for (const args of execute.mock.calls)
      expect(args).toEqual(['nthu.courses.search', { query: '資料庫' }, 1]);
    expect(otherCaller.adapter.remainingApiCalls!()).toBe(11);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('times out the caller without cancelling the shared source or converting the timeout into empty results', async () => {
    vi.useFakeTimers();
    const pendingSource = deferred<PublicCourseOperationResult>();
    execute.mockReturnValue(pendingSource.promise);
    const parent = new AbortController();
    const first = source(parent.signal).adapter.publicCourses!(search);
    const rejected = expect(first).rejects.toMatchObject({ status: 504, code: 'DEADLINE_EXCEEDED' });
    await vi.advanceTimersByTimeAsync(PUBLIC_COURSE_TOOL_TIMEOUT_MS);
    await rejected;
    expect(parent.signal.aborted).toBe(false);
    const second = source(undefined, 'bob').adapter.publicCourses!(search);
    const result = catalog();
    pendingSource.resolve(result);
    await expect(second).resolves.toBe(result);
    expect(execute).toHaveBeenCalledTimes(2);
    expect(fetch).not.toHaveBeenCalled();
  });
});
