import { describe, expect, it } from 'vitest';
import {
  PERIOD_TIMES,
  mapClockToPeriodSlots,
  parsePeriodRange,
  periodCount,
  periodLabelAt,
  periodProfileForSchool,
  periodStart,
  periodTimes,
} from '@campus/shared';

describe('各校節次表', () => {
  it('靜宜第 1–13 節維持 08:10 起', () => {
    expect(periodProfileForSchool('pu')).toBe('pu');
    expect(periodProfileForSchool('tw-pu')).toBe('pu');
    expect(PERIOD_TIMES).toHaveLength(13);
    expect(periodStart(1)).toBe('08:10');
    expect(periodStart(13)).toBe('20:50');
  });

  it('成大用官方 0、1–9、N、A–D，不會把 0 當成未排課', () => {
    expect(periodProfileForSchool('ncku')).toBe('ncku');
    expect(periodCount('ncku')).toBe(15);
    expect(periodLabelAt(1, 'ncku')).toBe('0');
    expect(periodStart(1, 'ncku')).toBe('07:00');
    expect(parsePeriodRange('0', 'ncku')).toEqual({ start: 1, end: 1, text: '0' });
    expect(parsePeriodRange('1-2', 'ncku')).toMatchObject({ start: 2, end: 3 });
    expect(parsePeriodRange('N-5', 'ncku')).toMatchObject({ start: 6, end: 7 });
    expect(parsePeriodRange('A-D', 'ncku')).toMatchObject({ start: 12, end: 15 });
    expect(parsePeriodRange('[3][4]', 'ncku')).toMatchObject({ start: 4, end: 5 });
    expect(mapClockToPeriodSlots('08:00', '09:50', 'ncku')).toEqual({ start: 2, end: 3 });
    expect(mapClockToPeriodSlots('08:10', '10:00', 'ncku')).toEqual({});
  });

  it('北大晚上第 10 節從 18:30 起，不套用靜宜 18:05', () => {
    expect(periodProfileForSchool('ntpu')).toBe('ntpu');
    expect(periodCount('ntpu')).toBe(13);
    expect(periodTimes('ntpu')[9]).toEqual(['18:30', '19:20']);
    expect(periodTimes('ntpu')[12]).toEqual(['21:20', '22:10']);
    expect(parsePeriodRange('10-13', 'ntpu')).toMatchObject({ start: 10, end: 13 });
    expect(mapClockToPeriodSlots('18:30', '22:10', 'ntpu')).toEqual({ start: 10, end: 13 });
    expect(mapClockToPeriodSlots('18:05', '21:40', 'ntpu')).toEqual({});
  });

  it('未知學校不猜測節次表', () => {
    expect(periodProfileForSchool('ntu')).toBeUndefined();
    expect(periodProfileForSchool('')).toBeUndefined();
  });
});
