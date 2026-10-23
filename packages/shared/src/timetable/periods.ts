import {
  periodCount,
  periodTimes,
  type PeriodProfileId,
} from './schoolPeriods';

export {
  MAX_PERIOD_SLOTS,
  PERIOD_PROFILES,
  PERIOD_PROFILE_IDS,
  PERIOD_PROFILE_SOURCES,
  PERIOD_PROFILE_TITLES,
  isPeriodProfileId,
  mapClockToPeriodSlots,
  parsePeriodRange,
  periodCount,
  periodDisplayLabel,
  periodLabelAt,
  periodProfileForSchool,
  periodSlots,
  periodTimes,
  slotIndexForLabel,
  type PeriodProfileId,
  type SchoolPeriodSlot,
} from './schoolPeriods';

/** 靜宜大學第 1–13 節。未指定學校時，個人課表與截圖匯入仍用這張表。 */

export const WEEKDAYS = ['一', '二', '三', '四', '五'] as const;
export const WEEKDAY_LABELS = ['星期一', '星期二', '星期三', '星期四', '星期五'] as const;

export const PERIOD_TIMES: ReadonlyArray<readonly [string, string]> = periodTimes('pu');

export const PERIOD_COUNT = periodCount('pu');

export function periodStart(period: number, profile: PeriodProfileId = 'pu'): string {
  return periodTimes(profile)[period - 1]?.[0] ?? '';
}

export function periodEnd(period: number, profile: PeriodProfileId = 'pu'): string {
  return periodTimes(profile)[period - 1]?.[1] ?? '';
}

export function periodRangeLabel(
  start: number,
  end: number,
  profile: PeriodProfileId = 'pu',
): string {
  if (!start || !end) return '時間待定';
  return `${periodStart(start, profile)}–${periodEnd(end, profile)}`;
}

export function weekdayLabel(day: number): string {
  return WEEKDAY_LABELS[day - 1] ?? '未排定';
}

export function timeToMinutes(value: string): number {
  const [hours, minutes] = String(value || '0:0')
    .split(':')
    .map(Number);
  return (hours || 0) * 60 + (minutes || 0);
}
