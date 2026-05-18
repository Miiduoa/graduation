/**
 * notificationService — 通知偏好預設值與安靜時段判斷。
 *
 * 此檔對應 main 上既有測試 `__tests__/notificationService.test.js` 的契約：
 *  - defaultNotificationPreferences(): 回傳預設偏好
 *  - isInQuietHours(prefs, date): 判斷是否在安靜時段內（支援跨日窗口）
 *  - createNotificationService(): 供 index.js 在初始化時取得 service 句柄
 *
 * 注意：`backend/functions/lib/` 整個目錄 gitignored 但有測試與多個 tool
 * 檔依賴本檔；此實作為最小且 self-contained，無外部依賴。
 */

'use strict';

function defaultNotificationPreferences() {
  return {
    enabled: true,
    announcements: true,
    events: true,
    groups: true,
    assignments: true,
    grades: true,
    messages: true,
    quietHoursEnabled: false,
    quietHoursStart: '22:00',
    quietHoursEnd: '08:00',
  };
}

function parseHHMM(str) {
  if (typeof str !== 'string') return null;
  const m = str.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
}

function isInQuietHours(prefs, date) {
  if (!prefs || !prefs.quietHoursEnabled) return false;
  const start = parseHHMM(prefs.quietHoursStart);
  const end = parseHHMM(prefs.quietHoursEnd);
  if (start == null || end == null) return false;
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return false;
  const minutes = d.getHours() * 60 + d.getMinutes();
  if (start === end) return false; // 0 寬度視為關閉
  if (start < end) {
    // 同日窗口（例：09:00–18:00）
    return minutes >= start && minutes < end;
  }
  // 跨日窗口（例：22:00–08:00）
  return minutes >= start || minutes < end;
}

function createNotificationService(deps) {
  const admin = deps && deps.admin;
  return {
    defaultPreferences: defaultNotificationPreferences,
    isInQuietHours,
    /** 寫入單一使用者偏好（demo 不落地，僅 echo） */
    async setPreferences(uid, prefs) {
      if (!admin) return { uid, prefs, written: false };
      try {
        await admin.firestore().collection('userNotificationPrefs').doc(uid).set(prefs, { merge: true });
        return { uid, prefs, written: true };
      } catch {
        return { uid, prefs, written: false };
      }
    },
    /** 取得偏好（不存在則回傳預設） */
    async getPreferences(uid) {
      if (!admin) return defaultNotificationPreferences();
      try {
        const doc = await admin.firestore().collection('userNotificationPrefs').doc(uid).get();
        if (!doc.exists) return defaultNotificationPreferences();
        return { ...defaultNotificationPreferences(), ...doc.data() };
      } catch {
        return defaultNotificationPreferences();
      }
    },
  };
}

module.exports = {
  defaultNotificationPreferences,
  isInQuietHours,
  createNotificationService,
};
