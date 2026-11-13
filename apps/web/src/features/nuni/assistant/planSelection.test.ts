import { expect, it, vi } from 'vitest';
import type { PlanProtectionEvent } from '@/lib/assistantPlanProtection';
import type { V2Card, V2Turn } from './types';
import { buildPlanSelection, getPlanSelectionTargets, planSelectionEventTime } from './planSelection';

const timed: PlanProtectionEvent = {
  title: '英文複習', date: '2030-11-04', allDay: false, startTime: '20:00', endTime: '21:00',
};
const night: PlanProtectionEvent = {
  title: '跨日專題討論', date: '2030-11-04', endDate: '2030-11-05', allDay: false, startTime: '23:30', endTime: '00:30',
};
const allDay: PlanProtectionEvent = { title: '全天閱讀', date: '2030-11-06', allDay: true };
function card(mutationId = 'first', args: Record<string, unknown> = timed): V2Card {
  return { mutationId, tool: 'propose_personal_event', args: { ...args }, schoolId: 'fixture-school',
    token: 'PRIVATE_SIGNED_TOKEN', destination: 'PRIVATE_DESTINATION', conversationId: 'PRIVATE_CONVERSATION' };
}
function turn(cards = [card('first'), card('second', night), card('third', allDay)]): V2Turn {
  return { question: 'PRIVATE_QUESTION', reply: { answer: 'PRIVATE_ANSWER',
    steps: [{ name: 'PRIVATE_STEP', status: 'ok', summary: 'PRIVATE_SUMMARY' }], cards } };
}
const allIDs = ['first', 'second', 'third'];

it('exposes all original rows with stable ordinal labels, exact IDs and detached raw event snapshots', () => {
  const original = turn();
  const targets = getPlanSelectionTargets(original);
  expect(targets).toEqual([
    { index: 0, mutationId: 'first', event: timed, label: '第 1 項 · 英文複習 · 2030-11-04 20:00–21:00（台灣時間）' },
    { index: 1, mutationId: 'second', event: night, label: '第 2 項 · 跨日專題討論 · 2030-11-04 23:30 – 2030-11-05 00:30（台灣時間）' },
    { index: 2, mutationId: 'third', event: allDay, label: '第 3 項 · 全天閱讀 · 2030-11-06 · 全天（至 2030-11-07，不含結束日）' },
  ]);
  expect(JSON.stringify(targets)).not.toMatch(/PRIVATE_|token|schoolId|conversationId|destination/);
  targets[0].event.title = '修改回傳副本';
  expect(original.reply.cards[0].args).toEqual(timed);
});

it('keeps all selected content as a no-op even when the requested IDs are reversed', () => {
  const original = turn();
  const requested = Object.freeze([...allIDs].reverse());
  const result = buildPlanSelection(original, requested);
  expect(result).toEqual({ before: [timed, night, allDay], after: [timed, night, allDay],
    keepMutationIds: allIDs, keptIndices: [0, 1, 2], removedIndices: [], changed: false, allExcluded: false });
  expect(requested).toEqual(['third', 'second', 'first']);
});

it('selects a proper subset in original order without modifying any event fields', () => {
  const result = buildPlanSelection(turn(), ['third', 'first']);
  expect(result).toEqual({ before: [timed, night, allDay], after: [timed, allDay],
    keepMutationIds: ['first', 'third'], keptIndices: [0, 2], removedIndices: [1], changed: true, allExcluded: false });
  expect(JSON.stringify(result)).not.toMatch(/PRIVATE_|token|schoolId|conversationId|destination/);
});

it('represents exclusion of every row explicitly rather than inventing an empty source plan', () => {
  const result = buildPlanSelection(turn(), []);
  expect(result).toEqual({ before: [timed, night, allDay], after: [], keepMutationIds: [],
    keptIndices: [], removedIndices: [0, 1, 2], changed: true, allExcluded: true });
  expect(() => buildPlanSelection(turn([]), [])).toThrow();
});

it('keeps one of same-name rows only by its exact original mutation ID', () => {
  const earlier = { ...timed, startTime: '18:00', endTime: '19:00' };
  const result = buildPlanSelection(turn([card('first', earlier), card('second', timed)]), ['second']);
  expect(result.keepMutationIds).toEqual(['second']);
  expect(result.keptIndices).toEqual([1]);
  expect(result.removedIndices).toEqual([0]);
  expect(result.after).toEqual([timed]);
});

it('permits independently selecting one exact duplicate row without fuzzy matching or group expansion', () => {
  const original = turn([card('first'), card('second')]);
  const result = buildPlanSelection(original, ['second']);
  expect(result.before).toEqual([timed, timed]);
  expect(result.after).toEqual([timed]);
  expect(result.keepMutationIds).toEqual(['second']);
  expect(result.keptIndices).toEqual([1]);
  expect(result.removedIndices).toEqual([0]);
  expect(getPlanSelectionTargets(original).map(target => target.label)).toEqual([
    '第 1 項 · 英文複習 · 2030-11-04 20:00–21:00（台灣時間）',
    '第 2 項 · 英文複習 · 2030-11-04 20:00–21:00（台灣時間）',
  ]);
});

it('preserves explicit versus omitted endDate, including all-day dates, in before and after', () => {
  const rows = [timed, { ...timed, endDate: timed.date }, allDay, { ...allDay, endDate: '2030-11-08' }];
  const original = turn(rows.map((row, index) => card('row-' + index, row)));
  const result = buildPlanSelection(original, ['row-3', 'row-0', 'row-2', 'row-1']);
  expect(result.before).toEqual(rows);
  expect(result.after).toEqual(rows);
  expect(result.before.map(row => Object.hasOwn(row, 'endDate'))).toEqual([false, true, false, true]);
  expect(result.after.map(row => Object.hasOwn(row, 'endDate'))).toEqual([false, true, false, true]);
  expect(result.after[2]).not.toHaveProperty('startTime');
  expect(result.after[2]).not.toHaveProperty('endTime');
});

it('uses exclusive all-day end semantics in labels without rewriting stored event fields', () => {
  const leap = { title: '全天活動', date: '2032-02-29', allDay: true };
  const yearEnd = { title: '跨年活動', date: '2030-12-31', allDay: true };
  expect(planSelectionEventTime(leap)).toBe('2032-02-29 · 全天（至 2032-03-01，不含結束日）');
  expect(planSelectionEventTime(yearEnd)).toBe('2030-12-31 · 全天（至 2031-01-01，不含結束日）');
  expect(planSelectionEventTime({ ...leap, endDate: '2032-03-03' })).toBe('2032-02-29 · 全天（至 2032-03-03，不含結束日）');
  expect(getPlanSelectionTargets(turn([card('leap', leap)]))[0].event).toEqual(leap);
});

it('treats an explicit same-day timed end as the same display range while retaining its raw field', () => {
  const explicit = { ...timed, endDate: timed.date };
  expect(planSelectionEventTime(explicit)).toBe(planSelectionEventTime(timed));
  expect(getPlanSelectionTargets(turn([card('first', explicit)]))[0].event).toEqual(explicit);
});

it('accepts exactly sixteen rows and canonicalizes a maximum-length reordered selection', () => {
  const ids = Array.from({ length: 16 }, (_, index) => 'row-' + index);
  const original = turn(ids.map(id => card(id)));
  const result = buildPlanSelection(original, [...ids].reverse());
  expect(getPlanSelectionTargets(original)).toHaveLength(16);
  expect(result.keepMutationIds).toEqual(ids);
  expect(result.keptIndices).toEqual(Array.from({ length: 16 }, (_, index) => index));
  expect(result.changed).toBe(false);
});

it('requires a nonempty token but does not claim to authenticate its signature in the client', () => {
  const original = turn([{ ...card(), token: 'opaque-fixture-not-a-real-signature' }]);
  expect(buildPlanSelection(original, ['first']).after).toEqual([timed]);
  expect(JSON.stringify(getPlanSelectionTargets(original))).not.toContain('opaque-fixture-not-a-real-signature');
});

it.each([
  { name: 'empty source', cards: [] },
  { name: 'seventeen rows', cards: Array.from({ length: 17 }, (_, index) => card('row-' + index)) },
  { name: 'duplicate IDs', cards: [card(), card()] },
  { name: 'empty ID', cards: [card('')] },
  { name: 'invalid ID', cards: [card('../first')] },
  { name: 'long ID', cards: [card('x'.repeat(101))] },
  { name: 'mixed tools', cards: [card(), { ...card('second'), tool: 'propose_open_page' }] },
  { name: 'mixed schools', cards: [card(), { ...card('second'), schoolId: 'other-school' }] },
  { name: 'reserved school', cards: [{ ...card(), schoolId: 'personal' }] },
  { name: 'malformed school', cards: [{ ...card(), schoolId: '../school' }] },
  { name: 'empty token', cards: [{ ...card(), token: '' }] },
  { name: 'blank token', cards: [{ ...card(), token: '  ' }] },
  { name: 'nonstring token', cards: [{ ...card(), token: null } as never] },
])('rejects $name for both targets and candidate construction', ({ cards }) => {
  expect(() => getPlanSelectionTargets(turn(cards))).toThrow();
  expect(() => buildPlanSelection(turn(cards), [])).toThrow();
});

it.each([
  { ...timed, date: '2030-02-30' }, { ...timed, startTime: '25:00' }, { ...timed, endTime: '19:00' },
  { ...timed, endDate: undefined }, { ...timed, endDate: null },
  { ...timed, location: 'PRIVATE_LOCATION' }, { ...timed, source: 'PRIVATE_SOURCE' },
  { ...allDay, startTime: '20:00' }, { ...allDay, endDate: allDay.date },
])('rejects malformed or extra raw source fields without projecting them away: %j', args => {
  const original = turn([card('first', args)]);
  expect(() => getPlanSelectionTargets(original)).toThrow();
  expect(() => buildPlanSelection(original, [])).toThrow();
});

it.each([
  ['unknown'], ['first', 'unknown'], ['first', 'first'], [''], ['../first'],
  ['FIRST'], [1], [null], Array.from({ length: 17 }, () => 'first'),
].map(keepIDs => ({ keepIDs })))('rejects unknown, duplicate or malformed kept IDs rather than guessing: $keepIDs', ({ keepIDs }) => {
  expect(() => buildPlanSelection(turn(), keepIDs as readonly string[])).toThrow();
});

it('requires a real dense array of kept IDs with own enumerable data entries and no extra keys', () => {
  expect(() => buildPlanSelection(turn(), null as never)).toThrow();
  expect(() => buildPlanSelection(turn(), 'first' as never)).toThrow();
  expect(() => buildPlanSelection(turn(), { 0: 'first', length: 1 } as never)).toThrow();
  expect(() => buildPlanSelection(turn(), new Array(1))).toThrow();
  const hidden = ['first'];
  Object.defineProperty(hidden, '0', { enumerable: false, value: 'first' });
  expect(() => buildPlanSelection(turn(), hidden)).toThrow();
  const extra = Object.assign(['first'], { unknown: 'PRIVATE_DATA' });
  expect(() => buildPlanSelection(turn(), extra)).toThrow();
  const symbol = ['first'];
  Object.defineProperty(symbol, Symbol('unknown'), { value: 'PRIVATE_DATA' });
  expect(() => buildPlanSelection(turn(), symbol)).toThrow();
});

it('rejects accessors in selected IDs without invoking them', () => {
  const getter = vi.fn(() => 'first');
  const keepIDs = ['first'];
  Object.defineProperty(keepIDs, '0', { enumerable: true, get: getter });
  expect(() => buildPlanSelection(turn(), keepIDs)).toThrow();
  expect(getter).not.toHaveBeenCalled();
});

it.each(['mutationId', 'schoolId', 'tool', 'token', 'args'] as const)('rejects source %s accessors without executing them', field => {
  const getter = vi.fn(() => card()[field]);
  const value = Object.defineProperty(card(), field, { enumerable: true, get: getter });
  expect(() => getPlanSelectionTargets(turn([value]))).toThrow();
  expect(() => buildPlanSelection(turn([value]), [])).toThrow();
  expect(getter).not.toHaveBeenCalled();
});

it('rejects nested event accessors and sparse source rows without invoking getters', () => {
  const getter = vi.fn(() => timed.title);
  const value = card();
  Object.defineProperty(value.args, 'title', { enumerable: true, get: getter });
  expect(() => buildPlanSelection(turn([value]), [])).toThrow();
  expect(getter).not.toHaveBeenCalled();
  expect(() => buildPlanSelection(turn(new Array(1)), [])).toThrow();
  const sourceRows = [card()];
  const rowGetter = vi.fn(() => card());
  Object.defineProperty(sourceRows, '0', { enumerable: true, get: rowGetter });
  expect(() => getPlanSelectionTargets(turn(sourceRows))).toThrow();
  expect(rowGetter).not.toHaveBeenCalled();
});

it('reads only required own source properties and never reads private UI metadata accessors', () => {
  const metadataGetter = vi.fn(() => 'PRIVATE_METADATA');
  const original = turn();
  Object.defineProperty(original, 'question', { enumerable: true, get: metadataGetter });
  Object.defineProperty(original.reply, 'answer', { enumerable: true, get: metadataGetter });
  for (const value of original.reply.cards)
    Object.defineProperty(value, 'destination', { enumerable: true, get: metadataGetter });
  expect(buildPlanSelection(original, ['second']).after).toEqual([night]);
  expect(getPlanSelectionTargets(original)).toHaveLength(3);
  expect(metadataGetter).not.toHaveBeenCalled();
  const replyGetter = vi.fn(() => original.reply);
  const invalid = Object.defineProperty({}, 'reply', { enumerable: true, get: replyGetter }) as V2Turn;
  expect(() => buildPlanSelection(invalid, [])).toThrow();
  expect(replyGetter).not.toHaveBeenCalled();
});

it('does not mutate frozen cards or selection and returns independent before/after content', () => {
  const original = turn(), requested = Object.freeze(['third', 'first']);
  const originalJson = JSON.stringify(original);
  for (const value of original.reply.cards) { Object.freeze(value.args); Object.freeze(value); }
  Object.freeze(original.reply.cards); Object.freeze(original.reply); Object.freeze(original);
  const result = buildPlanSelection(original, requested);
  expect(JSON.stringify(original)).toBe(originalJson);
  expect(requested).toEqual(['third', 'first']);
  result.before[0].title = '修改 before 副本';
  expect(result.after[0]).toEqual(timed);
  result.after[1].title = '修改 after 副本';
  expect(result.before[2]).toEqual(allDay);
  expect(JSON.stringify(original)).toBe(originalJson);
});
