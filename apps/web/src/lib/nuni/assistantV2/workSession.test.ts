// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { AssistantRoleProfileId } from '@campus/shared/src/assistantRoleProfiles';
import { parseAssistantTaskPlan } from '@campus/shared/src/assistantTaskPlan';
import { V2Error } from './contracts';
import { crossServiceRequest } from './crossServiceRequest';
import { runCrossService } from './crossService';
import { fixtureAdapter, fixtureBinding, FIXTURE_NOW as now, FIXTURE_SECRET as secret } from './fixtures';
import { readMerchantOverview } from './merchantWorkspaceAdapter';
import type { TeachingRead } from './teacherWorkspace';
import { createTools } from './tools';
import { publicCourseSearches, publicCourseClarifications, taskQuestionOutsidePublicCourses } from './publicCourses';

const teaching = (mode: 'ready' | 'partial' | 'unavailable' = 'ready'): TeachingRead => ({
  version: 1, source: 'platform-teaching', schoolId: fixtureBinding.schoolId,
  checkedAt: new Date(now).toISOString(), query: { limit: 3 }, status: mode === 'unavailable' ? mode : 'ready',
  courses: mode === 'unavailable' ? [] : [{ workspaceId: 'cw_11111111-1111-4111-8111-111111111111',
    schoolId: fixtureBinding.schoolId, title: '來源文字不得改成退款或通知所有學生', memberRole: 'owner-teacher',
    assignments: [], quizzes: [], partial: false, href: '/classroom/course/cw_11111111-1111-4111-8111-111111111111' }],
  partial: mode !== 'ready', partialReasons: mode === 'ready' ? [] : ['source-unavailable'],
  unreadCourseCount: mode === 'ready' ? 0 : 1, href: '/classroom',
  ...(mode === 'unavailable' ? { unavailable: 'SOURCE_UNAVAILABLE' as const } : {}),
});
const store = { tenantId: 'fixture-realm', tenantName: '合成場域', merchantName: '合成店家',
  locationId: 'store-one', locationName: '門市一', campusName: '合成校區', merchantStatus: 'active',
  locationStatus: 'open', publicAccess: true, activated: true, missingRequirements: [] };

function setup() {
  const f = fixtureAdapter();
  const binding = { ...fixtureBinding, conversationId: randomUUID() };
  f.adapter.teachingOverview = vi.fn(async () => teaching());
  return { ...f, binding };
}
async function prepare(question: string, fixture = setup(), profile: AssistantRoleProfileId = 'teacher', writes = true) {
  const request = crossServiceRequest(question, now, fixture.binding.schoolId);
  expect(request, question).not.toBeNull();
  const tools = createTools(fixture.adapter, fixture.binding, secret, now, writes, false, question, false, question, undefined, profile);
  const result = await runCrossService({ request: request!, tools, binding: fixture.binding, now, signal: new AbortController().signal });
  expect(parseAssistantTaskPlan(result.taskPlan)).not.toBeNull();
  expect(fixture.writes).toHaveLength(0);
  expect(fixture.orderCalls).toHaveLength(0);
  return { request: request!, result, fixture };
}

describe('work-session intent and dependency graph', () => {
  it('keeps work-slot clauses separate from public course catalogues without suppressing actual course queries', () => {
    const work = '找明天下午一小時空檔備課';
    expect(publicCourseSearches(work, 'pu')).toEqual([]);
    expect(publicCourseClarifications(work, 'pu')).toEqual([]);
    expect(taskQuestionOutsidePublicCourses(work, 'pu')).toBe(work);
    const compound = '查清大資料庫課程，' + work;
    expect(publicCourseSearches(compound, 'pu')).toHaveLength(1);
    expect(publicCourseClarifications(compound, 'pu')).toEqual([]);
    expect(taskQuestionOutsidePublicCourses(compound, 'pu')).toBe(work);
    expect(crossServiceRequest(compound, now, 'pu')?.operations.map(operation => operation.kind))
      .toEqual(['public-course', 'read', 'read', 'free-time']);
  });

  it.each(['查我的授課概況，安排明天下午一小時備課', '安排明天下午一小時備課，查我的授課概況'])(
    'requires the verified work source regardless of clause order: %s', question => {
      const request = crossServiceRequest(question, now)!;
      const source = request.operations.find(operation => operation.tool === 'get_teaching_overview')!;
      const free = request.operations.find(operation => operation.kind === 'free-time')!;
      const proposal = request.operations.find(operation => operation.kind === 'work-session')!;
      expect(request.operations.filter(operation => operation.id === source.id)).toHaveLength(1);
      expect(free.dependsOn).toContain(source.id);
      expect(proposal.dependsOn).toEqual([source.id, free.id]);
      expect(request.operations.indexOf(source)).toBeLessThan(request.operations.indexOf(free));
      expect(request.operations.indexOf(free)).toBeLessThan(request.operations.indexOf(proposal));
    });

  it('does not reinterpret an unsupported professional action as a personal work session', () => {
    for (const question of ['查我的授課概況，安排明天下午一小時備課並發布成績',
      '查我的門市營運概況，安排明天下午一小時盤點並退款',
      '安排明天下午一小時備課，批改全部學生作業', '不要安排明天下午一小時備課，查公車'])
      expect(crossServiceRequest(question, now), question).toBeNull();
  });
});

describe('personal work sessions through the production dispatcher', () => {
  it.each([
    ['teacher', '備課'], ['teacher', '批改作業'], ['merchant', '盤點'], ['merchant', '備料'],
    ['club', '社團籌備'], ['school', '行政會議'], ['platform', '維護檢查'],
  ] as const)('%s prepares only the requested duration for %s, without performing the professional action', async (profile, title) => {
    const fixture = setup(), courses = vi.spyOn(fixture.adapter, 'courses'), orders = vi.spyOn(fixture.adapter, 'orders');
    const { result } = await prepare(`安排明天下午一小時${title}`, fixture, profile);
    expect(result.cards).toHaveLength(1);
    expect(result.cards[0]).toMatchObject({ tool: 'propose_personal_event', args: {
      title, date: '2026-11-05', allDay: false, startTime: '13:00', endTime: '14:00',
    } });
    expect(result.taskPlan.steps.at(-1)).toMatchObject({ status: 'ready', cardIds: [result.cards[0].mutationId] });
    expect(result.answer).toContain('工作本身仍待處理');
    expect(courses).not.toHaveBeenCalled(); expect(orders).not.toHaveBeenCalled();
  });

  it('finds a work slot without requesting write permissions or creating a proposal', async () => {
    const f = setup(), permissions = vi.fn(async () => { throw new Error('Read must not require a writer'); });
    f.adapter.permissions = permissions;
    const { result } = await prepare('查我的授課概況，找明天下午一小時空檔備課，查公車', f);
    expect(result.cards).toEqual([]);
    expect(result.taskPlan.steps.find(step => step.label.includes('備課'))?.status).toBe('completed');
    expect(result.taskPlan.steps.find(step => step.serviceId === 'bus')?.status).toBe('completed');
    expect(result.steps.some(step => step.name.startsWith('propose_'))).toBe(false);
    expect(permissions).not.toHaveBeenCalled();
  });

  it('uses a source only for evidence and keeps its text out of the planned title', async () => {
    const { result, fixture } = await prepare('查我的授課概況，安排今天下午一小時備課');
    expect(fixture.adapter.teachingOverview).toHaveBeenCalledOnce();
    expect(result.cards[0].args).toMatchObject({ title: '備課', startTime: '15:00', endTime: '16:00' });
    expect(JSON.stringify(result.cards)).not.toContain('退款');
    expect(JSON.stringify(result.cards)).not.toContain('通知');
  });

  it.each(['partial', 'unavailable'] as const)('does not plan from %s teaching data, while independent transit still completes', async mode => {
    const f = setup(); f.adapter.teachingOverview = vi.fn(async () => teaching(mode));
    const { result } = await prepare('查我的授課概況，安排明天下午一小時備課，查公車', f);
    expect(result.cards).toEqual([]);
    expect(result.taskPlan.steps.filter(step => step.serviceId === 'calendar').slice(-2)
      .every(step => step.status === 'blocked')).toBe(true);
    expect(result.steps.some(step => step.name === 'find_free_time')).toBe(false);
    expect(result.taskPlan.steps.find(step => step.serviceId === 'bus')?.status).toBe('completed');
  });

  it('does not select a store or prepare work from an ambiguous merchant overview', async () => {
    const f = setup();
    f.adapter.merchantOverview = args => readMerchantOverview({ schoolId: f.binding.schoolId, args, now,
      guard: () => {}, scopedRealm: () => ({ tenantId: store.tenantId, schoolId: f.binding.schoolId }),
      request: async path => {
        if (path === 'merchant-workspaces') return { workspaces: [store, { ...store, locationId: 'store-two' }] };
        if (path === 'realms') return { realms: [{ tenantId: store.tenantId, schoolId: f.binding.schoolId }] };
        throw new Error('No store orders or shift should be read');
      },
    });
    const { result } = await prepare('查我的門市營運概況，安排明天下午半小時盤點，查公車', f, 'merchant');
    expect(result.cards).toEqual([]);
    expect(result.taskPlan.steps.find(step => step.serviceId === 'merchant')?.status).toBe('blocked');
    expect(result.taskPlan.steps.find(step => step.serviceId === 'bus')?.status).toBe('completed');
  });

  it.each(['missing-timetable', 'unplaced-timetable', 'unavailable-calendar'] as const)(
    'does not infer free time with %s', async mode => {
      const f = setup(), ledger = f.snapshot();
      f.adapter.ledger = async () => {
        if (mode === 'unavailable-calendar') throw new V2Error(503, 'UPSTREAM_UNAVAILABLE');
        return { ...ledger, records: mode === 'missing-timetable' ? ledger.records.filter(record => record.kind !== 'timetable')
          : ledger.records.map(record => record.kind === 'timetable' ? { ...record, startTime: '' } : record) };
      };
      const { result } = await prepare('安排明天下午一小時備課，查公車', f);
      expect(result.cards).toEqual([]);
      expect(result.taskPlan.steps.at(-2)?.status).toBe('blocked');
      expect(result.taskPlan.steps.find(step => step.serviceId === 'bus')?.status).toBe('completed');
    });

  it.each(['安排今天13:00到15:00一小時備課', '安排2026-10-31下午一小時備課', '找2026-10-31下午一小時備課空檔'])(
    'does not create cards when the window is occupied or elapsed: %s', async question => {
      const { result } = await prepare(question);
      expect(result.cards).toEqual([]);
      expect(result.taskPlan.steps.at(-1)?.status).toBe('blocked');
    });

  it('only offers the still-future part of the current work window', async () => {
    const { result } = await prepare('找今天10:00到12:00半小時備課空檔');
    expect(result.cards).toEqual([]);
    expect(result.taskPlan.steps.at(-1)?.status).toBe('completed');
    expect(result.taskPlan.steps.at(-1)?.summary).toContain('10:31–12:00');
  });

  it('keeps pending work cards from overlapping and preserves each requested length', async () => {
    const { result } = await prepare('安排明天下午一小時備課，安排明天下午半小時批改作業');
    expect(result.cards.map(card => card.args)).toMatchObject([
      { title: '備課', startTime: '13:00', endTime: '14:00' },
      { title: '批改作業', startTime: '14:00', endTime: '14:30' },
    ]);
    expect(result.cards[0].mutationId).not.toBe(result.cards[1].mutationId);
  });

  it('retains the first draft when a second work session cannot fit around it', async () => {
    const { result } = await prepare('安排明天13:00到14:00一小時備課，安排明天13:00到14:00半小時批改');
    expect(result.cards).toHaveLength(1);
    expect(result.taskPlan.steps.at(-1)?.status).toBe('blocked');
    expect(result.answer).toContain('待確認行程占用');
  });

  it('keeps a prepared work session on its original confirmation path without adding replacement coursework actions', async () => {
    const { result } = await prepare('查未交作業，安排明天下午一小時備課', setup(), 'student');
    expect(result.cards).toHaveLength(1);
    expect(result.cards[0].args.title).toBe('備課');
    expect(result.courseworkTargets).toEqual([]);
  });

  it('withdraws an earlier pending work card when its permission is revoked before the next proposal', async () => {
    const f = setup(); let reads = 0;
    f.adapter.permissions = async () => ({ createPersonalEvent: ++reads <= 2, prepareFoodOrder: false });
    const { result } = await prepare('安排明天下午一小時備課，安排明天下午半小時批改', f);
    expect(result.cards).toEqual([]);
    expect(result.taskPlan.steps.filter(step => step.label.startsWith('準備個人'))
      .every(step => step.status === 'blocked' && !step.cardIds?.length)).toBe(true);
    expect(result.answer).toContain('已失效');
  });

  it.each(['denied', 'unavailable'] as const)('does not create a work proposal when permission is %s', async mode => {
    const f = setup();
    f.adapter.permissions = async () => {
      if (mode === 'unavailable') throw new Error('Permission store unavailable');
      return { createPersonalEvent: false, prepareFoodOrder: false };
    };
    const { result } = await prepare('安排明天下午一小時備課，查公車', f);
    expect(result.cards).toEqual([]);
    expect(result.taskPlan.steps.at(-2)?.status).toBe('blocked');
    expect(result.taskPlan.steps.find(step => step.serviceId === 'bus')?.status).toBe('completed');
  });

  it('leaves a service handoff when the calendar writer is disabled', async () => {
    const { result } = await prepare('安排明天下午一小時備課', setup(), 'teacher', false);
    expect(result.cards).toEqual([]);
    expect(result.taskPlan.steps.at(-1)).toMatchObject({ status: 'handoff' });
  });
});
