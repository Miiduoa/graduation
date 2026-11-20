import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  clearRevisionDraft, readRevisionDraft, revisionDraftContentMatches, revisionDraftSource, saveRevisionDraft,
  type RevisionDraft, type RevisionDraftContent, type RevisionDraftScope, type RevisionDraftSource,
} from './assistantPlanRevisionDraft';

const NOW = Date.UTC(2026, 10, 9, 12);
const TTL = 30 * 60 * 1000;
const scope: RevisionDraftScope = { accountId: 'account_one', schoolId: 'pu', context: 'A'.repeat(43) };
const event = { title: '資料庫複習', date: '2030-11-10', allDay: false, startTime: '20:00', endTime: '21:00' };
const active = () => true;
const edit: RevisionDraftContent = { instruction: '  改到明晚\n其他照原安排  ', protectedIndices: [0] };
function cards() {
  return [
    { mutationId: 'original_first', tool: 'propose_personal_event', schoolId: 'pu', args: { ...event } },
    { mutationId: 'original_second', tool: 'propose_personal_event', schoolId: 'pu', args: { ...event, title: '英文閱讀', startTime: '21:00', endTime: '22:00' } },
  ];
}
function source(): RevisionDraftSource { return revisionDraftSource(cards()); }
function methods(): Storage {
  return Object.hasOwn(sessionStorage, 'setItem') ? sessionStorage : Object.getPrototypeOf(sessionStorage);
}
function saved(input = source(), content = edit): RevisionDraft {
  const result = saveRevisionDraft(scope, input, content, active, NOW);
  expect(result).toMatchObject({ ok: true, draft: expect.any(Object) });
  return result.draft!;
}
function onlyKey(): string {
  expect(sessionStorage.length).toBe(1);
  return sessionStorage.key(0)!;
}
function encoded(): string { return sessionStorage.getItem(onlyKey())!; }
function corrupt(patch: (value: Record<string, unknown>) => unknown) {
  const key = onlyKey();
  sessionStorage.setItem(key, JSON.stringify(patch(JSON.parse(encoded()))));
}
beforeEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  sessionStorage.clear();
  localStorage.clear();
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('round-trips exact unfinished input after a fresh module load without tokens or raw scope/IDs', async () => {
  const original = cards();
  const withMetadata = original.map(card => ({ ...card, token: 'PRIVATE_SIGNED_TOKEN', conversationId: 'PRIVATE_CONVERSATION',
    consent: true, destination: 'PRIVATE_DESTINATION', actionStates: { status: 'unknown' } }));
  const result = saved(revisionDraftSource(withMetadata));
  expect(result).toMatchObject({ version: 1, instruction: edit.instruction, protectedIndices: [0], savedAt: NOW });
  expect(onlyKey()).toMatch(/^campus\.assistant-plan-draft\.v1:[a-f0-9]{64}$/);
  expect(encoded()).not.toMatch(/PRIVATE|original_first|original_second|account_one|schoolId|context|conversation|token|consent|actionStates/);
  expect(encoded()).not.toContain(scope.context);
  expect(localStorage.length).toBe(0);
  vi.resetModules();
  const fresh = await import('./assistantPlanRevisionDraft');
  expect(fresh.readRevisionDraft(scope, NOW + 1)).toEqual({ status: 'ready', draft: result });
});

it('hashes the ordered raw fields and IDs deterministically without depending on property insertion order', () => {
  const first = source();
  const reorderedProperties = cards().map(card => ({ ...card, args: { endTime: card.args.endTime, allDay: card.args.allDay,
    date: card.args.date, title: card.args.title, startTime: card.args.startTime } }));
  expect(revisionDraftSource(reorderedProperties)).toEqual(first);
  expect(revisionDraftSource(cards().map(card => ({ ...card, mutationId: 'new_' + card.mutationId }))).key).not.toBe(first.key);
  expect(revisionDraftSource(cards().reverse()).key).not.toBe(first.key);
  const explicitEnd = cards().map(card => ({ ...card, args: { ...card.args, endDate: card.args.date } }));
  expect(revisionDraftSource(explicitEnd).key).not.toBe(first.key);
  expect(revisionDraftSource(explicitEnd).events.every(row => Object.hasOwn(row, 'endDate'))).toBe(true);
  expect(first.events.every(row => !Object.hasOwn(row, 'endDate'))).toBe(true);
});

it('matches full ordered raw content across fresh card IDs and rejects title-only or normalized-date guesses', () => {
  const draft = saved();
  const fresh = revisionDraftSource(cards().map(card => ({ ...card, mutationId: 'fresh_' + card.mutationId })));
  expect(fresh.key).not.toBe(draft.source.key);
  expect(revisionDraftContentMatches(draft, fresh)).toBe(true);
  const timeChanged = cards(); timeChanged[0].args.startTime = '19:30';
  expect(revisionDraftContentMatches(draft, revisionDraftSource(timeChanged))).toBe(false);
  expect(revisionDraftContentMatches(draft, revisionDraftSource(cards().reverse()))).toBe(false);
  expect(revisionDraftContentMatches(draft, revisionDraftSource(cards().slice(0, 1)))).toBe(false);
  expect(revisionDraftContentMatches(draft, revisionDraftSource(cards().map(card => ({ ...card, args: { ...card.args, endDate: card.args.date } }))))).toBe(false);
  expect(revisionDraftContentMatches(draft, { ...source(), events: [{ ...event, token: 'private' }] } as never)).toBe(false);
  expect(revisionDraftContentMatches({ ...draft, token: 'private' } as never, fresh)).toBe(false);
  expect(revisionDraftContentMatches({ source: draft.source } as never, fresh)).toBe(false);
  expect(revisionDraftContentMatches({ ...draft, id: 'invalid' }, fresh)).toBe(false);
});

it('preserves cross-day and all-day raw field presence without semantic normalization', () => {
  const raw = [
    { ...cards()[0], args: { ...event, startTime: '23:00', endTime: '01:00', endDate: '2030-11-11' } },
    { ...cards()[1], args: { title: '全天讀書', date: '2030-11-12', allDay: true } },
  ];
  const draft = saved(revisionDraftSource(raw));
  expect(readRevisionDraft(scope, NOW).draft?.source.events).toEqual(raw.map(card => card.args));
  const explicit = revisionDraftSource([raw[0], { ...raw[1], args: { ...raw[1].args, endDate: '2030-11-13' } }]);
  expect(revisionDraftContentMatches(draft, explicit)).toBe(false);
});

it('returns detached copies and stores only the latest draft with a fresh id on every save', () => {
  const input = source(), first = saved(input), initial = encoded();
  input.events[0].title = 'caller changed';
  first.source.events[0].title = 'consumer changed';
  expect(readRevisionDraft(scope, NOW).draft?.source.events[0].title).toBe(event.title);
  const second = saved(source(), { instruction: '另一份修改', protectedIndices: [1, 0] });
  expect(second.id).not.toBe(first.id);
  expect(second.protectedIndices).toEqual([0, 1]);
  expect(encoded()).not.toBe(initial);
  expect(readRevisionDraft(scope, NOW).draft).toEqual(second);
  expect(sessionStorage.length).toBe(1);
});

it('isolates account, school and session without enumerating other namespaces', () => {
  const first = saved();
  const enumerate = vi.spyOn(methods(), 'key');
  const get = vi.spyOn(methods(), 'getItem');
  for (const other of [
    { ...scope, accountId: 'account_two' }, { ...scope, schoolId: 'nthu' }, { ...scope, context: 'B'.repeat(43) },
  ]) expect(readRevisionDraft(other, NOW)).toEqual({ status: 'empty', draft: null });
  expect(get).toHaveBeenCalledTimes(3);
  expect(new Set(get.mock.calls.map(([key]) => key)).size).toBe(3);
  expect(enumerate).not.toHaveBeenCalled();
  expect(readRevisionDraft(scope, NOW).draft).toEqual(first);
});

it('does not expose a draft copied under another scope hash and cleans only that copied key', () => {
  saved();
  const originalKey = onlyKey(), payload = encoded(), other = { ...scope, accountId: 'account_two' };
  const get = vi.spyOn(methods(), 'getItem');
  readRevisionDraft(other, NOW);
  const otherKey = get.mock.calls.at(-1)![0];
  get.mockRestore();
  sessionStorage.setItem(otherKey, payload);
  expect(readRevisionDraft(other, NOW)).toMatchObject({ status: 'invalid', draft: null });
  expect(sessionStorage.getItem(otherKey)).toBeNull();
  expect(sessionStorage.getItem(originalKey)).toBe(payload);
});

it('expires at exactly thirty minutes and does not renew savedAt or write during valid reads', () => {
  const draft = saved();
  const raw = encoded(), set = vi.spyOn(methods(), 'setItem');
  expect(readRevisionDraft(scope, NOW + TTL - 1)).toEqual({ status: 'ready', draft });
  expect(encoded()).toBe(raw);
  expect(set).not.toHaveBeenCalled();
  expect(readRevisionDraft(scope, NOW + TTL)).toMatchObject({ status: 'expired', draft: null });
  expect(sessionStorage.length).toBe(0);
  expect(readRevisionDraft(scope, NOW + TTL + 1)).toEqual({ status: 'empty', draft: null });
});

it.each([
  { version: 2 }, { savedAt: NOW + 1 }, { savedAt: -1 }, { savedAt: 1.5 }, { id: 'not-uuid' },
  { token: 'PRIVATE_TOKEN' }, { source: { ...source(), token: 'PRIVATE_TOKEN' } },
  { protectedIndices: [0, 0] }, { protectedIndices: [2] }, { instruction: 'x'.repeat(301) },
  { source: { ...source(), events: [{ ...event, endDate: null }] } },
])('rejects and removes corrupt/future/unknown stored data without exposing it: %j', patch => {
  saved();
  corrupt(value => ({ ...value, ...patch }));
  const result = readRevisionDraft(scope, NOW);
  expect(result).toMatchObject({ draft: null, status: 'invalid' });
  expect(JSON.stringify(result)).not.toContain('PRIVATE_TOKEN');
  expect(sessionStorage.length).toBe(0);
});

it.each(['{broken', ' '.repeat(16385), '學'.repeat(6000)])('bounds stored JSON by UTF-8 bytes and clears malformed input', raw => {
  saved();
  sessionStorage.setItem(onlyKey(), raw);
  expect(readRevisionDraft(scope, NOW)).toMatchObject({ draft: null, status: 'invalid' });
  expect(sessionStorage.length).toBe(0);
});

it('never exposes invalid or expired contents if cleanup fails or is silently ignored', () => {
  saved();
  const remove = vi.spyOn(methods(), 'removeItem').mockImplementation(() => { throw new Error('denied'); });
  expect(readRevisionDraft(scope, NOW + TTL)).toMatchObject({ draft: null, status: 'expired', message: expect.stringContaining('尚未確認清除') });
  remove.mockImplementation(() => {});
  corrupt(value => ({ ...value, version: 99 }));
  expect(readRevisionDraft(scope, NOW)).toMatchObject({ draft: null, status: 'invalid', message: expect.stringContaining('尚未確認清除') });
  expect(sessionStorage.length).toBe(1);
});

it('allows an unfinished partial identical-group selection without weakening preview guards', () => {
  const original = cards();
  original[1].args = { ...original[0].args };
  const draft = saved(revisionDraftSource(original), { instruction: '', protectedIndices: [0] });
  expect(draft.protectedIndices).toEqual([0]);
  expect(readRevisionDraft(scope, NOW).draft).toEqual(draft);
});

it('clears empty text and selection only for its source, while whitespace remains exact input', () => {
  const first = saved();
  const other = revisionDraftSource(cards().map(card => ({ ...card, mutationId: 'new_' + card.mutationId })));
  expect(saveRevisionDraft(scope, other, { instruction: '', protectedIndices: [] }, active, NOW)).toEqual({ ok: true, draft: null });
  expect(readRevisionDraft(scope, NOW).draft).toEqual(first);
  const whitespace = saved(source(), { instruction: '  \n', protectedIndices: [] });
  expect(whitespace.instruction).toBe('  \n');
  expect(saveRevisionDraft(scope, source(), { instruction: '', protectedIndices: [] }, active, NOW)).toEqual({ ok: true, draft: null });
  expect(readRevisionDraft(scope, NOW)).toEqual({ status: 'empty', draft: null });
});

it('makes other-source cleanup a safe no-op and rejects stale same-source ids', () => {
  const first = saved(), second = saved();
  expect(clearRevisionDraft(scope, active, { sourceKey: 'f'.repeat(64) })).toEqual({ ok: true, cleared: false });
  expect(clearRevisionDraft(scope, active, { sourceKey: first.source.key, id: first.id })).toMatchObject({ ok: false, cleared: false });
  expect(clearRevisionDraft(scope, active, { sourceKey: 'f'.repeat(64), id: first.id })).toMatchObject({ ok: false, cleared: false });
  expect(readRevisionDraft(scope, NOW).draft).toEqual(second);
  expect(clearRevisionDraft(scope, active, { sourceKey: second.source.key, id: second.id })).toEqual({ ok: true, cleared: true });
  expect(clearRevisionDraft(scope, active, { id: second.id })).toEqual({ ok: true, cleared: false });
});

it.each([
  [], new Array(1), Array.from({ length: 17 }, (_, i) => ({ ...cards()[0], mutationId: 'id_' + i })),
  [cards()[0], cards()[0]], [{ ...cards()[0], tool: 'propose_food_order' }],
  [cards()[0], { ...cards()[1], schoolId: 'nthu' }], [{ ...cards()[0], mutationId: '' }],
  [{ ...cards()[0], args: { ...event, location: 'PRIVATE_LOCATION' } }],
  [{ ...cards()[0], args: { ...event, endDate: undefined } }],
  [{ ...cards()[0], args: { ...event, date: '2030-02-30' } }],
])('rejects invalid or non-calendar sources without storage access', invalid => {
  const set = vi.spyOn(methods(), 'setItem');
  expect(() => revisionDraftSource(invalid)).toThrow();
  expect(set).not.toHaveBeenCalled();
});

it('rejects getters, sparse/extra array properties and unknown source/content fields without invoking accessors', () => {
  const getter = vi.fn(() => event);
  const raw = Object.defineProperty({ ...cards()[0] }, 'args', { enumerable: true, get: getter });
  expect(() => revisionDraftSource([raw])).toThrow();
  const list = Object.assign(cards(), { token: 'PRIVATE_TOKEN' });
  expect(() => revisionDraftSource(list)).toThrow();
  const good = source();
  const hidden = Object.defineProperty({ ...good }, 'events', { enumerable: true, get: getter });
  expect(saveRevisionDraft(scope, hidden, edit, active, NOW).ok).toBe(false);
  const badContent = Object.defineProperty({ protectedIndices: [0] }, 'instruction', { enumerable: true, get: getter });
  expect(saveRevisionDraft(scope, good, badContent as never, active, NOW).ok).toBe(false);
  expect(saveRevisionDraft(scope, { ...good, token: 'PRIVATE_TOKEN' } as never, edit, active, NOW).ok).toBe(false);
  expect(saveRevisionDraft(scope, good, { ...edit, consent: true } as never, active, NOW).ok).toBe(false);
  expect(saveRevisionDraft(scope, good, { ...edit, protectedIndices: new Array(1) }, active, NOW).ok).toBe(false);
  expect(getter).not.toHaveBeenCalled();
  expect(sessionStorage.length).toBe(0);
});

it.each([
  { ...scope, accountId: '' }, { ...scope, schoolId: 'personal' }, { ...scope, context: 'short' },
  { ...scope, token: 'PRIVATE_TOKEN' },
])('rejects malformed scope without touching any storage: %j', bad => {
  const get = vi.spyOn(methods(), 'getItem'), set = vi.spyOn(methods(), 'setItem'), remove = vi.spyOn(methods(), 'removeItem');
  expect(readRevisionDraft(bad, NOW)).toMatchObject({ status: 'invalid', draft: null });
  expect(saveRevisionDraft(bad, source(), edit, active, NOW).ok).toBe(false);
  expect(clearRevisionDraft(bad, active).ok).toBe(false);
  expect(get).not.toHaveBeenCalled(); expect(set).not.toHaveBeenCalled(); expect(remove).not.toHaveBeenCalled();
});

it.each([{ instruction: 'x'.repeat(301), protectedIndices: [] }, { instruction: 'x', protectedIndices: [0, 0] },
  { instruction: 'x', protectedIndices: [-1] }, { instruction: 'x', protectedIndices: [2] }, { instruction: 'x', protectedIndices: [0.5] }])(
  'rejects invalid edits without replacing saved input: %j', content => {
    const first = saved();
    expect(saveRevisionDraft(scope, source(), content, active, NOW).ok).toBe(false);
    expect(readRevisionDraft(scope, NOW).draft).toEqual(first);
  },
);

it('reports storage access and get failures distinctly without exposing stored content', () => {
  saved();
  const get = vi.spyOn(methods(), 'getItem').mockImplementation(() => { throw new Error('PRIVATE_DENIAL'); });
  expect(readRevisionDraft(scope, NOW)).toMatchObject({ status: 'unavailable', draft: null, message: expect.stringContaining('無法讀取') });
  expect(saveRevisionDraft(scope, source(), edit, active, NOW)).toMatchObject({ ok: false, draft: null });
  expect(clearRevisionDraft(scope, active)).toMatchObject({ ok: false, cleared: false });
  get.mockRestore();
  vi.spyOn(window, 'sessionStorage', 'get').mockImplementation(() => { throw new Error('PRIVATE_DENIAL'); });
  const result = readRevisionDraft(scope, NOW);
  expect(result).toMatchObject({ status: 'unavailable', draft: null, message: expect.stringContaining('無法存取') });
  expect(JSON.stringify(result)).not.toContain('PRIVATE_DENIAL');
});

it('reports quota and ignored writes without falsely claiming persistence or replacing the previous draft', () => {
  const first = saved();
  const set = vi.spyOn(methods(), 'setItem').mockImplementation(() => { throw new DOMException('PRIVATE_QUOTA', 'QuotaExceededError'); });
  expect(saveRevisionDraft(scope, source(), edit, active, NOW)).toMatchObject({ ok: false, draft: null, message: expect.stringContaining('尚未確認儲存') });
  set.mockImplementation(() => {});
  expect(saveRevisionDraft(scope, source(), edit, active, NOW).ok).toBe(false);
  expect(readRevisionDraft(scope, NOW).draft).toEqual(first);
});

it('reports get failure after set and cannot claim a write succeeded', () => {
  const originalSet = sessionStorage.setItem.bind(sessionStorage);
  vi.spyOn(methods(), 'setItem').mockImplementation((key, value) => {
    originalSet(key, value);
    vi.spyOn(methods(), 'getItem').mockImplementation(() => { throw new Error('readback denied'); });
  });
  expect(saveRevisionDraft(scope, source(), edit, active, NOW)).toMatchObject({ ok: false, draft: null, message: expect.stringContaining('無法讀取') });
});

it('reports remove failures and ignored removals without claiming a successful cleanup', () => {
  const first = saved();
  const remove = vi.spyOn(methods(), 'removeItem').mockImplementation(() => { throw new Error('denied'); });
  expect(clearRevisionDraft(scope, active, { id: first.id })).toMatchObject({ ok: false, cleared: false });
  remove.mockImplementation(() => {});
  expect(clearRevisionDraft(scope, active, { id: first.id })).toMatchObject({ ok: false, cleared: false, message: expect.stringContaining('尚未確認清除') });
  expect(readRevisionDraft(scope, NOW).draft).toEqual(first);
});

it('checks activity before mutation and when scope changes during storage reads', () => {
  const first = saved();
  expect(saveRevisionDraft(scope, source(), edit, () => false, NOW).ok).toBe(false);
  expect(clearRevisionDraft(scope, () => false).ok).toBe(false);
  let current = true;
  const originalGet = sessionStorage.getItem.bind(sessionStorage);
  const get = vi.spyOn(methods(), 'getItem').mockImplementation(key => { current = false; return originalGet(key); });
  const set = vi.spyOn(methods(), 'setItem'), remove = vi.spyOn(methods(), 'removeItem');
  expect(saveRevisionDraft(scope, source(), edit, () => current, NOW).ok).toBe(false);
  current = true;
  expect(clearRevisionDraft(scope, () => current).ok).toBe(false);
  expect(set).not.toHaveBeenCalled(); expect(remove).not.toHaveBeenCalled();
  get.mockRestore();
  expect(readRevisionDraft(scope, NOW).draft).toEqual(first);
});

it('does not report success when scope changes during the set/remove mutation itself', () => {
  let current = true;
  const originalSet = sessionStorage.setItem.bind(sessionStorage);
  const set = vi.spyOn(methods(), 'setItem').mockImplementation((key, value) => { originalSet(key, value); current = false; });
  expect(saveRevisionDraft(scope, source(), edit, () => current, NOW)).toMatchObject({ ok: false, draft: null, message: expect.stringContaining('已切換') });
  set.mockRestore();
  current = true;
  const originalRemove = sessionStorage.removeItem.bind(sessionStorage);
  vi.spyOn(methods(), 'removeItem').mockImplementation(key => { originalRemove(key); current = false; });
  expect(clearRevisionDraft(scope, () => current)).toMatchObject({ ok: false, cleared: false, message: expect.stringContaining('已切換') });
});

it('does not overwrite or remove a newer value installed between its reads', () => {
  saved();
  const originalGet = sessionStorage.getItem.bind(sessionStorage), originalSet = sessionStorage.setItem.bind(sessionStorage);
  const before = encoded(), key = onlyKey();
  let reads = 0;
  const newer = JSON.stringify({ ...JSON.parse(before), instruction: '新草稿' });
  const get = vi.spyOn(methods(), 'getItem').mockImplementation(name => {
    if (++reads === 2) originalSet(name, newer);
    return originalGet(name);
  });
  expect(saveRevisionDraft(scope, source(), edit, active, NOW)).toMatchObject({ ok: false, draft: null, message: expect.stringContaining('已有更新') });
  expect(originalGet(key)).toBe(newer);
  get.mockRestore();
  sessionStorage.setItem(key, before);
  reads = 0;
  vi.spyOn(methods(), 'getItem').mockImplementation(name => {
    if (++reads === 2) originalSet(name, newer);
    return originalGet(name);
  });
  expect(clearRevisionDraft(scope, active)).toMatchObject({ ok: false, cleared: false, message: expect.stringContaining('已有更新') });
  expect(originalGet(key)).toBe(newer);
});
