// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { parseAssistantTaskPlan } from '@campus/shared/src/assistantTaskPlan';
import { crossServiceRequest } from './crossServiceRequest';
import { run } from './runner';
import { fixtureAdapter, fixtureBinding as binding, FIXTURE_NOW as now, FIXTURE_SECRET as secret } from './fixtures';

describe('compound task intent and source scope', () => {
  it('inherits a single requested day for omitted schedule/calendar dates', () => {
    const plan = crossServiceRequest('幫我查明天課表和個人行程，另外查公車', now)!;
    expect(plan.operations.filter(step => step.kind === 'read').map(step => step.args)).toEqual([
      { from: '2026-11-05', to: '2026-11-05' }, { from: '2026-11-05', to: '2026-11-05' },
    ]);
  });

  it('preserves separately specified dates and does not guess the date of a later plan', () => {
    const plan = crossServiceRequest('查今天課表，查明天個人行程', now)!;
    expect(plan.operations.map(step => step.args.from)).toEqual(['2026-11-04', '2026-11-05']);
    expect(crossServiceRequest('查今天課表，查明天個人行程，安排讀書', now)).toBeNull();
  });

  it('keeps a named task, unsupported clause, conditional or multi-window request on the existing path', () => {
    for (const text of [
      '查今天課表，安排資料庫作業準備30分鐘',
      '查今天課表，幫我刪除宿舍備忘並建立專題會議',
      '查今天課表，關於圖書館的英文解釋並計算微積分',
      '查今天課表，計算2加2',
      '查明天課表，安排明天早上30分鐘和下午60分鐘作業準備',
      '查今天課表，安排作業準備30分鐘和60分鐘',
      '查今天課表，安排早上30分鐘下午60分鐘讀書',
      '如果我說查課表，安排讀書要怎麼做',
      '不要查課表，查公車',
      '翻譯「查課表，安排讀書」',
      '查今天課表，每天安排讀書',
      '查今天課表，安排今天25:00到26:00讀書',
      '查未交作業，安排今晚下午讀書一小時',
      '查未交作業，安排明晚上午讀書一小時',
      '查未交作業，安排今天早上15:00到16:00讀書',
    ]) expect(crossServiceRequest(text, now), text).toBeNull();
  });

  it('accepts task sequencing and exact windows without silently multiplying the duration', () => {
    const plan = crossServiceRequest('先查我的課表，然後安排今天15:00到16:00讀書', now)!;
    expect(plan.operations.find(step => step.kind === 'study')?.args).toEqual({
      date: '2026-11-04', from: '15:00', to: '16:00', minMinutes: 60, taskLimit: 1,
    });
    const afternoon = crossServiceRequest('查課表，安排今天下午作業準備30分鐘', now)!;
    expect(afternoon.operations.find(step => step.kind === 'study')?.args).toMatchObject({ from: '13:00', to: '18:00', minMinutes: 30 });
    for (const text of ['查未交作業，安排明晚讀書一小時', '查未交作業，安排明天晚間讀書一小時']) {
      expect(crossServiceRequest(text, now)?.operations.find(step => step.kind === 'study')?.args)
        .toMatchObject({ date: '2026-11-05', from: '18:00', to: '22:00', minMinutes: 60, taskLimit: 1 });
    }
  });

  it('recognizes material lookup as a separate task and records every work source dependency', () => {
    const plan = crossServiceRequest('查今天作業，查明天測驗，找對應教材，安排明天讀書', now)!;
    const sources = plan.operations.filter(step => step.tool === 'get_due_work');
    expect(sources.map(step => step.directRead?.taskKind)).toEqual(['assignment', 'quiz']);
    for (const operation of plan.operations.filter(step => ['materials', 'study'].includes(step.kind)))
      expect(operation.dependsOn).toEqual(expect.arrayContaining(sources.map(step => step.id)));
  });

  it('keeps find-free-time read only and supports my-club phrasing', () => {
    const plan = crossServiceRequest('查今天作業，找今天30分鐘空堂', now)!;
    expect(plan.operations.some(step => step.kind === 'study')).toBe(false);
    expect(plan.operations.find(step => step.kind === 'free-time')?.args).not.toHaveProperty('taskLimit');
    expect(crossServiceRequest('查我的社團，查公車資訊', now)?.operations.map(step => step.kind)).toEqual(['clubs', 'transit']);
  });

  it('uses exact handoffs for disconnected services and rejects invalid clock context', () => {
    const plan = crossServiceRequest('查課表，開啟宿舍報修，查圖書館', now)!;
    expect(plan.operations.filter(step => step.kind === 'handoff').map(step => step.serviceId)).toEqual(['dormitory', 'library']);
    expect(crossServiceRequest('查課表，查公車', 1e30)).toBeNull();
    expect(crossServiceRequest('查課表，查公車', NaN)).toBeNull();
  });
});

async function ask(question: string, fixture = fixtureAdapter()) {
  const model = vi.fn(async () => { throw new Error('Compound requests must not use the model'); });
  const result = await run({ question, history: [], binding: { ...binding, conversationId: 'scope-' + Math.random() },
    adapter: fixture.adapter, model, secret, writes: true, signal: new AbortController().signal, now, log: () => {} });
  expect(model).not.toHaveBeenCalled();
  expect(parseAssistantTaskPlan('taskPlan' in result ? result.taskPlan : null)).not.toBeNull();
  return result;
}

describe('compound task evidence integrity', () => {
  it('does not select a quiz hidden by an assignment-only query', async () => {
    const fixture = fixtureAdapter();
    fixture.adapter.work = async () => [
      { id: 'quiz', courseId: 'course-a', kind: 'quiz', title: '不可排入的小考', dueAt: '2026-11-05T12:00:00+08:00', state: 'open', submitted: false },
      { id: 'assignment', courseId: 'course-a', kind: 'assignment', title: '指定來源的作業', dueAt: '2026-11-05T23:00:00+08:00', state: 'open', submitted: false },
    ];
    const result = await ask('查明天作業，安排明天30分鐘讀書', fixture);
    expect(result.cards).toHaveLength(1);
    expect(result.cards[0].args.title).toContain('指定來源的作業');
    expect(JSON.stringify(result.cards)).not.toContain('不可排入的小考');
  });

  it('rejects an ambiguous task id even when the conflicting kind was not displayed', async () => {
    const fixture = fixtureAdapter();
    fixture.adapter.work = async () => [
      { id: 'same', courseId: 'course-a', kind: 'assignment', title: '作業', dueAt: '2026-11-05T12:00:00+08:00', state: 'open', submitted: false },
      { id: 'same', courseId: 'course-a', kind: 'quiz', title: '測驗', dueAt: '2026-11-05T23:00:00+08:00', state: 'open', submitted: false },
    ];
    const result = await ask('查明天作業，安排明天30分鐘讀書', fixture);
    expect(result.cards).toHaveLength(0);
  });

  it('uses all explicitly requested work sources while preserving their dates and kinds', async () => {
    const fixture = fixtureAdapter();
    fixture.adapter.work = async () => [
      { id: 'assignment', courseId: 'course-a', kind: 'assignment', title: '今日作業', dueAt: '2026-11-04T23:00:00+08:00', state: 'open', submitted: false },
      { id: 'quiz', courseId: 'course-a', kind: 'quiz', title: '明日測驗', dueAt: '2026-11-05T23:00:00+08:00', state: 'open', submitted: false },
      { id: 'outside', courseId: 'course-a', kind: 'assignment', title: '不可自動選入的明日作業', dueAt: '2026-11-05T23:00:00+08:00', state: 'open', submitted: false },
    ];
    const result = await ask('查今天要交的作業，查明天測驗，安排今天讀書', fixture);
    expect(result.cards.map(card => card.args.title)).toEqual(['寫作業：今日作業', '寫作業：明日測驗']);
  });

  it('marks remaining assignments and incomplete club feeds as partial', async () => {
    const fixture = fixtureAdapter();
    fixture.adapter.work = async () => Array.from({ length: 5 }, (_, index) => ({ id: 'work-' + index,
      courseId: 'course-a', kind: 'assignment' as const, title: '作業' + index,
      dueAt: '2026-11-05T23:00:00+08:00', state: 'open', submitted: false }));
    fixture.adapter.feed = async () => ({ posts: [{ title: '社團公告' }], nextCursor: 'next', truncated: true });
    const result = await ask('查未交作業，安排作業各30分鐘，查社團動態', fixture);
    const plan = parseAssistantTaskPlan('taskPlan' in result ? result.taskPlan : null)!;
    expect(plan.steps.find(step => step.label === '安排作業準備時間')).toMatchObject({ status: 'partial' });
    expect(plan.steps.find(step => step.serviceId === 'clubs')).toMatchObject({ status: 'partial' });
    expect(result.answer).toContain('其餘 1 份保留待辦');
  });

  it('passes only the single observed stop id to an arrival lookup', async () => {
    const fixture = fixtureAdapter();
    fixture.adapter.transit = vi.fn(async args => args.action === 'campus'
      ? { status: 'ready', kind: 'stops', stops: [{ id: 'observed-stop', city: 'Taichung', name: '校門口' }] }
      : { status: 'ready', kind: 'arrivals', arrivals: [{ route: '301', destination: '臺中車站', seconds: 180, status: 0 }] });
    const result = await ask('查課表，查公車到站', fixture);
    expect(fixture.adapter.transit).toHaveBeenLastCalledWith({ action: 'arrivals', city: 'Taichung', stopId: 'observed-stop' });
    expect(result.answer).toContain('預估 3 分鐘');
    expect(result.answer).not.toContain('查詢時間：未提供');
  });
});
