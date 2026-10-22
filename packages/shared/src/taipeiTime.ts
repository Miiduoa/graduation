export const TAIPEI_TIME_ZONE = 'Asia/Taipei';
const TAIPEI_OFFSET_MS = 8 * 60 * 60 * 1000;

export type TaipeiParts = {
  year: number;
  month: number;
  day: number;
  hour24: number;
  hour12: number;
  minute: number;
  second: number;
  period: '上午' | '下午';
};

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

export function taipeiParts(value: string | number | Date): TaipeiParts | null {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  const shifted = new Date(date.getTime() + TAIPEI_OFFSET_MS);
  const hour24 = shifted.getUTCHours();
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour24,
    hour12: hour24 % 12 === 0 ? 12 : hour24 % 12,
    minute: shifted.getUTCMinutes(),
    second: shifted.getUTCSeconds(),
    period: hour24 < 12 ? '上午' : '下午',
  };
}

export function formatTaipeiDateTime(
  value: string | number | Date,
  options?: { seconds?: boolean },
): string {
  const parts = taipeiParts(value);
  if (!parts) return '';
  const time = `${parts.period}${parts.hour12}:${pad(parts.minute)}`;
  const clock = options?.seconds === false ? time : `${time}:${pad(parts.second)}`;
  return `${parts.year}/${parts.month}/${parts.day} ${clock}`;
}

export function taipeiWallTimeToIso(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (
    /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(
      trimmed,
    )
  ) {
    return trimmed;
  }
  const match = /^(\d{4}-\d{2}-\d{2})T([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/.exec(trimmed);
  if (!match) return null;
  return `${match[1]}T${match[2]}:${match[3]}:${match[4] ?? '00'}+08:00`;
}
