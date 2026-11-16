// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { parseAssistantCalendarReceipt } from '@campus/shared/src/assistantExecution';
import { confirm, issueRoute, reconcile, revoke, routeOwner, routeTarget, signCard, verifyCard, verifyRevokedCalendarPlan } from './actions';
import { prepareCampusEventRequest } from './campusEventRequest';
import { publicEventArgs, publicEventFingerprint, publicEventHref, publicEventSourcePath, type PublicEventRead, type PublicEventSourceItem } from './publicEvent';
import { fixtureAdapter, fixtureBinding, FIXTURE_NOW as now, FIXTURE_SECRET as secret } from './fixtures';
import { V2Error, type Binding } from './contracts';

const target = { schoolId: fixtureBinding.schoolId, source: 'school-club-events' as const, id: 'event-selected' };
const event: PublicEventSourceItem = { ...target, title: '校園攝影講座',
  startsAt: '2026-11-04T12:00:00.000Z', endsAt: '2026-11-04T13:00:00.000Z',
  href: publicEventHref(target), location: '活動中心二樓' };
function ready(item: PublicEventSourceItem = event): PublicEventRead {
  return { version: 1, target, sourcePath: publicEventSourcePath(target), checkedAt: new Date(now).toISOString(),
    status: 'ready', item, fingerprint: publicEventFingerprint(item), args: publicEventArgs(item, now) };
}
function setup() {
  const fixture = fixtureAdapter();
  fixture.adapter.publicEvent = vi.fn(async () => ready());
  const binding = { ...fixtureBinding, conversationId: randomUUID() };
  const request = { target, binding, adapter: fixture.adapter, secret, writes: true, now,
    signal: new AbortController().signal };
  return { fixture, binding, request };
}
const proof = (card: { token: string; args: Record<string, unknown> }) => ({ token: card.token, args: card.args });

describe('source-selected public event to verified personal calendar', () => {
  it('re-reads exactly the selected identity, prepares no write, then confirms and verifies one record', async () => {
    const { fixture, binding, request } = setup();
    const reply = await prepareCampusEventRequest(request);
    expect(reply).toMatchObject({ dataRead: true, stopReason: '', cards: [
      { tool: 'propose_personal_event', args: { title: event.title, date: '2026-11-04', allDay: false, startTime: '20:00', endTime: '21:00' } },
    ], eventTargets: [{ ...event, checkedAt: new Date(now).toISOString() }] });
    expect(fixture.adapter.publicEvent).toHaveBeenCalledExactlyOnceWith(target);
    expect(fixture.writes).toHaveLength(0);
    expect(reply.answer).toContain('不會報名');
    const card = reply.cards[0];
    expect(verifyCard(binding, proof(card), secret, now + 1000).publicEventGuard)
      .toEqual({ target, fingerprint: publicEventFingerprint(event) });
    const receipt = parseAssistantCalendarReceipt(await confirm(binding, proof(card), secret, now + 1000, fixture.adapter, true),
      { schoolId: binding.schoolId, mutationId: card.mutationId, event: card.args, storage: 'synced' });
    expect(receipt.status).toBe('verified');
    expect(fixture.writes).toHaveLength(1);
    expect(fixture.adapter.publicEvent).toHaveBeenCalledTimes(2);
    const replay = await confirm(binding, proof(card), secret, now + 2000, fixture.adapter, true);
    expect(replay).toMatchObject({ status: 'verified', replay: true });
    expect(fixture.writes).toHaveLength(1);
    expect(fixture.adapter.publicEvent).toHaveBeenCalledTimes(2);
  });

  it.each([
    { title: '活動名稱已修改' },
    { startsAt: '2026-11-04T12:30:00.000Z', endsAt: '2026-11-04T13:30:00.000Z' },
    { location: '已改至另一地點' },
  ])('does not write after source facts change: %j', async change => {
    const { fixture, binding, request } = setup();
    const reply = await prepareCampusEventRequest(request);
    fixture.adapter.publicEvent = vi.fn(async () => ready({ ...event, ...change }));
    await expect(confirm(binding, proof(reply.cards[0]), secret, now + 1000, fixture.adapter, true))
      .rejects.toMatchObject({ code: 'CAMPUS_EVENT_CHANGED' });
    expect(fixture.writes).toHaveLength(0);
  });

  it.each([
    ['NOT_FOUND', 'CAMPUS_EVENT_CHANGED'],
    ['SOURCE_UNAVAILABLE', 'CAMPUS_EVENT_UNAVAILABLE'],
    ['MISSING_END_TIME', 'CAMPUS_EVENT_TIME_REQUIRED'],
    ['EVENT_NOT_FUTURE', 'CAMPUS_EVENT_START_PASSED'],
  ] as const)('blocks unavailable source %s before dispatch', async (unavailable, code) => {
    const { fixture, binding, request } = setup();
    const reply = await prepareCampusEventRequest(request);
    fixture.adapter.publicEvent = vi.fn(async () => ({ version: 1, target,
      sourcePath: publicEventSourcePath(target), checkedAt: new Date(now).toISOString(), status: 'unavailable', unavailable }));
    await expect(confirm(binding, proof(reply.cards[0]), secret, now + 1000, fixture.adapter, true)).rejects.toMatchObject({ code });
    expect(fixture.writes).toHaveLength(0);
  });

  it('retains receipt recovery when the original public event has disappeared or is offline', async () => {
    const { fixture, binding, request } = setup();
    const reply = await prepareCampusEventRequest(request), card = reply.cards[0];
    await confirm(binding, proof(card), secret, now + 1000, fixture.adapter, true);
    const publicRead = vi.fn(async () => { throw new Error('Public source is now offline'); });
    fixture.adapter.publicEvent = publicRead;
    expect(await reconcile(binding, proof(card), secret, now + 400000, fixture.adapter, true))
      .toMatchObject({ status: 'verified', replay: true });
    expect(await revoke(binding, proof(card), secret, now + 400000, fixture.adapter))
      .toMatchObject({ status: 'verified' });
    expect(publicRead).not.toHaveBeenCalled();
    expect(fixture.writes).toHaveLength(1);
  });

  it('preserves the old chat card through separate event preview issuance and cancellation', async () => {
    const { fixture, binding, request } = setup();
    const oldBinding: Binding = { ...binding, conversationId: randomUUID() };
    const old = signCard(oldBinding, 'propose_personal_event',
      { title: '原本讀書', date: '2026-11-04', allDay: false, startTime: '18:00', endTime: '19:00' },
      1, secret, now);
    const reply = await prepareCampusEventRequest(request);
    expect(verifyCard(oldBinding, proof(old), secret, now + 1000).mutationId).toBe(old.mutationId);
    expect(await revoke(binding, proof(reply.cards[0]), secret, now + 1000, fixture.adapter)).toMatchObject({ status: 'revoked' });
    expect(verifyCard(oldBinding, proof(old), secret, now + 1000).mutationId).toBe(old.mutationId);
    await expect(confirm(oldBinding, proof(old), secret, now + 1000, fixture.adapter, true)).resolves.toMatchObject({ status: 'verified' });
  });

  it('cannot revise a source-guarded card into an unguarded generic event', async () => {
    const { fixture, binding, request } = setup(), reply = await prepareCampusEventRequest(request);
    const card = reply.cards[0];
    await revoke(binding, proof(card), secret, now + 1000, fixture.adapter);
    expect(() => verifyRevokedCalendarPlan(binding, [proof(card)], secret, now + 1000))
      .toThrowError(expect.objectContaining({ code: 'INVALID_PLAN_REVISION' }));
  });

  it('rejects forged scope or arguments and permission withdrawal without writing', async () => {
    const { fixture, binding, request } = setup(), reply = await prepareCampusEventRequest(request);
    const card = reply.cards[0];
    for (const forged of [{ ...binding, schoolId: 'foreign' }, { ...binding, account: 'foreign' },
      { ...binding, session: 'foreign' }, { ...binding, conversationId: 'foreign' }])
      await expect(confirm(forged, proof(card), secret, now + 1000, fixture.adapter, true)).rejects.toThrow();
    await expect(confirm(binding, { ...proof(card), args: { ...card.args, title: '偽造活動' } }, secret, now + 1000, fixture.adapter, true)).rejects.toThrow();
    fixture.adapter.permissions = async () => ({ createPersonalEvent: false, prepareFoodOrder: true });
    await expect(confirm(binding, proof(card), secret, now + 1000, fixture.adapter, true))
      .rejects.toMatchObject({ code: 'ASSISTANT_PERMISSION_DENIED' });
    expect(fixture.writes).toHaveLength(0);
  });

  it('does not issue a card for conflicting times or disabled writes', async () => {
    const conflict = setup();
    conflict.fixture.adapter.publicEvent = vi.fn(async () => ready({ ...event,
      startsAt: '2026-11-04T05:00:00.000Z', endsAt: '2026-11-04T06:00:00.000Z' }));
    expect(await prepareCampusEventRequest(conflict.request)).toMatchObject({ cards: [], stopReason: 'EVENT_CONFLICT' });
    expect(conflict.fixture.writes).toHaveLength(0);
    const disabled = setup();
    expect(await prepareCampusEventRequest({ ...disabled.request, writes: false }))
      .toMatchObject({ cards: [], stopReason: 'WRITES_DISABLED', eventTargets: [{ id: target.id }] });
    expect(disabled.fixture.writes).toHaveLength(0);
  });

  it('keeps cross-day source time exact in Taipei', async () => {
    const { fixture, request } = setup();
    fixture.adapter.publicEvent = vi.fn(async () => ready({ ...event,
      startsAt: '2026-11-04T15:30:00.000Z', endsAt: '2026-11-04T16:30:00.000Z' }));
    const result = await prepareCampusEventRequest(request);
    expect(result.cards[0].args).toMatchObject({ date: '2026-11-04', endDate: '2026-11-05', startTime: '23:30', endTime: '00:30' });
  });

  it('blocks a source read that completes after cancellation and never writes', async () => {
    const { fixture, request } = setup(), controller = new AbortController();
    fixture.adapter.publicEvent = vi.fn(async () => { controller.abort(); return ready(); });
    await expect(prepareCampusEventRequest({ ...request, signal: controller.signal })).rejects.toThrow();
    expect(fixture.writes).toHaveLength(0);
  });

  it('never masks an expired authenticated session as an empty event result', async () => {
    const { fixture, request } = setup();
    fixture.adapter.publicEvent = vi.fn(async () => { throw new V2Error(401, 'SESSION_EXPIRED'); });
    await expect(prepareCampusEventRequest(request)).rejects.toMatchObject({ code: 'SESSION_EXPIRED' });
  });

  it('rechecks time after slow verification and before the first dispatch', async () => {
    const { fixture, binding, request } = setup();
    const selected = { ...event, startsAt: new Date(now + 60000).toISOString(), endsAt: new Date(now + 120000).toISOString() };
    fixture.adapter.publicEvent = vi.fn(async () => ready(selected));
    const result = await prepareCampusEventRequest(request);
    let clock = now, permissionReads = 0;
    fixture.adapter.permissions = async () => {
      if (++permissionReads === 2) clock = now + 60000;
      return { createPersonalEvent: true, prepareFoodOrder: true };
    };
    await expect(confirm(binding, proof(result.cards[0]), secret, now, fixture.adapter, true,
      () => clock)).rejects.toMatchObject({ code: 'CAMPUS_EVENT_START_PASSED' });
    expect(permissionReads).toBe(2);
    expect(fixture.writes).toHaveLength(0);
  });

  it('does not issue an already-started card when the last permission read crosses its start time', async () => {
    let clock = now, permissionReads = 0;
    const spy = vi.spyOn(Date, 'now').mockImplementation(() => clock);
    try {
      const { fixture, request } = setup();
      const selected = { ...event, startsAt: new Date(now + 60000).toISOString(), endsAt: new Date(now + 120000).toISOString() };
      fixture.adapter.publicEvent = vi.fn(async () => ready(selected));
      fixture.adapter.permissions = async () => {
        if (++permissionReads === 2) clock = now + 60000;
        return { createPersonalEvent: true, prepareFoodOrder: true };
      };
      expect(await prepareCampusEventRequest(request)).toMatchObject({ cards: [], stopReason: 'CAMPUS_EVENT_START_PASSED' });
      expect(permissionReads).toBe(2);
      expect(fixture.writes).toHaveLength(0);
    } finally { spy.mockRestore(); }
  });
});

describe('independent event-preview route authority', () => {
  it('does not accept a chat route for events or an event route for chat/revision', () => {
    const binding = { ...fixtureBinding, conversationId: randomUUID() };
    const chat = issueRoute(binding, secret), events = issueRoute(binding, secret, 'event-preview');
    const scope = { session: binding.session, conversationId: binding.conversationId, schoolId: binding.schoolId };
    expect(routeOwner(events, binding, secret, 'event-preview')).toBe('local');
    expect(routeTarget(chat, scope, secret)).toBe('local');
    expect(() => routeOwner(chat, binding, secret, 'event-preview')).toThrow();
    expect(() => routeTarget(events, scope, secret)).toThrow();
    expect(() => routeOwner(events, { ...binding, account: 'another' }, secret, 'event-preview')).toThrow();
  });
});
