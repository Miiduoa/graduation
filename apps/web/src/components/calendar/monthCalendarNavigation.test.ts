import { describe, expect, it } from 'vitest';
import { monthCalendarKeyboardDate } from './monthCalendarNavigation';

describe('月格鍵盤日期移動', () => {
  it.each([
    ['2028-01-31', 'PageDown', '2028-02-29'],
    ['2027-01-31', 'PageDown', '2027-02-28'],
    ['2028-03-31', 'PageUp', '2028-02-29'],
    ['2028-01-31', 'PageUp', '2027-12-31'],
    ['2027-12-01', 'PageDown', '2028-01-01'],
    ['2028-01-01', 'ArrowLeft', '2027-12-31'],
    ['2027-12-31', 'ArrowRight', '2028-01-01'],
    ['2028-03-03', 'ArrowUp', '2028-02-25'],
    ['2028-02-25', 'ArrowDown', '2028-03-03'],
    ['2028-01-01', 'Home', '2027-12-26'],
    ['2027-12-31', 'End', '2028-01-01'],
    ['2028-01-02', 'Home', '2028-01-02'],
  ])('%s 按 %s 到 %s', (date, key, expected) => {
    expect(monthCalendarKeyboardDate(date, key)).toBe(expected);
  });

  it('非法日期、一般按鍵與有效日期範圍外皆不移動', () => {
    expect(monthCalendarKeyboardDate('2027-02-29', 'PageDown')).toBeNull();
    expect(monthCalendarKeyboardDate('2028-01-02', 'Enter')).toBeNull();
    expect(monthCalendarKeyboardDate('2028-01-02', 'Tab')).toBeNull();
    expect(monthCalendarKeyboardDate('1900-01-01', 'ArrowLeft')).toBeNull();
    expect(monthCalendarKeyboardDate('2200-12-31', 'ArrowRight')).toBeNull();
  });
});
