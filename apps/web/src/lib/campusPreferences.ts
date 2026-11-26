'use client';

import {
  createDefaultCampusPreferences,
  normalizeCampusPreferences,
  type CampusPersonalizationPreferences,
} from '@campus/shared/src/campusPersonalization';
import type { PersonalImportScope } from './personalImports';

export const CAMPUS_PREFERENCES_CHANGE = 'nuni-campus-preferences-change';

/** Browsing preferences are neither verified identity nor authorization. */
export function campusPreferencesStorageKey(scope: PersonalImportScope): string {
  return `nuni.campus-preferences.v1:${encodeURIComponent(scope.owner)}:${encodeURIComponent(scope.schoolId)}`;
}

export function readCampusPreferences(
  scope: PersonalImportScope,
): CampusPersonalizationPreferences {
  const raw = localStorage.getItem(campusPreferencesStorageKey(scope));
  if (raw === null) return createDefaultCampusPreferences();
  try {
    if (raw.length > 8192) throw new Error();
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object' || !('version' in value) || value.version !== 1)
      throw new Error();
    return normalizeCampusPreferences(value);
  } catch {
    throw new Error('這台裝置的首頁偏好暫時讀不到。你可以重新設定，原有課表與行程不受影響。');
  }
}

export function writeCampusPreferences(
  scope: PersonalImportScope,
  value: CampusPersonalizationPreferences,
): CampusPersonalizationPreferences {
  const preferences = normalizeCampusPreferences(value);
  try {
    localStorage.setItem(campusPreferencesStorageKey(scope), JSON.stringify(preferences));
  } catch {
    throw new Error('這次未能儲存首頁偏好，請確認瀏覽器允許儲存資料後再試。');
  }
  window.dispatchEvent(
    new CustomEvent(CAMPUS_PREFERENCES_CHANGE, {
      detail: { key: campusPreferencesStorageKey(scope) },
    }),
  );
  return preferences;
}
