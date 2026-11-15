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
export function clubEventInput(values: Record<string, string>) {
  return Object.fromEntries(
    Object.entries(values).map(([key, value]) => [
      key,
      key === 'capacity'
        ? Number(value)
        : ['startsAt', 'endsAt', 'registrationDeadline', 'cancellationDeadline'].includes(key)
          ? new Date(value).getTime()
          : value,
    ]),
  );
}
