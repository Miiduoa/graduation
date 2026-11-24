import { beforeEach, expect, it, vi } from 'vitest';
import {
  readAssistantExecutionJournal,
  removeAssistantExecutionJournal,
  saveAssistantExecutionJournal,
  type AssistantExecutionJournalScope,
} from './assistantExecutionJournal';

const scope: AssistantExecutionJournalScope = { owner: 'platform:account_one', schoolId: 'pu', context: 'A'.repeat(43) };
const active = () => true;
const event = { title: '資料庫複習', date: '2026-11-10', allDay: false, startTime: '20:00', endTime: '21:00' };
function input(id = 'av2_1234567890abcdef1234567890abcdef') {
  return { conversationId: 'conversation_one', card: {
    tool: 'propose_personal_event', token: 'signed_body.signature', args: { ...event },
    mutationId: id, schoolId: 'pu', destination: '個人行事曆（無推播提醒）',
  } };
}
function methods(): Storage {
  return Object.hasOwn(sessionStorage, 'setItem') ? sessionStorage : Object.getPrototypeOf(sessionStorage);
}
function storedKey() {
  expect(sessionStorage.length).toBe(1);
  return sessionStorage.key(0)!;
}
function snapshot() {
  return sessionStorage.getItem(storedKey());
}
beforeEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  sessionStorage.clear();
  localStorage.clear();
});

it('keeps an exact calendar recovery card across a fresh module load, without unrelated data', async () => {
  saveAssistantExecutionJournal(scope, input(), active);
  const expected = readAssistantExecutionJournal(scope);
  expect(expected).toEqual([{ ...input(), savedAt: expect.any(String) }]);
  expect(new Date(expected[0].savedAt).toISOString()).toBe(expected[0].savedAt);
  vi.resetModules();
  const reloaded = await import('./assistantExecutionJournal');
  expect(reloaded.readAssistantExecutionJournal(scope)).toEqual(expected);
  expect(localStorage.length).toBe(0);
  expect(snapshot()).not.toMatch(/history|question|sessionHandle|consent|grade|rawText/);
});

it.each([true, false])('retains coursework=%s across storage and a fresh module load', async (coursework) => {
  const value = input();
  const hinted = { ...value, card: { ...value.card, coursework } };
  saveAssistantExecutionJournal(scope, hinted, active);
  const stored = snapshot();
  expect(JSON.parse(stored!).entries[0].card).toHaveProperty('coursework', coursework);
  const expected = [{ ...hinted, savedAt: expect.any(String) }];
  expect(readAssistantExecutionJournal(scope)).toEqual(expected);
  vi.resetModules();
  const reloaded = await import('./assistantExecutionJournal');
  expect(reloaded.readAssistantExecutionJournal(scope)).toEqual(expected);
  reloaded.saveAssistantExecutionJournal(scope, hinted, active);
  expect(snapshot()).toBe(stored);
});

it('keeps legacy cards without a coursework hint distinct from explicit true and false cards', () => {
  saveAssistantExecutionJournal(scope, input('av2_legacy_event'), active);
  for (const coursework of [true, false]) {
    const value = input('av2_coursework_' + coursework);
    saveAssistantExecutionJournal(scope, { ...value, card: { ...value.card, coursework } }, active);
  }
  const entries = readAssistantExecutionJournal(scope);
  expect(entries).toHaveLength(3);
  expect(entries[0].card).not.toHaveProperty('coursework');
  expect(entries[1].card).toHaveProperty('coursework', true);
  expect(entries[2].card).toHaveProperty('coursework', false);
  expect(JSON.parse(snapshot()!).entries[0].card).not.toHaveProperty('coursework');
  const before = snapshot();
  saveAssistantExecutionJournal(scope, input('av2_legacy_event'), active);
  expect(snapshot()).toBe(before);
});

it.each([true, false])('does not change or erase coursework=%s for an existing mutation', (coursework) => {
  const value = input();
  saveAssistantExecutionJournal(scope, { ...value, card: { ...value.card, coursework } }, active);
  const before = snapshot();
  for (const card of [{ ...value.card, coursework: !coursework }, value.card]) {
    expect(() => saveAssistantExecutionJournal(scope, { ...value, card }, active)).toThrow('不同確認內容');
    expect(snapshot()).toBe(before);
  }
});

it.each([null, 'true', 'false', 0, 1, {}, []].map(coursework => ({ coursework })))(
  'rejects malformed coursework=$coursework without erasing recovery evidence', ({ coursework }) => {
    saveAssistantExecutionJournal(scope, input(), active);
    const key = storedKey(), before = snapshot();
    const value = input('av2_malformed_event');
    expect(() => saveAssistantExecutionJournal(scope, {
      ...value, card: { ...value.card, coursework },
    }, active)).toThrow();
    expect(snapshot()).toBe(before);

    const corrupt = JSON.parse(before!);
    corrupt.entries[0].card.coursework = coursework;
    const encoded = JSON.stringify(corrupt);
    sessionStorage.setItem(key, encoded);
    expect(() => readAssistantExecutionJournal(scope)).toThrow();
    expect(() => saveAssistantExecutionJournal(scope, value, active)).toThrow();
    expect(() => removeAssistantExecutionJournal(scope, input().card.mutationId, active)).toThrow();
    expect(sessionStorage.getItem(key)).toBe(encoded);
  },
);

it('rejects undefined and accessor coursework hints without invoking a getter', () => {
  const value = input();
  const getter = vi.fn(() => true);
  expect(() => saveAssistantExecutionJournal(scope, {
    ...value, card: { ...value.card, coursework: undefined },
  }, active)).toThrow();
  expect(() => saveAssistantExecutionJournal(scope, {
    ...value, card: Object.defineProperty({ ...value.card }, 'coursework', { enumerable: true, get: getter }),
  }, active)).toThrow();
  expect(getter).not.toHaveBeenCalled();
  expect(sessionStorage.length).toBe(0);
});

it('returns detached copies and keeps exact duplicate saves byte-for-byte unchanged', () => {
  const value = input();
  saveAssistantExecutionJournal(scope, value, active);
  const before = snapshot();
  value.card.args.title = 'caller edit';
  const read = readAssistantExecutionJournal(scope);
  read[0].card.args.title = 'consumer edit';
  read[0].conversationId = 'different';
  expect(readAssistantExecutionJournal(scope)[0].card.args.title).toBe(event.title);
  saveAssistantExecutionJournal(scope, input(), active);
  expect(snapshot()).toBe(before);
});

it.each(['token', 'args', 'conversationId', 'destination'] as const)('does not replace the same mutation when %s differs', (field) => {
  saveAssistantExecutionJournal(scope, input(), active);
  const before = snapshot(), next = input();
  if (field === 'token') next.card.token = 'different.signature';
  if (field === 'args') next.card.args.title = '不同內容';
  if (field === 'conversationId') next.conversationId = 'different_conversation';
  if (field === 'destination') next.card.destination = '其他目的地';
  expect(() => saveAssistantExecutionJournal(scope, next, active)).toThrow('原有紀錄');
  expect(snapshot()).toBe(before);
});

it('accepts matching UI conversation metadata without persisting it twice', () => {
  const value = input();
  saveAssistantExecutionJournal(scope, { ...value, card: { ...value.card, conversationId: value.conversationId } }, active);
  expect(readAssistantExecutionJournal(scope)[0].card).not.toHaveProperty('conversationId');
  const before = snapshot();
  expect(() => saveAssistantExecutionJournal(scope, { ...value, card: { ...value.card, conversationId: 'different' } }, active)).toThrow();
  expect(snapshot()).toBe(before);
});

it.each([undefined, false])('retains source-bound pickup policy with coursework=%s and rejects unknown policies', (coursework) => {
  const value = input();
  const card = coursework === undefined ? value.card : { ...value.card, coursework };
  const pickup = { ...value, card: { ...card, sourceBound: 'food-pickup' } };
  saveAssistantExecutionJournal(scope, pickup, active);
  expect(readAssistantExecutionJournal(scope)[0].card).toMatchObject({
    ...card, sourceBound: 'food-pickup',
  });
  const before = snapshot();
  expect(() => saveAssistantExecutionJournal(scope, { ...value,
    card: { ...card, sourceBound: 'unverified-order' } }, active)).toThrow();
  expect(() => saveAssistantExecutionJournal(scope, { ...value, card }, active)).toThrow('不同確認內容');
  expect(snapshot()).toBe(before);
});

it('reads only the exact owner, school and session key and never enumerates other scopes', () => {
  saveAssistantExecutionJournal(scope, input(), active);
  const oldKey = storedKey();
  const enumerate = vi.spyOn(methods(), 'key');
  const read = vi.spyOn(methods(), 'getItem');
  for (const changed of [
    { ...scope, owner: 'platform:account_two' },
    { ...scope, schoolId: 'ntu' },
    { ...scope, context: 'B'.repeat(43) },
  ]) expect(readAssistantExecutionJournal(changed)).toEqual([]);
  expect(read).toHaveBeenCalledTimes(3);
  expect(read.mock.calls.every(([key]) => key !== oldKey)).toBe(true);
  expect(enumerate).not.toHaveBeenCalled();
  expect(readAssistantExecutionJournal(scope)).toHaveLength(1);
});

it('rejects a journal copied into another account or session namespace', () => {
  saveAssistantExecutionJournal(scope, input(), active);
  const original = snapshot();
  const changed = { ...scope, owner: 'platform:account_two' };
  const get = vi.spyOn(methods(), 'getItem');
  readAssistantExecutionJournal(changed);
  const otherKey = get.mock.calls.at(-1)![0];
  get.mockRestore();
  sessionStorage.setItem(otherKey, original!);
  expect(() => readAssistantExecutionJournal(changed)).toThrow();
  expect(readAssistantExecutionJournal(scope)).toHaveLength(1);
  expect(sessionStorage.getItem(otherKey)).toBe(original);
});

it.each([
  { ...scope, owner: 'school:account_one' },
  { ...scope, owner: 'platform:' },
  { ...scope, owner: 'platform:one:two' },
  { ...scope, context: 'ps_' + 'x'.repeat(43) },
  { ...scope, context: 'short' },
  { ...scope, context: ' '.repeat(43) },
  { ...scope, schoolId: 'personal' },
  { ...scope, schoolId: '../pu' },
])('rejects an invalid scope before touching storage: %j', (invalid) => {
  const get = vi.spyOn(methods(), 'getItem'), set = vi.spyOn(methods(), 'setItem'), remove = vi.spyOn(methods(), 'removeItem');
  expect(() => readAssistantExecutionJournal(invalid)).toThrow();
  expect(() => saveAssistantExecutionJournal(invalid, input(), active)).toThrow();
  expect(() => removeAssistantExecutionJournal(invalid, input().card.mutationId, active)).toThrow();
  expect(get).not.toHaveBeenCalled(); expect(set).not.toHaveBeenCalled(); expect(remove).not.toHaveBeenCalled();
});

it.each([
  { tool: 'propose_food_order' }, { schoolId: 'ntu' }, { mutationId: 'short' },
  { mutationId: '../mutation' }, { token: '' }, { token: 'x'.repeat(2049) },
  { args: { ...event, grade: 'PRIVATE_GRADE' } }, { args: { ...event, date: '2026-02-30' } },
  { args: { ...event, endTime: '19:00' } }, { rawText: 'PRIVATE_SOURCE' }, { consent: true },
])('rejects non-calendar, invalid or extra card fields without changing saved work: %j', (patch) => {
  saveAssistantExecutionJournal(scope, input(), active);
  const before = snapshot();
  expect(() => saveAssistantExecutionJournal(scope, { ...input('av2_second_event'), card: { ...input('av2_second_event').card, ...patch } }, active)).toThrow();
  expect(snapshot()).toBe(before);
});

it('rejects extra input fields, invalid conversation IDs and accessors without invoking getters', () => {
  const getter = vi.fn(() => input().card);
  expect(() => saveAssistantExecutionJournal(scope, Object.defineProperty({ conversationId: 'valid' }, 'card', { enumerable: true, get: getter }) as never, active)).toThrow();
  expect(getter).not.toHaveBeenCalled();
  expect(() => saveAssistantExecutionJournal(scope, { ...input(), conversationId: '../other' }, active)).toThrow();
  expect(() => saveAssistantExecutionJournal(scope, { ...input(), history: [{ role: 'user', content: 'private' }] } as never, active)).toThrow();
  expect(sessionStorage.length).toBe(0);
});

it('preserves corrupt, unsupported and over-capacity stored documents during reads, saves and removals', () => {
  saveAssistantExecutionJournal(scope, input(), active);
  const key = storedKey(), valid = JSON.parse(snapshot()!);
  for (const corrupt of ['{broken', JSON.stringify({ ...valid, version: 2 }), JSON.stringify({ ...valid, history: [] }),
    JSON.stringify({ ...valid, entries: [...valid.entries, ...valid.entries] }), 'x'.repeat(65537)]) {
    sessionStorage.setItem(key, corrupt);
    expect(() => readAssistantExecutionJournal(scope)).toThrow();
    expect(() => saveAssistantExecutionJournal(scope, input('av2_second_event'), active)).toThrow();
    expect(() => removeAssistantExecutionJournal(scope, input().card.mutationId, active)).toThrow();
    expect(sessionStorage.getItem(key)).toBe(corrupt);
  }
});

it('caps unresolved entries at 16 and never drops older cards to make room', () => {
  for (let i = 0; i < 16; i++) saveAssistantExecutionJournal(scope, input('mutation_' + i), active);
  const before = snapshot();
  expect(readAssistantExecutionJournal(scope)).toHaveLength(16);
  expect(() => saveAssistantExecutionJournal(scope, input('mutation_17'), active)).toThrow('上限');
  expect(snapshot()).toBe(before);
  saveAssistantExecutionJournal(scope, input('mutation_0'), active);
  expect(snapshot()).toBe(before);
});

it('enforces the 64 KiB limit in UTF-8 bytes and keeps the last valid journal intact', () => {
  let saved = 0, rejected = false;
  for (let i = 0; i < 16; i++) {
    const value = input('large_mutation_' + i);
    const large = { ...value, card: { ...value.card, token: 'x'.repeat(2048),
      destination: '學'.repeat(300), args: { ...event, title: '學'.repeat(200), location: '學'.repeat(300) } } };
    const before = sessionStorage.length ? snapshot() : null;
    try { saveAssistantExecutionJournal(scope, large, active); saved++; }
    catch (error) {
      expect(String(error)).toContain('容量');
      expect(snapshot()).toBe(before);
      rejected = true;
      break;
    }
  }
  expect(rejected).toBe(true);
  expect(saved).toBeLessThan(16);
  expect(readAssistantExecutionJournal(scope)).toHaveLength(saved);
});

it('blocks confirmation when storage is unavailable, full or silently fails to save', () => {
  saveAssistantExecutionJournal(scope, input(), active);
  const before = snapshot();
  const set = vi.spyOn(methods(), 'setItem').mockImplementation(() => { throw new DOMException('full', 'QuotaExceededError'); });
  expect(() => saveAssistantExecutionJournal(scope, input('av2_second_event'), active)).toThrow();
  expect(snapshot()).toBe(before);
  set.mockImplementation(() => {});
  expect(() => saveAssistantExecutionJournal(scope, input('av2_second_event'), active)).toThrow();
  expect(snapshot()).toBe(before);
  set.mockRestore();
  const get = vi.spyOn(methods(), 'getItem').mockImplementation(() => { throw new Error('disabled'); });
  expect(() => readAssistantExecutionJournal(scope)).toThrow();
  expect(() => saveAssistantExecutionJournal(scope, input(), active)).toThrow();
  get.mockRestore();
  expect(snapshot()).toBe(before);
});

it('checks activity before every mutation and stops if scope changes while reading storage', () => {
  saveAssistantExecutionJournal(scope, input(), active);
  const before = snapshot();
  expect(() => saveAssistantExecutionJournal(scope, input('av2_second_event'), () => false)).toThrow('已切換');
  expect(() => removeAssistantExecutionJournal(scope, input().card.mutationId, () => false)).toThrow('已切換');
  let current = true;
  const original = sessionStorage.getItem.bind(sessionStorage);
  const get = vi.spyOn(methods(), 'getItem').mockImplementation((key) => { current = false; return original(key); });
  expect(() => saveAssistantExecutionJournal(scope, input('av2_second_event'), () => current)).toThrow('已切換');
  current = true;
  expect(() => removeAssistantExecutionJournal(scope, input().card.mutationId, () => current)).toThrow('已切換');
  get.mockRestore();
  expect(snapshot()).toBe(before);
});

it('removes only one exact mutation and preserves unrelated entries and scopes', () => {
  saveAssistantExecutionJournal(scope, input(), active);
  saveAssistantExecutionJournal(scope, input('av2_second_event'), active);
  const other = { ...scope, context: 'B'.repeat(43) };
  saveAssistantExecutionJournal(other, input(), active);
  const initial = readAssistantExecutionJournal(other);
  removeAssistantExecutionJournal(scope, input().card.mutationId, active);
  expect(readAssistantExecutionJournal(scope).map((item) => item.card.mutationId)).toEqual(['av2_second_event']);
  expect(readAssistantExecutionJournal(other)).toEqual(initial);
  removeAssistantExecutionJournal(scope, input().card.mutationId, active);
  expect(readAssistantExecutionJournal(scope)).toHaveLength(1);
  removeAssistantExecutionJournal(scope, 'av2_second_event', active);
  expect(readAssistantExecutionJournal(scope)).toEqual([]);
  expect(readAssistantExecutionJournal(other)).toEqual(initial);
});

it('keeps the pending card when removal fails rather than reporting a false cleanup', () => {
  saveAssistantExecutionJournal(scope, input(), active);
  const before = snapshot();
  const remove = vi.spyOn(methods(), 'removeItem').mockImplementation(() => {});
  expect(() => removeAssistantExecutionJournal(scope, input().card.mutationId, active)).toThrow();
  remove.mockRestore();
  expect(snapshot()).toBe(before);
});
