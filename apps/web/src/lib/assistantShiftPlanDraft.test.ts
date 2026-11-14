import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  clearShiftPlanDraft, readShiftPlanDraft, saveShiftPlanDraft, shiftPlanDraftSourceMatch,
  SHIFT_PLAN_DRAFT_TTL_MS, type ShiftPlanDraftContent,
} from './assistantShiftPlanDraft';
import { revisionDraftSource, readRevisionDraft, saveRevisionDraft, type RevisionDraftScope } from './assistantPlanRevisionDraft';
import { readPrecisePlanDraft, savePrecisePlanDraft } from './assistantPrecisePlanDraft';

const NOW = Date.UTC(2026, 10, 10);
const scope: RevisionDraftScope = { accountId: 'fixture-account', schoolId: 'pu', context: 'A'.repeat(43) };
const first = { title: '同名閱讀', date: '2030-11-10', allDay: false, startTime: '18:00', endTime: '19:00' };
const rows = [first, { ...first, startTime: '20:00', endTime: '21:00' }, { title: '全天', date: '2030-11-11', allDay: true }];
const source = (prefix = 'original', events = rows) => revisionDraftSource(events.map((args, index) => ({
  mutationId: prefix + '_' + index, tool: 'propose_personal_event', schoolId: 'pu', args,
  token: 'PRIVATE_TOKEN', context: 'PRIVATE_CONTEXT', consent: true,
})));
const content: ShiftPlanDraftContent = { mode: 'shift', direction: 'earlier', minutes: '-', selectedIndices: [1], protectedIndices: [0, 2] };
const active = () => true;
function save(value = content, input = source(), now = NOW) {
  const result = saveShiftPlanDraft(scope, input, value, active, now);
  expect(result.ok).toBe(true);
  return result.draft!;
}
function key() {
  return Array.from({ length: sessionStorage.length }, (_, index) => sessionStorage.key(index)!)
    .find(value => value.startsWith('campus.assistant-shift-draft.v1:'))!;
}
function methods(): Storage { return Object.hasOwn(sessionStorage, 'setItem') ? sessionStorage : Object.getPrototypeOf(sessionStorage); }
beforeEach(() => { sessionStorage.clear(); localStorage.clear(); });
afterEach(() => vi.restoreAllMocks());

it('round-trips unfinished minutes and an empty selection without leaking execution authority or deleting intent', () => {
  const draft = save({ ...content, minutes: '', selectedIndices: [] });
  expect(key()).toMatch(/^campus\.assistant-shift-draft\.v1:[a-f0-9]{64}$/);
  const encoded = sessionStorage.getItem(key())!;
  expect(encoded).not.toMatch(/PRIVATE|original_\d|fixture-account|mutationId|token|consent|signature|permit|context/);
  expect(localStorage.length).toBe(0);
  expect(readShiftPlanDraft(scope, NOW + 1)).toEqual({ status: 'ready', draft });
  expect(saveShiftPlanDraft(scope, source(), { ...content, minutes: 'invalid 1441', selectedIndices: [] }, active, NOW + 2,
    { expected: draft }).draft).toMatchObject({ minutes: 'invalid 1441', selectedIndices: [] });
});

it('keeps all three draft modes and every scope separate; clearing shift leaves the other two unchanged', () => {
  const shift = save();
  const text = saveRevisionDraft(scope, source(), { instruction: '晚上閱讀', protectedIndices: [0] }, active, NOW).draft;
  const precise = savePrecisePlanDraft(scope, source(), { selectedIndex: 1, edits: [
    { index: 1, date: '', endDate: '', startTime: '', endTime: '' },
  ] }, active, NOW).draft;
  expect(sessionStorage.length).toBe(3);
  const enumerate = vi.spyOn(methods(), 'key');
  for (const change of [{ accountId: 'another' }, { schoolId: 'ntut' }, { context: 'B'.repeat(43) }])
    expect(readShiftPlanDraft({ ...scope, ...change }, NOW)).toEqual({ status: 'empty', draft: null });
  expect(enumerate).not.toHaveBeenCalled();
  expect(clearShiftPlanDraft(scope, active, { snapshot: shift })).toEqual({ ok: true, cleared: true });
  expect(readRevisionDraft(scope, NOW).draft).toEqual(text);
  expect(readPrecisePlanDraft(scope, NOW).draft).toEqual(precise);
});

it('requires exact source identity, ordered raw values and optional-field presence plus the current protected set', () => {
  const draft = save();
  expect(shiftPlanDraftSourceMatch(draft, source(), [2, 0])).toBe('exact');
  expect(shiftPlanDraftSourceMatch(draft, source('fresh'), [0, 2])).toBe('reselect');
  expect(shiftPlanDraftSourceMatch(draft, source('same-name', [first, first, rows[2]]), [0, 2])).toBe('reselect');
  for (const events of [[rows[1], rows[0], rows[2]], [{ ...first, startTime: '17:00' }, rows[1], rows[2]],
    [{ ...first, endDate: first.date }, rows[1], rows[2]]]) {
    // Even reusing a source hash cannot hide an altered raw snapshot.
    expect(shiftPlanDraftSourceMatch(draft, { key: source().key, events }, [0, 2])).toBe('reselect');
  }
  for (const locks of [[], [0], [1, 2], [0, 0], [3]])
    expect(shiftPlanDraftSourceMatch(draft, source(), locks)).toBe('reselect');
});

it.each([
  { mode: 'precise' }, { direction: 'sideways' }, { minutes: 'x'.repeat(17) }, { minutes: 30 },
  { selectedIndices: [0] }, { selectedIndices: [2], protectedIndices: [] }, { selectedIndices: [1, 1] },
  { selectedIndices: [-1] }, { selectedIndices: [3] }, { selectedIndices: [0.5] },
  { selectedIndices: new Array(1) }, { protectedIndices: [0, 0] }, { protectedIndices: [16] },
  { protectedIndices: ['0'] }, { token: 'PRIVATE_TOKEN' },
].map(change => ({ change })))('rejects invalid schema $change before modifying a valid draft', ({ change }) => {
  const saved = save(), set = vi.spyOn(methods(), 'setItem');
  expect(saveShiftPlanDraft(scope, source(), { ...content, ...change } as ShiftPlanDraftContent, active, NOW).ok).toBe(false);
  expect(set).not.toHaveBeenCalled();
  expect(readShiftPlanDraft(scope, NOW).draft).toEqual(saved);
});

it('never evaluates draft content accessors and enforces the sixteen-source limit', () => {
  const getter = vi.fn(() => '30'), input = { ...content };
  Object.defineProperty(input, 'minutes', { get: getter, enumerable: true });
  expect(saveShiftPlanDraft(scope, source(), input, active, NOW).ok).toBe(false);
  expect(getter).not.toHaveBeenCalled();
  const events = Array.from({ length: 16 }, (_, index) => ({ ...first, title: `閱讀 ${index}` }));
  expect(save({ ...content, selectedIndices: [15], protectedIndices: [] }, source('sixteen', events))).toBeTruthy();
  expect(saveShiftPlanDraft(scope, { key: source().key, events: [...events, first] }, content, active, NOW).ok).toBe(false);
});

it.each(['expired', 'corrupt', 'future'] as const)('does not expose a %s draft and clears only its current namespace', kind => {
  const draft = save();
  sessionStorage.setItem('unrelated', 'keep');
  if (kind === 'corrupt') sessionStorage.setItem(key(), '{PRIVATE_CORRUPT');
  if (kind === 'future') sessionStorage.setItem(key(), JSON.stringify({ ...draft, savedAt: NOW + 1 }));
  expect(readShiftPlanDraft(scope, kind === 'expired' ? NOW + SHIFT_PLAN_DRAFT_TTL_MS : NOW))
    .toMatchObject({ draft: null, status: kind === 'expired' ? 'expired' : 'invalid' });
  expect(key()).toBeUndefined();
  expect(sessionStorage.getItem('unrelated')).toBe('keep');
});

it('preserves the original deadline on explicit rebind and rejects stale whole snapshots even with the same id', () => {
  const draft = save();
  const rebound = saveShiftPlanDraft(scope, source('fresh'), { ...content, selectedIndices: [] }, active, NOW + 60000,
    { expected: draft, savedAt: draft.savedAt }).draft!;
  expect(rebound.savedAt).toBe(NOW);
  const replacement = { ...rebound, minutes: '60' };
  sessionStorage.setItem(key(), JSON.stringify(replacement));
  expect(saveShiftPlanDraft(scope, source(), content, active, NOW + 60001, { expected: rebound }))
    .toMatchObject({ ok: false, message: expect.stringContaining('已有更新') });
  expect(clearShiftPlanDraft(scope, active, { snapshot: rebound }).ok).toBe(false);
  expect(readShiftPlanDraft(scope, NOW + 60001).draft).toEqual(replacement);
});

it('reports read denial, quota and unverified removal without claiming storage success', () => {
  const draft = save();
  const get = vi.spyOn(methods(), 'getItem').mockImplementation(() => { throw new Error('PRIVATE_DENIED'); });
  expect(readShiftPlanDraft(scope, NOW)).toMatchObject({ status: 'unavailable', draft: null });
  get.mockRestore();
  const set = vi.spyOn(methods(), 'setItem').mockImplementation(() => { throw new Error('PRIVATE_QUOTA'); });
  expect(saveShiftPlanDraft(scope, source(), content, active, NOW, { expected: draft }))
    .toMatchObject({ ok: false, message: expect.stringContaining('尚未確認儲存') });
  set.mockRestore();
  const remove = vi.spyOn(methods(), 'removeItem').mockImplementation(() => {});
  expect(clearShiftPlanDraft(scope, active, { snapshot: draft }))
    .toMatchObject({ ok: false, message: expect.stringContaining('尚未確認清除') });
  remove.mockRestore();
  expect(readShiftPlanDraft(scope, NOW).draft).toEqual(draft);
});

it('does not overwrite or remove storage after the active scope changes', () => {
  const draft = save();
  expect(saveShiftPlanDraft(scope, source(), content, () => false, NOW, { expected: draft }).ok).toBe(false);
  expect(clearShiftPlanDraft(scope, () => false, { snapshot: draft }).ok).toBe(false);
  expect(readShiftPlanDraft(scope, NOW).draft).toEqual(draft);
});
