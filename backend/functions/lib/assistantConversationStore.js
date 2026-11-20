'use strict';

const { getFirestore, FieldValue } = require('firebase-admin/firestore');

const MAX_STORED_MESSAGES = 30;
const MAX_MESSAGE_CHARS = 8000;

// Older conversations could include client-supplied assistant turns. Only replay
// transcripts written by the server after client history was removed from model input.
function transcriptRef(uid, sessionId) {
  if (!uid || !sessionId || sessionId.includes('/')) return null;
  return getFirestore().collection('users').doc(uid).collection('assistantTranscripts').doc(sessionId);
}

function sanitizeMessageForStore(msg) {
  if (!msg || typeof msg !== 'object') return null;
  // Evidence is rebuilt for each request and must never become a stored user turn.
  if (msg.role === 'system' || msg.name === 'campus_reference_data') return null;
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
 * @param {string} schoolId
 * @returns {Promise<Array<Record<string, unknown>>>}
 */
async function loadConversationMessages(uid, sessionId, schoolId) {
  const ref = transcriptRef(uid, sessionId);
  if (!ref || !schoolId) return [];
  const snap = await ref.get().catch(() => null);
  const data = snap?.data();
  if (data?.schoolId !== schoolId || !Array.isArray(data.messages)) return [];
  return data.messages.slice(-MAX_STORED_MESSAGES).map(sanitizeMessageForStore).filter(Boolean);
}

/**
 * @param {string} uid
 * @param {string} sessionId
 * @param {string} schoolId
 * @param {Array<Record<string, unknown>>} messages 含 system 亦可，會剔除
 */
async function saveConversationMessages(uid, sessionId, schoolId, messages) {
  const ref = transcriptRef(uid, sessionId);
  if (!ref || !schoolId || !Array.isArray(messages)) return;
  const cleaned = messages.map(sanitizeMessageForStore).filter(Boolean);
  const trimmed = cleaned.slice(-MAX_STORED_MESSAGES);
  await ref
    .set(
      {
        schoolId,
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
