// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { parseAssistantTaskRetry } from '@campus/shared/src/assistantTaskRetry';
import { confirm } from './actions';
import { V2Error, type Binding } from './contracts';
import { fixtureAdapter, fixtureBinding, FIXTURE_NOW as now, FIXTURE_SECRET as secret } from './fixtures';
import { run } from './runner';
import { retryTaskReads } from './taskRetry';

let serial = 0;
const binding = (): Binding => ({ ...fixtureBinding, conversationId: 'retry-' + ++serial });
async function prepare(question: string, fixture = fixtureAdapter(), scope = binding(), at = now) {
  const model = vi.fn().mockRejectedValue(new Error('No model for a structured task'));
  const reply = await run({ question, history: [], binding: scope, adapter: fixture.adapter,
    secret, now: at, writes: true, signal: new AbortController().signal, model, log: () => {} });
  expect(model).not.toHaveBeenCalled();
  const taskRetry = parseAssistantTaskRetry('taskRetry' in reply ? reply.taskRetry : undefined,
    'taskPlan' in reply ? reply.taskPlan : undefined);
  return { reply, taskRetry, fixture, scope };
}
async function unavailableBus(question = '查今天課表，查公車') {
  const fixture = fixtureAdapter(), transit = fixture.adapter.transit;
  const read = vi.spyOn(fixture.adapter, 'transit').mockRejectedValueOnce(new Error('Temporary failure'));
  const result = await prepare(question, fixture);
  expect(result.taskRetry).not.toBeNull();
  read.mockImplementation(transit);
  return { ...result, read };
}
function retry(result: Awaited<ReturnType<typeof prepare>>, overrides: Partial<Parameters<typeof retryTaskReads>[0]> = {}) {
  return retryTaskReads({ binding: result.scope, secret, now: now + 1000, adapter: result.fixture.adapter,
    signal: new AbortController().signal, token: result.taskRetry!.token, stepIds: result.taskRetry!.stepIds, ...overrides });
}

describe('selective cross-service read continuation', () => {
  it('retries the failed source without rereading unrelated completed services', async () => {
    const result = await unavailableBus('查今天課表，查餐廳，查公車');
    const ledger = vi.spyOn(result.fixture.adapter, 'ledger'), dining = vi.spyOn(result.fixture.adapter, 'dining');
    const response = await retry(result);
    expect(response).toMatchObject({ version: 2, dataRead: true, modelCalls: 0, cards: [], stopReason: '' });
    expect(response.taskPlan.steps).toHaveLength(1);
    expect(response.taskPlan.steps[0]).toMatchObject({ serviceId: 'bus', status: 'completed' });
    expect(response.taskRetry).toBeUndefined();
    expect(result.read).toHaveBeenCalledTimes(2);
    expect(ledger).not.toHaveBeenCalled();
    expect(dining).not.toHaveBeenCalled();
    expect(result.fixture.writes).toHaveLength(0);
    expect(result.fixture.orderCalls).toHaveLength(0);
  });

  it('preserves an existing study card, including confirmation and idempotent readback', async () => {
    const result = await unavailableBus('查未交作業，安排今天15:00到16:00讀書，查公車');
    expect(result.reply.cards).toHaveLength(1);
    const card = result.reply.cards[0];
    const response = await retry(result);
    expect(response.cards).toEqual([]);
    expect(response.taskPlan.steps).toHaveLength(1);
    expect(result.fixture.writes).toHaveLength(0);
    const proof = { token: card.token, args: card.args };
    await confirm(result.scope, proof, secret, now + 2000, result.fixture.adapter, true, () => now + 2000);
    await confirm(result.scope, proof, secret, now + 3000, result.fixture.adapter, true, () => now + 3000);
    expect(result.fixture.writes).toHaveLength(1);
    expect((await retry(result)).cards).toEqual([]);
    expect(result.fixture.writes).toHaveLength(1);
  });

  it('rereads a selected material lookup and its original coursework dependency only', async () => {
    const fixture = fixtureAdapter(), materials = fixture.adapter.materials;
    vi.spyOn(fixture.adapter, 'materials').mockRejectedValueOnce(new Error('Temporary failure'));
    const result = await prepare('查未交作業，找相關教材，查餐廳', fixture);
    expect(result.taskRetry).not.toBeNull();
    vi.mocked(fixture.adapter.materials).mockImplementation(materials);
    const work = vi.spyOn(fixture.adapter, 'work'), dining = vi.spyOn(fixture.adapter, 'dining');
    const response = await retry(result);
    expect(response.taskPlan.steps.map(step => step.serviceId)).toEqual(['classroom', 'classroom']);
    expect(response.taskPlan.steps.at(-1)?.status).toBe('completed');
    expect(response.answer).toContain('樹與圖講義');
    expect(work).toHaveBeenCalled();
    expect(dining).not.toHaveBeenCalled();
    expect(response.cards).toEqual([]);
  });

  it('never resumes a study or reorder operation as a side effect of repairing its read dependency', async () => {
    const fixture = fixtureAdapter(), readLedger = fixture.adapter.ledger;
    vi.spyOn(fixture.adapter, 'ledger').mockRejectedValue(new Error('Offline'));
    const result = await prepare('查今天課表，安排今天讀書30分鐘，查餐廳', fixture);
    expect(result.taskRetry).not.toBeNull();
    const original = 'taskPlan' in result.reply ? result.reply.taskPlan : undefined;
    const study = original?.steps.find(step => step.label === '安排作業準備時間');
    expect(study?.status).toBe('blocked');
    expect(result.taskRetry?.stepIds).not.toContain(study?.id);
    vi.mocked(fixture.adapter.ledger).mockImplementation(readLedger);
    const response = await retry(result);
    expect(response.cards).toEqual([]);
    expect(response.taskPlan.steps.every(step => !step.cardIds?.length)).toBe(true);
    expect(response.taskPlan.steps.some(step => step.id === study?.id)).toBe(false);
    await expect(retry(result, { stepIds: [study!.id] })).rejects.toMatchObject({ code: 'TASK_RETRY_INVALID' });
    expect(fixture.writes).toHaveLength(0);
    expect(fixture.orderCalls).toHaveLength(0);
  });

  it('returns renewed failure scope without extending the original expiry', async () => {
    const result = await unavailableBus('查今天課表，查餐廳，查公車');
    result.read.mockRejectedValue(new Error('Still offline'));
    const response = await retry(result, { now: now + 120000 });
    const credential = parseAssistantTaskRetry(response.taskRetry, response.taskPlan);
    expect(credential?.stepIds).toEqual(result.taskRetry?.stepIds);
    expect(credential?.expiresAt).toBe(result.taskRetry?.expiresAt);
    expect(response.cards).toEqual([]);
    expect(response.taskPlan.steps[0].status).toBe('blocked');
  });

  it('keeps the original day when a retry crosses midnight', async () => {
    const at = Date.parse('2026-11-04T23:55:00+08:00');
    const fixture = fixtureAdapter(), readLedger = fixture.adapter.ledger;
    vi.spyOn(fixture.adapter, 'ledger').mockRejectedValueOnce(new Error('Offline'));
    const result = await prepare('查今天課表，查餐廳', fixture, binding(), at);
    expect(result.taskRetry).not.toBeNull();
    vi.mocked(fixture.adapter.ledger).mockImplementation(readLedger);
    const response = await retry(result, { now: at + 10 * 60000 });
    expect(response.answer).toContain('程式設計');
    expect(response.answer).toContain('資料結構');
    expect(response.answer).not.toContain('英文');
  });

  it('does not reclassify a past class as next when its original query is retried across midnight', async () => {
    const at = Date.parse('2026-11-04T23:55:00+08:00');
    const fixture = fixtureAdapter(), readLedger = fixture.adapter.ledger;
    vi.spyOn(fixture.adapter, 'ledger').mockRejectedValueOnce(new Error('Offline'));
    const result = await prepare('查下一堂課，查公車', fixture, binding(), at);
    expect(result.taskRetry).not.toBeNull();
    vi.mocked(fixture.adapter.ledger).mockImplementation(readLedger);
    const response = await retry(result, { now: at + 10 * 60000 });
    expect(response.answer).toContain('英文');
    expect(response.answer).not.toContain('程式設計');
    expect(response.answer).not.toContain('資料結構');
  });

  it('freezes an implicit coursework range rather than shifting it after midnight', async () => {
    const at = Date.parse('2026-11-04T23:55:00+08:00');
    const fixture = fixtureAdapter(), work = fixture.adapter.work;
    vi.spyOn(fixture.adapter, 'work').mockRejectedValue(new Error('Offline'));
    const result = await prepare('查功課，查公車', fixture, binding(), at);
    expect(result.taskRetry).not.toBeNull();
    vi.mocked(fixture.adapter.work).mockImplementation(work);
    const response = await retry(result, { now: at + 10 * 60000 });
    expect(response.answer).toContain('2026-11-04 至 2026-11-10');
    expect(response.answer).not.toContain('2026-11-05 至 2026-11-11');
  });

  it('does not offer yesterday\'s free periods when a time lookup is retried across midnight', async () => {
    const at = Date.parse('2026-11-04T23:55:00+08:00');
    const fixture = fixtureAdapter(), readLedger = fixture.adapter.ledger;
    vi.spyOn(fixture.adapter, 'ledger').mockRejectedValue(new Error('Offline'));
    const result = await prepare('找今天讀書空檔，查餐廳', fixture, binding(), at);
    expect(result.taskRetry).not.toBeNull();
    vi.mocked(fixture.adapter.ledger).mockImplementation(readLedger);
    const response = await retry(result, { now: at + 10 * 60000 });
    const free = response.taskPlan.steps.find(step => step.label === '找可用的讀書時段');
    expect(free?.summary).toContain('沒有');
    expect(free?.summary).not.toMatch(/\d{2}:\d{2}–\d{2}:\d{2}/);
    expect(response.cards).toEqual([]);
  });

  it.each(['account', 'session', 'schoolId', 'conversationId'] as const)('rejects changed %s before any source read', async key => {
    const result = await unavailableBus();
    result.read.mockClear();
    await expect(retry(result, { binding: { ...result.scope, [key]: 'other-owner' } })).rejects.toMatchObject({ code: 'TASK_RETRY_INVALID' });
    expect(result.read).not.toHaveBeenCalled();
  });

  it.each(['modified token', 'completed id', 'duplicate ids', 'missing ids', 'empty ids', 'expired', 'future issuance'])(
    'refuses %s without reading data', async mode => {
      const result = await unavailableBus();
      result.read.mockClear();
      const overrides: Partial<Parameters<typeof retryTaskReads>[0]> = {};
      if (mode === 'modified token') overrides.token = 'A' + result.taskRetry!.token.slice(1);
      if (mode === 'completed id') overrides.stepIds = ['task-1'];
      if (mode === 'duplicate ids') overrides.stepIds = [...result.taskRetry!.stepIds, ...result.taskRetry!.stepIds];
      if (mode === 'missing ids') overrides.stepIds = undefined;
      if (mode === 'empty ids') overrides.stepIds = [];
      if (mode === 'expired') overrides.now = result.taskRetry!.expiresAt;
      if (mode === 'future issuance') overrides.now = now - 1;
      await expect(retry(result, overrides)).rejects.toMatchObject({ code: mode === 'expired' ? 'TASK_RETRY_EXPIRED' : 'TASK_RETRY_INVALID' });
      expect(result.read).not.toHaveBeenCalled();
    },
  );

  it('propagates revoked sessions rather than returning a successful empty result', async () => {
    const result = await unavailableBus();
    result.read.mockRejectedValue(new V2Error(401, 'SESSION_EXPIRED'));
    await expect(retry(result)).rejects.toMatchObject({ status: 401, code: 'SESSION_EXPIRED' });
  });

  it('does not release a late result after cancellation', async () => {
    const result = await unavailableBus();
    let resolve!: (value: unknown) => void;
    result.read.mockImplementation(() => new Promise(done => { resolve = done; }));
    const controller = new AbortController();
    const promise = retry(result, { signal: controller.signal });
    const assertion = expect(promise).rejects.toBeDefined();
    await vi.waitFor(() => expect(resolve).toBeTypeOf('function'));
    controller.abort();
    resolve({ status: 'ready', kind: 'arrivals', arrivals: [] });
    await assertion;
    expect(result.fixture.writes).toHaveLength(0);
  });
});
