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

const HAS_EXPLICIT_OFFSET = /(?:Z|[+-]\d{2}:\d{2})$/i;
const NAIVE_WALL =
  /^(\d{4}-\d{2}-\d{2})(?:[T ]([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d)(?:\.(\d{1,9}))?)?)?$/;

export function parseTaipeiInstant(value: string | number | Date): number | null {
  if (value instanceof Date) {
    const time = value.getTime();
    return Number.isFinite(time) ? time : null;
  }
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (HAS_EXPLICIT_OFFSET.test(trimmed)) {
    const time = Date.parse(trimmed);
    return Number.isFinite(time) ? time : null;
  }
  const naive = NAIVE_WALL.exec(trimmed.replace(' ', 'T'));
  if (naive) {
    const hour = naive[2] ?? '00';
    const minute = naive[3] ?? '00';
    const second = naive[4] ?? '00';
    const fraction = naive[5] ? `.${naive[5]}` : '';
    const time = Date.parse(`${naive[1]}T${hour}:${minute}:${second}${fraction}+08:00`);
    return Number.isFinite(time) ? time : null;
  }
  const time = Date.parse(trimmed);
  return Number.isFinite(time) ? time : null;
}

export function taipeiParts(value: string | number | Date): TaipeiParts | null {
  const time = parseTaipeiInstant(value);
  if (time === null) return null;
  const shifted = new Date(time + TAIPEI_OFFSET_MS);
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
