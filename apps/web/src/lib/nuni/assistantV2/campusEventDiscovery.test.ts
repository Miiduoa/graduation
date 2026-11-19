// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { assistantServiceHref } from '@campus/shared/src/assistantServices';
import { confirm, signCard, verifyCard } from './actions';
import { parseCampusEventDiscovery, prepareCampusEventDiscovery } from './campusEventDiscovery';
import { V2Error } from './contracts';
import { fixtureAdapter, fixtureBinding, FIXTURE_NOW as now, FIXTURE_SECRET as secret } from './fixtures';
import { operationSignal } from './operation';
import { publicCampusSourcePath, type PublicCampusRead } from './publicCampus';
import { publicEventArgs, publicEventFingerprint, publicEventHref, publicEventSourcePath,
  type PublicEventSourceItem, type PublicEventTarget } from './publicEvent';

const schoolId = fixtureBinding.schoolId;
const first: PublicEventSourceItem = { schoolId, source: 'school-club-events', id: 'first', title: '第一場校園講座',
  startsAt: '2026-11-04T12:00:00.000Z', endsAt: '2026-11-04T13:00:00.000Z', href: '' };
first.href = publicEventHref({ schoolId, source: first.source, id: first.id });
const second: PublicEventSourceItem = { ...first, id: 'second', title: '第二場工作坊',
  startsAt: '2026-11-04T13:00:00.000Z', endsAt: '2026-11-04T14:00:00.000Z', href: '' };
second.href = publicEventHref({ schoolId, source: second.source, id: second.id });
function list(items: PublicEventSourceItem[] = [first, second], partial = false): PublicCampusRead {
  return { version: 1, kind: 'events', schoolId, source: 'school-club-events',
    sourcePath: publicCampusSourcePath(schoolId, 'school-club-events'), checkedAt: new Date(now).toISOString(),
    status: 'ready', items: items.map(item => ({ id: item.id, schoolId, title: item.title, startsAt: item.startsAt,
      endsAt: item.endsAt, href: item.href, ...(item.location ? { location: item.location } : {}), summary: '' })), partial,
    href: assistantServiceHref('events', schoolId)! };
}
function exact(target: PublicEventTarget, item: PublicEventSourceItem) {
  return { version: 1, target, sourcePath: publicEventSourcePath(target), checkedAt: new Date(now).toISOString(),
    status: 'ready', item, args: publicEventArgs(item, now), fingerprint: publicEventFingerprint(item) };
}
function setup() {
  const fixture = fixtureAdapter(), binding = { ...fixtureBinding, conversationId: randomUUID() };
  fixture.adapter.publicCampus = vi.fn(async () => list());
  fixture.adapter.publicEvent = vi.fn(async target => exact(target, target.id === second.id ? second : first));
  vi.spyOn(fixture.adapter, 'ledger');
  const input = { adapter: fixture.adapter, binding, discovery: { index: 2 }, secret, writes: true, now,
    signal: new AbortController().signal };
  return { fixture, binding, input };
}
const proof = (card: { token: string; args: Record<string, unknown> }) => ({ token: card.token, args: card.args });
beforeEach(() => { vi.spyOn(Date, 'now').mockReturnValue(now); });
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

describe('activity discovery to source-bound calendar preparation', () => {
  it('selects exactly the second verified record, re-reads its facts and confirms just one mutation', async () => {
    const { fixture, binding, input } = setup();
    const changed = { ...second, title: '工作坊最新名稱', location: '活動中心' };
    fixture.adapter.publicEvent = vi.fn(async target => exact(target, changed));
    const result = await prepareCampusEventDiscovery(input), card = result.cards[0];
    expect(result).toMatchObject({ campusEventPreview: true, dataRead: true, stopReason: '',
      eventTargets: [{ id: second.id, title: changed.title }], cards: [{ args: { title: changed.title, startTime: '21:00', endTime: '22:00' } }] });
    expect(fixture.adapter.publicCampus).toHaveBeenCalledExactlyOnceWith('events', 5);
    expect(fixture.adapter.publicEvent).toHaveBeenCalledExactlyOnceWith({ schoolId, source: second.source, id: second.id });
    expect(verifyCard(binding, proof(card), secret, now).publicEventGuard)
      .toEqual({ target: { schoolId, source: second.source, id: second.id }, fingerprint: publicEventFingerprint(changed) });
    expect(fixture.writes).toHaveLength(0);
    expect(await confirm(binding, proof(card), secret, now, fixture.adapter, true)).toMatchObject({ status: 'verified', replay: false });
    expect(await confirm(binding, proof(card), secret, now, fixture.adapter, true)).toMatchObject({ status: 'verified', replay: true });
    expect(fixture.writes).toHaveLength(1);
  });

  it.each(['partial', 'unordered', 'short'] as const)('preserves explicit choices without selecting another record when the list is %s', async kind => {
    const { fixture, input } = setup();
    fixture.adapter.publicCampus = vi.fn(async () => list(kind === 'unordered' ? [second, first] : [first, second], kind === 'partial'));
    const result = await prepareCampusEventDiscovery({ ...input, discovery: { index: kind === 'short' ? 3 : 2 } });
    expect(result).toMatchObject({ campusEventPreview: false, cards: [], dataRead: true, stopReason: 'CAMPUS_EVENT_SELECTION_REQUIRED' });
    expect(result.eventTargets.map(item => item.id)).toEqual(kind === 'unordered' ? ['second', 'first'] : ['first', 'second']);
    expect(fixture.adapter.publicEvent).not.toHaveBeenCalled();
    expect(fixture.adapter.ledger).not.toHaveBeenCalled();
    expect(fixture.writes).toHaveLength(0);
  });

  it('does not replace an empty result with an older event or claim no campus events exist', async () => {
    const { fixture, input } = setup();
    fixture.adapter.publicCampus = vi.fn(async () => list([]));
    const result = await prepareCampusEventDiscovery(input);
    expect(result).toMatchObject({ campusEventPreview: false, cards: [], eventTargets: [], stopReason: 'CAMPUS_EVENT_EMPTY' });
    expect(result.answer).toContain('不代表校內沒有其他活動');
    expect(fixture.adapter.publicEvent).not.toHaveBeenCalled();
  });

  it.each([
    (read: PublicCampusRead) => ({ ...read, schoolId: 'another-school' }),
    (read: PublicCampusRead) => ({ ...read, sourcePath: 'users/private' }),
    (read: PublicCampusRead) => ({ ...read, items: [read.items[0], read.items[0]] }),
    (read: PublicCampusRead) => ({ ...read, items: [{ ...read.items[0], id: ' ' }, read.items[1]] }),
    (read: PublicCampusRead) => ({ ...read, items: [read.items[0], { ...read.items[1], startsAt: undefined }] }),
  ])('rejects malformed or ambiguous source lists as a whole', async corrupt => {
    const { fixture, input } = setup();
    fixture.adapter.publicCampus = vi.fn(async () => corrupt(list()));
    expect(await prepareCampusEventDiscovery(input)).toMatchObject({ campusEventPreview: false, cards: [], eventTargets: [],
      stopReason: 'INVALID_PUBLIC_CAMPUS_RESULT' });
    expect(fixture.adapter.publicEvent).not.toHaveBeenCalled();
  });

  it('keeps unavailable source distinct from an empty successful read', async () => {
    const { fixture, input } = setup();
    fixture.adapter.publicCampus = vi.fn(async () => ({ ...list([]), status: 'unavailable', unavailable: 'HIDDEN_SCHOOL' }));
    expect(await prepareCampusEventDiscovery(input)).toMatchObject({ campusEventPreview: false, cards: [], eventTargets: [],
      stopReason: 'CAMPUS_EVENT_UNAVAILABLE', steps: [{ name: 'get_campus_events', status: 'error' }] });
    expect(fixture.adapter.publicEvent).not.toHaveBeenCalled();
  });

  it('does not use list dates when the exact source has no confirmed ending time', async () => {
    const { fixture, input } = setup();
    fixture.adapter.publicEvent = vi.fn(async target => ({ version: 1, target, sourcePath: publicEventSourcePath(target),
      checkedAt: new Date(now).toISOString(), status: 'unavailable', unavailable: 'MISSING_END_TIME' }));
    expect(await prepareCampusEventDiscovery(input)).toMatchObject({ campusEventPreview: true, cards: [], eventTargets: [],
      stopReason: 'CAMPUS_EVENT_TIME_REQUIRED' });
    expect(fixture.writes).toHaveLength(0);
  });

  it('preserves a separately pending chat card through discovery and source preview', async () => {
    const { fixture, binding, input } = setup(), oldBinding = { ...binding, conversationId: 'old-' + randomUUID() };
    const old = signCard(oldBinding, 'propose_personal_event',
      { title: '原本讀書', date: '2026-11-04', allDay: false, startTime: '18:00', endTime: '19:00' }, 1, secret, now);
    expect((await prepareCampusEventDiscovery(input)).cards).toHaveLength(1);
    expect(verifyCard(oldBinding, proof(old), secret, now).mutationId).toBe(old.mutationId);
    expect(fixture.writes).toHaveLength(0);
  });

  it('checks the creation permission before discovering source details', async () => {
    const { fixture, input } = setup();
    fixture.adapter.permissions = async () => ({ createPersonalEvent: false, prepareFoodOrder: true });
    expect(await prepareCampusEventDiscovery(input)).toMatchObject({ cards: [], stopReason: 'ASSISTANT_PERMISSION_DENIED' });
    expect(fixture.adapter.publicCampus).not.toHaveBeenCalled();
    expect(fixture.adapter.publicEvent).not.toHaveBeenCalled();
  });

  it('keeps write-disabled discovery a read-only result', async () => {
    const { fixture, input } = setup();
    expect(await prepareCampusEventDiscovery({ ...input, writes: false })).toMatchObject({ cards: [], eventTargets: [{ id: second.id }],
      campusEventPreview: true, stopReason: 'WRITES_DISABLED' });
    expect(fixture.writes).toHaveLength(0);
  });

  it('includes discovery latency when validating the exact source start time', async () => {
    const { fixture, input } = setup();
    const started = Date.parse(second.startsAt) - 1000;
    let clock = started;
    vi.mocked(Date.now).mockImplementation(() => clock);
    fixture.adapter.publicCampus = vi.fn(async () => {
      clock += 1000;
      return list();
    });
    // Even a stale adapter "ready" response cannot revive the just-started
    // event: the strict source parser receives the time after discovery.
    expect(await prepareCampusEventDiscovery({ ...input, now: started })).toMatchObject({
      campusEventPreview: true, cards: [], stopReason: 'INVALID_PUBLIC_EVENT_RESULT',
    });
    expect(fixture.adapter.publicEvent).toHaveBeenCalledOnce();
    expect(fixture.adapter.ledger).not.toHaveBeenCalled();
    expect(fixture.writes).toHaveLength(0);
  });

  it.each([401, 429] as const)('preserves authentication or API budget errors (%s) without falling back', async status => {
    const { fixture, input } = setup();
    const error = new V2Error(status, status === 401 ? 'SESSION_CHANGED' : 'API_BUDGET_EXCEEDED');
    fixture.adapter.publicCampus = vi.fn(async () => { throw error; });
    if (status === 401) await expect(prepareCampusEventDiscovery(input)).rejects.toBe(error);
    else expect(await prepareCampusEventDiscovery(input)).toMatchObject({ cards: [], stopReason: 'API_BUDGET_EXCEEDED' });
    expect(fixture.adapter.publicEvent).not.toHaveBeenCalled();
    expect(fixture.adapter.publicCampus).toHaveBeenCalledOnce();
  });

  it('ignores a late list after cancellation and never starts an exact read or proposal', async () => {
    const { fixture, input } = setup(), controller = new AbortController();
    let release!: (value: unknown) => void, started!: () => void;
    const reading = new Promise<void>(resolve => { started = resolve; });
    fixture.adapter.publicCampus = vi.fn(async () => {
      expect(operationSignal()).toBeDefined();
      started();
      return new Promise(resolve => { release = resolve; });
    });
    const pending = prepareCampusEventDiscovery({ ...input, signal: controller.signal });
    const rejected = expect(pending).rejects.toMatchObject({ code: 'ABORTED' });
    await reading;
    controller.abort();
    await rejected;
    release(list());
    await Promise.resolve(); await Promise.resolve();
    expect(fixture.adapter.publicEvent).not.toHaveBeenCalled();
    expect(fixture.adapter.ledger).not.toHaveBeenCalled();
    expect(fixture.writes).toHaveLength(0);
  });

  it('bounds a hanging source read and discards its late result', async () => {
    vi.useFakeTimers();
    const { fixture, input } = setup();
    let release!: (value: unknown) => void;
    fixture.adapter.publicCampus = vi.fn(async () => new Promise(resolve => { release = resolve; }));
    const pending = prepareCampusEventDiscovery(input);
    await vi.advanceTimersByTimeAsync(12001);
    expect(await pending).toMatchObject({ cards: [], stopReason: 'DEADLINE_EXCEEDED' });
    release(list());
    await vi.advanceTimersByTimeAsync(1);
    expect(fixture.adapter.publicEvent).not.toHaveBeenCalled();
    expect(fixture.writes).toHaveLength(0);
  });
});

describe('strict event discovery input', () => {
  it.each([1, 2, 5])('accepts only a bounded one-based index %s', index => {
    expect(parseCampusEventDiscovery({ index })).toEqual({ index });
  });
  it.each([null, [], {}, { index: 0 }, { index: 6 }, { index: -1 }, { index: 1.5 }, { index: '2' },
    { index: 2, schoolId }, { index: 2, title: '改內容' }, { index: 2, startsAt: first.startsAt },
    { index: 2, filters: {} }, { index: 2, [Symbol('extra')]: true }, Object.create({ index: 2 }),
  ])('rejects extra, unsupported or inherited query fields: %j', value => {
    expect(() => parseCampusEventDiscovery(value)).toThrowError(expect.objectContaining({ code: 'INVALID_INPUT' }));
  });
  it('does not execute getters while parsing a selection', () => {
    const getter = vi.fn(() => 2), value = Object.defineProperty({}, 'index', { enumerable: true, get: getter });
    expect(() => parseCampusEventDiscovery(value)).toThrow();
    expect(getter).not.toHaveBeenCalled();
  });
});
