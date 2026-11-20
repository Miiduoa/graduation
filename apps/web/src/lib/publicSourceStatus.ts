function taipeiCalendarDate(ms: number): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(ms));
}

export function publicSourceStatus(value?: string | null, expired = false, now = Date.now()) {
  if (!value?.trim())
    return { date: '未提供', message: '沒有最後確認時間，請到官方入口確認目前資訊。' };
  // 僅接受完整日期或含時區的時間，避免無效日期被自動進位。
  const match =
    /^(\d{4})-(\d{2})-(\d{2})(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}))?$/.exec(value);
  const dateOnly = Boolean(match && !value.includes('T'));
  const calendarDay = match ? `${match[1]}-${match[2]}-${match[3]}` : '';
  const calendar = match ? new Date(`${calendarDay}T00:00:00Z`) : null;
  const stamp = dateOnly ? Number.NaN : Date.parse(value);
  // 只有日期的快照以 Asia/Taipei 日曆日比較，避免 Date.parse 當 UTC 午夜後
  // 在台灣 0–8 點把當天誤判成未來。
  const isFuture = dateOnly
    ? calendarDay > taipeiCalendarDate(now)
    : !Number.isFinite(stamp) || stamp > now;
  if (
    !match ||
    !calendar ||
    !Number.isFinite(calendar.getTime()) ||
    calendar.toISOString().slice(0, 10) !== calendarDay ||
    isFuture
  ) {
    return {
      date: '未提供（日期無法確認）',
      message: '日期無法確認，請到官方入口查核；不代表資料剛更新。',
    };
  }
  return {
    date: dateOnly
      ? `${match[1]}/${match[2]}/${match[3]}`
      : new Intl.DateTimeFormat('zh-TW', {
          timeZone: 'Asia/Taipei',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
        }).format(new Date(stamp)),
    message: expired
      ? '資料已超過更新提醒期限，請先向官方確認。'
      : '這是資料快照，實際內容仍以官方最新資訊為準。',
  };
}

export function publicSourceUrl(value?: string | null): string | null {
  try {
    const url = new URL(value ?? '');
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password
      ? value!
      : null;
  } catch {
    return null;
  }
}
