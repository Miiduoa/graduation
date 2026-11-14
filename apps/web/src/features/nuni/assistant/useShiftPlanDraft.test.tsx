import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useShiftPlanDraft } from './useShiftPlanDraft';
import { usePrecisePlanDraft } from './usePrecisePlanDraft';
import { usePlanRevisionDraft } from './usePlanRevisionDraft';
import { revisionDraftSource, readRevisionDraft, type RevisionDraftScope } from '@/lib/assistantPlanRevisionDraft';
import { readPrecisePlanDraft } from '@/lib/assistantPrecisePlanDraft';
import {
  readShiftPlanDraft, saveShiftPlanDraft, SHIFT_PLAN_DRAFT_TTL_MS, type ShiftPlanDraftContent,
} from '@/lib/assistantShiftPlanDraft';

const scope: RevisionDraftScope = { accountId: 'fixture-account', schoolId: 'pu', context: 'A'.repeat(43) };
const NOW = Date.UTC(2026, 10, 10);
const first = { title: '同名閱讀', date: '2030-11-10', allDay: false, startTime: '18:00', endTime: '19:00' };
const rows = [first, { ...first, startTime: '20:00', endTime: '21:00' }];
const source = (prefix = 'original', events = rows) => revisionDraftSource(events.map((args, index) => ({
  mutationId: prefix + '_' + index, tool: 'propose_personal_event', schoolId: 'pu', args,
})));
const content: ShiftPlanDraftContent = { mode: 'shift', direction: 'earlier', minutes: '-', selectedIndices: [1], protectedIndices: [0] };
let now: number;
function methods(): Storage { return Object.hasOwn(sessionStorage, 'setItem') ? sessionStorage : Object.getPrototypeOf(sessionStorage); }
function key() {
  return Array.from({ length: sessionStorage.length }, (_, index) => sessionStorage.key(index)!)
    .find(value => value.startsWith('campus.assistant-shift-draft.v1:'))!;
}
function seed(value = content) { return saveShiftPlanDraft(scope, source(), value, () => true, now).draft!; }
async function mount() {
  const view = renderHook(() => useShiftPlanDraft(scope, () => true));
  await act(async () => { await Promise.resolve(); });
  return view;
}
beforeEach(() => {
  now = NOW;
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  sessionStorage.clear();
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Draft hooks cannot dispatch requests'); }));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('requires explicit restore and apply after remount, keeping exact selection and the original deadline', async () => {
  const firstView = await mount(), original = source();
  act(() => { expect(firstView.result.current.saveEditor(original, content).ok).toBe(true); });
  expect(firstView.result.current.draft).toBeNull();
  const saved = readShiftPlanDraft(scope).draft!;
  firstView.unmount(); now += 60000;
  const view = await mount();
  expect(view.result.current.draft).toEqual(saved);
  expect(view.result.current.restored).toBe(false);
  act(() => { expect(view.result.current.apply(original, [0]).ok).toBe(false); });
  act(() => { expect(view.result.current.restore().ok).toBe(true); });
  expect(readShiftPlanDraft(scope).draft!.savedAt).toBe(saved.savedAt);
  act(() => { expect(view.result.current.apply(original, [0])).toMatchObject({ ok: true, content }); });
  expect(readShiftPlanDraft(scope).draft).toMatchObject({ ...content, savedAt: NOW });
  expect(view.result.current.draft).toBeNull();
  expect(fetch).not.toHaveBeenCalled();
});

it.each(['fresh-id', 'changed-source', 'reordered', 'locks'] as const)('restores only direction and minutes for %s and requires new selection', async kind => {
  const saved = seed(), view = await mount();
  act(() => { view.result.current.restore(); });
  now += 60000;
  const current = kind === 'fresh-id' ? source('fresh') : kind === 'changed-source'
    ? { key: source().key, events: [{ ...first, startTime: '17:00' }, rows[1]] }
    : kind === 'reordered' ? source('reordered', [rows[1], rows[0]]) : source();
  const locks = kind === 'locks' ? [1] : [0];
  act(() => {
    expect(view.result.current.apply(current, locks)).toMatchObject({ ok: true,
      message: expect.stringContaining('重新選擇'), content: { ...content, selectedIndices: [], protectedIndices: locks } });
  });
  expect(readShiftPlanDraft(scope).draft).toMatchObject({ source: current, selectedIndices: [], protectedIndices: locks, savedAt: saved.savedAt });
  expect(fetch).not.toHaveBeenCalled();
});

it('exposes the old offer on same-mount source changes and preserves both inputs until explicit replacement, including empty selection', async () => {
  const view = await mount(), original = source();
  act(() => { view.result.current.saveEditor(original, content); });
  const saved = readShiftPlanDraft(scope).draft!;
  now += 1000;
  const incoming = { ...content, direction: 'later' as const, minutes: '', selectedIndices: [] };
  act(() => { expect(view.result.current.saveEditor(source('new'), incoming).ok).toBe(false); });
  expect(view.result.current.draft).toEqual(saved);
  expect(readShiftPlanDraft(scope).draft).toEqual(saved);
  expect(incoming.minutes).toBe('');
  act(() => { expect(view.result.current.restore().ok).toBe(true); });
  act(() => { expect(view.result.current.saveEditor(source('new'), incoming).ok).toBe(false); });
  act(() => { expect(view.result.current.replaceEditor(source('new'), incoming).ok).toBe(true); });
  expect(readShiftPlanDraft(scope).draft).toMatchObject({ ...incoming, source: source('new'), savedAt: now });
  expect(view.result.current.draft).toBeNull();
});

it('keeps text, precise and shift hook saves independent and clears only the requested shift source', async () => {
  const view = renderHook(() => ({
    shift: useShiftPlanDraft(scope, () => true), precise: usePrecisePlanDraft(scope, () => true),
    text: usePlanRevisionDraft(scope, () => true),
  }));
  await act(async () => { await Promise.resolve(); });
  act(() => {
    expect(view.result.current.shift.saveEditor(source(), content).ok).toBe(true);
    expect(view.result.current.precise.saveEditor(source(), { selectedIndex: 0, edits: [
      { index: 0, date: '', endDate: '', startTime: '', endTime: '' },
    ] }).ok).toBe(true);
    view.result.current.text.saveEditor(source(), { instruction: '稍後閱讀', protectedIndices: [] });
  });
  const text = readRevisionDraft(scope).draft, precise = readPrecisePlanDraft(scope).draft;
  expect(text?.instruction).toBe('稍後閱讀');
  expect(precise?.edits).toHaveLength(1);
  expect(sessionStorage.length).toBe(3);
  act(() => { expect(view.result.current.shift.clearSource(source('different').key, true).ok).toBe(true); });
  expect(readShiftPlanDraft(scope).draft).not.toBeNull();
  act(() => { expect(view.result.current.shift.clearSource(source().key, true).ok).toBe(true); });
  expect(readShiftPlanDraft(scope).draft).toBeNull();
  expect(readRevisionDraft(scope).draft).toEqual(text);
  expect(readPrecisePlanDraft(scope).draft).toEqual(precise);
  expect(fetch).not.toHaveBeenCalled();
});

it.each(['get', 'set'] as const)('does not overwrite the current input or return replacement content after storage %s failure', async operation => {
  const saved = seed(), view = await mount();
  act(() => { view.result.current.restore(); });
  const method = operation === 'get' ? 'getItem' : 'setItem';
  const spy = vi.spyOn(methods(), method).mockImplementation(() => { throw new Error('denied/quota'); });
  act(() => { expect(view.result.current.apply(source(), [0])).toMatchObject({ ok: false }); });
  expect(view.result.current.draft).toEqual(saved);
  expect(view.result.current.restored).toBe(true);
  spy.mockRestore();
  const incoming = { ...content, minutes: '14x', selectedIndices: [] };
  act(() => { expect(view.result.current.replaceEditor(source(), incoming).ok).toBe(true); });
  expect(readShiftPlanDraft(scope).draft).toMatchObject(incoming);
});

it('requires a fresh review after same-id storage content is replaced', async () => {
  const saved = seed(), view = await mount();
  act(() => { view.result.current.restore(); });
  const newer = { ...saved, minutes: '60', protectedIndices: [], selectedIndices: [0] };
  sessionStorage.setItem(key(), JSON.stringify(newer));
  act(() => { expect(view.result.current.apply(source(), []).ok).toBe(false); });
  expect(view.result.current.restored).toBe(false);
  expect(view.result.current.draft).toEqual(newer);
  act(() => { view.result.current.restore(); });
  act(() => { expect(view.result.current.apply(source(), [])).toMatchObject({ ok: true, content: {
    ...content, minutes: '60', protectedIndices: [], selectedIndices: [0],
  } }); });
});

it.each(['accountId', 'schoolId', 'context'] as const)('hides old recovery and rejects retained callbacks after %s changes', async field => {
  const saved = seed();
  const view = renderHook(({ current }) => useShiftPlanDraft(current, () => true), { initialProps: { current: scope } });
  await act(async () => { await Promise.resolve(); });
  const staleSave = view.result.current.saveEditor, staleDiscard = view.result.current.discard;
  view.rerender({ current: { ...scope, [field]: field === 'context' ? 'B'.repeat(43) : 'another' } });
  expect(view.result.current.draft).toBeNull();
  act(() => { expect(staleSave(source(), content).ok).toBe(false); expect(staleDiscard().ok).toBe(false); });
  expect(readShiftPlanDraft(scope).draft).toEqual(saved);
});

it('refuses stale clear and failed removal, then verifies cleanup before allowing dispatch', async () => {
  const saved = seed(), view = await mount();
  const remove = vi.spyOn(methods(), 'removeItem').mockImplementation(() => { throw new Error('denied'); });
  act(() => { expect(view.result.current.clearSource(source().key, true).ok).toBe(false); });
  expect(readShiftPlanDraft(scope).draft).toEqual(saved);
  remove.mockRestore();
  const newer = seed({ ...content, minutes: '90' });
  act(() => { expect(view.result.current.clearSource(source().key, true).ok).toBe(false); });
  expect(view.result.current.draft).toEqual(newer);
  act(() => { expect(view.result.current.clearSource(source().key, true).ok).toBe(true); });
  expect(readShiftPlanDraft(scope).draft).toBeNull();
});

it('expires recovery without restoring any selection and refuses callbacks after unmount', async () => {
  seed();
  const view = await mount();
  act(() => { view.result.current.restore(); });
  now += SHIFT_PLAN_DRAFT_TTL_MS;
  act(() => { document.dispatchEvent(new Event('visibilitychange')); });
  expect(view.result.current.draft).toBeNull();
  expect(view.result.current.restored).toBe(false);
  act(() => { expect(view.result.current.apply(source(), [0]).ok).toBe(false); });
  const save = view.result.current.saveEditor;
  view.unmount();
  expect(save(source(), content).ok).toBe(false);
  expect(fetch).not.toHaveBeenCalled();
});
