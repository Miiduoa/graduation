import { describe, expect, it, vi } from 'vitest';
import {
  createCareerCallableTransport,
  createWorkstudyService,
  slotLabel,
  slotValid,
  workstudyConflicts,
  transitionAllowed,
} from '@campus/shared/src/careerWorkstudy';
import { courses } from '@campus/shared/testFixtures/careerWorkstudy';
describe('work-study conflicts use the actual school period table', () => {
  it('detects partial overlap, but preserves a touching endpoint as free', () => {
    expect(
      workstudyConflicts('pu', [{ day: 1, start: '08:59', end: '09:01' }], courses).names,
    ).toEqual(['測試課程']);
    expect(workstudyConflicts('pu', [{ day: 1, start: '09:00', end: '10:00' }], courses)).toEqual({
      known: true,
      names: [],
    });
    expect(
      workstudyConflicts('pu', [{ day: 2, start: '08:10', end: '09:00' }], courses).names,
    ).toEqual([]);
  });
  it('uses NCKU period zero time instead of PU time', () => {
    expect(
      workstudyConflicts('ncku', [{ day: 1, start: '07:10', end: '07:20' }], courses).names,
    ).toEqual(['測試課程']);
    expect(
      workstudyConflicts('pu', [{ day: 1, start: '07:10', end: '07:20' }], courses).names,
    ).toEqual([]);
  });
  it('does not invent free time when course data or school times are unknown', () => {
    expect(workstudyConflicts('unknown', [], courses).known).toBe(false);
    expect(workstudyConflicts('pu', [], null).known).toBe(false);
    expect(workstudyConflicts('pu', [], []).known).toBe(false);
    expect(workstudyConflicts('pu', [], [{ ...courses[0], day: 0 }]).known).toBe(false);
    expect(workstudyConflicts('pu', [], [{ ...courses[0], start: 30 }]).known).toBe(false);
  });
  it('supports weekend slots and validates time ranges', () => {
    expect(slotLabel({ day: 7, start: '09:00', end: '10:00' })).toBe('週日 09:00–10:00');
    expect(slotValid({ day: 7, start: '24:00', end: '25:00' })).toBe(false);
    expect(slotValid({ day: 1, start: '09:00', end: '09:00' })).toBe(false);
  });
  it('requires read before decisions and never silently rewinds an outcome', () => {
    expect(transitionAllowed('submitted', 'accepted')).toBe(false);
    expect(transitionAllowed('read', 'rejected')).toBe(true);
    expect(transitionAllowed('accepted', 'interview')).toBe(false);
  });
});

describe('callable cancellation and timeout', () => {
  it.each(['abort', 'timeout', 'default timeout'] as const)(
    'aborts a hanging fetch: %s',
    async (mode) => {
      vi.useFakeTimers();
      try {
        let fetchSignal: AbortSignal | undefined;
        const fetcher = vi.fn((_url: unknown, init?: RequestInit) => {
          fetchSignal = init?.signal ?? undefined;
          // Even an uncooperative fetcher must not leave the caller waiting forever.
          return new Promise<Response>(() => {});
        }) as unknown as typeof fetch;
        const transport = createCareerCallableTransport({
          endpoint: '/isolated-career',
          authHeaders: async () => ({}),
          fetcher,
          ...(mode === 'timeout' ? { timeoutMs: 50 } : {}),
        });
        const controller = new AbortController();
        const result = createWorkstudyService('pu', transport).load('student', {
          signal: controller.signal,
        });
        const rejection = expect(result).rejects.toThrow('請重新整理後重試');
        await Promise.resolve();
        expect(fetchSignal?.aborted).toBe(false);
        if (mode === 'abort') controller.abort();
        else await vi.advanceTimersByTimeAsync(mode === 'timeout' ? 50 : 15000);
        await rejection;
        expect(fetchSignal?.aborted).toBe(true);
        expect(vi.getTimerCount()).toBe(0);
      } finally {
        vi.useRealTimers();
      }
    },
  );

  it('does not start fetching after cancellation while headers are pending', async () => {
    let headers!: (value: Record<string, string>) => void;
    const fetcher = vi.fn() as unknown as typeof fetch;
    const transport = createCareerCallableTransport({
      endpoint: '/isolated-career',
      fetcher,
      authHeaders: () =>
        new Promise((resolve) => {
          headers = resolve;
        }),
    });
    const controller = new AbortController();
    const result = transport(
      'pu',
      { action: 'list', audience: 'student' },
      { signal: controller.signal },
    );
    controller.abort();
    await expect(result).rejects.toThrow('請重新整理後重試');
    headers({});
    await Promise.resolve();
    expect(fetcher).not.toHaveBeenCalled();
  });
});
