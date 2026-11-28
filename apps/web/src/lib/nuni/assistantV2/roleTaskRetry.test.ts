// @vitest-environment node
import { createHmac, randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { AssistantRoleProfileId } from '@campus/shared/src/assistantRoleProfiles';
import { parseAssistantTaskRetry } from '@campus/shared/src/assistantTaskRetry';
import { canonical, type Obj } from './contracts';
import { fixtureAdapter, fixtureBinding, FIXTURE_NOW as now, FIXTURE_SECRET as secret } from './fixtures';
import { run } from './runner';
import { retryTaskReads } from './taskRetry';

const payload = (token: string): Obj => JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString('utf8'));
function sign(value: Obj): string {
  const body = Buffer.from(canonical(value)).toString('base64url');
  return body + '.' + createHmac('sha256', secret).update('nuni-assistant-task-read-retry\0' + body).digest('base64url');
}
async function failedTransit(taskProfile: AssistantRoleProfileId, question = '查今天課表，查公車') {
  const fixture = fixtureAdapter();
  const binding = { ...fixtureBinding, conversationId: randomUUID() };
  const transit = fixture.adapter.transit;
  const read = vi.spyOn(fixture.adapter, 'transit').mockRejectedValueOnce(new Error('Temporary source failure'));
  const dining = vi.spyOn(fixture.adapter, 'dining');
  const model = vi.fn().mockRejectedValue(new Error('Structured tasks do not need a model'));
  const reply = await run({ taskProfile, question, history: [], binding, adapter: fixture.adapter,
    now, secret, writes: true, signal: new AbortController().signal, model, log: () => {} });
  expect(model).not.toHaveBeenCalled();
  const retry = parseAssistantTaskRetry('taskRetry' in reply ? reply.taskRetry : undefined,
    'taskPlan' in reply ? reply.taskPlan : undefined);
  expect(retry).not.toBeNull();
  read.mockImplementation(transit);
  return { fixture, binding, reply, retry: retry!, read, dining };
}
type Prepared = Awaited<ReturnType<typeof failedTransit>>;
const resume = (prepared: Prepared, extra: Partial<Parameters<typeof retryTaskReads>[0]> = {}) => retryTaskReads({
  token: prepared.retry.token, stepIds: prepared.retry.stepIds, binding: prepared.binding,
  secret, now: now + 1000, adapter: prepared.fixture.adapter, signal: new AbortController().signal, ...extra,
});

describe('task context survives signed read-only continuation', () => {
  it.each(['student', 'teacher', 'merchant', 'club', 'school', 'platform'] as const)(
    'binds %s to the retry and preserves it on another source failure', async taskProfile => {
      const prepared = await failedTransit(taskProfile);
      expect(payload(prepared.retry.token)).toMatchObject({ version: 4, taskProfile });
      prepared.read.mockRejectedValue(new Error('Still unavailable'));
      const failed = await resume(prepared);
      expect(failed.taskRetry).toBeDefined();
      expect(payload(failed.taskRetry!.token)).toMatchObject({ version: 4, taskProfile });
      expect(failed.taskRetry!.expiresAt).toBe(prepared.retry.expiresAt);
      expect(failed.cards).toEqual([]);
      expect(prepared.fixture.writes).toHaveLength(0);
      expect(prepared.fixture.orderCalls).toHaveLength(0);
    },
  );

  it('does not turn an unavailable merchant-context tool into an allowed student retry', async () => {
    const prepared = await failedTransit('merchant', '查今天課表，查餐廳，查公車');
    expect(prepared.dining).not.toHaveBeenCalled();
    const plan = 'taskPlan' in prepared.reply ? prepared.reply.taskPlan : undefined;
    const unsupported = plan?.steps.find(step => step.serviceId === 'cafeteria');
    expect(unsupported?.status, JSON.stringify(plan)).toBe('blocked');
    expect(prepared.retry.stepIds).not.toContain(unsupported?.id);
    const reply = await resume(prepared);
    expect(reply.taskPlan.steps.map(step => step.serviceId)).toEqual(['bus']);
    expect(prepared.dining).not.toHaveBeenCalled();
    expect(reply.cards).toEqual([]);
    await expect(resume(prepared, { stepIds: [unsupported!.id] })).rejects.toMatchObject({ code: 'TASK_RETRY_INVALID' });
    // Even an internally signed malformed proof cannot expand the profile's
    // available tools when the verifier reconstructs its dependency closure.
    const forged = sign({ ...payload(prepared.retry.token), stepIds: [unsupported!.id] });
    await expect(resume(prepared, { token: forged, stepIds: [unsupported!.id] }))
      .rejects.toMatchObject({ code: 'TASK_RETRY_INVALID' });
    expect(prepared.dining).not.toHaveBeenCalled();
    expect(prepared.fixture.writes).toHaveLength(0);
  });

  it('rejects a changed profile before any source access', async () => {
    const prepared = await failedTransit('merchant');
    prepared.read.mockClear();
    const [body, signature] = prepared.retry.token.split('.');
    const changed = { ...payload(prepared.retry.token), taskProfile: 'student' };
    expect(Buffer.from(canonical(changed)).toString('base64url')).not.toBe(body);
    const token = Buffer.from(canonical(changed)).toString('base64url') + '.' + signature;
    await expect(resume(prepared, { token })).rejects.toMatchObject({ code: 'TASK_RETRY_INVALID' });
    expect(prepared.read).not.toHaveBeenCalled();
  });

  it.each(['administrator', null, { id: 'student' }])('rejects a signed invalid profile %j', async taskProfile => {
    const prepared = await failedTransit('teacher');
    prepared.read.mockClear();
    await expect(resume(prepared, { token: sign({ ...payload(prepared.retry.token), taskProfile }) }))
      .rejects.toMatchObject({ code: 'TASK_RETRY_INVALID' });
    expect(prepared.read).not.toHaveBeenCalled();
  });

  it('accepts an unexpired legacy read proof without enabling proposals', async () => {
    const prepared = await failedTransit('student');
    const legacy: Obj = { ...payload(prepared.retry.token), version: 1 };
    delete legacy.taskProfile;
    delete legacy.eventMapSelections;
    delete legacy.merchantSelections;
    const reply = await resume(prepared, { token: sign(legacy) });
    expect(reply.taskPlan.steps).toHaveLength(1);
    expect(reply.taskPlan.steps[0]).toMatchObject({ serviceId: 'bus', status: 'completed' });
    expect(reply.cards).toEqual([]);
    expect(prepared.fixture.writes).toHaveLength(0);
    expect(prepared.fixture.orderCalls).toHaveLength(0);
  });

  it('does not infer student scope from a legacy professional-context proof', async () => {
    const prepared = await failedTransit('merchant', '查今天課表，查餐廳，查公車');
    const plan = 'taskPlan' in prepared.reply ? prepared.reply.taskPlan : undefined;
    const unsupported = plan!.steps.find(step => step.serviceId === 'cafeteria')!;
    // Reconstruct a genuine old proof shape: the old issuer included context-
    // blocked reads but had no taskProfile field in its authenticated payload.
    const legacy: Obj = { ...payload(prepared.retry.token), version: 1, stepIds: [unsupported.id] };
    delete legacy.taskProfile;
    delete legacy.eventMapSelections;
    delete legacy.merchantSelections;
    prepared.read.mockClear();
    await expect(resume(prepared, { token: sign(legacy), stepIds: [unsupported.id] }))
      .rejects.toMatchObject({ code: 'TASK_RETRY_INVALID' });
    expect(prepared.read).not.toHaveBeenCalled();
    expect(prepared.dining).not.toHaveBeenCalled();
    expect(prepared.fixture.writes).toHaveLength(0);
  });
});
