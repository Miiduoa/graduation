/**
 * 同伴 feature signal 節流 — 避免 Map／Bus 每次聚焦或連發 Chat 過度加成。
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

const PREFIX_DAY = '@companionThrottle:day:';
const PREFIX_MS = '@companionThrottle:ms:';

function calendarDay(): string {
  return new Date().toISOString().split('T')[0];
}

/** 同一行事曆日最多通過一次；通過時回傳 true 並寫入當日標記。 */
export async function companionThrottleOncePerCalendarDay(signalKey: string): Promise<boolean> {
  const day = calendarDay();
  const storageKey = `${PREFIX_DAY}${signalKey}`;
  try {
    const prev = await AsyncStorage.getItem(storageKey);
    if (prev === day) return false;
    await AsyncStorage.setItem(storageKey, day);
    return true;
  } catch {
    return false;
  }
}

/** 距離上次通過至少 intervalMs 毫秒才可再度通過；通過時回傳 true。 */
export async function companionThrottleMinInterval(
  signalKey: string,
  intervalMs: number,
): Promise<boolean> {
  const storageKey = `${PREFIX_MS}${signalKey}`;
  const now = Date.now();
  try {
    const raw = await AsyncStorage.getItem(storageKey);
    const last = raw ? parseInt(raw, 10) : 0;
    if (Number.isFinite(last) && now - last < intervalMs) return false;
    await AsyncStorage.setItem(storageKey, String(now));
    return true;
  } catch {
    return false;
  }
}
