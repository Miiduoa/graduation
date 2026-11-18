// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { createTools, selectTools, toolSelectionNotice } from './tools';
import { run } from './runner';
import type { Model } from './contracts';
import {
  fixtureAdapter, fixtureBinding as binding, FIXTURE_NOW as now, FIXTURE_SECRET as secret,
} from './fixtures';

const compound = '查作業、教材、社團和公車';
const domainTools = ['get_due_work', 'get_materials', 'list_clubs', 'get_transit'];
const answerModel: Model = async () => ({
  message: { role: 'assistant', content: '請查看結果。' },
  usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
});

describe('tool selection coverage within eight tools', () => {
  it.each([
    ['有什麼作業要交', 'get_due_work'],
    ['查看教材', 'get_materials'],
    ['查看社團', 'list_clubs'],
    ['公車到站交通', 'get_transit'],
    ['查看點餐菜單', 'get_food_menu'],
    ['幫我點一份便當', 'propose_food_order'],
  ])('retains the primary tool for %s', (question, primary) => {
    const names = selectTools(question, false);
    expect(names).toContain(primary);
    expect(names.length).toBeLessThanOrEqual(8);
  });

  it('reserves an executable tool for every domain in the compound request', () => {
    const names = selectTools(compound, false);
    expect(names).toEqual(expect.arrayContaining(domainTools));
    expect(names).toHaveLength(8);
    expect(new Set(names).size).toBe(names.length);
  });

  it('does not delete the last tool when open-page and calendar are already absent', () => {
    // Food intent deletes open-page before trimming. No schedule intent adds calendar.
    // The old two splice(-1, 1) calls removed notifications and transit here.
    const names = selectTools('幫我點便當、查作業、社團、公車和通知', true);
    expect(names).not.toContain('propose_open_page');
    expect(names).not.toContain('get_calendar');
    expect(names).toEqual(expect.arrayContaining([
      'get_food_menu', 'get_due_work', 'list_clubs', 'get_transit', 'get_notifications',
    ]));
    expect(names.length).toBeLessThanOrEqual(8);
  });

  it('retains the exact study-plan and reorder special paths', () => {
    expect(selectTools('幫我規劃寫作業，中午吃什麼', false)).toEqual([
      'get_day_overview', 'get_today_context', 'get_due_work', 'find_free_time',
      'propose_study_plan', 'get_dining',
    ]);
    for (const question of ['再點一次', '跟上次一樣']) {
      expect(selectTools(question, false)).toEqual([
        'reorder_last_food_order', 'propose_food_order', 'get_food_menu', 'list_food_orders',
      ]);
    }
  });

  it.each(['幫我規劃作業，也查教材社團公車', '再點一次，也查作業教材社團公車'])
    ('explicitly defers domains omitted by a special path: %s', (question) => {
      const names = selectTools(question, false);
      const notice = toolSelectionNotice(question, false, names);
      expect(names.length).toBeLessThanOrEqual(8);
      expect(notice).toContain('教材');
      expect(notice).toContain('社團');
      expect(notice).toContain('公車／交通');
      expect(notice).toContain('下一輪');
    });

  it('explicitly defers overflow even when more than eight domains are requested', () => {
    const question = '作業教材社團公車圖書館點餐餐廳課表行程匯入成績服務通知';
    const names = selectTools(question, true);
    expect(names).toHaveLength(8);
    const notice = toolSelectionNotice(question, true, names);
    expect(notice).toContain('下一輪');
    expect(notice).toContain('通知');
  });

  it.each(['通知', compound + '和通知', '幫我點便當、作業、教材、通知'])
    ('never advertises simulation notifications in production: %s', (question) => {
      expect(selectTools(question, false)).not.toContain('get_notifications');
    });

  it('renders the deferred notice even when the model ignores it', async () => {
    const question = '再點一次，也查教材社團公車';
    const f = fixtureAdapter(false);
    const result = await run({
      question, history: [], binding, adapter: f.adapter,
      model: answerModel,
      secret, writes: false, signal: new AbortController().signal, now, log: () => {},
    });
    expect(result.answer).toContain('教材、社團、公車／交通');
    expect(result.answer).toContain('下一輪');
  });

  it('reports selected domains until queries actually succeed', () => {
    expect(selectTools(compound, false)).toEqual(expect.arrayContaining(domainTools));
    expect(toolSelectionNotice(compound, false, [])).toContain('作業／測驗、教材、社團、公車／交通');
    expect(toolSelectionNotice(compound, false, ['get_due_work', 'list_clubs']))
      .toContain('尚未查詢：教材、公車／交通');
    expect(toolSelectionNotice('查作業和課表', false, ['get_day_overview'])).toBe('');
  });

  it.each([
    '幫我規劃作業，也查圖書館',
    '幫我規劃作業，也查圖書館教材社團',
  ])('counts successful campus preludes in the final answer: %s', async (question) => {
    const f = fixtureAdapter(false);
    const result = await run({
      question, history: [], binding, adapter: f.adapter,
      model: answerModel,
      secret, writes: false, signal: new AbortController().signal, now, log: () => {},
    });
    expect(selectTools(question, false)).not.toContain('get_campus_info');
    expect(result.steps).toContainEqual(expect.objectContaining({ name: 'get_campus_info', status: 'ok' }));
    expect(result.answer).not.toMatch(/尚未查詢：[^。]*校園資訊/);
    if (question.includes('教材')) expect(result.answer).toContain('尚未查詢：教材、社團');
    else expect(result.answer).not.toContain('尚未查詢：');
  });

  it('counts completed preludes in partial answers after a model failure', async () => {
    const f = fixtureAdapter(false);
    const result = await run({
      question: '幫我規劃作業，也查圖書館教材社團', history: [], binding, adapter: f.adapter,
      model: async () => { throw Object.assign(new Error('Unavailable'), { status: 503 }); },
      secret, writes: false, signal: new AbortController().signal, now, log: () => {},
    });
    expect(result.steps).toContainEqual(expect.objectContaining({ name: 'get_campus_info', status: 'ok' }));
    expect(result.answer).not.toMatch(/尚未查詢：[^。]*校園資訊/);
    expect(result.answer).toMatch(/尚未查詢：[^。]*教材、社團/);
  });

  it.each([false, true])('only counts successful model tool calls (failure: %s)', async (fail) => {
    const f = fixtureAdapter(false);
    if (fail) vi.spyOn(f.adapter, 'clubs').mockRejectedValue(new Error('Unavailable'));
    let calls = 0;
    const result = await run({
      question: '查社團與教材', history: [], binding, adapter: f.adapter,
      model: async () => ({
        message: calls++ === 0
          ? { role: 'assistant', content: '', tool_calls: [{ id: 'clubs', type: 'function',
            function: { name: 'list_clubs', arguments: JSON.stringify({ tenantId: 'fixture-realm' }) } }] }
          : { role: 'assistant', content: '請查看結果。' },
        usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
      }),
      secret, writes: false, signal: new AbortController().signal, now, log: () => {},
    });
    expect(result.steps).toContainEqual(expect.objectContaining({ name: 'list_clubs', status: fail ? 'error' : 'ok' }));
    expect(result.answer).toContain(fail ? '尚未查詢：教材、社團' : '尚未查詢：教材。');
    if (!fail) expect(result.answer).not.toMatch(/尚未查詢：[^。]*社團/);
  });

  it('keeps ordering disabled without calling quote/order endpoints', async () => {
    const f = fixtureAdapter(false);
    f.adapter.simulation = false;
    const submit = vi.spyOn(f.adapter.food!, 'submit');
    const orders = vi.spyOn(f.adapter, 'orders');
    const order = vi.spyOn(f.adapter, 'order');
    const originalFetch = globalThis.fetch;
    const orderRequests = vi.fn();
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input), 'https://fixture.invalid');
      if (/\/(?:quotes|orders)(?:\/|$)/.test(url.pathname)) {
        orderRequests(url.pathname);
        throw new Error('Quote/order HTTP requests are forbidden in this test');
      }
      return originalFetch(input, init);
    });
    try {
      const result = await run({
        question: '幫我點一份便當，也查作業教材社團公車', history: [], binding,
        adapter: f.adapter,
        model: answerModel,
        secret, writes: false, signal: new AbortController().signal, now, log: () => {},
      });
      expect(result.simulation).toBe(false);
      expect(submit).toHaveBeenCalledTimes(0);
      expect(orders).toHaveBeenCalledTimes(0);
      expect(order).toHaveBeenCalledTimes(0);
      expect(orderRequests).toHaveBeenCalledTimes(0);
    } finally {
      fetch.mockRestore();
    }
  });

  it('still rejects cross-school and forged IDs before adapter dispatch', async () => {
    const f = fixtureAdapter();
    const work = vi.spyOn(f.adapter, 'work');
    const feed = vi.spyOn(f.adapter, 'feed');
    const orders = vi.spyOn(f.adapter, 'orders');
    const tools = createTools(f.adapter, binding, secret, now, false);
    await expect(tools.call('get_course_work', { workspaceId: 'forged' })).rejects.toMatchObject({ status: 403 });
    await expect(tools.call('get_club_feed', { tenantId: 'fixture-realm', communityId: 'forged' }))
      .rejects.toMatchObject({ status: 403 });
    await expect(tools.call('list_food_orders', { tenantId: 'other-school' })).rejects.toMatchObject({ status: 403 });
    expect(work).not.toHaveBeenCalled();
    expect(feed).not.toHaveBeenCalled();
    expect(orders).not.toHaveBeenCalled();
  });
});
