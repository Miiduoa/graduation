import {
  isLostFoundDateOnly,
  lostFoundDateFieldValue,
  normalizeLostFoundDateInput,
  taiwanCalendarDay,
} from '../../data/lostFoundDates';

test('taiwanCalendarDay uses Asia/Taipei calendar day', () => {
  // 2026-10-08 16:30 UTC → already 2026-10-09 in Taiwan.
  expect(taiwanCalendarDay(new Date('2026-10-08T16:30:00.000Z'))).toBe('2026-10-09');
  expect(taiwanCalendarDay(new Date('2026-10-08T01:00:00.000Z'))).toBe('2026-10-08');
});

test('date-only validation rejects impossible days and does not invent 08:00', () => {
  expect(isLostFoundDateOnly('2026-02-28')).toBe(true);
  expect(isLostFoundDateOnly('2026-02-30')).toBe(false);
  expect(isLostFoundDateOnly('2026-10-08T08:00:00+08:00')).toBe(false);
  expect(normalizeLostFoundDateInput('2026-10-08')).toBe('2026-10-08');
  expect(() => normalizeLostFoundDateInput('2026-02-30')).toThrow('有效日期');
});

test('form field display keeps YYYY-MM-DD and maps instants through Taiwan day', () => {
  expect(lostFoundDateFieldValue('2026-10-08')).toBe('2026-10-08');
  expect(lostFoundDateFieldValue('2026-10-08T16:30:00.000Z')).toBe('2026-10-09');
});
