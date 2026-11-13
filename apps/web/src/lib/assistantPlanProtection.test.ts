import { describe, expect, it, vi } from 'vitest';
import { createPlanProtection, validatePlanProtection, type PlanProtection, type PlanProtectionEvent } from './assistantPlanProtection';

const event = (title = '微積分複習', startTime = '19:00', endTime = '19:30'): PlanProtectionEvent =>
  ({ title, date: '2030-11-12', allDay: false, startTime, endTime });
const a = () => event();
const b = () => event('英文閱讀', '20:00', '20:30');

describe('createPlanProtection', () => {
  it('copies exact reviewed fields, sorts unique indices and does not mutate input', () => {
    const original = [a(), b(), event('程式練習', '21:00', '21:30')];
    const indices = [2, 0];
    const plan = createPlanProtection(original, indices);
    expect(plan).toEqual({ originalEvents: original, protectedIndices: [0, 2] });
    expect(indices).toEqual([2, 0]);
    expect(Object.hasOwn(plan.originalEvents[0], 'endDate')).toBe(false);
    original[0].title = '後來改動';
    indices.push(1);
    expect(plan.originalEvents[0].title).toBe('微積分複習');
    expect(plan.protectedIndices).toEqual([0, 2]);
  });

  it('accepts no selection and the complete supported plan size', () => {
    const original = Array.from({ length: 16 }, (_, index) => event('項目' + index));
    expect(createPlanProtection(original, []).protectedIndices).toEqual([]);
    expect(createPlanProtection(original, original.map((_, index) => index)).protectedIndices).toHaveLength(16);
    expect(() => createPlanProtection([...original, event('第17項')], [])).toThrow(/原提議/);
  });

  it.each([undefined, null, [], {}, 'not-a-plan'])('rejects missing or empty original %j', original => {
    expect(() => createPlanProtection(original, [])).toThrow(/原提議/);
  });
  it.each([
    { value: undefined }, { value: null }, { value: {} }, { value: [0, 0] }, { value: [-1] },
    { value: [2] }, { value: [0.5] }, { value: ['0'] }, { value: [NaN] }, { value: [Infinity] },
  ])('rejects invalid indices $value before any request', ({ value }) => {
    expect(() => createPlanProtection([a(), b()], value)).toThrow(/保留項目不正確/);
  });

  it.each([
    { field: 'location', value: '圖書館' }, { field: 'token', value: 'private-token' },
    { field: 'source', value: { rawText: 'private-source' } }, { field: 'schoolId', value: 'private-school' },
    { field: 'endDate', value: undefined }, { field: 'endDate', value: null },
  ])('does not silently project away $field', ({ field, value }) => {
    expect(() => createPlanProtection([{ ...a(), [field]: value }], [0])).toThrow(/原提議/);
  });

  it('rejects getters, symbol fields, sparse arrays and invalid calendar content without invoking getters', () => {
    const getter = vi.fn(() => 'private-value');
    const row = a();
    Object.defineProperty(row, 'title', { enumerable: true, get: getter });
    expect(() => createPlanProtection([row], [0])).toThrow(/原提議/);
    const rows: unknown[] = [];
    Object.defineProperty(rows, '0', { get: getter });
    expect(() => createPlanProtection(rows, [0])).toThrow(/原提議/);
    expect(() => createPlanProtection(new Array(1), [])).toThrow(/原提議/);
    expect(() => createPlanProtection([{ ...a(), [Symbol('private')]: 'hidden' }], [0])).toThrow(/原提議/);
    expect(() => createPlanProtection([{ ...a(), date: '2030-02-30' }], [0])).toThrow(/原提議/);
    expect(getter).not.toHaveBeenCalled();
  });

  it('requires a complete exact-duplicate group without automatically expanding the selection', () => {
    const original = [a(), a(), b()];
    expect(() => createPlanProtection(original, [0])).toThrow('完全相同的行程需一起標記保留');
    expect(() => createPlanProtection(original, [1, 2])).toThrow('完全相同的行程需一起標記保留');
    expect(createPlanProtection(original, [1, 0]).protectedIndices).toEqual([0, 1]);
    expect(createPlanProtection(original, [2]).protectedIndices).toEqual([2]);
  });

  it('does not confuse same-name different-time rows with exact duplicate groups', () => {
    const original = [event('複習'), event('複習', '20:00', '20:30')];
    expect(createPlanProtection(original, [0]).protectedIndices).toEqual([0]);
  });
});

describe('validatePlanProtection', () => {
  it('allows a preserved row, unrelated edits/additions/removals and arbitrary order', () => {
    const plan = createPlanProtection([a(), b()], [0]);
    expect(validatePlanProtection(plan, [event('程式練習', '21:00', '21:30'), a()])).toEqual({ ok: true });
    expect(validatePlanProtection(plan, [a()])).toEqual({ ok: true });
    expect(validatePlanProtection(plan, [b(), a()])).toEqual({ ok: true });
  });

  it('does not enforce candidate protection when nothing is selected', () => {
    const plan = createPlanProtection([a()], []);
    expect(validatePlanProtection(plan, [])).toEqual({ ok: true });
    expect(validatePlanProtection(plan, null)).toEqual({ ok: true });
  });

  it.each([
    { field: 'title', value: '不同標題' }, { field: 'date', value: '2030-11-13' },
    { field: 'endDate', value: '2030-11-12' }, { field: 'startTime', value: '18:30' },
    { field: 'endTime', value: '20:00' },
  ])('rejects a change to the protected raw $field', ({ field, value }) => {
    const plan = createPlanProtection([a(), b()], [0]);
    expect(validatePlanProtection(plan, [{ ...a(), [field]: value }, b()])).toMatchObject({ ok: false });
  });

  it('rejects changed allDay or optional-field presence even when displayed timing is equivalent', () => {
    const timed = { ...a(), endDate: a().date };
    expect(validatePlanProtection(createPlanProtection([timed], [0]), [a()])).toMatchObject({ ok: false });
    const allDay: PlanProtectionEvent = { title: a().title, date: a().date, allDay: true };
    expect(validatePlanProtection(createPlanProtection([a()], [0]), [allDay])).toMatchObject({ ok: false });
    expect(validatePlanProtection(createPlanProtection([allDay], [0]), [{ ...allDay, endDate: '2030-11-13' }])).toMatchObject({ ok: false });
    const overnight = { ...a(), startTime: '23:30', endTime: '00:30', endDate: '2030-11-13' };
    expect(validatePlanProtection(createPlanProtection([overnight], [0]), [{ ...overnight, endDate: '2030-11-14' }])).toMatchObject({ ok: false });
  });

  it('requires exactly the original multiplicity for fully protected duplicate groups', () => {
    const plan = createPlanProtection([a(), a(), b()], [0, 1]);
    expect(validatePlanProtection(plan, [b(), a(), a()])).toEqual({ ok: true });
    expect(validatePlanProtection(plan, [a(), b()])).toMatchObject({ ok: false });
    expect(validatePlanProtection(plan, [a(), a(), a(), b()])).toMatchObject({ ok: false });
    expect(validatePlanProtection(createPlanProtection([a(), b()], [0]), [a(), b(), a()])).toMatchObject({ ok: false });
    expect(validatePlanProtection(plan, [])).toMatchObject({ ok: false });
  });

  it('consumes exact unprotected originals before detecting alias ambiguity', () => {
    const sameName = event(a().title, '20:00', '20:30');
    const sameSchedule = event('別的課目');
    const plan = createPlanProtection([a(), sameName, sameSchedule], [0]);
    expect(validatePlanProtection(plan, [sameSchedule, sameName, a()])).toEqual({ ok: true });
    expect(validatePlanProtection(plan, [a(), sameName, sameSchedule, sameName])).toMatchObject({ ok: false, message: expect.stringContaining('對應不明') });
  });

  it('rejects a moved same-name unprotected row rather than guessing its correspondence', () => {
    const sameName = event(a().title, '20:00', '20:30');
    const plan = createPlanProtection([a(), sameName], [0]);
    expect(validatePlanProtection(plan, [a(), event(a().title, '21:00', '21:30')])).toMatchObject({ ok: false, message: expect.stringContaining('對應不明') });
  });

  it('rejects extra renamed copies of a protected schedule and moved copies of its title', () => {
    const plan = createPlanProtection([a(), b()], [0]);
    expect(validatePlanProtection(plan, [a(), b(), event('新名稱')])).toMatchObject({ ok: false, message: expect.stringContaining('對應不明') });
    expect(validatePlanProtection(plan, [a(), b(), event(a().title, '21:00', '21:30')])).toMatchObject({ ok: false, message: expect.stringContaining('對應不明') });
  });

  it.each([
    { candidate: undefined }, { candidate: null }, { candidate: {} }, { candidate: [a(), {}] },
    { candidate: [{ ...a(), source: 'private' }] }, { candidate: [{ ...a(), location: 'private' }] },
    { candidate: [{ ...a(), token: 'private-token' }] }, { candidate: [{ ...a(), endDate: undefined }] },
    { candidate: Array.from({ length: 17 }, () => a()) },
  ])('rejects malformed candidate content as a whole without leaking metadata', ({ candidate }) => {
    const result = validatePlanProtection(createPlanProtection([a()], [0]), candidate);
    expect(result).toMatchObject({ ok: false });
    expect(JSON.stringify(result)).not.toContain('private');
  });

  it('rejects malformed or partially selected protection objects without throwing or reading getters', () => {
    expect(validatePlanProtection({ originalEvents: [a(), a()], protectedIndices: [0] }, [a(), a()])).toMatchObject({ ok: false });
    expect(validatePlanProtection(null as unknown as PlanProtection, [a()])).toMatchObject({ ok: false });
    const getter = vi.fn(() => [a()]);
    const plan = { protectedIndices: [0] };
    Object.defineProperty(plan, 'originalEvents', { enumerable: true, get: getter });
    expect(validatePlanProtection(plan as PlanProtection, [a()])).toMatchObject({ ok: false });
    expect(getter).not.toHaveBeenCalled();
  });

  it('leaves both snapshots unchanged across repeated validation', () => {
    const plan = createPlanProtection([a(), b()], [0]), candidate = [b(), a()];
    const before = JSON.stringify({ plan, candidate });
    expect(validatePlanProtection(plan, candidate)).toEqual({ ok: true });
    expect(validatePlanProtection(plan, candidate)).toEqual({ ok: true });
    expect(JSON.stringify({ plan, candidate })).toBe(before);
  });
});
