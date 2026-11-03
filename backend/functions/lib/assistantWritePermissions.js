'use strict';

/**
 * 助理寫入權限：讀取 users/{uid}/settings/assistantPermissions，fail closed。
 * 定義與網頁／手機共用 packages/shared/src/assistantPermissions.ts（經 generated/shared）。
 */

const {
  ASSISTANT_PERMISSIONS_DOC_ID,
  ASSISTANT_PERMISSIONS_SETTINGS_HREF,
  ASSISTANT_WRITE_PERMISSION_DEFINITIONS,
  ASSISTANT_WRITE_PERMISSION_KEYS,
  ASSISTANT_WRITE_TOOL_ALIASES,
  assistantWritePermissionDeniedMessage,
  createDefaultAssistantWritePermissions,
  getAssistantWritePermissionLabel,
  isAssistantWriteToolAllowed,
  normalizeAssistantWritePermissions,
  resolveAssistantWritePermissionKey,
  serializeAssistantWritePermissions,
} = require('../generated/shared/assistantPermissions');

/**
 * @param {FirebaseFirestore.Firestore} db
 * @param {string | null | undefined} uid
 * @returns {Promise<ReturnType<typeof createDefaultAssistantWritePermissions>>}
 */
async function loadAssistantWritePermissions(db, uid) {
  const closed = createDefaultAssistantWritePermissions();
  if (!uid || typeof uid !== 'string' || !db) return closed;
  try {
    const snap = await db.collection('users').doc(uid).collection('settings').doc(ASSISTANT_PERMISSIONS_DOC_ID).get();
    if (!snap.exists) return closed;
    return normalizeAssistantWritePermissions(snap.data());
  } catch (error) {
    console.warn(
      '[assistantWritePermissions] load failed; denying writes:',
      error?.message || error,
    );
    return closed;
  }
}

/**
 * 同步正規化（測試／已讀到 raw 後使用）。讀取失敗請直接用 createDefault。
 * @param {unknown} raw
 */
function resolveAssistantWritePermissions(raw) {
  try {
    return normalizeAssistantWritePermissions(raw);
  } catch {
    return createDefaultAssistantWritePermissions();
  }
}

module.exports = {
  ASSISTANT_PERMISSIONS_DOC_ID,
  ASSISTANT_PERMISSIONS_SETTINGS_HREF,
  ASSISTANT_WRITE_PERMISSION_DEFINITIONS,
  ASSISTANT_WRITE_PERMISSION_KEYS,
  ASSISTANT_WRITE_TOOL_ALIASES,
  assistantWritePermissionDeniedMessage,
  createDefaultAssistantWritePermissions,
  getAssistantWritePermissionLabel,
  isAssistantWriteToolAllowed,
  loadAssistantWritePermissions,
  normalizeAssistantWritePermissions,
  resolveAssistantWritePermissionKey,
  resolveAssistantWritePermissions,
  serializeAssistantWritePermissions,
};
