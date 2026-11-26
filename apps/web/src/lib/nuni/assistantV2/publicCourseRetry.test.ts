// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { parseAssistantPublicCourseResults } from '@campus/shared/src/assistantPublicCourseResults';
import { parseAssistantTaskPlan } from '@campus/shared/src/assistantTaskPlan';
import { parseAssistantTaskRetry } from '@campus/shared/src/assistantTaskRetry';
import type { PublicCourseAssistantSearch } from '@campus/shared/src/publicCourseAssistant';
import type { PublicCourseCatalogResponse } from '@campus/shared/src/publicCourseCatalog';
import { resolvePublicCourseOperation } from '@campus/shared/src/publicCourseOperations';
import { V2Error, type Adapter } from './contracts';
import { fixtureAdapter, fixtureBinding, FIXTURE_NOW as now, FIXTURE_SECRET as secret } from './fixtures';
import { run } from './runner';
import { retryTaskReads } from './taskRetry';

function catalog(search: PublicCourseAssistantSearch): PublicCourseCatalogResponse {
  const filtered = !!search.filters && Object.keys(search.filters).length > 0;
  const operation = resolvePublicCourseOperation(search.schoolId, filtered ? 2 : 1)!;
  return {
    schoolId: search.schoolId, sourceUrl: operation.sourceUrl,
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
  };
}

async function prepare(question = '查清大星期三3學分資料庫課程，查公車') {
  const fixture = fixtureAdapter();
  const publicCourses = vi.fn<NonNullable<Adapter['publicCourses']>>()
    .mockRejectedValueOnce(new V2Error(503, 'PUBLIC_COURSES_UNAVAILABLE'))
    .mockImplementation(async search => catalog(search));
  fixture.adapter.publicCourses = publicCourses;
  const binding = { ...fixtureBinding, conversationId: 'public-retry-' + randomUUID() };
  const model = vi.fn().mockRejectedValue(new Error('A structured retry must not call a model'));
  const reply = await run({ question, history: [], binding, adapter: fixture.adapter,
    secret, now, writes: true, signal: new AbortController().signal, model, log: () => {} });
  const plan = parseAssistantTaskPlan('taskPlan' in reply ? reply.taskPlan : undefined);
  const credential = parseAssistantTaskRetry('taskRetry' in reply ? reply.taskRetry : undefined, plan);
  expect(model).not.toHaveBeenCalled();
  if (!plan || !credential) throw new Error('The public catalog failure must be a signed retryable task');
  expect(plan.steps[0]).toMatchObject({ serviceId: 'school-courses', status: 'blocked' });
  expect(credential.stepIds).toContain(plan.steps[0].id);
  return { fixture, publicCourses, binding, reply, plan, credential, model };
}

function retry(prepared: Awaited<ReturnType<typeof prepare>>, overrides: Partial<Parameters<typeof retryTaskReads>[0]> = {}) {
  return retryTaskReads({ token: prepared.credential.token, stepIds: prepared.credential.stepIds,
    binding: prepared.binding, adapter: prepared.fixture.adapter, secret, now: now + 1000,
    signal: new AbortController().signal, ...overrides });
}

describe('signed public catalog read continuation', () => {
  it('retries the exact requested school, query and filters without using the private campus or repeating completed reads', async () => {
    const prepared = await prepare();
    const transit = vi.spyOn(prepared.fixture.adapter, 'transit');
    const ledger = vi.spyOn(prepared.fixture.adapter, 'ledger');
    const response = await retry(prepared);
    expect(response).toMatchObject({ version: 2, dataRead: true, modelCalls: 0, cards: [], stopReason: '' });
    expect(response.taskPlan.steps).toEqual([
      expect.objectContaining({ id: prepared.plan.steps[0].id, serviceId: 'school-courses', status: 'completed' }),
    ]);
    expect(response.taskRetry).toBeUndefined();
    expect(prepared.publicCourses).toHaveBeenCalledTimes(2);
    for (const call of prepared.publicCourses.mock.calls) expect(call).toEqual([
      { kind: 'search', schoolId: 'nthu', query: '資料庫', filters: { weekday: 3, credits: 3 } },
    ]);
    const reads = parseAssistantPublicCourseResults(response.publicCourseResults);
    expect(reads).toHaveLength(1);
    expect(reads?.[0]).toMatchObject({ schoolId: 'nthu', query: '資料庫', status: 'ready' });
    expect(reads?.[0].sourceUrl).toBe(resolvePublicCourseOperation('nthu', 2)!.sourceUrl);
    expect(prepared.binding.schoolId).toBe(fixtureBinding.schoolId);
    expect(prepared.fixture.snapshot().schoolId).toBe(fixtureBinding.schoolId);
    expect(response.answer).toContain('資料庫');
    expect(response.answer).not.toContain('PUBLIC_COURSE_QUERY_MISMATCH');
    expect(transit).not.toHaveBeenCalled();
    expect(ledger).not.toHaveBeenCalled();
    expect(prepared.fixture.writes).toEqual([]);
    expect(prepared.fixture.orderCalls).toEqual([]);
    expect(prepared.model).not.toHaveBeenCalled();
  });

  it('keeps the failed public source distinct from another successful school catalog', async () => {
    const prepared = await prepare('查清大星期三3學分資料庫課程，查暨大2.5學分管理學課程，查公車');
    const readsBefore = prepared.publicCourses.mock.calls.map(([search]) => search);
    expect(readsBefore).toEqual([
      { kind: 'search', schoolId: 'nthu', query: '資料庫', filters: { weekday: 3, credits: 3 } },
      { kind: 'search', schoolId: 'ncnu', query: '管理學', filters: { credits: 2.5 } },
    ]);
    prepared.publicCourses.mockClear();
    const response = await retry(prepared);
    expect(prepared.publicCourses).toHaveBeenCalledExactlyOnceWith(readsBefore[0]);
    expect(response.taskPlan.steps).toHaveLength(1);
    expect(response.taskPlan.steps[0].status).toBe('completed');
    const reads = parseAssistantPublicCourseResults(response.publicCourseResults);
    expect(reads?.map(read => read.schoolId)).toEqual(['nthu']);
    expect(response.cards).toEqual([]);
    expect(prepared.fixture.writes).toEqual([]);
    expect(prepared.fixture.orderCalls).toEqual([]);
  });

  it('does not recreate a completed study proposal while restoring a failed public query', async () => {
    const prepared = await prepare('查清大資料庫課程，安排今天15:00到16:00讀書，查公車');
    expect(prepared.reply.cards).toHaveLength(1);
    const originalCards = structuredClone(prepared.reply.cards);
    const ledger = vi.spyOn(prepared.fixture.adapter, 'ledger');
    const work = vi.spyOn(prepared.fixture.adapter, 'work');
    const response = await retry(prepared);
    expect(response.taskPlan.steps).toEqual([
      expect.objectContaining({ serviceId: 'school-courses', status: 'completed' }),
    ]);
    expect(response.cards).toEqual([]);
    expect(response.taskPlan.steps.every(step => !step.cardIds?.length)).toBe(true);
    expect(prepared.reply.cards).toEqual(originalCards);
    expect(ledger).not.toHaveBeenCalled();
    expect(work).not.toHaveBeenCalled();
    expect(prepared.fixture.writes).toEqual([]);
    expect(prepared.fixture.orderCalls).toEqual([]);
  });

  it.each(['schoolId', 'account', 'session', 'conversationId'] as const)(
    'rejects a changed %s binding before reading any source', async key => {
      const prepared = await prepare();
      prepared.publicCourses.mockClear();
      await expect(retry(prepared, { binding: { ...prepared.binding, [key]: 'different-owner' } }))
        .rejects.toMatchObject({ code: 'TASK_RETRY_INVALID' });
      expect(prepared.publicCourses).not.toHaveBeenCalled();
      expect(prepared.fixture.writes).toEqual([]);
      expect(prepared.fixture.orderCalls).toEqual([]);
    },
  );

  it.each(['school', 'query'] as const)('rejects a changed %s in the signed question instead of treating it as a new lookup', async field => {
    const prepared = await prepare();
    prepared.publicCourses.mockClear();
    const [body, signature] = prepared.credential.token.split('.');
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    payload.question = String(payload.question).replace(field === 'school' ? '清大' : '資料庫', field === 'school' ? '暨大' : '管理學');
    const modified = Buffer.from(JSON.stringify(payload)).toString('base64url') + '.' + signature;
    await expect(retry(prepared, { token: modified })).rejects.toMatchObject({ code: 'TASK_RETRY_INVALID' });
    expect(prepared.publicCourses).not.toHaveBeenCalled();
    expect(prepared.fixture.writes).toEqual([]);
    expect(prepared.fixture.orderCalls).toEqual([]);
  });

  it('rejects the original retry at its exact expiry before reading data or preparing an action', async () => {
    const prepared = await prepare();
    prepared.publicCourses.mockClear();
    await expect(retry(prepared, { now: prepared.credential.expiresAt }))
      .rejects.toMatchObject({ code: 'TASK_RETRY_EXPIRED' });
    expect(prepared.publicCourses).not.toHaveBeenCalled();
    expect(prepared.fixture.writes).toEqual([]);
    expect(prepared.fixture.orderCalls).toEqual([]);
  });
});
