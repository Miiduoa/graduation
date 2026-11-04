// @vitest-environment node
import { expect, it, vi } from 'vitest';
import { createTools, selectTools, studyTitle, validateTool } from './tools';
import { run } from './runner';
import {
  fixtureAdapter,
  fixtureBinding as binding,
  FIXTURE_NOW as now,
  FIXTURE_SECRET as secret,
} from './fixtures';
it('offers actionable recovery without granting invented ids', async () => {
  const tools = createTools(fixtureAdapter().adapter, binding, secret, now, true);
  await expect(tools.call('get_dining', { locationId: 'cafeteria' })).rejects.toMatchObject({
    code: 'FORBIDDEN_SCOPE',
  });
  expect(tools.recovery('get_dining').nextStep).toContain('get_dining {}');
  await tools.call('get_dining', {});
  expect(tools.recovery('get_dining').availableIds.length).toBeGreaterThan(0);
  expect(validateTool('get_food_locations', {})).toEqual({});
  expect(validateTool('list_food_orders', {})).toEqual({});
});
it('queries course work concurrently, reserves API pairs and reports missing coverage', async () => {
  const f = fixtureAdapter();
  f.adapter.courses = async () =>
    Array.from({ length: 8 }, (_, i) => ({ id: `c-${i}`, title: `課${i}` }));
  f.adapter.remainingApiCalls = () => 7;
  let active = 0,
    peak = 0;
  f.adapter.work = vi.fn(async (courseId) => {
    active++;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active--;
    return [
      {
        id: courseId,
        courseId,
        title: courseId,
        dueAt: '2026-11-05T12:00:00+08:00',
        submitted: false,
        state: 'open',
      },
    ];
  });
  const tools = createTools(f.adapter, binding, secret, now, true);
  const { value } = await tools.call('get_due_work', {});
  expect(peak).toBe(3);
  expect(f.adapter.work).toHaveBeenCalledTimes(3);
  expect(value).toMatchObject({
    partial: true,
    pending: expect.any(Array),
    unqueried: expect.arrayContaining([{ id: 'c-7', title: '課7', reason: 'API_BUDGET_EXCEEDED' }]),
  });
});
it('separates submitted and overdue tasks and combines the actual requested day', async () => {
  const tools = createTools(fixtureAdapter().adapter, binding, secret, now, true);
  const due = (await tools.call('get_due_work', { from: '2026-11-01', to: '2026-11-10' })).value as {
    pending: { dueAt: string }[];
    submitted: unknown[];
    overdue: unknown[];
  };
  expect(due.submitted.length).toBeGreaterThan(0);
  expect(due.overdue.length).toBeGreaterThan(0);
  expect(due.pending.map((t) => t.dueAt)).toEqual(due.pending.map((t) => t.dueAt).sort());
  const day = (await tools.call('get_day_overview', { date: '2026-11-05' })).value;
  expect(day).toMatchObject({
    date: '2026-11-05',
    schedule: { classes: expect.any(Array) },
    events: expect.any(Array),
    due: { from: '2026-11-05', to: '2026-11-05' },
    free: { slots: expect.any(Array) },
  });
});
it('reserves 900 tokens for the final round and marks retained truncated content', async () => {
  const limits: number[] = [];
  const result = await run({
    question: '你好',
    history: [],
    binding,
    adapter: fixtureAdapter().adapter,
    secret,
    now,
    writes: true,
    signal: new AbortController().signal,
    log: () => {},
    model: async (input) => {
      limits.push(input.max_completion_tokens);
      if (input.tools)
        return {
          message: { role: 'assistant', content: '部分' },
          usage: { prompt_tokens: 100, completion_tokens: 100, total_tokens: 200 },
          finishReason: 'length',
        };
      return {
        message: { role: 'assistant', content: '已完成部分' },
        usage: { prompt_tokens: 100, completion_tokens: 100, total_tokens: 200 },
        finishReason: 'length',
      };
    },
  });
  expect(limits).toEqual([256, 900]);
  expect(result.answer).toContain('已完成部分');
  expect(result.answer).toContain('輸出達上限');
  expect(result.usage.total_tokens).toBeLessThanOrEqual(7000);
});
it('normalizes titles and retains essential domain tools', () => {
  expect(studyTitle('寫「樹與圖作」作業')).toBe('寫作業：樹與圖作業');
  expect(studyTitle('寫「樹與圖作業」作業')).toBe('寫作業：樹與圖作業');
  expect(studyTitle('寫作業：寫作業：「樹與圖作業」')).toBe('寫作業：樹與圖作業');
  expect(selectTools('幫我點餐', false)).toEqual(
    expect.arrayContaining(['get_food_locations', 'get_food_menu', 'propose_food_order']),
  );
  expect(selectTools('這禮拜要交什麼作業', false)).toContain('get_due_work');
  expect(selectTools('規劃明天課作業吃飯', false)).toEqual(
    expect.arrayContaining(['get_day_overview', 'find_free_time', 'propose_study_plan']),
  );
  expect(selectTools('公車交通', false)).toContain('get_transit');
});
it('returns completed courses when another course reaches its deadline', async () => {
  vi.useFakeTimers();
  try {
    const f = fixtureAdapter();
    f.adapter.courses = async () => [
      { id: 'fast', title: '已查' },
      { id: 'slow', title: '未查' },
    ];
    f.adapter.work = async (courseId) =>
      courseId === 'slow'
        ? new Promise(() => {})
        : [
            {
              id: 'a',
              courseId,
              title: '作業',
              dueAt: '2026-11-05T12:00:00+08:00',
              submitted: false,
              state: 'open',
            },
          ];
    const tools = createTools(f.adapter, binding, secret, now, true);
    const pending = tools.call('get_due_work', {});
    await vi.advanceTimersByTimeAsync(3001);
    expect((await pending).value).toMatchObject({
      partial: true,
      pending: [{ id: 'a' }],
      unqueried: [{ id: 'slow', reason: 'DEADLINE_EXCEEDED' }],
    });
  } finally {
    vi.useRealTimers();
  }
});
