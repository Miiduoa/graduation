import AsyncStorage from "@react-native-async-storage/async-storage";
import { makeScopedStorageKey, makeScopedStoragePrefix, type TenantContext } from "@campus/shared/src";

export { makeScopedStorageKey, makeScopedStoragePrefix, type TenantContext } from "@campus/shared/src";

export const LEGACY_GLOBAL_STORAGE_KEYS = new Set([
  "@schedule_courses",
  "@schedule_events",
  "@schedule_semester",
  "@schedule_view",
  "@schedule_filter",
  "ai_chat_history",
  "@ai_course_advisor_preferences",
  "@ai_course_advisor_chat_history",
  "campus.streak.v1",
]);

const LEGACY_SCOPED_PREFIXES = [
  "campus.favorites.",
  "@search_history.",
  "@menu_subscriptions_",
  "@menu_subscription_settings_",
];

function includesTenantMarker(key: string, marker: string): boolean {
  return key.includes(`.${marker}.`) || key.endsWith(`.${marker}`) || key.endsWith(`_${marker}`);
}

function matchesLegacyScopedKey(key: string, context: TenantContext): boolean {
  const uid = context.uid ? String(context.uid).trim() : "";
  const schoolId = context.schoolId ? String(context.schoolId).trim() : "";

  if (LEGACY_SCOPED_PREFIXES.some((prefix) => key.startsWith(prefix) && (!uid || key.includes(uid)))) {
    return true;
  }

  if (uid && includesTenantMarker(key, uid)) {
    return true;
  }

  if (schoolId && includesTenantMarker(key, schoolId)) {
    return true;
  }

  return false;
}

export function getScopedStorageKey(feature: string, context: TenantContext = {}): string {
  return makeScopedStorageKey(feature, context);
}

export async function getFirstStorageValue(keys: string[]): Promise<string | null> {
  for (const key of keys) {
    const value = await AsyncStorage.getItem(key);
    if (value != null) {
      return value;
    }
  }
  return null;
}

export async function clearUserScopedStorage(context: TenantContext = {}): Promise<void> {
  const keys = await AsyncStorage.getAllKeys();
  const scopedPrefix = makeScopedStoragePrefix();
  const keysToRemove = keys.filter((key) => {
    if (LEGACY_GLOBAL_STORAGE_KEYS.has(key)) return true;
    if (key.startsWith(scopedPrefix)) return true;
    return matchesLegacyScopedKey(key, context);
  });

  if (keysToRemove.length > 0) {
    await AsyncStorage.multiRemove(keysToRemove);
  }
}
