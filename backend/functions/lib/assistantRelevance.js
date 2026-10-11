'use strict';

/**
 * 沒有模型可用時，只在查到的資料真的對得上問題才拿來回答。
 * 作法很保守：把問題裡「公告、活動、有什麼、請問」這類通用字拿掉，剩下的字切成兩個字一組，
 * 資料裡要對到夠多組才算相關。問題只剩通用字（例如「今天有什麼公告」）時，代表就是要看清單。
 */

const GENERIC_PHRASES = [
  '請問', '想問', '幫我', '幫忙', '告訴我', '查一下', '查詢', '看一下', '我想', '我要', '可以', '能不能', '有沒有',
  '有什麼', '有哪些', '是什麼', '什麼', '哪些', '哪裡', '哪個', '怎麼走', '怎麼', '如何', '多少', '幾點', '幾個',
  '最新', '最近', '近期', '今天', '明天', '本週', '這週', '這禮拜', '下週', '現在', '目前',
  '學校', '校園', '校方', '本校', '我們', '我的', '我有', '你們', '大家',
  '公告', '消息', '通知', '新聞', '活動', '事件', '餐點', '菜單', '餐廳', '午餐', '晚餐', '早餐', '吃什麼', '推薦',
  '地點', '位置', '在哪', '作業', '功課', '待繳', '快截止', '截止', '到期',
  '關於', '相關', '資訊', '資料', '公開', '內容', '一些', '整理', '說', '嗎', '呢', '吧', '啊', '了', '的', '是', '有', '要', '和', '跟', '與', '在', '去', '到', '個', '一下',
];

const CJK_RUN = /[\u3400-\u9fff]+/g;
const ASCII_WORD = /[a-z0-9]{2,}/g;

function normalize(text) {
  return String(text || '').toLowerCase();
}

/** 問題裡真正有內容的部分：兩字一組的中文、英數字詞。 */
function questionKeywords(question) {
  let rest = normalize(question);
  for (const phrase of [...GENERIC_PHRASES].sort((a, b) => b.length - a.length)) {
    rest = rest.split(phrase).join(' ');
  }
  const grams = new Set();
  for (const run of rest.match(CJK_RUN) || []) {
    if (run.length === 1) continue;
    for (let i = 0; i < run.length - 1; i += 1) grams.add(run.slice(i, i + 2));
  }
  for (const word of rest.match(ASCII_WORD) || []) grams.add(word);
  return [...grams];
}

/** 一筆資料對到幾組關鍵字。 */
function matchCount(keywords, text) {
  const haystack = normalize(text);
  return keywords.filter((gram) => haystack.includes(gram)).length;
}

/**
 * 回傳和問題相關的資料。
 * - 問題只有通用字：整份清單都算（就是要看清單）。
 * - 有內容字：至少要對到 min(2, 關鍵字數) 組才留下。
 */
function relevantItems(question, items, toText) {
  const list = Array.isArray(items) ? items : [];
  const keywords = questionKeywords(question);
  if (keywords.length === 0) return list;
  const need = Math.min(2, keywords.length);
  return list.filter((item) => matchCount(keywords, toText(item)) >= need);
}

module.exports = { questionKeywords, relevantItems };
