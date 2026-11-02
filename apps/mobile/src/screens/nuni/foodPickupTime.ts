import type { NuniFoodLocationSummary } from '@campus/shared/src/nuniFoodTypes';

const minuteMs = 60_000;
const taiwanTime = new Intl.DateTimeFormat('zh-TW', {
  timeZone: 'Asia/Taipei',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

function pickupInstant(value: string): number | null {
  if (!/(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

export function pickupTimeFromMinutes(value: string, now: number): string | null {
  if (!/^\d+$/.test(value) || !Number.isFinite(new Date(now).getTime())) return null;
  const minutes = Number(value);
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440) return null;
  const time = new Date(now + minutes * minuteMs);
  return Number.isFinite(time.getTime()) ? time.toISOString() : null;
}

export function formatPickupTime(value: string): string | null {
  const time = pickupInstant(value);
  if (time === null) return null;
  const parts = taiwanTime.formatToParts(time);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value;
  return `${part('year')}/${part('month')}/${part('day')} ${part('hour')}:${part('minute')}`;
}

export function pickupTimeGuidance(
  location: Pick<NuniFoodLocationSummary, 'state' | 'earliestPickupAt' | 'latestPickupAt'>,
  requestedPickupAt: string | null,
): { windowText: string; warning: string | null } {
  const earliest =
    location.earliestPickupAt === undefined ? null : pickupInstant(location.earliestPickupAt);
  const latest =
    location.latestPickupAt === undefined ? null : pickupInstant(location.latestPickupAt);
  const invalidWindow =
    (location.earliestPickupAt !== undefined && earliest === null) ||
    (location.latestPickupAt !== undefined && latest === null) ||
    (earliest !== null && latest !== null && earliest > latest);

  let windowText = '門市尚未提供取餐時間範圍，請確認餐點與金額，查看是否能接單。';
  if (invalidWindow) {
    windowText = '門市提供的取餐時間範圍無法確認。';
  } else if (earliest !== null && latest !== null) {
    windowText = `門市提供的取餐範圍：${formatPickupTime(location.earliestPickupAt!)} 至 ${formatPickupTime(location.latestPickupAt!)}（台灣時間）。`;
  } else if (earliest !== null) {
    windowText = `門市提供的最早取餐時間：${formatPickupTime(location.earliestPickupAt!)}（台灣時間）。`;
  } else if (latest !== null) {
    windowText = `門市提供的最晚取餐時間：${formatPickupTime(location.latestPickupAt!)}（台灣時間）。`;
  }

  if (location.state === 'closed') {
    return {
      windowText,
      warning: '門市目前已關店，請返回選擇其他門市，或稍後重新讀取餐點。',
    };
  }
  if (location.state === 'paused') {
    return {
      windowText,
      warning: '門市目前暫停接單，請稍後重新讀取餐點，或返回選擇其他門市。',
    };
  }
  if (invalidWindow) {
    return {
      windowText,
      warning: '請重新讀取餐點以更新取餐範圍；若仍無法確認，請返回選擇其他門市。',
    };
  }

  const requested = requestedPickupAt === null ? null : pickupInstant(requestedPickupAt);
  if (requested !== null && earliest !== null && requested < earliest) {
    return {
      windowText,
      warning: '選擇的時間早於門市提供的最早取餐時間，請增加分鐘數，或重新讀取餐點。',
    };
  }
  if (requested !== null && latest !== null && requested > latest) {
    return {
      windowText,
      warning: '選擇的時間晚於門市提供的最晚取餐時間，請減少分鐘數，或返回選擇其他門市。',
    };
  }
  return { windowText, warning: null };
}
