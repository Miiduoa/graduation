// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import { parseAssistantCalendarIntent } from '@campus/shared/src/assistantCalendarIntent';
import { parseAssistantCalendarReceipt } from '@campus/shared/src/assistantExecution';
import { confirm } from './actions';
import { V2Error } from './contracts';
import { fixtureAdapter, fixtureBinding, FIXTURE_NOW as now, FIXTURE_SECRET as secret } from './fixtures';
import { prepareExplicitEventRequest } from './explicitEventRequest';
import { run } from './runner';
import { createTools } from './tools';

const question = '幫我明天 19:00 到 20:00 安排英文讀書';
const event = { title: '英文讀書', date: '2026-11-05', allDay: false, startTime: '19:00', endTime: '20:00' };
const binding = { ...fixtureBinding, conversationId: 'explicit-event-test' };
const signal = () => new AbortController().signal;
afterEach(() => { vi.restoreAllMocks(); });

it('turns an exact appointment into a reviewable card, with zero model calls or premature writes', async () => {
  const fixture = fixtureAdapter();
  const model = vi.fn().mockRejectedValue(new Error('provider unavailable'));
  const courses = vi.spyOn(fixture.adapter, 'courses');
  const result = await run({ question, history: [], binding, adapter: fixture.adapter, model,
    secret, now, writes: true, signal: signal(), log: () => {} });
  expect(result.cards).toHaveLength(1);
  expect(result.cards[0]).toMatchObject({ tool: 'propose_personal_event', args: event });
  expect(result.answer).toContain('2026-11-05 19:00–20:00｜英文讀書');
  expect(result.answer).toContain('按下確認後');
  expect(result.answer).not.toContain('樹與圖');
  expect(result.answer).not.toContain('已加入');
  expect(result.modelCalls).toBe(0);
  expect(model).not.toHaveBeenCalled();
  expect(courses).not.toHaveBeenCalled();
  expect(fixture.writes).toHaveLength(0);

  const card = result.cards[0];
  const raw = { token: card.token, args: card.args };
  const receipt = parseAssistantCalendarReceipt(
    await confirm(binding, raw, secret, now, fixture.adapter, true),
    { schoolId: binding.schoolId, mutationId: card.mutationId, event, storage: 'synced' },
  );
  expect(receipt).toMatchObject({ status: 'verified', replay: false, record: event });
  expect(fixture.snapshot().records.some((record) => record.id === card.mutationId && record.title === '英文讀書')).toBe(true);
  await confirm(binding, raw, secret, now, fixture.adapter, true);
  expect(fixture.writes).toHaveLength(1);
});

it('keeps the write gate closed while returning the actual prepared content', async () => {
  const fixture = fixtureAdapter();
  const read = vi.spyOn(fixture.adapter, 'ledger');
  const tools = createTools(fixture.adapter, binding, secret, now, false, false, question);
  const result = await prepareExplicitEventRequest({ question, now, tools, signal: signal() });
  expect(result).toMatchObject({ cards: [], stopReason: 'WRITES_DISABLED' });
  expect(result?.answer).toContain('2026-11-05 19:00–20:00｜英文讀書');
  expect(result?.answer).toContain('尚未加入行事曆');
  expect(read).not.toHaveBeenCalled();
  expect(fixture.writes).toHaveLength(0);
});

it.each(['寫履歷', '寫研究計畫'])('preserves the explicitly requested title %s', async (title) => {
  const fixture = fixtureAdapter();
  const text = `幫我明天 19:00 到 20:00 安排${title}`;
  const tools = createTools(fixture.adapter, binding, secret, now, true, false, text);
  const result = await prepareExplicitEventRequest({ question: text, now, tools, signal: signal() });
  expect(result?.cards[0].args.title).toBe(title);
  expect(result?.answer).toContain(`｜${title}`);
  expect(result?.answer).not.toContain('寫作業：');
});

it('reports the conflicting slot instead of substituting a different task or claiming success', async () => {
  const fixture = fixtureAdapter();
  const conflicting = '幫我今天 13:00 到 14:00 安排英文讀書';
  const tools = createTools(fixture.adapter, binding, secret, now, true, false, conflicting);
  const result = await prepareExplicitEventRequest({ question: conflicting, now, tools, signal: signal() });
  expect(result).toMatchObject({ cards: [], stopReason: 'EVENT_CONFLICT' });
  expect(result?.answer).toContain('與課表或個人行程重疊');
  expect(result?.answer).toContain('尚未建立');
  expect(fixture.writes).toHaveLength(0);
});

it.each([
  '幫我明天 20:00 到 19:00 安排英文讀書',
  '幫我今天 08:00 到 09:00 安排英文讀書',
  '安排2027-02-30 19:00 到 20:00 英文讀書',
])('clarifies an invalid appointment without reading data or guessing a time: %s', async (text) => {
  const fixture = fixtureAdapter();
  const read = vi.spyOn(fixture.adapter, 'ledger');
  const tools = createTools(fixture.adapter, binding, secret, now, true, false, text);
  const result = await prepareExplicitEventRequest({ question: text, now, tools, signal: signal() });
  expect(result).toMatchObject({ cards: [], steps: [], stopReason: 'INVALID_EVENT_REQUEST' });
  expect(read).not.toHaveBeenCalled();
  expect(fixture.writes).toHaveLength(0);
});

it.each([
  '明天 19:00 到 20:00 有空嗎？',
  '不要幫我明天 19:00 到 20:00 安排英文讀書',
  '「幫我明天 19:00 到 20:00 安排英文讀書」是什麼意思？',
  '幫我明天 19:00 到 20:00 安排英文讀書，然後送出作業',
  '幫我明天安排英文讀書',
])('does not turn questions, negation, quotations or compound requests into an appointment: %s', async (text) => {
  const fixture = fixtureAdapter();
  const read = vi.spyOn(fixture.adapter, 'ledger');
  const tools = createTools(fixture.adapter, binding, secret, now, true, false, text);
  expect(await prepareExplicitEventRequest({ question: text, now, tools, signal: signal() })).toBeNull();
  expect(read).not.toHaveBeenCalled();
});

it('propagates revoked authentication and cancels without producing a card', async () => {
  const fixture = fixtureAdapter();
  vi.spyOn(fixture.adapter, 'ledger').mockRejectedValue(new V2Error(401, 'SESSION_EXPIRED'));
  const tools = createTools(fixture.adapter, binding, secret, now, true, false, question);
  await expect(prepareExplicitEventRequest({ question, now, tools, signal: signal() }))
    .rejects.toMatchObject({ status: 401 });
  const aborted = new AbortController();
  aborted.abort();
  await expect(prepareExplicitEventRequest({ question, now, tools, signal: aborted.signal })).rejects.toThrow();
  expect(tools.cards).toHaveLength(0);
  expect(fixture.writes).toHaveLength(0);
});

it('does not sign a card when a cancelled ledger read resolves later', async () => {
  const fixture = fixtureAdapter();
  const ledger = await fixture.adapter.ledger();
  let release!: (value: typeof ledger) => void;
  let started!: () => void;
  const ready = new Promise<void>((resolve) => { started = resolve; });
  vi.spyOn(fixture.adapter, 'ledger').mockImplementation(() => {
    started();
    return new Promise((resolve) => { release = resolve; });
  });
  const tools = createTools(fixture.adapter, binding, secret, now, true, false, question);
  const controller = new AbortController();
  const result = prepareExplicitEventRequest({ question, now, tools, signal: controller.signal });
  const rejected = expect(result).rejects.toMatchObject({ code: 'ABORTED' });
  await ready;
  controller.abort();
  await rejected;
  release(ledger);
  await new Promise<void>((resolve) => setImmediate(resolve));
  expect(tools.cards).toHaveLength(0);
  expect(fixture.writes).toHaveLength(0);
});

it('rejects a ledger from another school without exposing its data', async () => {
  const fixture = fixtureAdapter();
  const ledger = await fixture.adapter.ledger();
  vi.spyOn(fixture.adapter, 'ledger').mockResolvedValue({ ...ledger, schoolId: 'another-school' });
  const tools = createTools(fixture.adapter, binding, secret, now, true, false, question);
  const result = await prepareExplicitEventRequest({ question, now, tools, signal: signal() });
  expect(result?.cards).toHaveLength(0);
  expect(result?.answer).toContain('尚未建立');
  expect(result?.answer).not.toContain('資料結構');
  expect(fixture.writes).toHaveLength(0);
});

it.each(['ASSISTANT_PERMISSION_DENIED', 'ASSISTANT_PERMISSION_STORE_UNAVAILABLE'])(
  'retains actionable permission failures for the Google permissions integration: %s', async (code) => {
    const fixture = fixtureAdapter();
    const tools = createTools(fixture.adapter, binding, secret, now, true, false, question);
    vi.spyOn(tools, 'call').mockRejectedValue(new V2Error(403, code));
    const result = await prepareExplicitEventRequest({ question, now, tools, signal: signal() });
    expect(result).toMatchObject({ cards: [], stopReason: code });
    expect(result?.answer).toContain('助理權限');
    if (code === 'ASSISTANT_PERMISSION_DENIED') expect(result?.answer).toContain('/settings?section=assistant');
    expect(fixture.writes).toHaveLength(0);
  },
);

it('shares the native parser and resolves tomorrow using the Taiwan date across year boundaries', () => {
  expect(parseAssistantCalendarIntent(question, Date.parse('2026-12-31T16:10:00Z')))
    .toMatchObject({ kind: 'draft', event: { ...event, date: '2027-01-02' } });
});
