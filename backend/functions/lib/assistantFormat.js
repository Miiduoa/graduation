/**
 * assistantFormat — Campus Assistant 的訊息/日期格式化工具
 *
 * 此檔在 main 上被多個 agent 模組與測試 import 但實作未被 commit。
 * 本檔為最小實作以滿足契約：
 *   - toJsDate(value): 將 Firestore Timestamp / ISO 字串 / Date / number 轉為 Date
 *   - formatAssistantDate(date, locale?): 格式化為使用者友善字串
 *   - getLastUserMessage(messages): 從訊息陣列取最後一則 user 訊息
 *   - isDormRepairStatusQueryMessage(text): 啟發式偵測「報修狀態查詢」意圖
 *   - detectCampusAssistantIntent(text): 啟發式 intent 分類，回傳 {intent, confidence}
 */

'use strict';

function toJsDate(value) {
  if (value == null) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  // Firestore Timestamp 形狀
  if (typeof value === 'object') {
    if (typeof value.toDate === 'function') {
      try {
        const d = value.toDate();
        return d instanceof Date && !Number.isNaN(d.getTime()) ? d : null;
      } catch { /* fallthrough */ }
    }
    if (typeof value.seconds === 'number') {
      return new Date(value.seconds * 1000 + (value.nanoseconds || 0) / 1e6);
    }
    if (typeof value._seconds === 'number') {
      return new Date(value._seconds * 1000 + (value._nanoseconds || 0) / 1e6);
    }
  }
  if (typeof value === 'number') return new Date(value);
  if (typeof value === 'string') {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

function formatAssistantDate(date, locale = 'zh-TW') {
  const d = toJsDate(date);
  if (!d) return '';
  try {
    return d.toLocaleString(locale, {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  } catch {
    return d.toISOString();
  }
}

function getLastUserMessage(messages) {
  if (!Array.isArray(messages)) return null;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m && m.role === 'user') return m;
  }
  return null;
}

function isDormRepairStatusQueryMessage(input) {
  const text = typeof input === 'string' ? input : input && input.content;
  if (!text || typeof text !== 'string') return false;
  // 簡易中文 / 英文偵測：包含「報修」+「狀態 / 進度 / 處理 / 完成 / 派工」
  const t = text;
  const hasKey = /(報修|維修|修繕|repair)/i.test(t);
  const hasStatus = /(狀態|進度|處理|完成|派工|何時|status|progress)/i.test(t);
  return hasKey && hasStatus;
}

/**
 * 啟發式 intent 分類，回傳「intent name 字串」。
 * 此函式被 agent/classifyIntent.js 當成 keyword_fallback 使用，
 * 真正的細粒度分類由 richIntentClassify 處理；本函式只負責
 * 在前者 miss 時提供「help / general / 報修狀態」三種兜底名稱。
 */
function detectCampusAssistantIntent(input) {
  const text = (typeof input === 'string' ? input : input && input.content) || '';
  if (!text) return 'general';
  // 能力說明 / help
  if (/(你會什麼|能做什麼|功能|help|what.*can.*you|capabilities)/i.test(text)) {
    return 'help';
  }
  // 圖書館 — rich classifier 漏掉的補位
  if (/續借/i.test(text)) return 'renew_book';
  if (/還書/i.test(text)) return 'return_book';
  if (/借這本書|借書|借閱/i.test(text)) return 'borrow_book';
  // 報修狀態查詢（被多個 tool 共用）
  if (isDormRepairStatusQueryMessage(text)) return 'check_repair_status';
  return 'general';
}

module.exports = {
  toJsDate,
  formatAssistantDate,
  getLastUserMessage,
  isDormRepairStatusQueryMessage,
  detectCampusAssistantIntent,
};
