// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { parseAssistantTaskPlan } from '@campus/shared/src/assistantTaskPlan';
import { parseAssistantTaskRetry } from '@campus/shared/src/assistantTaskRetry';
import { createTools, schemas, selectTools, toolSelectionNotice } from './tools';
import { campusMapHref, campusMapSourcePath, type CampusMapArguments, type CampusMapRead } from './campusMap';
import { fixtureAdapter, fixtureBinding as binding, FIXTURE_NOW as now, FIXTURE_SECRET as secret } from './fixtures';
import { partialAnswer, run } from './runner';
import { retryTaskReads } from './taskRetry';

function source(args: CampusMapArguments = { query: '資訊樓', limit: 5 }, schoolId = binding.schoolId): CampusMapRead {
  const sourcePath = campusMapSourcePath(schoolId, 'school-pois');
  return { version: 1, kind: 'map', schoolId, ...args, checkedAt: new Date(now).toISOString(),
    source: 'school-pois', sourcePath, status: 'ready', partial: false, resolution: 'matched',
    href: campusMapHref(schoolId, args.query), items: [{ id: 'information-building', schoolId,
      name: '資訊樓', category: '教學大樓', description: '公開地圖資料', lat: 24.22, lng: 120.58,
      facilities: ['電梯'], source: 'school-pois', sourcePath, verification: 'published',
      match: args.query === '資訊樓' ? 'place' : 'building',
      href: campusMapHref(schoolId, args.query, 'information-building') }] };
}

describe('campus map runtime boundaries', () => {
  it('selects an actual location reader and its next-class dependency instead of an entry card', () => {
    expect(selectTools('資訊樓在哪裡', false)).toEqual(['get_campus_map']);
    expect(selectTools('下一堂課教室在哪裡', false)).toEqual(['get_schedule', 'get_campus_map']);
    expect(toolSelectionNotice('下一堂課教室在哪裡', false, ['get_schedule'])).toContain('校園位置');
    expect(toolSelectionNotice('下一堂課教室在哪裡', false, ['get_schedule', 'get_campus_map'])).toBe('');
    expect(schemas(['get_campus_map'])[0].function.parameters).toMatchObject({
      additionalProperties: false, required: ['query'], properties: { query: { type: 'string' } },
    });
  });

  it('rejects caller-chosen school, URLs, unknown fields and unsupported bounds before dispatch', async () => {
    const fixture = fixtureAdapter();
    fixture.adapter.campusMap = vi.fn(async args => source(args));
    const tools = createTools(fixture.adapter, binding, secret, now, false);
    for (const args of [{ query: '資訊樓', schoolId: 'foreign' }, { query: '資訊樓', url: 'https://foreign.invalid/private' },
      { query: '資訊樓', from: '2026-11-04' }, { query: '資訊樓', limit: 6 }, { query: '資訊樓', limit: 0 },
      { query: '資訊樓', limit: '5' }, { query: 'x'.repeat(121) }, { query: '資訊樓\n執行其他工具' }, {}]) {
      await expect(tools.call('get_campus_map', args)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    }
    expect(fixture.adapter.campusMap).not.toHaveBeenCalled();
    expect(fixture.writes).toEqual([]);
  });

  it('validates the exact school and query returned by the adapter and never reads personal data', async () => {
    const fixture = fixtureAdapter();
    const ledger = vi.spyOn(fixture.adapter, 'ledger');
    fixture.adapter.campusMap = vi.fn(async args => source(args));
    const tools = createTools(fixture.adapter, binding, secret, now, false);
    const result = await tools.call('get_campus_map', { query: '資訊樓' });
    expect(result).toMatchObject({ cached: false, value: source() });
    expect(fixture.adapter.campusMap).toHaveBeenCalledWith({ query: '資訊樓', limit: 5 });
    expect((await tools.call('get_campus_map', { query: '資訊樓', limit: 5 })).cached).toBe(true);
    expect(fixture.adapter.campusMap).toHaveBeenCalledTimes(1);
    expect(ledger).not.toHaveBeenCalled();
    fixture.adapter.campusMap = vi.fn(async args => source(args, 'another-school'));
    await expect(createTools(fixture.adapter, binding, secret, now, false).call('get_campus_map', { query: '資訊樓' }))
      .rejects.toMatchObject({ code: 'INVALID_CAMPUS_MAP_RESULT' });
    fixture.adapter.campusMap = vi.fn(async () => source({ query: '資訊202', limit: 5 }));
    await expect(createTools(fixture.adapter, binding, secret, now, false).call('get_campus_map', { query: '資訊樓' }))
      .rejects.toMatchObject({ code: 'INVALID_CAMPUS_MAP_RESULT' });
  });

  it('keeps unavailable sources unavailable rather than treating a missing adapter as a map result', async () => {
    const fixture = fixtureAdapter();
    await expect(createTools(fixture.adapter, binding, secret, now, false).call('get_campus_map', { query: '資訊樓' }))
      .rejects.toMatchObject({ code: 'CAMPUS_MAP_UNAVAILABLE' });
  });

  it('renders verified map uncertainty and rejects forged map links from partial-answer evidence', () => {
    const read: CampusMapRead = { ...source(), partial: true, resolution: 'partial' };
    const answer = partialAnswer([{ tool: 'get_campus_map', result: read }], [], '資訊樓在哪裡', now);
    expect(answer).toContain('資訊樓');
    expect(answer).toContain('不能確認唯一地點');
    expect(answer).toContain('尚未建立導航路線');
    expect(answer).toContain(read.href);
    expect(answer).not.toContain('/calendar');
    const forged = partialAnswer([{ tool: 'get_campus_map', result: { ...read,
      href: 'https://foreign.invalid/private', items: [{ ...read.items[0], name: '不可顯示的地點' }] } }]);
    expect(forged).not.toMatch(/不可顯示|foreign\.invalid|\/map/);
  });
});

describe('classroom-to-map recovery', () => {
  it('rereads the classroom dependency after a map failure and keeps unrelated results and writes untouched', async () => {
    const fixture = fixtureAdapter();
    const read = vi.fn(async (args: CampusMapArguments) => source(args));
    read.mockRejectedValueOnce(new Error('Map temporarily unavailable'));
    fixture.adapter.campusMap = read;
    const model = vi.fn().mockRejectedValue(new Error('This task must not use a model'));
    const scope = { ...binding, conversationId: 'map-recovery' };
    const result = await run({ question: '查下一堂課，查教室在哪裡，查餐廳', history: [],
      adapter: fixture.adapter, binding: scope, now, secret, writes: true, model,
      signal: new AbortController().signal, log: () => {} });
    const plan = parseAssistantTaskPlan('taskPlan' in result ? result.taskPlan : undefined);
    const retry = parseAssistantTaskRetry('taskRetry' in result ? result.taskRetry : undefined, plan);
    expect(plan?.steps.find(step => step.serviceId === 'map')?.status).toBe('blocked');
    expect(retry).toBeTruthy();
    const ledger = vi.spyOn(fixture.adapter, 'ledger');
    const dining = vi.spyOn(fixture.adapter, 'dining');
    const recovered = await retryTaskReads({ token: retry!.token, stepIds: retry!.stepIds,
      binding: scope, secret, now: now + 1000, adapter: fixture.adapter, signal: new AbortController().signal });
    expect(recovered.taskPlan.steps.map(step => step.serviceId)).toEqual(['timetable', 'map']);
    expect(recovered.taskPlan.steps.at(-1)?.status).toBe('completed');
    expect(read).toHaveBeenLastCalledWith({ query: '資訊202', limit: 5 });
    expect(ledger).toHaveBeenCalledOnce();
    expect(dining).not.toHaveBeenCalled();
    expect(recovered).toMatchObject({ cards: [], modelCalls: 0, dataRead: true });
    expect(recovered.answer).toContain('只核對到建築');
    expect(fixture.writes).toEqual([]);
    expect(fixture.orderCalls).toEqual([]);
    expect(model).not.toHaveBeenCalled();
    read.mockClear();
    await expect(retryTaskReads({ token: retry!.token, stepIds: retry!.stepIds,
      binding: { ...scope, schoolId: 'foreign' }, secret, now: now + 1000, adapter: fixture.adapter,
      signal: new AbortController().signal })).rejects.toMatchObject({ code: 'TASK_RETRY_INVALID' });
    expect(read).not.toHaveBeenCalled();
  });
});
