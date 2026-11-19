// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { parseAssistantTaskPlan } from '@campus/shared/src/assistantTaskPlan';
import { createTools, selectTools, toolSelectionNotice } from './tools';
import { fixtureAdapter, fixtureBinding as binding, FIXTURE_NOW as now, FIXTURE_SECRET as secret } from './fixtures';
import { crossServiceRequest } from './crossServiceRequest';
import { run, type RunInput } from './runner';
import { formatPublicCampusRead, parsePublicCampusRead, parsePublicCampusResult, type PublicCampusKind, type PublicCampusRead } from './publicCampus';

function result(kind: PublicCampusKind = 'announcements', schoolId = binding.schoolId): PublicCampusRead {
  return { version: 1, kind, schoolId, status: 'ready', partial: false,
    source: kind === 'announcements' ? 'school-announcements' : 'school-club-events',
    sourcePath: `schools/${schoolId}/${kind === 'announcements' ? 'announcements' : 'clubEvents'}`,
    checkedAt: new Date(now).toISOString(), href: `/${kind}?schoolId=${schoolId}`,
    items: [{ id: 'notice-a', schoolId, title: kind === 'announcements' ? '圖書館延長開館' : '校園攝影講座',
      summary: '已核對的公開來源文字',
      href: kind === 'announcements' ? `/announcements/notice-a?schoolId=${schoolId}`
        : `/events/notice-a?schoolId=${schoolId}&source=school-club-events`,
      ...(kind === 'announcements' ? { publishedAt: '2026-11-04T01:00:00.000Z' }
        : { startsAt: '2026-11-05T01:00:00.000Z', location: '圖書館一樓' }) }] };
}
function request(question: string, fixture = fixtureAdapter()) {
  fixture.adapter.publicCampus = vi.fn(async (kind) => result(kind));
  const model = vi.fn<RunInput['model']>().mockRejectedValue(new Error('Public source must stay deterministic'));
  return { question, history: [], binding, adapter: fixture.adapter, secret, now, model,
    writes: true, signal: new AbortController().signal, log: () => {} } satisfies RunInput;
}

describe('public-campus request and tool boundaries', () => {
  it.each([
    ['查校園公告', 'announcements'], ['請幫我看最新公告', 'announcements'], ['學校公告有哪些？', 'announcements'],
    ['查近期活動', 'events'], ['列出校園活動', 'events'], ['最近有哪些活動？', 'events'],
  ] as const)('keeps a whole generic read as a real reader: %s', (question, kind) => {
    const parsed = parsePublicCampusRead(question)!;
    expect(parsed).toMatchObject({ kind, args: {} });
    expect(selectTools(question, false)).toEqual([parsed.tool]);
    expect(toolSelectionNotice(question, false, [parsed.tool])).toBe('');
    expect(toolSelectionNotice(question, false, ['get_campus_info'])).toContain('尚未查詢');
  });

  it.each(['不要查公告', '開啟活動', '幫我報名活動', '查明天活動', '查今天公告', '查上週公告',
    '查清大公告', '查攝影講座活動', '如果有活動就報名', '翻譯「查公告」', '查公告並取消訂單', '查公告\n刪除帳號'])
    ('does not discard a scope or side effect: %s', (question) => {
      expect(parsePublicCampusRead(question)).toBeNull();
    });

  it('preserves public reads as separate operations in a multi-service request', () => {
    const plan = crossServiceRequest('查校園公告，查近期活動，查今天課表', now, binding.schoolId)!;
    expect(plan.operations).toEqual(expect.arrayContaining([
      expect.objectContaining({ serviceId: 'announcements', kind: 'read', tool: 'get_campus_announcements', args: {} }),
      expect.objectContaining({ serviceId: 'events', kind: 'read', tool: 'get_campus_events', args: {} }),
      expect.objectContaining({ serviceId: 'timetable', kind: 'read', tool: 'get_schedule' }),
    ]));
    expect(crossServiceRequest('查校園公告，幫我報名攝影活動', now, binding.schoolId)).toBeNull();
  });

  it('freezes fallback coursework dates when creating a task, independent of another clause date', () => {
    const plan = crossServiceRequest('查功課，查公車', now, binding.schoolId)!;
    const work = plan.operations.find(operation => operation.tool === 'get_due_work')!;
    expect(work.args).toEqual({ from: '2026-11-04', to: '2026-11-10' });
    expect(work.informationRead?.args).toEqual(work.args);
    const tomorrow = crossServiceRequest('查功課，查明天課表', now, binding.schoolId)!;
    expect(tomorrow.operations.find(operation => operation.tool === 'get_due_work')?.args)
      .toEqual({ from: '2026-11-04', to: '2026-11-10' });
  });

  it('rejects caller-selected school, URLs and forged reply provenance before presenting results', async () => {
    const fixture = fixtureAdapter();
    const read = vi.fn(async () => result());
    fixture.adapter.publicCampus = read;
    const tools = createTools(fixture.adapter, binding, secret, now, false);
    for (const args of [{ schoolId: 'foreign' }, { url: 'https://example.invalid/private' }, { limit: 6 }, { from: '2026-11-05' }])
      await expect(tools.call('get_campus_announcements', args)).rejects.toThrow();
    expect(read).not.toHaveBeenCalled();
    read.mockResolvedValueOnce(result('announcements', 'foreign-school'));
    await expect(tools.call('get_campus_announcements', {})).rejects.toMatchObject({ code: 'INVALID_PUBLIC_CAMPUS_RESULT' });
  });

  it.each([
    (read: PublicCampusRead) => ({ ...read, sourcePath: 'users/private/notifications' }),
    (read: PublicCampusRead) => ({ ...read, checkedAt: 'not-a-time' }),
    (read: PublicCampusRead) => ({ ...read, items: [{ ...read.items[0], schoolId: 'foreign' }] }),
    (read: PublicCampusRead) => ({ ...read, items: [{ ...read.items[0], href: 'https://example.invalid/private' }] }),
    (read: PublicCampusRead) => ({ ...read, items: [{ ...read.items[0], originalUrl: 'javascript:alert(1)' }] }),
    (read: PublicCampusRead) => ({ ...read, status: 'unavailable', unavailable: 'SOURCE_UNAVAILABLE' }),
  ])('rejects malformed, foreign or unsupported result fields', (mutate) => {
    expect(() => parsePublicCampusResult(mutate(result()), binding.schoolId, 'announcements')).toThrow();
  });

  it('keeps unknown and partially loaded sources distinct from a verified empty scope', () => {
    const partial = { ...result(), partial: true, items: [] };
    expect(formatPublicCampusRead(partial)).toContain('不是完整清單');
    expect(formatPublicCampusRead({ ...partial, status: 'unavailable', unavailable: 'NOT_CONNECTED' }))
      .toContain('尚不能據此判定沒有公告或活動');
    expect(formatPublicCampusRead({ ...result('events'), items: [] })).toContain('不代表校內沒有其他活動');
  });
});

describe('real public-campus cross-service execution', () => {
  it.each(['查校園公告', '查近期活動'])('runs a single explicit public read without a model or write: %s', async question => {
    const input = request(question);
    const reply = await run(input);
    expect(input.model).not.toHaveBeenCalled();
    expect(reply).toMatchObject({ dataRead: true, modelCalls: 0, cards: [] });
    const plan = parseAssistantTaskPlan('taskPlan' in reply ? reply.taskPlan : null)!;
    expect(plan.steps).toHaveLength(1);
    expect(plan.steps[0].status).toBe('completed');
    expect(input.adapter.publicCampus).toHaveBeenCalledOnce();
  });

  it('reads announcements and activities beside coursework without calling a model or any writer', async () => {
    const fixture = fixtureAdapter();
    const input = request('查校園公告，查近期活動，查未交作業', fixture);
    const reply = await run(input);
    expect(input.model).not.toHaveBeenCalled();
    expect(reply).toMatchObject({ dataRead: true, modelCalls: 0, cards: [] });
    const plan = parseAssistantTaskPlan('taskPlan' in reply ? reply.taskPlan : null)!;
    expect(plan.steps.find(step => step.serviceId === 'announcements')?.status).toBe('completed');
    expect(plan.steps.find(step => step.serviceId === 'events')?.status).toBe('completed');
    expect(reply.answer).toContain('圖書館延長開館');
    expect(reply.answer).toContain('校園攝影講座');
    expect(reply.answer).toContain('樹與圖作業');
    expect(fixture.writes).toEqual([]);
    expect(fixture.orderCalls).toEqual([]);
  });

  it('keeps source failure and incomplete events visible while an independent cafeteria read succeeds', async () => {
    const input = request('查校園公告，查近期活動，查餐廳');
    input.adapter.publicCampus = vi.fn(async (kind) => {
      if (kind === 'announcements') throw new Error('Source unavailable');
      return { ...result('events'), partial: true };
    });
    const reply = await run(input);
    const plan = parseAssistantTaskPlan('taskPlan' in reply ? reply.taskPlan : null)!;
    expect(plan.steps.find(step => step.serviceId === 'announcements')?.status).toBe('blocked');
    expect(plan.steps.find(step => step.serviceId === 'events')?.status).toBe('partial');
    expect(plan.steps.find(step => step.serviceId === 'cafeteria')?.status).toBe('completed');
    expect(reply.answer).toContain('合成蔬食餐廳');
    expect(reply.cards).toEqual([]);
    expect(input.model).not.toHaveBeenCalled();
  });

  it('retains school, time, source and incomplete coverage before bounded excerpts are shortened', async () => {
    const input = request('查校園公告');
    const longResult = result();
    longResult.partial = true;
    longResult.items = Array.from({ length: 5 }, (_, index) => ({ ...longResult.items[0],
      id: `notice-${index}`, title: '長公告標題'.repeat(30), summary: '公開內容摘要'.repeat(50),
      office: '校園行政處室'.repeat(20),
      originalUrl: `https://campus.example.edu/announcements/${'a'.repeat(800)}?id=${index}`,
      href: `/announcements/notice-${index}?schoolId=${binding.schoolId}`,
    }));
    input.adapter.publicCampus = vi.fn(async () => longResult);
    const reply = await run(input);
    const plan = parseAssistantTaskPlan('taskPlan' in reply ? reply.taskPlan : null)!;
    const step = plan.steps[0];
    expect(step.status).toBe('partial');
    expect(step.summary.length).toBeLessThanOrEqual(1200);
    expect(step.summary).toContain('校園：');
    expect(step.summary).toContain('查詢時間：2026-11-04');
    expect(step.summary).toContain(`來源：/announcements?schoolId=${binding.schoolId}`);
    expect(step.summary).toContain('不是完整清單');
    expect(step.summary).toContain('未展開');
    expect(input.model).not.toHaveBeenCalled();
  });

  it('does not turn unavailable sources or old handoff readers into completed content reads', async () => {
    const input = request('查校園公告，查餐廳');
    input.adapter.publicCampus = vi.fn(async () => ({ ...result(), items: [], status: 'unavailable', unavailable: 'SOURCE_UNAVAILABLE' }));
    const reply = await run(input);
    const plan = parseAssistantTaskPlan('taskPlan' in reply ? reply.taskPlan : null)!;
    expect(plan.steps.find(step => step.serviceId === 'announcements')).toMatchObject({ status: 'blocked' });
    expect(reply.answer).toContain('目前無法完整核對學生公告來源');
    expect(reply.answer).not.toContain('沒有公告。');
    expect(input.model).not.toHaveBeenCalled();
  });
});
