// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { parseAssistantPublicCourseResults } from '@campus/shared/src/assistantPublicCourseResults';
import { parseAssistantTaskPlan } from '@campus/shared/src/assistantTaskPlan';
import type { PublicCourseAssistantSearch } from '@campus/shared/src/publicCourseAssistant';
import type { PublicCourseCatalogResponse } from '@campus/shared/src/publicCourseCatalog';
import { resolvePublicCourseOperation } from '@campus/shared/src/publicCourseOperations';
import { parseAssistantCourseworkTargets } from '../../assistantCoursework';
import type { Adapter, ModelResult, Obj } from './contracts';
import { fixtureAdapter, fixtureBinding as binding, FIXTURE_NOW as now, FIXTURE_SECRET as secret } from './fixtures';
import { run, type RunInput } from './runner';

type Fixture = ReturnType<typeof fixtureAdapter>;
type Reply = Awaited<ReturnType<typeof run>>;

/** The same reviewed source/operation contract used by the public catalog client. */
function catalog(search: PublicCourseAssistantSearch, changes: Partial<PublicCourseCatalogResponse> = {}): PublicCourseCatalogResponse {
  const filtered = !!search.filters && Object.keys(search.filters).length > 0;
  const operation = resolvePublicCourseOperation(search.schoolId, filtered ? 2 : 1)!;
  return {
    schoolId: search.schoolId,
    sourceUrl: operation.sourceUrl,
    fetchedAt: '2026-11-04T02:00:00.000Z',
    operation: operation.version === 2
      ? { id: operation.id, access: operation.access, version: 2, responseSchemaVersion: 2 }
      : { id: operation.id, access: operation.access, version: 1, responseSchemaVersion: 1 },
    ...(filtered ? { filters: search.filters, unresolvedCount: 0 } : {}),
    courses: [{ code: search.schoolId === 'nthu' ? '11510CS  135500' : '115101101', section: '01',
      title: search.query || '資料庫', department: '資訊工程學系', teacher: '王老師',
      credits: String(search.filters?.credits ?? 3), semester: '1151',
      time: search.schoolId === 'nthu' ? 'W3W4' : '三3,4', room: '資訊館101',
      ...(search.schoolId === 'nthu' ? { meetings: [{ time: 'W3W4', room: '資訊館101' }] } : {}) }],
    truncated: false,
    ...changes,
  };
}

function fixtureWithPublic() {
  const fixture = fixtureAdapter();
  const publicCourses = vi.fn<NonNullable<Adapter['publicCourses']>>().mockImplementation(async search => catalog(search));
  fixture.adapter.publicCourses = publicCourses;
  return { ...fixture, publicCourses };
}

function input(question: string, fixture: Fixture, overrides: Partial<RunInput> = {}) {
  return { question, history: [], binding, adapter: fixture.adapter, secret, now,
    writes: true, signal: new AbortController().signal, log: () => {},
    model: vi.fn<RunInput['model']>().mockRejectedValue(new Error('Complete compound reads must not call the model')),
    ...overrides } satisfies RunInput;
}

function plan(reply: Reply) {
  const parsed = parseAssistantTaskPlan('taskPlan' in reply ? reply.taskPlan : undefined);
  expect(parsed, 'The response must satisfy the same contract rendered by the task list').not.toBeNull();
  return parsed!;
}

function publicResults(reply: Reply) {
  const parsed = parseAssistantPublicCourseResults('publicCourseResults' in reply ? reply.publicCourseResults : []);
  expect(parsed, 'Public result metadata must be independently verifiable').not.toBeNull();
  return parsed!;
}

async function prepare(question: string, fixture: Fixture = fixtureWithPublic()) {
  const request = input(question, fixture);
  const reply = await run(request);
  expect(request.model).not.toHaveBeenCalled();
  expect(reply).toMatchObject({ version: 2, dataRead: true, modelCalls: 0 });
  return { reply, taskPlan: plan(reply), reads: publicResults(reply) };
}

const usage = { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 };
function toolReply(args: Obj): ModelResult {
  return { message: { role: 'assistant', tool_calls: [{ id: 'public-source', type: 'function',
    function: { name: 'get_public_courses', arguments: JSON.stringify(args) } }] }, usage };
}
const finalReply = (): ModelResult => ({ message: { role: 'assistant', content: '已讀取公開資料；讀書策略可依練習與回顧分別比較。' }, usage });

describe('public catalogs in the actual cross-service runner', () => {
  it('reads the public catalog, the current campus bus and the exact private day in one model-free request', async () => {
    const fixture = fixtureWithPublic();
    const transit = vi.spyOn(fixture.adapter, 'transit');
    const ledger = vi.spyOn(fixture.adapter, 'ledger');
    const courses = vi.spyOn(fixture.adapter, 'courses');
    const work = vi.spyOn(fixture.adapter, 'work');
    const before = { ...binding };
    const { reply, taskPlan, reads } = await prepare('查清大星期三3學分資料庫課程，另外查公車，查明天課表', fixture);
    expect(fixture.publicCourses).toHaveBeenCalledExactlyOnceWith({ kind: 'search', schoolId: 'nthu',
      query: '資料庫', filters: { weekday: 3, credits: 3 } });
    expect(transit).toHaveBeenCalledWith({ action: 'campus', schoolId: binding.schoolId });
    expect(ledger).toHaveBeenCalledOnce();
    expect(courses).not.toHaveBeenCalled();
    expect(work).not.toHaveBeenCalled();
    expect(binding).toEqual(before);
    expect(fixture.snapshot().schoolId).toBe(binding.schoolId);
    expect(reply.answer).toContain('合成301');
    expect(reply.answer).toContain('英文');
    expect(reply.answer).not.toContain('資訊202');
    expect(reads[0]).toMatchObject({ schoolId: 'nthu', status: 'ready', matchCount: 1 });
    expect(reads[0].sourceUrl).toBe(resolvePublicCourseOperation('nthu')!.sourceUrl);
    expect(taskPlan.steps.map(step => step.status)).toEqual(['completed', 'completed', 'completed']);
    expect(reply.cards).toEqual([]);
    expect(fixture.writes).toHaveLength(0);
  });

  it('keeps weekday, exact credits and the complete course title containing 與', async () => {
    const fixture = fixtureWithPublic();
    const { reads, taskPlan } = await prepare('查清大星期三3學分資料庫與人工智慧課程，另外查公車', fixture);
    expect(fixture.publicCourses).toHaveBeenCalledExactlyOnceWith({ kind: 'search', schoolId: 'nthu',
      query: '資料庫與人工智慧', filters: { weekday: 3, credits: 3 } });
    expect(reads[0]).toMatchObject({ query: '資料庫與人工智慧', filters: { weekday: 3, credits: 3 }, status: 'ready' });
    expect(taskPlan.steps).toHaveLength(2);
    expect(taskPlan.steps[0].status).toBe('completed');
  });

  it('does not split quoted course-title punctuation into more actions', async () => {
    const fixture = fixtureWithPublic();
    const { reply, reads } = await prepare('查清大「資料庫與人工智慧，實作」課程，另外查公車', fixture);
    expect(fixture.publicCourses).toHaveBeenCalledExactlyOnceWith({ kind: 'search', schoolId: 'nthu', query: '資料庫與人工智慧,實作' });
    expect(reads[0].query).toBe('資料庫與人工智慧,實作');
    expect(reply.cards).toEqual([]);
  });

  it('keeps separate public campuses and filters while leaving private sources in the active campus', async () => {
    const fixture = fixtureWithPublic();
    const privateCourses = vi.spyOn(fixture.adapter, 'courses');
    const { reply, reads } = await prepare('查清大資料庫課程，另外查暨大2.5學分管理學課程，查今天課表', fixture);
    expect(fixture.publicCourses.mock.calls.map(([search]) => search)).toEqual([
      { kind: 'search', schoolId: 'nthu', query: '資料庫' },
      { kind: 'search', schoolId: 'ncnu', query: '管理學', filters: { credits: 2.5 } },
    ]);
    expect(reads.map(read => read.schoolId)).toEqual(['nthu', 'ncnu']);
    expect(reply.answer).toContain('資訊202');
    expect(privateCourses).not.toHaveBeenCalled();
    expect(fixture.snapshot().schoolId).toBe(binding.schoolId);
  });

  it('keeps an already verified result when another catalog would exceed the complete result-group budget', async () => {
    const fixture = fixtureWithPublic();
    fixture.publicCourses.mockImplementation(async search => {
      const data = catalog(search);
      data.courses[0].department = '系'.repeat(100_000);
      expect(parseAssistantPublicCourseResults([{ search, data }])).toHaveLength(1);
      return data;
    });
    const { reply, taskPlan, reads } = await prepare('查清大資料庫課程，查暨大管理學課程，查公車', fixture);
    expect(fixture.publicCourses).toHaveBeenCalledTimes(2);
    expect(taskPlan.steps.map(step => step.status)).toEqual(['completed', 'blocked', 'completed']);
    expect(reads.map(read => read.schoolId)).toEqual(['nthu']);
    expect(reply.answer).toContain('合成301');
    expect(reply.cards).toEqual([]);
  });

  it.each(['source', 'school', 'receipt', 'missing-filter-receipt'] as const)(
    'blocks an invalid %s response and still completes the independent bus query', async change => {
      const fixture = fixtureWithPublic();
      fixture.publicCourses.mockImplementation(async search => {
        const data = catalog(search);
        if (change === 'source') return { ...data, sourceUrl: 'https://untrusted.example/private-cookie' };
        if (change === 'school') return { ...data, schoolId: 'ncnu' };
        if (change === 'receipt') return { ...data, operation: { ...data.operation, access: 'private' } };
        return catalog({ kind: 'search', schoolId: search.schoolId, query: search.query });
      });
      const { reply, taskPlan, reads } = await prepare('查清大星期三3學分資料庫課程，另外查公車', fixture);
      expect(taskPlan.steps[0].status).toBe('blocked');
      expect(taskPlan.steps.find(step => step.serviceId === 'bus')?.status).toBe('completed');
      expect(reads).toEqual([]);
      expect(reply.answer).toContain('合成301');
      expect(reply.answer).not.toMatch(/找到.*0 筆|private-cookie|已完成.*公開/);
      expect(reply.cards).toEqual([]);
    },
  );

  it.each(['truncated', 'unresolved', 'partial'] as const)(
    'keeps an explicitly %s source incomplete instead of reporting all results as verified', async kind => {
      const fixture = fixtureWithPublic();
      fixture.publicCourses.mockImplementation(async search => kind === 'partial'
        ? { ...catalog(search), partial: true }
        : catalog(search, kind === 'truncated' ? { truncated: true } : { unresolvedCount: 2 }));
      const { taskPlan, reads } = await prepare('查清大星期三3學分資料庫課程，另外查公車', fixture);
      expect(taskPlan.steps[0].status).not.toBe('completed');
      expect(taskPlan.steps[0].status).not.toBe('ready');
      expect(taskPlan.steps.find(step => step.serviceId === 'bus')?.status).toBe('completed');
      if (kind === 'truncated') expect(reads[0]).toMatchObject({ truncated: true });
      if (kind === 'unresolved') expect(reads[0]).toMatchObject({ unresolvedCount: 2 });
    },
  );

  it('shows a valid empty source as an empty query result without confusing it with an outage', async () => {
    const fixture = fixtureWithPublic();
    fixture.publicCourses.mockImplementation(async search => catalog(search, { courses: [] }));
    const { reply, taskPlan, reads } = await prepare('查清大資料庫課程，查公車', fixture);
    expect(reads[0]).toMatchObject({ status: 'ready', matchCount: 0 });
    expect(taskPlan.steps[0].status).toBe('completed');
    expect(reply.answer).toContain('0 筆');
  });

  it('rejects explicit partial metadata from an otherwise canonical production adapter response', async () => {
    const fixture = fixtureWithPublic();
    fixture.adapter.simulation = false;
    fixture.publicCourses.mockImplementation(async search => ({ ...catalog(search), partial: true }));
    const { reply, taskPlan, reads } = await prepare('查清大資料庫課程，另外查公車', fixture);
    expect(taskPlan.steps[0].status).toBe('blocked');
    expect(taskPlan.steps.find(step => step.serviceId === 'bus')?.status).toBe('completed');
    expect(reads).toEqual([]);
    expect(reply).toMatchObject({ simulation: false });
  });

  it('keeps unsupported constraints visible without silently broadening the public search', async () => {
    const fixture = fixtureWithPublic();
    const { reply, taskPlan, reads } = await prepare('查清大下午不衝堂的3學分課程，另外查公車', fixture);
    expect(fixture.publicCourses).not.toHaveBeenCalled();
    expect(taskPlan.steps[0].status).toBe('blocked');
    expect(taskPlan.steps[0].summary).toMatch(/尚不能|不衝堂|鐘點/);
    expect(taskPlan.steps.find(step => step.serviceId === 'bus')?.status).toBe('completed');
    expect(reads).toEqual([]);
    expect(reply.cards).toEqual([]);
  });

  it('keeps unavailable adapters blocked instead of claiming that the campus has no courses', async () => {
    const fixture = fixtureAdapter();
    const { reply, taskPlan, reads } = await prepare('查清大資料庫課程，另外查公車', fixture);
    expect(taskPlan.steps[0].status).toBe('blocked');
    expect(taskPlan.steps.find(step => step.serviceId === 'bus')?.status).toBe('completed');
    expect(reads).toEqual([]);
    expect(reply.answer).not.toContain('0 筆');
  });

  it('does not publish a late public result or continue other services after cancellation', async () => {
    const fixture = fixtureWithPublic(), controller = new AbortController();
    fixture.publicCourses.mockImplementation(async search => { controller.abort(); return catalog(search); });
    const transit = vi.spyOn(fixture.adapter, 'transit');
    const request = input('查清大資料庫課程，另外查公車', fixture, { signal: controller.signal });
    await expect(run(request)).rejects.toMatchObject({ status: 499, code: 'ABORTED' });
    expect(request.model).not.toHaveBeenCalled();
    expect(transit).not.toHaveBeenCalled();
    expect(fixture.writes).toHaveLength(0);
  });

  it('retains exact private coursework follow-up targets next to a public course result', async () => {
    const fixture = fixtureWithPublic();
    const { reply, reads } = await prepare('查清大資料庫課程，查未交作業，查公車', fixture);
    const targets = parseAssistantCourseworkTargets('courseworkTargets' in reply ? reply.courseworkTargets : undefined);
    expect(reads[0]).toMatchObject({ schoolId: 'nthu', query: '資料庫' });
    expect(targets.map(target => target.taskId)).toEqual(['task-urgent', 'task-next']);
    expect(targets.every(target => target.workspaceId === 'course-a')).toBe(true);
    expect(reply.cards).toEqual([]);
    expect(fixture.writes).toHaveLength(0);
  });

  it('does not substitute unrelated private materials for a public catalog course', async () => {
    const fixture = fixtureWithPublic();
    const courses = vi.spyOn(fixture.adapter, 'courses');
    const materials = vi.spyOn(fixture.adapter, 'materials');
    const { taskPlan, reads } = await prepare('查清大資料庫課程，找相關教材', fixture);
    expect(reads[0]).toMatchObject({ schoolId: 'nthu', query: '資料庫' });
    expect(taskPlan.steps[0].status).toBe('completed');
    expect(taskPlan.steps.find(step => step.label.startsWith('找課程教材'))?.status).toBe('blocked');
    expect(courses).not.toHaveBeenCalled();
    expect(materials).not.toHaveBeenCalled();
  });

  it('uses explicit private coursework dependencies for materials while a public catalog result coexists', async () => {
    const fixture = fixtureWithPublic();
    const materials = vi.spyOn(fixture.adapter, 'materials');
    const { reply, taskPlan, reads } = await prepare('查清大資料庫課程，查未交作業，找相關教材', fixture);
    const workStep = taskPlan.steps.find(step => step.label.startsWith('查待繳作業與測驗'))!;
    const materialsStep = taskPlan.steps.find(step => step.label.startsWith('找課程教材'))!;
    expect(reads[0]).toMatchObject({ schoolId: 'nthu', query: '資料庫' });
    expect(workStep.status).toBe('completed');
    expect(materialsStep).toMatchObject({ status: 'completed', dependsOn: [workStep.id] });
    expect(materials).toHaveBeenCalledExactlyOnceWith('course-a', undefined);
    expect(reply.answer).toContain('樹與圖講義');
    expect(reply.cards).toEqual([]);
    expect(fixture.writes).toHaveLength(0);
  });
});

describe('public course tool use in the conversational fallback', () => {
  it('verifies the source and renders only its facts when the model skips the public tool and invents results', async () => {
    const fixture = fixtureWithPublic();
    const model = vi.fn<RunInput['model']>().mockResolvedValue({ message: { role: 'assistant',
      content: '已查到清大資料庫課程共999筆，都是6學分。讀書策略可採間隔複習。' }, usage });
    const reply = await run(input('查清大3學分資料庫課程，另外比較兩種讀書策略', fixture, { model }));
    expect(fixture.publicCourses).toHaveBeenCalledExactlyOnceWith({ kind: 'search', schoolId: 'nthu',
      query: '資料庫', filters: { credits: 3 } });
    expect(publicResults(reply)[0]).toMatchObject({ matchCount: 1, filters: { credits: 3 } });
    expect(reply.answer).toMatch(/1\s*筆/);
    expect(reply.answer).toMatch(/3\s*學分/);
    expect(reply.answer).not.toMatch(/999|6\s*學分/);
    expect(reply.answer).toContain('比較兩種讀書策略');
    expect(reply.answer).toMatch(/尚未|未核對|未完成/);
    expect(reply).toMatchObject({ dataRead: true });
    expect(reply.cards).toEqual([]);
  });

  it('verifies every requested public campus when the model reads only one of them', async () => {
    const fixture = fixtureWithPublic();
    const model = vi.fn<RunInput['model']>().mockImplementation(async () =>
      model.mock.calls.length === 1 ? toolReply({ schoolId: 'nthu', query: '資料庫' }) : finalReply());
    const reply = await run(input('查清大資料庫課程，查暨大管理學課程，另外比較兩種讀書策略', fixture, { model }));
    expect(fixture.publicCourses.mock.calls.map(([search]) => search)).toEqual([
      { kind: 'search', schoolId: 'nthu', query: '資料庫' },
      { kind: 'search', schoolId: 'ncnu', query: '管理學' },
    ]);
    expect(publicResults(reply).map(read => read.schoolId)).toEqual(['nthu', 'ncnu']);
    expect(reply.answer).toContain('國立清華大學');
    expect(reply.answer).toContain('國立暨南國際大學');
    expect(reply.answer).toContain('比較兩種讀書策略');
    expect(reply.cards).toEqual([]);
  });

  it('does not deliver previously read public data when the parent cancels during the final model call', async () => {
    const fixture = fixtureWithPublic(), controller = new AbortController();
    const model = vi.fn<RunInput['model']>().mockImplementation(async () => {
      if (model.mock.calls.length === 1) return toolReply({ schoolId: 'nthu', query: '資料庫' });
      controller.abort();
      return finalReply();
    });
    const request = input('查清大資料庫課程，另外比較兩種讀書策略', fixture, { model, signal: controller.signal });
    await expect(run(request)).rejects.toMatchObject({ status: 499, code: 'ABORTED' });
    expect(fixture.publicCourses).toHaveBeenCalledExactlyOnceWith({ kind: 'search', schoolId: 'nthu', query: '資料庫' });
    expect(model).toHaveBeenCalledTimes(2);
    expect(fixture.writes).toHaveLength(0);
  });

  it('still reads the explicitly requested public source when the first model call is unavailable', async () => {
    const fixture = fixtureWithPublic();
    const model = vi.fn<RunInput['model']>().mockRejectedValue(new Error('Provider unavailable'));
    const reply = await run(input('查清大資料庫課程，另外比較兩種讀書策略', fixture, { model }));
    expect(model).toHaveBeenCalledOnce();
    expect(fixture.publicCourses).toHaveBeenCalledExactlyOnceWith({ kind: 'search', schoolId: 'nthu', query: '資料庫' });
    expect(publicResults(reply)[0]).toMatchObject({ status: 'ready', matchCount: 1 });
    expect(reply).toMatchObject({ dataRead: true, stopReason: 'ASSISTANT_UNAVAILABLE' });
    expect(reply.answer).toContain('比較兩種讀書策略');
    expect(reply.answer).toMatch(/尚未|未核對|未完成/);
    expect(reply.cards).toEqual([]);
  });

  it('preserves verified public evidence after the total deadline without treating it as parent cancellation', async () => {
    const fixture = fixtureWithPublic(), controller = new AbortController();
    const model = vi.fn<RunInput['model']>().mockImplementation(async request => {
      if (model.mock.calls.length === 1) return toolReply({ schoolId: 'nthu', query: '資料庫' });
      return await new Promise<ModelResult>((_resolve, reject) => {
        const abort = () => reject(request.signal.reason);
        if (request.signal.aborted) abort();
        else request.signal.addEventListener('abort', abort, { once: true });
      });
    });
    const reply = await run(input('查清大資料庫課程，另外比較兩種讀書策略', fixture,
      { model, signal: controller.signal, previewDeadlineMs: 250 }));
    expect(controller.signal.aborted).toBe(false);
    expect(model).toHaveBeenCalledTimes(2);
    expect(fixture.publicCourses).toHaveBeenCalledExactlyOnceWith({ kind: 'search', schoolId: 'nthu', query: '資料庫' });
    expect(publicResults(reply)[0]).toMatchObject({ status: 'ready', matchCount: 1 });
    expect(reply).toMatchObject({ dataRead: true, stopReason: 'DEADLINE_EXCEEDED' });
    expect(reply.answer).toContain('比較兩種讀書策略');
    expect(reply.cards).toEqual([]);
  });

  it.each([
    { question: '查清大下午生涯規劃課程，另外比較兩種讀書策略', clarification: '尚不能篩選' },
    { question: '查台大生涯規劃課程，另外比較兩種讀書策略', clarification: '這所學校尚未接通' },
  ])('keeps public clarification and does not advertise private planning for $question', async ({ question, clarification }) => {
    const fixture = fixtureWithPublic();
    const ledger = vi.spyOn(fixture.adapter, 'ledger');
    const courses = vi.spyOn(fixture.adapter, 'courses');
    const work = vi.spyOn(fixture.adapter, 'work');
    const permissions = vi.spyOn(fixture.adapter, 'permissions');
    const model = vi.fn<RunInput['model']>().mockResolvedValue(finalReply());
    const reply = await run(input(question, fixture, { model }));
    expect(model).toHaveBeenCalled();
    for (const [request] of model.mock.calls)
      expect(JSON.stringify(request.tools ?? [])).not.toMatch(/get_today_context|get_schedule|get_calendar|get_day_overview|get_due_work|get_course_work|find_free_time|propose_study_plan|propose_personal_event/);
    expect(fixture.publicCourses).not.toHaveBeenCalled();
    expect(ledger).not.toHaveBeenCalled();
    expect(courses).not.toHaveBeenCalled();
    expect(work).not.toHaveBeenCalled();
    expect(permissions).not.toHaveBeenCalled();
    expect(publicResults(reply)).toEqual([]);
    expect(reply.answer).toContain(clarification);
    expect(reply.cards).toEqual([]);
    expect(fixture.writes).toHaveLength(0);
  });

  it('offers the public reader and executes it when an additional reasoning clause needs the model', async () => {
    const fixture = fixtureWithPublic();
    const model = vi.fn<RunInput['model']>().mockImplementation(async request => {
      if (model.mock.calls.length === 1) {
        expect(request.tools).toEqual(expect.arrayContaining([
          expect.objectContaining({ function: expect.objectContaining({ name: 'get_public_courses' }) }),
        ]));
        return toolReply({ schoolId: 'nthu', query: '資料庫' });
      }
      return finalReply();
    });
    const reply = await run(input('查清大資料庫課程，另外比較兩種讀書策略', fixture, { model }));
    expect(model).toHaveBeenCalledTimes(2);
    expect(fixture.publicCourses).toHaveBeenCalledExactlyOnceWith({ kind: 'search', schoolId: 'nthu', query: '資料庫' });
    expect(publicResults(reply)[0]).toMatchObject({ status: 'ready', schoolId: 'nthu' });
    expect(reply).toMatchObject({ dataRead: true });
    expect(reply.cards).toEqual([]);
  });

  it.each([
    { schoolId: 'ncnu', query: '資料庫', weekday: 3, credits: 3 },
    { schoolId: 'nthu', query: '管理學', weekday: 3, credits: 3 },
    { schoolId: 'nthu', query: '資料庫', credits: 3 },
    { schoolId: 'nthu', query: '資料庫', weekday: 4, credits: 3 },
  ])('refuses a model-changed public target or dropped filter before source access: %j', async attempted => {
    const fixture = fixtureWithPublic();
    const model = vi.fn<RunInput['model']>().mockImplementation(async () => {
      if (model.mock.calls.length === 1) return toolReply(attempted);
      if (model.mock.calls.length === 2) return toolReply({ schoolId: 'nthu', query: '資料庫', weekday: 3, credits: 3 });
      return finalReply();
    });
    const reply = await run(input('查清大星期三3學分資料庫課程，另外比較兩種讀書策略', fixture, { model }));
    expect(fixture.publicCourses).toHaveBeenCalledExactlyOnceWith({ kind: 'search', schoolId: 'nthu',
      query: '資料庫', filters: { weekday: 3, credits: 3 } });
    expect(reply.steps).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'get_public_courses', status: 'error', summary: 'PUBLIC_COURSE_QUERY_MISMATCH' }),
    ]));
    expect(publicResults(reply)).toHaveLength(1);
    expect(reply.cards).toEqual([]);
  });

  it('does not interpret a public course title as a private planning or write request', async () => {
    const fixture = fixtureWithPublic();
    const ledger = vi.spyOn(fixture.adapter, 'ledger');
    const courses = vi.spyOn(fixture.adapter, 'courses');
    const work = vi.spyOn(fixture.adapter, 'work');
    const permissions = vi.spyOn(fixture.adapter, 'permissions');
    const model = vi.fn<RunInput['model']>().mockImplementation(async request => {
      if (model.mock.calls.length === 1) {
        expect(JSON.stringify(request.tools)).not.toMatch(/propose_study_plan|propose_personal_event|get_due_work|get_schedule/);
        return toolReply({ schoolId: 'nthu', query: '生涯規劃' });
      }
      return finalReply();
    });
    const reply = await run(input('查清大生涯規劃課程，另外比較兩種讀書策略', fixture, { model }));
    expect(fixture.publicCourses).toHaveBeenCalledExactlyOnceWith({ kind: 'search', schoolId: 'nthu', query: '生涯規劃' });
    expect(ledger).not.toHaveBeenCalled();
    expect(courses).not.toHaveBeenCalled();
    expect(work).not.toHaveBeenCalled();
    expect(permissions).not.toHaveBeenCalled();
    expect(publicResults(reply)[0].query).toBe('生涯規劃');
    expect(reply.cards).toEqual([]);
    expect(fixture.writes).toHaveLength(0);
  });
});
