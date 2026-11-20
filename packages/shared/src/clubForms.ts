export const clubProfileFields = [
  ['name', '社名'],
  ['description', '介紹'],
  ['meetingTime', '社課時間'],
  ['instagram', 'IG 外連（https://www.instagram.com/…）'],
  ['line', 'LINE 外連（https://line.me/…）'],
] as const;
export const clubEventFields = [
  ['title', '活動名稱'],
  ['location', '地點'],
  ['startsAt', '開始時間'],
  ['endsAt', '結束時間'],
  ['capacity', '名額'],
  ['registrationDeadline', '報名截止'],
  ['cancellationDeadline', '取消截止'],
] as const;
function parseEventTime(value: string): number {
  const parts = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/.exec(value);
  if (!parts) throw new RangeError('活動日期時間無效');

  const [, year, month, day, hour, minute, second, offset] = parts;
  const y = Number(year);
  const m = Number(month);
  const d = Number(day);
  const leapYear = y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (
    m < 1 || m > 12 || d < 1 || d > daysInMonth[m - 1] ||
    Number(hour ?? 0) > 23 || Number(minute ?? 0) > 59 || Number(second ?? 0) > 59
  ) throw new RangeError('活動日期時間無效');

  // Taiwan event wall times use UTC+08:00, independent of the device timezone.
  const timestamp = Date.parse(offset ? value : `${value}${hour ? '' : 'T00:00:00'}+08:00`);
  if (!Number.isFinite(timestamp)) throw new RangeError('活動日期時間無效');
  return timestamp;
}

export function clubEventInput(values: Record<string, string>) {
  return Object.fromEntries(
    Object.entries(values).map(([key, value]) => [
      key,
      key === 'capacity'
        ? Number(value)
        : ['startsAt', 'endsAt', 'registrationDeadline', 'cancellationDeadline'].includes(key)
          ? parseEventTime(value)
          : value,
    ]),
  );
}
