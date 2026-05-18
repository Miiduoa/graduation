/**
 * assistantQueue — Campus Assistant 後台佇列寫入 helper
 *
 * 此檔在 main 上被 agent runtime / handlers import 但實作未被 commit。
 * 本檔提供最小 stub，無 admin 時為 no-op 並回傳模擬 id，呼叫端的 try/catch
 * 已足以承接。實際持久化以 Firestore collection 為主。
 */

'use strict';

function safeCollection(admin, name) {
  if (!admin) return null;
  try {
    return admin.firestore().collection(name);
  } catch {
    return null;
  }
}

/** 寫入「待人工審核 AI 建議」佇列 */
async function writeReviewAiSuggestionQueueItem(item, deps = {}) {
  const coll = safeCollection(deps.admin, 'assistantReviewQueue');
  const payload = {
    ...item,
    createdAt: new Date().toISOString(),
    status: 'pending',
  };
  if (!coll) return { id: `mem-${Date.now()}`, ...payload };
  try {
    const ref = await coll.add(payload);
    return { id: ref.id, ...payload };
  } catch {
    return { id: `mem-${Date.now()}`, ...payload };
  }
}

/** 將 AI 產出的多份 action draft 一次入佇列 */
async function queueAssistantActionDrafts(drafts, deps = {}) {
  if (!Array.isArray(drafts) || drafts.length === 0) return [];
  const results = [];
  for (const draft of drafts) {
    results.push(await writeReviewAiSuggestionQueueItem(draft, deps));
  }
  return results;
}

/** 紀錄 AI 助理操作的 audit log */
async function writeAssistantAuditLog(entry, deps = {}) {
  const coll = safeCollection(deps.admin, 'assistantAuditLog');
  const payload = {
    ...entry,
    timestamp: new Date().toISOString(),
  };
  if (!coll) return { id: `mem-${Date.now()}`, ...payload };
  try {
    const ref = await coll.add(payload);
    return { id: ref.id, ...payload };
  } catch {
    return { id: `mem-${Date.now()}`, ...payload };
  }
}

module.exports = {
  writeReviewAiSuggestionQueueItem,
  queueAssistantActionDrafts,
  writeAssistantAuditLog,
};
