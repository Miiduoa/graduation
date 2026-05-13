import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = '@dashboard_rain_reminder_shown_date';

function localCalendarDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export async function getLastRainReminderDateKey(): Promise<string | null> {
  try {
    const v = await AsyncStorage.getItem(STORAGE_KEY);
    return v && v.length > 0 ? v : null;
  } catch {
    return null;
  }
}

export async function markRainReminderShownToday(now: Date = new Date()): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, localCalendarDateKey(now));
  } catch {
    /* ignore */
  }
}

export async function shouldShowRainReminderBannerToday(now: Date = new Date()): Promise<boolean> {
  const today = localCalendarDateKey(now);
  const last = await getLastRainReminderDateKey();
  return last !== today;
}
