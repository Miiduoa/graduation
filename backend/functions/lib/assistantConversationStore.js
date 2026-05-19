'use strict';

const { getFirestore, FieldValue } = require('firebase-admin/firestore');

const MAX_STORED_MESSAGES = 30;
const MAX_MESSAGE_CHARS = 8000;

function db() {
  return getFirestore();
}

function sanitizeMessageForStore(msg) {
  if (!msg || typeof msg !== 'object') return null;
  if (msg.role === 'system') return null;
  const role = msg.role;
  if (!['user', 'assistant', 'tool'].includes(role)) return null;
  const out = { role };
  if (msg.content != null) {
    out.content = String(msg.content).slice(0, MAX_MESSAGE_CHARS);
  }
  if (Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) {
    out.tool_calls = JSON.parse(JSON.stringify(msg.tool_calls)).slice(0, 16);
  }
  if (msg.tool_call_id != null) {
    out.tool_call_id = String(msg.tool_call_id);
  }
  return out;
}

/**
 * @param {string} uid
 * @param {string} sessionId
 * @returns {Promise<Array<Record<string, unknown>>>}
 */
async function loadConversationMessages(uid, sessionId) {
  if (!uid || !sessionId) return [];
  const snap = await db()
    .collection('sessions')
    .doc(uid)
    .collection('conversations')
    .doc(sessionId)
    .get()
    .catch(() => null);
  if (!snap?.exists) return [];
  const data = snap.data() || {};
  const list = Array.isArray(data.messages) ? data.messages : [];
  return list.filter((m) => m && typeof m === 'object');
}

/**
 * @param {string} uid
 * @param {string} sessionId
 * @param {Array<Record<string, unknown>>} messages 含 system 亦可，會剔除
 */
async function saveConversationMessages(uid, sessionId, messages) {
  if (!uid || !sessionId || !Array.isArray(messages)) return;
  const cleaned = messages.map(sanitizeMessageForStore).filter(Boolean);
  const trimmed = cleaned.slice(-MAX_STORED_MESSAGES);
  await db()
    .collection('sessions')
    .doc(uid)
    .collection('conversations')
    .doc(sessionId)
    .set(
      {
        messages: trimmed,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    )
    .catch((e) => {
      console.warn('[assistantConversationStore] save failed:', e?.message || e);
    });
}

module.exports = {
  loadConversationMessages,
  saveConversationMessages,
  MAX_STORED_MESSAGES,
};
