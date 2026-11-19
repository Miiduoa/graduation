// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDocFromServer, getDocsFromServer } from 'firebase/firestore';
import { getDb, isFirebaseConfigured } from '../../firebase';
import type { PublicCampusReadGuard } from '../../publicCampusReadGuard';
import { publicCampusFirestore } from '../../server/publicCampusFirestore';
import { V2Error } from './contracts';
import { createAdapter } from './adapter';
import { withOperationSignal } from './operation';
import { readPublicEvent } from './publicEventAdapter';
import { publicEventHref, type PublicEventTarget } from './publicEvent';

const state = vi.hoisted(() => ({ anonymousDb: { mode: 'public-anonymous' } }));
vi.mock('../../firebase', () => ({
  getDb: vi.fn(() => { throw new Error('Authenticated Firebase app must not be used'); }),
  isFirebaseConfigured: vi.fn(() => true),
}));
vi.mock('../../server/publicCampusFirestore', () => ({ publicCampusFirestore: vi.fn(() => state.anonymousDb) }));
vi.mock('firebase/firestore', () => ({
  doc: (db: unknown, ...path: string[]) => ({ db, path: path.join('/') }),
  getDocFromServer: vi.fn(), getDocsFromServer: vi.fn(),
  collection: vi.fn(), documentId: vi.fn(), limit: vi.fn(), orderBy: vi.fn(),
  query: vi.fn(), startAfter: vi.fn(), where: vi.fn(),
}));

const now = Date.parse('2026-11-16T03:00:00.000Z');
const target: PublicEventTarget = { schoolId: 'nthu', source: 'school-club-events', id: 'event-a' };
type Reference = { db: unknown; path: string };
function snapshot(ref: Reference, patch: Record<string, unknown> = {}) {
  return { id: ref.path.split('/').at(-1), exists: () => true,
    ref: { parent: { path: ref.path.split('/').slice(0, -1).join('/') } },
    data: () => ({ schoolId: target.schoolId, title: '<b>校園講座</b>',
      startsAt: '2026-11-17T23:30:00+08:00', endsAt: '2026-11-18T00:30:00+08:00',
      location: ' 圖書館 ', registrationPolicy: { version: 1 }, privateRoster: ['never project'], ...patch }),
  };
}
function guard(signal = new AbortController().signal, budget = 1): PublicCampusReadGuard & { reads: () => number } {
  let reads = 0;
  return { db: state.anonymousDb as unknown as PublicCampusReadGuard['db'],
    beforeRead() { signal.throwIfAborted(); if (++reads > budget) throw new V2Error(429, 'API_BUDGET_EXCEEDED'); },
    afterRead() { signal.throwIfAborted(); }, reads: () => reads,
  };
}
function sourceData(patch: Record<string, unknown>) {
  vi.mocked(getDocFromServer).mockImplementation((async (ref: Reference) => snapshot(ref, patch)) as never);
}
async function adapter(signal = new AbortController().signal) {
  const source = createAdapter({ sessionHandle: 'ps_' + 'a'.repeat(43), expiresAt: now + 3600000 }, target.schoolId, signal);
  await source.principal();
  return source;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
  vi.clearAllMocks();
  vi.mocked(isFirebaseConfigured).mockReturnValue(true);
  vi.stubEnv('NEXT_PUBLIC_APP_ENV', 'production');
  vi.stubEnv('NUNI_API_BASE_URL', 'https://api.nuni.tw');
  vi.stubGlobal('fetch', vi.fn(async (input) => {
    if (!String(input).endsWith('/sessions/current')) throw new Error('Unexpected private or platform request');
    return Response.json({ authenticated: true, platformAccountId: 'pa_11111111-1111-4111-8111-111111111111', isPlatformOperator: false });
  }));
  sourceData({});
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe('anonymous selected event source', () => {
  it.each([
    ['school-club-events', 'schools/nthu/clubEvents/event-a'],
    ['school-events', 'schools/nthu/events/event-a'],
    ['legacy-events', 'events/event-a'],
  ] as const)('reads only the exact %s document with the anonymous database', async (source, path) => {
    const selected = { ...target, source }, limits = guard();
    const read = await readPublicEvent({ target: selected, guard: limits, now });
    expect(read).toMatchObject({ status: 'ready', target: selected, checkedAt: new Date(now).toISOString(),
      item: { ...selected, title: '校園講座', location: '圖書館', href: publicEventHref(selected),
        startsAt: '2026-11-17T15:30:00.000Z', endsAt: '2026-11-17T16:30:00.000Z' },
      args: { title: '校園講座', date: '2026-11-17', endDate: '2026-11-18', allDay: false,
        startTime: '23:30', endTime: '00:30' } });
    expect(getDocFromServer).toHaveBeenCalledExactlyOnceWith({ db: state.anonymousDb, path });
    expect(getDocsFromServer).not.toHaveBeenCalled();
    expect(getDb).not.toHaveBeenCalled();
    expect(limits.reads()).toBe(1);
    expect(JSON.stringify(read)).not.toMatch(/privateRoster|never project|registrationPolicy|appRegistration/);
  });

  it('does not fall back after a missing or denied source', async () => {
    vi.mocked(getDocFromServer).mockResolvedValueOnce({ exists: () => false } as never);
    await expect(readPublicEvent({ target, guard: guard(), now })).resolves.toMatchObject({ status: 'unavailable', unavailable: 'NOT_FOUND' });
    expect(getDocFromServer).toHaveBeenCalledTimes(1);
    vi.mocked(getDocFromServer).mockRejectedValueOnce(new Error('permission-denied'));
    await expect(readPublicEvent({ target, guard: guard(), now })).resolves.toMatchObject({ status: 'unavailable', unavailable: 'SOURCE_UNAVAILABLE' });
    expect(getDocFromServer).toHaveBeenCalledTimes(2);
    expect(getDocsFromServer).not.toHaveBeenCalled();
  });

  it('fails closed for hidden schools, missing configuration and an absent anonymous database', async () => {
    await expect(readPublicEvent({ target: { ...target, schoolId: 'tw-demo-uni' }, guard: guard(), now }))
      .resolves.toMatchObject({ status: 'unavailable', unavailable: 'HIDDEN_SCHOOL' });
    vi.mocked(isFirebaseConfigured).mockReturnValue(false);
    await expect(readPublicEvent({ target, guard: guard(), now })).resolves.toMatchObject({ status: 'unavailable', unavailable: 'SOURCE_UNAVAILABLE' });
    vi.mocked(isFirebaseConfigured).mockReturnValue(true);
    await expect(readPublicEvent({ target, guard: { beforeRead() {}, afterRead() {} }, now }))
      .resolves.toMatchObject({ status: 'unavailable', unavailable: 'SOURCE_UNAVAILABLE' });
    expect(getDb).not.toHaveBeenCalled();
    expect(getDocFromServer).not.toHaveBeenCalled();
  });

  it('rejects identity hints and bad clocks before any network read', async () => {
    await expect(readPublicEvent({ target: { ...target, title: 'UI hint' } as never, guard: guard(), now }))
      .rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(readPublicEvent({ target, guard: guard(), now: NaN })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    expect(getDocFromServer).not.toHaveBeenCalled();
  });

  it.each(['school-club-events', 'school-events', 'legacy-events'] as const)('rejects a cross-school %s record without exposing it', async (source) => {
    sourceData({ schoolId: 'other-school', title: 'Foreign secret' });
    const result = await readPublicEvent({ target: { ...target, source }, guard: guard(), now });
    expect(result).toMatchObject({ status: 'unavailable', unavailable: 'SOURCE_UNAVAILABLE' });
    expect(JSON.stringify(result)).not.toMatch(/other-school|Foreign secret/);
    expect(getDocFromServer).toHaveBeenCalledOnce();
  });

  it('requires an explicit matching school on a legacy document', async () => {
    sourceData({ schoolId: undefined });
    await expect(readPublicEvent({ target: { ...target, source: 'legacy-events' }, guard: guard(), now }))
      .resolves.toMatchObject({ status: 'unavailable', unavailable: 'SOURCE_UNAVAILABLE' });
  });

  it('rechecks the selected document and changes its fingerprint when source facts change', async () => {
    const limits = guard(undefined, 2);
    const first = await readPublicEvent({ target, guard: limits, now });
    sourceData({ location: '新地點', endsAt: '2026-11-18T01:00:00+08:00' });
    const second = await readPublicEvent({ target, guard: limits, now });
    expect(first.status).toBe('ready');
    expect(second.status).toBe('ready');
    if (first.status !== 'ready' || second.status !== 'ready') throw new Error('Expected verified sources');
    expect(second.fingerprint).not.toBe(first.fingerprint);
    expect(second.args.endTime).toBe('01:00');
    expect(getDocFromServer).toHaveBeenCalledTimes(2);
  });
});

describe('source time representability', () => {
  it.each([
    [{ endsAt: undefined }, 'MISSING_END_TIME'],
    [{ startsAt: '2026-11-17' }, 'INVALID_EVENT'],
    [{ startsAt: '2026-11-17T23:30:00' }, 'INVALID_EVENT'],
    [{ startsAt: '2026-02-30T23:30:00+08:00' }, 'INVALID_EVENT'],
    [{ startsAt: '2026-11-17T23:30:01+08:00' }, 'INVALID_EVENT'],
    [{ endsAt: '2026-11-17T23:00:00+08:00' }, 'INVALID_EVENT'],
    [{ endsAt: '2027-01-18T00:30:00+08:00' }, 'INVALID_EVENT'],
    [{ startsAt: new Date(now).toISOString() }, 'EVENT_NOT_FUTURE'],
    [{ title: 'a'.repeat(121) }, 'INVALID_EVENT'],
  ] as const)('keeps unrepresentable source facts unavailable (%j)', async (patch, unavailable) => {
    sourceData(patch);
    const result = await readPublicEvent({ target, guard: guard(), now });
    expect(result).toMatchObject({ status: 'unavailable', unavailable });
    expect(result).not.toHaveProperty('args');
    expect(result).not.toHaveProperty('fingerprint');
  });

  it('accepts Firestore timestamps without converting them into a guessed duration', async () => {
    sourceData({ startsAt: { toDate: () => new Date('2026-11-17T01:00:00.000Z') },
      endsAt: { toDate: () => new Date('2026-11-17T02:00:00.000Z') } });
    await expect(readPublicEvent({ target, guard: guard(), now })).resolves.toMatchObject({
      status: 'ready', args: { date: '2026-11-17', startTime: '09:00', endTime: '10:00' },
    });
  });
});

describe('shared budget, deadline and cancellation', () => {
  it('requires a verified principal and fixed adapter school before using the public database', async () => {
    const source = createAdapter({ sessionHandle: 'opaque', expiresAt: now + 1000 }, target.schoolId, new AbortController().signal);
    await expect(source.adapter.publicEvent!(target)).rejects.toMatchObject({ status: 401, code: 'UNAUTHENTICATED' });
    await source.principal();
    await expect(source.adapter.publicEvent!({ ...target, schoolId: 'pu' })).rejects.toMatchObject({ status: 403, code: 'FORBIDDEN_SCOPE' });
    await expect(source.adapter.publicEvent!({ ...target, source: 'unknown' } as never)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    expect(publicCampusFirestore).not.toHaveBeenCalled();
    expect(getDocFromServer).not.toHaveBeenCalled();
    await expect(source.adapter.publicEvent!(target)).resolves.toMatchObject({ status: 'ready', target });
    expect(publicCampusFirestore).toHaveBeenCalledOnce();
    expect(getDocFromServer).toHaveBeenCalledExactlyOnceWith({ db: state.anonymousDb, path: 'schools/nthu/clubEvents/event-a' });
    expect(getDb).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledOnce();
    expect(source.apiCalls()).toBe(2);
    expect(JSON.stringify(vi.mocked(getDocFromServer).mock.calls)).not.toMatch(/private|session|Platform |ps_|pa_/);
  });

  it('charges every real getDoc to the same twelve-call budget as principal and other operations', async () => {
    const source = await adapter();
    for (let index = 0; index < 11; index++)
      await expect(source.adapter.publicEvent!(target)).resolves.toMatchObject({ status: 'ready' });
    expect(source.apiCalls()).toBe(12);
    expect(getDocFromServer).toHaveBeenCalledTimes(11);
    await expect(source.adapter.publicEvent!(target)).rejects.toMatchObject({ status: 429, code: 'API_BUDGET_EXCEEDED' });
    expect(getDocFromServer).toHaveBeenCalledTimes(11);
    expect(source.adapter.remainingApiCalls!()).toBe(0);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('does not convert an exhausted budget or a guard exception into ordinary unavailability', async () => {
    await expect(readPublicEvent({ target, guard: guard(undefined, 0), now }))
      .rejects.toMatchObject({ status: 429, code: 'API_BUDGET_EXCEEDED' });
    expect(getDocFromServer).not.toHaveBeenCalled();
    const failure = new Error('guard failed');
    const custom = guard();
    custom.beforeRead = () => { throw failure; };
    await expect(readPublicEvent({ target, guard: custom, now })).rejects.toBe(failure);
  });

  it.each(['parent', 'operation'] as const)('discards a pending document after the actual adapter %s signal aborts', async (which) => {
    let resolve!: (value: unknown) => void;
    vi.mocked(getDocFromServer).mockReturnValueOnce(new Promise(done => { resolve = done; }) as never);
    const controller = new AbortController(), operation = new AbortController();
    const source = await adapter(controller.signal);
    const pending = withOperationSignal(operation.signal, () => source.adapter.publicEvent!(target));
    const rejected = expect(pending).rejects.toMatchObject({ status: 499, code: 'ABORTED' });
    await vi.waitFor(() => expect(getDocFromServer).toHaveBeenCalledOnce());
    (which === 'parent' ? controller : operation).abort();
    await rejected;
    resolve(snapshot({ db: state.anonymousDb, path: 'schools/nthu/clubEvents/event-a' }));
    await Promise.resolve();
    await Promise.resolve();
    expect(getDocFromServer).toHaveBeenCalledOnce();
    expect(getDocsFromServer).not.toHaveBeenCalled();
  });

  it('bounds a stalled source using the caller deadline and does not revive a timed-out read', async () => {
    let resolve!: (value: unknown) => void;
    vi.mocked(getDocFromServer).mockReturnValueOnce(new Promise(done => { resolve = done; }) as never);
    const source = await adapter();
    const pending = source.adapter.publicEvent!(target);
    const rejected = expect(pending).rejects.toMatchObject({ status: 504, code: 'DEADLINE_EXCEEDED' });
    await vi.waitFor(() => expect(getDocFromServer).toHaveBeenCalledOnce());
    await vi.advanceTimersByTimeAsync(4000);
    await rejected;
    resolve(snapshot({ db: state.anonymousDb, path: 'schools/nthu/clubEvents/event-a' }));
    await Promise.resolve();
    await Promise.resolve();
    expect(getDocFromServer).toHaveBeenCalledOnce();
  });
});
