import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { usePrecisePlanDraft } from './usePrecisePlanDraft';
import { revisionDraftSource, type RevisionDraftScope } from '@/lib/assistantPlanRevisionDraft';
import { readPrecisePlanDraft, savePrecisePlanDraft, PRECISE_PLAN_DRAFT_TTL_MS,
  type PrecisePlanDraft, type PrecisePlanDraftContent } from '@/lib/assistantPrecisePlanDraft';

const scope: RevisionDraftScope = { accountId: 'fixture-account', schoolId: 'pu', context: 'A'.repeat(43) };
const NOW = Date.UTC(2026, 10, 10, 1);
const first = { title: '閱讀', date: '2030-11-10', allDay: false, startTime: '18:00', endTime: '19:00' };
const second = { ...first, title: '複習', startTime: '20:00', endTime: '21:00' };
const content: PrecisePlanDraftContent = { selectedIndex: 1, edits: [
  { index: 1, date: '2026-02-30', endDate: '', startTime: '', endTime: '25:00' },
] };
let now: number;
const source = (prefix = 'old', events = [first, second]) => revisionDraftSource(events.map((event, index) => ({
  mutationId: prefix + '_' + index, schoolId: 'pu', tool: 'propose_personal_event', args: event,
})));
function methods(): Storage {
  return Object.hasOwn(sessionStorage, 'setItem') ? sessionStorage : Object.getPrototypeOf(sessionStorage);
}
function key(): string {
  const keys = Array.from({ length: sessionStorage.length }, (_, index) => sessionStorage.key(index)!);
  return keys.find(value => value.startsWith('campus.assistant-time-draft.v1:'))!;
}
function seed(original = source(), value = content): PrecisePlanDraft {
  const result = savePrecisePlanDraft(scope, original, value, () => true, now);
  expect(result.ok).toBe(true);
  return result.draft!;
}
async function mount() {
  const view = renderHook(() => usePrecisePlanDraft(scope, () => true));
  await act(async () => { await Promise.resolve(); });
  return view;
}
function changedSnapshot(update: (draft: PrecisePlanDraft) => void) {
  const value = JSON.parse(sessionStorage.getItem(key())!) as PrecisePlanDraft;
  update(value);
  sessionStorage.setItem(key(), JSON.stringify(value));
  return value;
}
beforeEach(() => {
  now = NOW;
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  sessionStorage.clear();
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Draft hooks cannot send requests'); }));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('autosaves only its own editor, then requires explicit recovery after a real remount and applies to fresh IDs without renewing the TTL', async () => {
  const original = source(), firstView = await mount();
  act(() => { expect(firstView.result.current.saveEditor(original, content).ok).toBe(true); });
  expect(firstView.result.current.draft).toBeNull();
  now += 1000;
  const latest = { ...content, edits: [{ ...content.edits[0], startTime: '2' }] };
  act(() => { expect(firstView.result.current.saveEditor(original, latest).ok).toBe(true); });
  const saved = readPrecisePlanDraft(scope).draft!;
  firstView.unmount();
  now += 60000;
  const secondView = await mount();
  expect(secondView.result.current.draft).toEqual(saved);
  expect(secondView.result.current.restored).toBe(false);
  act(() => { expect(secondView.result.current.apply(source('fresh')).ok).toBe(false); });
  act(() => { expect(secondView.result.current.restore().ok).toBe(true); });
  expect(secondView.result.current.restored).toBe(true);
  act(() => {
    expect(secondView.result.current.apply(source('fresh'))).toMatchObject({ ok: true, content: latest });
  });
  const rebound = readPrecisePlanDraft(scope).draft!;
  expect(rebound.source.key).toBe(source('fresh').key);
  expect(rebound.id).not.toBe(saved.id);
  expect(rebound.savedAt).toBe(saved.savedAt);
  expect(secondView.result.current.draft).toBeNull();
  expect(fetch).not.toHaveBeenCalled();
});

it.each(['same', 'different'] as const)('blocks autosave over a recovered %s source until explicit replacement', async kind => {
  const saved = seed(), view = await mount();
  const nextSource = kind === 'same' ? source() : source('different', [second, first]);
  const incoming = { ...content, edits: [{ ...content.edits[0], startTime: '19:30' }] };
  act(() => { expect(view.result.current.saveEditor(nextSource, incoming).ok).toBe(false); });
  expect(readPrecisePlanDraft(scope).draft).toEqual(saved);
  act(() => { expect(view.result.current.restore().ok).toBe(true); });
  act(() => { expect(view.result.current.saveEditor(nextSource, incoming).ok).toBe(false); });
  expect(readPrecisePlanDraft(scope).draft).toEqual(saved);
  now += 1000;
  act(() => { expect(view.result.current.replaceEditor(nextSource, incoming).ok).toBe(true); });
  expect(readPrecisePlanDraft(scope).draft).toMatchObject({ source: nextSource, ...incoming, savedAt: now });
  expect(view.result.current.draft).toBeNull();
});

it('exposes the preserved draft when another editor source cannot autosave in the same mounted conversation', async () => {
  const view = await mount(), original = source(), another = source('another');
  act(() => { expect(view.result.current.saveEditor(original, content).ok).toBe(true); });
  const saved = readPrecisePlanDraft(scope).draft!;
  const incoming = { ...content, edits: [{ ...content.edits[0], startTime: '23:' }] };
  now += 60000;
  act(() => { expect(view.result.current.saveEditor(another, incoming).ok).toBe(false); });
  expect(readPrecisePlanDraft(scope).draft).toEqual(saved);
  expect(view.result.current.draft).toEqual(saved);
  expect(view.result.current.restored).toBe(false);
  expect(incoming.edits[0].startTime).toBe('23:');
  // A real recovery choice must be reachable; blocking alone strands both editors.
  act(() => { expect(view.result.current.restore().ok).toBe(true); });
  expect(view.result.current.restored).toBe(true);
  expect(readPrecisePlanDraft(scope).draft!.savedAt).toBe(saved.savedAt);
  act(() => { expect(view.result.current.replaceEditor(another, incoming).ok).toBe(true); });
  expect(readPrecisePlanDraft(scope).draft).toMatchObject({ source: another, ...incoming, savedAt: now });
});

it.each(['time', 'order', 'presence'] as const)('keeps restored input read-only when fresh source %s differs', async kind => {
  const saved = seed(), view = await mount();
  act(() => { expect(view.result.current.restore().ok).toBe(true); });
  const events = kind === 'time' ? [{ ...first, startTime: '17:30' }, second]
    : kind === 'order' ? [second, first] : [{ ...first, endDate: first.date }, second];
  act(() => { expect(view.result.current.apply(source('fresh', events)).ok).toBe(false); });
  expect(view.result.current.restored).toBe(true);
  expect(view.result.current.draft).toEqual(saved);
  expect(readPrecisePlanDraft(scope).draft).toEqual(saved);
});

it('does not guess duplicate edited rows on fresh IDs but can apply the exact original source', async () => {
  const original = source('duplicates', [first, first]), saved = seed(original);
  const view = await mount();
  act(() => { view.result.current.restore(); });
  act(() => { expect(view.result.current.apply(source('fresh', [first, first])).ok).toBe(false); });
  expect(readPrecisePlanDraft(scope).draft).toEqual(saved);
  act(() => { expect(view.result.current.apply(original)).toMatchObject({ ok: true, content }); });
});

it.each(['new-id', 'same-id-content'] as const)('requires a fresh recovery decision after a %s storage replacement', async kind => {
  seed();
  const view = await mount();
  act(() => { view.result.current.restore(); });
  const incoming = { ...content, edits: [{ ...content.edits[0], date: '2031-01-02' }] };
  const replacement = kind === 'new-id'
    ? seed(source(), incoming)
    : changedSnapshot(value => { value.edits = incoming.edits; });
  act(() => { expect(view.result.current.apply(source('fresh')).ok).toBe(false); });
  expect(view.result.current.restored).toBe(false);
  expect(view.result.current.draft).toEqual(replacement);
  expect(readPrecisePlanDraft(scope).draft).toEqual(replacement);
  act(() => { expect(view.result.current.restore().ok).toBe(true); });
  act(() => { expect(view.result.current.apply(source('fresh'))).toMatchObject({ ok: true, content: incoming }); });
});

it.each(['get', 'set'] as const)('keeps current input available after storage %s failure and persists the latest input on retry', async operation => {
  const view = await mount(), original = source();
  act(() => { expect(view.result.current.saveEditor(original, content).ok).toBe(true); });
  const previous = readPrecisePlanDraft(scope).draft!;
  const incoming = { ...content, edits: [{ ...content.edits[0], startTime: '07:' }] };
  const spy = operation === 'get'
    ? vi.spyOn(methods(), 'getItem').mockImplementation(() => { throw new Error('denied'); })
    : vi.spyOn(methods(), 'setItem').mockImplementation(() => { throw new Error('quota'); });
  act(() => { expect(view.result.current.saveEditor(original, incoming).ok).toBe(false); });
  expect(view.result.current.editorStatuses[original.key]).toMatch(/無法|尚未/);
  // The owner still holds exactly the same unfinished input; no replacement content is returned.
  expect(incoming.edits[0].startTime).toBe('07:');
  spy.mockRestore();
  expect(readPrecisePlanDraft(scope).draft).toEqual(previous);
  act(() => { expect(view.result.current.saveEditor(original, incoming).ok).toBe(true); });
  expect(readPrecisePlanDraft(scope).draft!.edits).toEqual(incoming.edits);
});

it('blocks apply while recovery storage cannot be read without discarding the reviewed draft', async () => {
  const saved = seed(), view = await mount();
  act(() => { view.result.current.restore(); });
  const spy = vi.spyOn(methods(), 'getItem').mockImplementation(() => { throw new Error('denied'); });
  act(() => { expect(view.result.current.apply(source('fresh')).ok).toBe(false); });
  expect(view.result.current.draft).toEqual(saved);
  expect(view.result.current.restored).toBe(true);
  spy.mockRestore();
  act(() => { expect(view.result.current.apply(source('fresh')).ok).toBe(true); });
});

it('blocks dispatch cleanup and discard after removal failure, then clears only on verified removal', async () => {
  const original = source(), saved = seed(), view = await mount();
  act(() => { view.result.current.restore(); });
  const spy = vi.spyOn(methods(), 'removeItem').mockImplementation(() => { throw new Error('denied'); });
  act(() => { expect(view.result.current.clearSource(original.key, true).ok).toBe(false); });
  act(() => { expect(view.result.current.discard().ok).toBe(false); });
  expect(view.result.current.draft).toEqual(saved);
  expect(readPrecisePlanDraft(scope).draft).toEqual(saved);
  spy.mockRestore();
  act(() => { expect(view.result.current.clearSource(original.key, true).ok).toBe(true); });
  expect(readPrecisePlanDraft(scope).draft).toBeNull();
  expect(view.result.current.draft).toBeNull();
  expect(view.result.current.status).toBe('');
  expect(fetch).not.toHaveBeenCalled();
});

it('refuses stale cleanup of a newer same-source record and never clears another source', async () => {
  const original = source(), view = await mount();
  act(() => { view.result.current.saveEditor(original, content); });
  const replacement = seed(original, { ...content, edits: [{ ...content.edits[0], endTime: '22:30' }] });
  act(() => { expect(view.result.current.clearSource(original.key, true).ok).toBe(false); });
  expect(readPrecisePlanDraft(scope).draft).toEqual(replacement);
  const unrelated = source('other');
  act(() => { expect(view.result.current.clearSource(unrelated.key, true).ok).toBe(true); });
  expect(readPrecisePlanDraft(scope).draft).toEqual(replacement);
});

it.each(['accountId', 'schoolId', 'context'] as const)('hides recovery and rejects retained callbacks after a %s scope switch', async field => {
  const saved = seed();
  const view = renderHook(({ currentScope }) => usePrecisePlanDraft(currentScope, () => true),
    { initialProps: { currentScope: scope } });
  await act(async () => { await Promise.resolve(); });
  const oldCallback = view.result.current.discard;
  const next = { ...scope, [field]: field === 'context' ? 'B'.repeat(43) : 'other' };
  view.rerender({ currentScope: next });
  expect(view.result.current.draft).toBeNull();
  act(() => { expect(oldCallback().ok).toBe(false); });
  act(() => { expect(view.result.current.saveEditor(source(), content).ok).toBe(false); });
  expect(readPrecisePlanDraft(scope).draft).toEqual(saved);
});

it('refuses saves and cleanup after lifetime end and does not renew an offered draft by restoring it', async () => {
  const saved = seed(), view = await mount();
  now += 60000;
  act(() => { view.result.current.restore(); });
  expect(readPrecisePlanDraft(scope).draft!.savedAt).toBe(saved.savedAt);
  const oldSave = view.result.current.saveEditor, oldClear = view.result.current.clearSource;
  view.unmount();
  expect(oldSave(source(), content).ok).toBe(false);
  expect(oldClear(source().key, true).ok).toBe(false);
  expect(readPrecisePlanDraft(scope).draft).toEqual(saved);
});

it('hides an expired restored offer even when storage cleanup is denied', async () => {
  seed();
  const view = await mount();
  act(() => { view.result.current.restore(); });
  const spy = vi.spyOn(methods(), 'removeItem').mockImplementation(() => { throw new Error('denied'); });
  now += PRECISE_PLAN_DRAFT_TTL_MS;
  act(() => { document.dispatchEvent(new Event('visibilitychange')); });
  expect(view.result.current.draft).toBeNull();
  expect(view.result.current.restored).toBe(false);
  act(() => { expect(view.result.current.apply(source('fresh')).ok).toBe(false); });
  spy.mockRestore();
});

it('clears an owned draft when its last edited entry returns to original fields without clearing unrelated storage', async () => {
  const view = await mount(), original = source();
  sessionStorage.setItem('unrelated-setting', 'keep');
  act(() => { view.result.current.saveEditor(original, content); });
  act(() => { expect(view.result.current.saveEditor(original, { selectedIndex: 1, edits: [] }).ok).toBe(true); });
  expect(readPrecisePlanDraft(scope).draft).toBeNull();
  expect(sessionStorage.getItem('unrelated-setting')).toBe('keep');
});
