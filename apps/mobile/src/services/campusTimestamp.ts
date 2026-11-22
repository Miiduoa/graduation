// Date.parse accepts impossible dates such as February 30 and silently rolls
// them into March. A restored source timestamp must preserve the exact local
// calendar fields even when the producer used an explicit UTC offset.
export function isRealTimestamp(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|([+-])(\d{2}):(\d{2}))$/.exec(value);
  if (!match) return false;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return false;
  const hours = Number(match[10] || 0);
  const minutes = Number(match[11] || 0);
  if (hours > 14 || minutes > 59 || (hours === 14 && minutes !== 0)) return false;
  const offsetMinutes = match[8] === 'Z' ? 0 : (match[9] === '+' ? 1 : -1) * (hours * 60 + minutes);
  const sourceClock = new Date(parsed + offsetMinutes * 60_000);
  return sourceClock.getUTCFullYear() === Number(match[1]) &&
    sourceClock.getUTCMonth() + 1 === Number(match[2]) &&
    sourceClock.getUTCDate() === Number(match[3]) &&
    sourceClock.getUTCHours() === Number(match[4]) &&
    sourceClock.getUTCMinutes() === Number(match[5]) &&
    sourceClock.getUTCSeconds() === Number(match[6]) &&
    sourceClock.getUTCMilliseconds() === Number((match[7] || '').padEnd(3, '0') || 0);
}

