/** Shared message and date formatting for the campus assistant. */

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

// 伺服器跑在 UTC，給使用者看的時間一律換成台灣時間，寫成「10 月 13 日（二）02:35」。
// 回覆會存下來之後再讀，所以只寫絕對日期，不寫今天、明天這種相對的字。
const ASSISTANT_TIME_ZONE = 'Asia/Taipei';
const WEEKDAY_ZH = { Sun: '日', Mon: '一', Tue: '二', Wed: '三', Thu: '四', Fri: '五', Sat: '六' };
const assistantDateParts = new Intl.DateTimeFormat('en-US', {
  timeZone: ASSISTANT_TIME_ZONE,
  month: 'numeric',
  day: 'numeric',
  weekday: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

function formatAssistantDate(date) {
  const d = toJsDate(date);
  if (!d) return '';
  const parts = {};
  for (const part of assistantDateParts.formatToParts(d)) parts[part.type] = part.value;
  return `${Number(parts.month)} 月 ${Number(parts.day)} 日（${WEEKDAY_ZH[parts.weekday]}）${parts.hour}:${parts.minute}`;
}

function getLastUserMessage(messages) {
  if (!Array.isArray(messages)) return null;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m && m.role === 'user') return m;
  }
  return null;
}

function normalizeAssistantText(value) {
  const text = typeof value === 'string' ? value : value?.content;
  return typeof text === 'string' ? text.trim() : '';
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

// 問的是「什麼時候、幾點、哪天」這類時間，不是要送報修
const SCHEDULE_QUESTION_RE = /(什麼時候|甚麼時候|啥時|何時|幾點|哪天|哪一天|哪幾天|幾號|幾月|星期幾|禮拜幾|週幾|周幾|什麼時間|時段|多久|\bwhen\b)/i;
// 講到自己送出的報修單才算查報修進度
const OWN_REPAIR_TICKET_RE = /(報修|維修單|工單|單號|進度|狀態)/;

function isScheduleQuestionMessage(input) {
  const text = typeof input === 'string' ? input : input && input.content;
  if (!text || typeof text !== 'string') return false;
  return SCHEDULE_QUESTION_RE.test(text);
}

function mentionsOwnRepairTicket(input) {
  const text = typeof input === 'string' ? input : input && input.content;
  if (!text || typeof text !== 'string') return false;
  return OWN_REPAIR_TICKET_RE.test(text);
}

// 公告內文裡講時段的那一句，例如「10 月 14 日（三）01:00–05:00 宿舍網路維修」
// 要有真的鐘點（01:00、1 點）才算時段；只寫「下午」「近期」不算，免得把沒有時段的句子當成時段
const TIME_MENTION_RE = /(\d{1,2}\s*[:：]\s*\d{2}|\d{1,2}\s*點)/;
// 內文自己就寫「維修時段：…」時，拿掉這個標題，回覆不會變成「時段：維修時段：…」
const LEADING_LABEL_RE = /^[\s【\[(（]*(?:[\u4e00-\u9fff]{0,6}(?:時段|時間))[\]】)）]*\s*[:：]\s*/;
const RELATIVE_DAY_RE = /(今天|明天|後天|昨天|今日|明日|今晚|明晚)/;

function extractScheduleSnippet(text, maxLength = 80) {
  if (!text || typeof text !== 'string') return '';
  const sentences = text
    .split(/[。！？!?\n]+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
  // 回覆會存下來之後再看，寫「明天」的句子日後會指錯天，不拿來用
  const hit = sentences.find((sentence) => TIME_MENTION_RE.test(sentence) && !RELATIVE_DAY_RE.test(sentence));
  if (!hit) return '';
  const cleaned = hit.replace(LEADING_LABEL_RE, '').trim();
  if (!cleaned || !TIME_MENTION_RE.test(cleaned)) return '';
  return cleaned.length > maxLength ? `${cleaned.slice(0, maxLength)}…` : cleaned;
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
  ASSISTANT_TIME_ZONE,
  toJsDate,
  formatAssistantDate,
  getLastUserMessage,
  normalizeAssistantText,
  isDormRepairStatusQueryMessage,
  isScheduleQuestionMessage,
  mentionsOwnRepairTicket,
  extractScheduleSnippet,
  detectCampusAssistantIntent,
};
