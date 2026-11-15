import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  clearPrecisePlanDraft, precisePlanDraftSourceMatch, readPrecisePlanDraft, savePrecisePlanDraft,
  PRECISE_PLAN_DRAFT_MAX_BYTES, PRECISE_PLAN_DRAFT_TTL_MS,
  type PrecisePlanDraft, type PrecisePlanDraftContent, type PrecisePlanDraftSaveOptions,
} from './assistantPrecisePlanDraft';
import {
  revisionDraftSource, saveRevisionDraft, type RevisionDraftScope, type RevisionDraftSource,
} from './assistantPlanRevisionDraft';
import type { PlanProtectionEvent } from './assistantPlanProtection';

const NOW = Date.UTC(2026, 10, 9, 12);
const scope: RevisionDraftScope = { accountId: 'account_one', schoolId: 'pu', context: 'A'.repeat(43) };
const active = () => true;
const event: PlanProtectionEvent = {
  title: '資料庫複習', date: '2030-11-10', allDay: false, startTime: '20:00', endTime: '21:00',
};
const edit: PrecisePlanDraftContent = {
  selectedIndex: 1,
  edits: [{ index: 0, date: '2030-', endDate: '', startTime: '25:7', endTime: '' }],
};
function events(): PlanProtectionEvent[] {
  return [{ ...event }, { ...event, title: '英文閱讀', startTime: '21:30', endTime: '22:30' },
    { title: '校園活動', date: '2030-11-11', allDay: true }];
}
function source(rows = events(), idPrefix = 'original'): RevisionDraftSource {
  return revisionDraftSource(rows.map((args, index) => ({
    mutationId: idPrefix + '_' + index, tool: 'propose_personal_event', schoolId: 'pu', args,
    token: 'PRIVATE_TOKEN', context: 'PRIVATE_CONTEXT', consent: true, status: 'PRIVATE_STATUS',
  })));
}
function methods(): Storage {
  return Object.hasOwn(sessionStorage, 'setItem') ? sessionStorage : Object.getPrototypeOf(sessionStorage);
}
function saved(input = source(), content = edit): PrecisePlanDraft {
  const result = savePrecisePlanDraft(scope, input, content, active, NOW);
  expect(result).toMatchObject({ ok: true, draft: expect.any(Object) });
  return result.draft!;
}
function onlyKey(): string {
  expect(sessionStorage.length).toBe(1);
  return sessionStorage.key(0)!;
}
function encoded(): string { return sessionStorage.getItem(onlyKey())!; }
function replaceStored(value: unknown): void { sessionStorage.setItem(onlyKey(), JSON.stringify(value)); }
function attempt(content: unknown, input: unknown = source(), options?: unknown) {
  return savePrecisePlanDraft(scope, input as RevisionDraftSource, content as PrecisePlanDraftContent,
    active, NOW, options as PrecisePlanDraftSaveOptions);
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  sessionStorage.clear();
  localStorage.clear();
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('round-trips unfinished dates and times after a module reload without execution or raw scope metadata', async () => {
  const draft = saved();
  expect(draft).toMatchObject({ ...edit, savedAt: NOW, version: 1 });
  expect(onlyKey()).toMatch(/^campus\.assistant-time-draft\.v1:[a-f0-9]{64}$/);
  expect(encoded()).not.toMatch(/PRIVATE|original_\d|account_one|schoolId|context|mutationId|token|consent|status/);
  expect(encoded()).not.toContain(scope.context);
  expect(localStorage.length).toBe(0);
  vi.resetModules();
  const reloaded = await import('./assistantPrecisePlanDraft');
  expect(reloaded.readPrecisePlanDraft(scope, NOW + 1)).toEqual({ status: 'ready', draft });
});

it('keeps the new namespace separate and reads only the requested account, school and context', () => {
  const first = saved(), firstKey = onlyKey();
  const oldDraft = saveRevisionDraft(scope, source(), { instruction: '改成晚上', protectedIndices: [] }, active, NOW).draft;
  expect(oldDraft).not.toBeNull();
  const enumerate = vi.spyOn(methods(), 'key');
  for (const changed of [{ accountId: 'account_two' }, { schoolId: 'ntut' }, { context: 'B'.repeat(43) }]) {
    expect(readPrecisePlanDraft({ ...scope, ...changed }, NOW)).toEqual({ draft: null, status: 'empty' });
  }
  expect(enumerate).not.toHaveBeenCalled();
  expect(clearPrecisePlanDraft(scope, active, { snapshot: first })).toEqual({ ok: true, cleared: true });
  expect(sessionStorage.getItem(firstKey)).toBeNull();
  expect(sessionStorage.length).toBe(1);
  expect(JSON.parse(sessionStorage.getItem(sessionStorage.key(0)!)!).instruction).toBe('改成晚上');
});

it('copies source and editor data and returns a new draft ID for each deliberate save', () => {
  const input = source(), content = structuredClone(edit), first = saved(input, content);
  input.events[0].title = 'changed source';
  content.edits[0].date = '2040-01-01';
  first.edits[0].startTime = '00:00';
  const read = readPrecisePlanDraft(scope, NOW).draft!;
  expect(read.source.events[0]).toEqual(event);
  expect(read.edits).toEqual(edit.edits);
  const second = savePrecisePlanDraft(scope, source(), edit, active, NOW + 1, { expected: read }).draft!;
  expect(second.id).not.toBe(read.id);
  expect(second.savedAt).toBe(NOW + 1);
});

it('accepts several unique timed rows and a selected row that has no edit', () => {
  const content: PrecisePlanDraftContent = {
    selectedIndex: 1,
    edits: [edit.edits[0], { index: 1, date: '', endDate: 'not-a-date', startTime: '', endTime: 'nope' }],
  };
  expect(saved(source(), content).edits).toEqual(content.edits);
  expect(saved(source(), edit).selectedIndex).toBe(1);
});

it('accepts sixteen source rows and edits, while rejecting a seventeenth row or edit', () => {
  const rows = Array.from({ length: 16 }, (_, index) => ({ ...event, title: '第' + index + '項' }));
  const input = source(rows);
  const content = { selectedIndex: 15, edits: rows.map((_, index) => ({ ...edit.edits[0], index })) };
  expect(saved(input, content).edits).toHaveLength(16);
  expect(attempt({ ...content, edits: [...content.edits, { ...edit.edits[0], index: 16 }] }, input).ok).toBe(false);
  expect(attempt(content, { ...input, events: [...rows, { ...event }] }).ok).toBe(false);
});

it.each([
  ['all-day selected row', { ...edit, selectedIndex: 2 }],
  ['all-day edited row', { ...edit, edits: [{ ...edit.edits[0], index: 2 }] }],
  ['negative selection', { ...edit, selectedIndex: -1 }],
  ['fractional selection', { ...edit, selectedIndex: 0.5 }],
  ['missing selection', { edits: edit.edits }],
  ['out-of-range edited row', { ...edit, edits: [{ ...edit.edits[0], index: 3 }] }],
  ['duplicate edited row', { ...edit, edits: [edit.edits[0], edit.edits[0]] }],
  ['unknown content field', { ...edit, token: 'PRIVATE_TOKEN' }],
  ['unknown edit field', { ...edit, edits: [{ ...edit.edits[0], title: 'PRIVATE_TITLE' }] }],
  ['missing raw field', { ...edit, edits: [{ index: 0, date: '', startTime: '', endTime: '' }] }],
  ['date over ten characters', { ...edit, edits: [{ ...edit.edits[0], date: '2030-11-100' }] }],
  ['end date over ten characters', { ...edit, edits: [{ ...edit.edits[0], endDate: '2030-11-100' }] }],
  ['start time over five characters', { ...edit, edits: [{ ...edit.edits[0], startTime: '20:000' }] }],
  ['end time over five characters', { ...edit, edits: [{ ...edit.edits[0], endTime: '20:000' }] }],
  ['non-string raw input', { ...edit, edits: [{ ...edit.edits[0], date: null }] }],
])('rejects %s before replacing an existing draft', (_label, content) => {
  const before = saved(), set = vi.spyOn(methods(), 'setItem');
  expect(attempt(content)).toMatchObject({ ok: false, draft: null });
  expect(set).not.toHaveBeenCalled();
  expect(readPrecisePlanDraft(scope, NOW).draft).toEqual(before);
});

it('does not evaluate getters, inherited properties or array accessors while validating input', () => {
  const getter = vi.fn(() => 'PRIVATE_GETTER');
  const getterEdit = { ...edit.edits[0] };
  Object.defineProperty(getterEdit, 'date', { enumerable: true, get: getter });
  const getterSource = source();
  Object.defineProperty(getterSource, 'events', { enumerable: true, get: getter });
  const getterOptions = {};
  Object.defineProperty(getterOptions, 'expected', { enumerable: true, get: getter });
  const arrayGetter = [edit.edits[0]];
  Object.defineProperty(arrayGetter, '0', { enumerable: true, get: getter });
  const hiddenEdit = { ...edit.edits[0] };
  Object.defineProperty(hiddenEdit, 'date', { value: '', enumerable: false });
  const extraArray = Object.assign([edit.edits[0]], { private: 'metadata' });
  for (const content of [
    { ...edit, edits: [getterEdit] }, { ...edit, edits: arrayGetter }, { ...edit, edits: [hiddenEdit] },
    { ...edit, edits: extraArray }, { ...edit, edits: new Array(1) }, Object.create(edit),
    { ...edit, [Symbol('private')]: 'data' },
  ]) expect(attempt(content).ok).toBe(false);
  expect(attempt(edit, getterSource).ok).toBe(false);
  expect(attempt(edit, source(), getterOptions).ok).toBe(false);
  expect(getter).not.toHaveBeenCalled();
  expect(sessionStorage.length).toBe(0);
});

it('rejects invalid scope and source snapshots without touching storage', () => {
  const get = vi.spyOn(methods(), 'getItem'), set = vi.spyOn(methods(), 'setItem');
  for (const changed of [{ accountId: '' }, { schoolId: 'personal' }, { context: 'short' }]) {
    expect(readPrecisePlanDraft({ ...scope, ...changed }, NOW).status).toBe('invalid');
    expect(savePrecisePlanDraft({ ...scope, ...changed }, source(), edit, active, NOW).ok).toBe(false);
  }
  for (const input of [
    { ...source(), key: 'not-a-hash' }, { ...source(), token: 'PRIVATE' },
    { ...source(), events: [] }, { ...source(), events: Object.assign(events(), { secret: true }) },
    { ...source(), events: [{ ...event, token: 'PRIVATE' }] },
    { ...source(), events: [{ ...event, date: 'unfinished' }] },
  ]) expect(attempt(edit, input).ok).toBe(false);
  expect(get).not.toHaveBeenCalled();
  expect(set).not.toHaveBeenCalled();
});

it('matches full ordered raw content and distinguishes the original source from fresh cards', () => {
  const draft = saved();
  expect(precisePlanDraftSourceMatch(draft, source())).toBe('exact');
  expect(precisePlanDraftSourceMatch(draft, source(events(), 'fresh'))).toBe('fresh');
  const modifiedTime = events(); modifiedTime[0].startTime = '19:30';
  const modifiedTitle = events(); modifiedTitle[0].title = '其他';
  const explicitEnd = events(); explicitEnd[0].endDate = explicitEnd[0].date;
  for (const input of [
    source(modifiedTime), source(modifiedTitle), source(events().reverse()), source(explicitEnd),
    { key: draft.source.key, events: modifiedTime },
  ]) expect(precisePlanDraftSourceMatch(draft, input)).toBe('mismatch');
});

it('requires unique edited raw rows for fresh cards but allows same-name rows with different times', () => {
  const rows = [{ ...event }, { ...event }, { ...event, startTime: '21:30', endTime: '22:30' }];
  const duplicateDraft = saved(source(rows), { selectedIndex: 0, edits: [edit.edits[0]] });
  expect(precisePlanDraftSourceMatch(duplicateDraft, source(rows))).toBe('exact');
  expect(precisePlanDraftSourceMatch(duplicateDraft, source(rows, 'fresh'))).toBe('ambiguous');
  const uniqueDraft = saved(source(rows), { selectedIndex: 0, edits: [{ ...edit.edits[0], index: 2 }] });
  expect(precisePlanDraftSourceMatch(uniqueDraft, source(rows, 'fresh'))).toBe('fresh');
  const bothDuplicates = saved(source(rows), { selectedIndex: 0, edits: [edit.edits[0], { ...edit.edits[0], index: 1 }] });
  expect(precisePlanDraftSourceMatch(bothDuplicates, source(rows, 'fresh'))).toBe('ambiguous');
});

it('rejects malformed match inputs without evaluating their getters', () => {
  const draft = saved(), getter = vi.fn(() => draft.source);
  const unsafe = { ...draft };
  Object.defineProperty(unsafe, 'source', { enumerable: true, get: getter });
  expect(precisePlanDraftSourceMatch(unsafe, source())).toBe('mismatch');
  expect(precisePlanDraftSourceMatch({ ...draft, scopeKey: 'invalid' }, source())).toBe('mismatch');
  expect(getter).not.toHaveBeenCalled();
});

it('does not renew expiry on read or when explicitly rebinding the same recovered input', () => {
  const first = saved(), set = vi.spyOn(methods(), 'setItem');
  expect(readPrecisePlanDraft(scope, NOW + PRECISE_PLAN_DRAFT_TTL_MS - 1).draft).toEqual(first);
  expect(set).not.toHaveBeenCalled();
  const now = NOW + 10_000;
  const result = savePrecisePlanDraft(scope, source(events(), 'fresh'), edit, active, now, { expected: first, savedAt: first.savedAt });
  expect(result).toMatchObject({ ok: true, draft: { savedAt: NOW } });
  expect(result.draft!.source.key).not.toBe(first.source.key);
  expect(result.draft!.id).not.toBe(first.id);
  expect(readPrecisePlanDraft(scope, NOW + PRECISE_PLAN_DRAFT_TTL_MS)).toMatchObject({ status: 'expired', draft: null });
  expect(sessionStorage.length).toBe(0);
});

it.each([-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY, NOW + 1, NOW - PRECISE_PLAN_DRAFT_TTL_MS])(
  'rejects invalid, future or expired preserved savedAt %s without replacing the draft', savedAt => {
    const before = saved();
    expect(savePrecisePlanDraft(scope, source(), edit, active, NOW, { expected: before, savedAt }))
      .toMatchObject({ ok: false, draft: null });
    expect(readPrecisePlanDraft(scope, NOW).draft).toEqual(before);
  },
);

it.each([
  ['future timestamp', (draft: PrecisePlanDraft) => ({ ...draft, savedAt: NOW + 1 })],
  ['unknown metadata', (draft: PrecisePlanDraft) => ({ ...draft, token: 'PRIVATE_TOKEN' })],
  ['wrong scope hash', (draft: PrecisePlanDraft) => ({ ...draft, scopeKey: 'b'.repeat(64) })],
  ['duplicate indices', (draft: PrecisePlanDraft) => ({ ...draft, edits: [draft.edits[0], draft.edits[0]] })],
  ['all-day selection', (draft: PrecisePlanDraft) => ({ ...draft, selectedIndex: 2 })],
  ['unknown version', (draft: PrecisePlanDraft) => ({ ...draft, version: 2 })],
])('never exposes %s stored input and removes the invalid record', (_label, patch) => {
  const before = saved();
  replaceStored(patch(before));
  expect(readPrecisePlanDraft(scope, NOW)).toMatchObject({ status: 'invalid', draft: null });
  expect(sessionStorage.length).toBe(0);
});

it.each(['{invalid JSON', 'x'.repeat(PRECISE_PLAN_DRAFT_MAX_BYTES + 1), JSON.stringify('界'.repeat(6000))])(
  'limits both JSON size and UTF-8 byte size and hides corrupt input', raw => {
    saved();
    sessionStorage.setItem(onlyKey(), raw);
    expect(readPrecisePlanDraft(scope, NOW)).toMatchObject({ status: 'invalid', draft: null });
    expect(sessionStorage.length).toBe(0);
  },
);

it('does not expose expired or invalid text even when removal is denied', () => {
  saved();
  vi.spyOn(methods(), 'removeItem').mockImplementation(() => { throw new Error('PRIVATE_STORAGE_ERROR'); });
  expect(readPrecisePlanDraft(scope, NOW + PRECISE_PLAN_DRAFT_TTL_MS)).toMatchObject({
    draft: null, status: 'expired', message: expect.stringContaining('尚未確認清除'),
  });
  expect(sessionStorage.length).toBe(1);
});

it.each([
  ['edited text', (draft: PrecisePlanDraft) => ({ ...draft, edits: [{ ...draft.edits[0], date: '2031-' }] })],
  ['selection', (draft: PrecisePlanDraft) => ({ ...draft, selectedIndex: 0 })],
  ['saved timestamp', (draft: PrecisePlanDraft) => ({ ...draft, savedAt: NOW - 1 })],
  ['source', (draft: PrecisePlanDraft) => ({ ...draft, source: source(events(), 'other') })],
])('rejects saving and clearing a same-ID draft whose %s changed after review', (_label, patch) => {
  const before = saved(), newer = patch(before);
  replaceStored(newer);
  expect(savePrecisePlanDraft(scope, source(), edit, active, NOW, { expected: before }))
    .toMatchObject({ ok: false, draft: null, message: expect.stringContaining('已有更新') });
  expect(clearPrecisePlanDraft(scope, active, { snapshot: before }))
    .toMatchObject({ ok: false, cleared: false, message: expect.stringContaining('已有更新') });
  expect(readPrecisePlanDraft(scope, NOW).draft).toEqual(newer);
});

it('requires actual emptiness for expected:null, while allowing an explicit cross-source replacement', () => {
  const initial = savePrecisePlanDraft(scope, source(), edit, active, NOW, { expected: null }).draft!;
  expect(initial).not.toBeNull();
  expect(savePrecisePlanDraft(scope, source(), edit, active, NOW, { expected: null }).ok).toBe(false);
  expect(clearPrecisePlanDraft(scope, active, { snapshot: null })).toMatchObject({ ok: false, cleared: false });
  const replacement = savePrecisePlanDraft(scope, source(events(), 'fresh'), edit, active, NOW + 1, { expected: initial });
  expect(replacement).toMatchObject({ ok: true, draft: { savedAt: NOW + 1 } });
  expect(replacement.draft!.source.key).not.toBe(initial.source.key);
  expect(clearPrecisePlanDraft(scope, active, { snapshot: replacement.draft })).toEqual({ ok: true, cleared: true });
  expect(clearPrecisePlanDraft(scope, active, { snapshot: null })).toEqual({ ok: true, cleared: false });
});

it('treats another source as a safe cleanup no-op before checking stale IDs or snapshots', () => {
  const older = saved(), newer = saved(source(events(), 'fresh'));
  expect(clearPrecisePlanDraft(scope, active, { sourceKey: older.source.key, id: older.id, snapshot: older }))
    .toEqual({ ok: true, cleared: false });
  expect(clearPrecisePlanDraft(scope, active, { sourceKey: older.source.key, snapshot: null }))
    .toEqual({ ok: true, cleared: false });
  expect(readPrecisePlanDraft(scope, NOW).draft).toEqual(newer);
  expect(clearPrecisePlanDraft(scope, active, { sourceKey: newer.source.key, id: older.id }).ok).toBe(false);
});

it('clears an empty edit only for the same source and still enforces the expected snapshot', () => {
  const first = saved(), empty = { selectedIndex: 0, edits: [] };
  expect(savePrecisePlanDraft(scope, source(), empty, active, NOW, { expected: null }).ok).toBe(false);
  expect(readPrecisePlanDraft(scope, NOW).draft).toEqual(first);
  expect(savePrecisePlanDraft(scope, source(events(), 'fresh'), empty, active, NOW, { expected: first }))
    .toEqual({ ok: true, draft: null });
  expect(readPrecisePlanDraft(scope, NOW).draft).toEqual(first);
  expect(savePrecisePlanDraft(scope, source(), empty, active, NOW, { expected: first })).toEqual({ ok: true, draft: null });
  expect(sessionStorage.length).toBe(0);
  expect(savePrecisePlanDraft(scope, source(), empty, active, NOW, { expected: null })).toEqual({ ok: true, draft: null });
  expect(sessionStorage.length).toBe(0);
});

it('validates expected and cleanup snapshots as data without evaluating getters or accepting unknown fields', () => {
  const before = saved(), getter = vi.fn(() => before), badOptions = {};
  Object.defineProperty(badOptions, 'expected', { enumerable: true, get: getter });
  expect(attempt(edit, source(), badOptions).ok).toBe(false);
  expect(attempt(edit, source(), { expected: before, token: 'PRIVATE' }).ok).toBe(false);
  const badMatch = {};
  Object.defineProperty(badMatch, 'snapshot', { enumerable: true, get: getter });
  expect(clearPrecisePlanDraft(scope, active, badMatch).ok).toBe(false);
  expect(getter).not.toHaveBeenCalled();
  expect(readPrecisePlanDraft(scope, NOW).draft).toEqual(before);
});

it('reports storage access and read failures without exposing private error text', () => {
  const get = vi.spyOn(methods(), 'getItem').mockImplementation(() => { throw new Error('PRIVATE_READ'); });
  expect(readPrecisePlanDraft(scope, NOW)).toMatchObject({ status: 'unavailable', draft: null });
  expect(savePrecisePlanDraft(scope, source(), edit, active, NOW).ok).toBe(false);
  expect(clearPrecisePlanDraft(scope, active).ok).toBe(false);
  expect(readPrecisePlanDraft(scope, NOW).message).not.toContain('PRIVATE');
  get.mockRestore();
  vi.spyOn(window, 'sessionStorage', 'get').mockImplementation(() => { throw new Error('PRIVATE_ACCESS'); });
  expect(readPrecisePlanDraft(scope, NOW)).toMatchObject({
    status: 'unavailable', draft: null, message: expect.stringContaining('無法存取'),
  });
});

it('does not claim a successful write or removal when storage throws or silently ignores it', () => {
  const first = saved();
  const set = vi.spyOn(methods(), 'setItem').mockImplementation(() => { throw new Error('quota'); });
  expect(savePrecisePlanDraft(scope, source(), edit, active, NOW, { expected: first }).ok).toBe(false);
  set.mockImplementation(() => {});
  expect(savePrecisePlanDraft(scope, source(), edit, active, NOW, { expected: first }))
    .toMatchObject({ ok: false, draft: null, message: expect.stringContaining('尚未確認儲存') });
  set.mockRestore();
  const remove = vi.spyOn(methods(), 'removeItem').mockImplementation(() => { throw new Error('denied'); });
  expect(clearPrecisePlanDraft(scope, active, { snapshot: first }).ok).toBe(false);
  remove.mockImplementation(() => {});
  expect(clearPrecisePlanDraft(scope, active, { snapshot: first }))
    .toMatchObject({ ok: false, cleared: false, message: expect.stringContaining('尚未確認清除') });
  expect(readPrecisePlanDraft(scope, NOW).draft).toEqual(first);
});

it('requires an active scope before mutations, including scope changes during a read', () => {
  const before = saved();
  expect(savePrecisePlanDraft(scope, source(), edit, () => false, NOW).ok).toBe(false);
  expect(clearPrecisePlanDraft(scope, () => false).ok).toBe(false);
  let current = true;
  const originalGet = sessionStorage.getItem.bind(sessionStorage);
  const get = vi.spyOn(methods(), 'getItem').mockImplementation(key => { current = false; return originalGet(key); });
  const set = vi.spyOn(methods(), 'setItem'), remove = vi.spyOn(methods(), 'removeItem');
  expect(savePrecisePlanDraft(scope, source(), edit, () => current, NOW, { expected: before }).ok).toBe(false);
  current = true;
  expect(clearPrecisePlanDraft(scope, () => current, { snapshot: before }).ok).toBe(false);
  expect(set).not.toHaveBeenCalled();
  expect(remove).not.toHaveBeenCalled();
  get.mockRestore();
  expect(readPrecisePlanDraft(scope, NOW).draft).toEqual(before);
});

it('does not report success if the active scope changes during the mutation', () => {
  let current = true;
  const originalSet = sessionStorage.setItem.bind(sessionStorage);
  const set = vi.spyOn(methods(), 'setItem').mockImplementation((key, value) => { originalSet(key, value); current = false; });
  expect(savePrecisePlanDraft(scope, source(), edit, () => current, NOW))
    .toMatchObject({ ok: false, draft: null, message: expect.stringContaining('已切換') });
  set.mockRestore();
  current = true;
  const originalRemove = sessionStorage.removeItem.bind(sessionStorage);
  vi.spyOn(methods(), 'removeItem').mockImplementation(key => { originalRemove(key); current = false; });
  expect(clearPrecisePlanDraft(scope, () => current))
    .toMatchObject({ ok: false, cleared: false, message: expect.stringContaining('已切換') });
});

it.each(['save', 'clear', 'empty edit'] as const)(
  'preserves a replacement installed between storage reads during %s', operation => {
    const first = saved(), key = onlyKey();
    const originalGet = sessionStorage.getItem.bind(sessionStorage), originalSet = sessionStorage.setItem.bind(sessionStorage);
    const newer = JSON.stringify({ ...first, edits: [{ ...first.edits[0], date: '2031-' }] });
    let reads = 0;
    vi.spyOn(methods(), 'getItem').mockImplementation(name => {
      if (++reads === 2) originalSet(name, newer);
      return originalGet(name);
    });
    const result = operation === 'clear' ? clearPrecisePlanDraft(scope, active, { snapshot: first })
      : savePrecisePlanDraft(scope, source(), operation === 'empty edit' ? { selectedIndex: 0, edits: [] } : edit,
        active, NOW, { expected: first });
    expect(result).toMatchObject({ ok: false, message: expect.stringContaining('已有更新') });
    expect(originalGet(key)).toBe(newer);
  },
);

it('does not report persistence or cleanup success when verification reads fail', () => {
  const originalGet = sessionStorage.getItem.bind(sessionStorage);
  let reads = 0;
  const get = vi.spyOn(methods(), 'getItem').mockImplementation(key => {
    if (++reads === 3) throw new Error('PRIVATE_VERIFY');
    return originalGet(key);
  });
  expect(savePrecisePlanDraft(scope, source(), edit, active, NOW))
    .toMatchObject({ ok: false, draft: null, message: expect.stringContaining('無法讀取') });
  get.mockRestore();
  const before = readPrecisePlanDraft(scope, NOW).draft!;
  reads = 0;
  vi.spyOn(methods(), 'getItem').mockImplementation(key => {
    if (++reads === 3) throw new Error('PRIVATE_VERIFY');
    return originalGet(key);
  });
  expect(clearPrecisePlanDraft(scope, active, { snapshot: before }))
    .toMatchObject({ ok: false, cleared: false, message: expect.stringContaining('無法讀取') });
});
