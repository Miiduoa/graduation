'use strict';

const cases = require('./cases.json');
const { detectCampusAssistantIntent, isDormRepairStatusQueryMessage } = require('../lib/assistantFormat');
const {
  classifyRichIntent,
  richRawScoreToConfidence01,
} = require('./richIntentClassify');

const FALLBACK_CONFIDENCE_CAP = 0.58;

/**
 * 多語別名表：把英文 / 日文 / 台語 / 注音文等 → 對映回中文核心字。
 * 在進 richIntentClassify 之前做一次正規化，可以提升命中率而不必改 INTENT_PATTERNS。
 */
const MULTILINGUAL_ALIASES = [
  // 食物
  { match: /\blunch\b/gi, replace: '午餐' },
  { match: /\bdinner\b/gi, replace: '晚餐' },
  { match: /\bbreakfast\b/gi, replace: '早餐' },
  { match: /\b(order|ordering)\s+food\b/gi, replace: '訂餐' },
  { match: /\b(eat|hungry|starving)\b/gi, replace: '吃' },
  { match: /欲食/g, replace: '想吃' }, // 台語
  { match: /欲呷|欲嗚/g, replace: '想吃' },
  // 天氣
  { match: /\bweather\b/gi, replace: '天氣' },
  { match: /天気/g, replace: '天氣' }, // 日文
  { match: /\b(rain|raining)\b/gi, replace: '下雨' },
  { match: /會落雨/g, replace: '會下雨' }, // 台語
  // 課程 / 課表
  { match: /\b(class|classes|schedule)\b/gi, replace: '課' },
  { match: /\b(homework|assignment|due)\b/gi, replace: '作業' },
  // 宿舍
  { match: /\bair\s*conditioner\b/gi, replace: '冷氣' },
  { match: /\bac\s+(broken|not\s+working)\b/gi, replace: '冷氣壞了' },
  { match: /冷氣寄掉了?/g, replace: '冷氣壞了' }, // 網路用語
  { match: /\b(dorm|dormitory|room)\b/gi, replace: '宿舍' },
  // 圖書館
  { match: /\b(library|book|borrow)\b/gi, replace: '圖書館' },
  // 健康 / 心理
  { match: /\b(sick|ill|headache|fever)\b/gi, replace: '不舒服' },
  { match: /\b(anxious|anxiety|stressed|depressed)\b/gi, replace: '焦慮' },
  // 公告 / 活動
  { match: /\b(announcement|notice)\b/gi, replace: '公告' },
  { match: /\bevent\b/gi, replace: '活動' },
  // 列印
  { match: /\bprint(ing)?\b/gi, replace: '列印' },
  // 失物
  { match: /\b(lost|found)\b/gi, replace: '失物' },
  // 請假
  { match: /\b(leave|sick\s+leave|absence)\b/gi, replace: '請假' },
];

function normalizeMultilingualAliases(text) {
  let out = String(text ?? '');
  for (const { match, replace } of MULTILINGUAL_ALIASES) {
    out = out.replace(match, replace);
  }
  return out;
}

/**
 * 邊界輸入 guard：空字串 / 只剩標點 / 單 emoji / 單字 / 重複字 → 走澄清。
 */
function detectAmbiguousLowInfoInput(text) {
  const s = String(text ?? '').trim();
  if (!s) return { ambiguous: true, reason: 'empty' };
  if (s.length <= 1) return { ambiguous: true, reason: 'single_char' };
  // 只剩標點或符號
  if (/^[\s\p{P}\p{S}]+$/u.test(s)) return { ambiguous: true, reason: 'punct_only' };
  // 只剩 emoji
  if (/^(?:\p{Emoji_Presentation}|\p{Extended_Pictographic}|\s)+$/u.test(s)) {
    return { ambiguous: true, reason: 'emoji_only' };
  }
  // 重複同一個字 ≥ 4 次（中文中文中文中文 / aaaaa）
  if (/^(.)\1{3,}$/u.test(s.replace(/\s+/g, ''))) {
    return { ambiguous: true, reason: 'repeated_char' };
  }
  // 超短且沒有任何中文/英文/數字（純空白與符號混雜）
  if (s.length <= 2 && !/[\p{L}\p{N}]/u.test(s)) {
    return { ambiguous: true, reason: 'too_short_no_word' };
  }
  return { ambiguous: false };
}

/**
 * 將豐富分類的 category 對應到 assistantFormat 的 intent 名稱（與 executeCampusAssistantCore 路由一致）。
 * @param {string} category
 * @param {string} rawMessage
 * @param {string} [richSubIntent]
 */
function mapRichCategoryToAssistantIntent(category, rawMessage, richSubIntent) {
  const m = String(rawMessage ?? '').toLowerCase();
  switch (category) {
    case 'food':
      if (
        /幫我(?:在)?[^。]{0,12}訂餐|我要訂餐|線上訂餐|幫我點|我要點|外帶|來一份|雞排飯|學生餐廳.*點|點一份|點一杯|幫我訂(?:午餐|晚餐|早餐)|我要訂(?:午餐|晚餐|早餐)|訂(?:午餐|晚餐|早餐)/.test(m) ||
        (/點餐|下單/.test(m) && /幫我|我要/.test(m)) ||
        (richSubIntent === 'order' && /我要|幫我|來一份|點一份|外帶|學生餐廳/.test(m))
      ) {
        return 'food_order';
      }
      return 'menus';
    case 'leave_status':
      return 'leave_status';
    case 'leave':
      return 'leave_request';
    case 'location':
      return 'pois';
    case 'library': {
      if (/預約.*座位|座位.*預約|自習室|圖書館.*座位|搶座/.test(m)) return 'reserve_seat';
      if (/續借|延長.*借|再借|renew/i.test(m)) return 'renew_book';
      if (/還書|歸還|return/i.test(m)) return 'return_book';
      if (/借書|借閱|幫我借|我要借/.test(m)) return 'borrow_book';
      return 'pois';
    }
    case 'event':
      return 'events';
    case 'announcement':
      return 'announcements';
    case 'help':
      return 'help';
    case 'course': {
      if (/拆|拆解|讀書計畫|安排.*作業|分解作業/.test(m)) return 'assignment_planning';
      if (/(作業|截止|繳交|deadline|due|待繳|待辦|期限)/.test(m)) return 'assignment_status';
      if (/(畢業|學分|選課|gpa|延畢|必修|選修|通識)/i.test(m)) return 'credit_audit';
      if (/(課表|今天.*課|明天.*課|幾點上課|哪些課|幾門課|上什麼課)/.test(m)) return 'study_summary';
      return 'study_summary';
    }
    case 'schedule':
      return 'study_summary';
    case 'health':
    case 'dorm': {
      const hasDormRepairSignal = /宿舍|報修|維修|維修單|工單|冷氣|空調|房間|洗衣|洗衣機|包裹/.test(m);
      if (!hasDormRepairSignal) return 'general';
      if (richSubIntent === 'repair_status') return 'check_repair_status';
      if (isDormRepairStatusQueryMessage(rawMessage)) return 'check_repair_status';
      if (/洗衣機|洗衣/.test(m) && /預約|幫我|訂|今晚|明天/.test(m)) return 'wash_reserve';
      if (
        /報修|維修|送.*單|送一個.*單|維修單|送\s*修|送.*報修/.test(m) ||
        (/壞了|故障|不冷|不會轉|漏水|怪怪的|好熱|太熱|熱爆|不涼|沒風|異音|忽冷忽熱/.test(m) &&
          /宿舍|冷氣|房|燈|水|馬桶|空調|房間/.test(m)) ||
        (/怪怪的|不大正常|不太對/.test(m) && /冷氣|空調|房|宿舍/.test(m)) ||
        (/(好熱|太熱|熱爆)/.test(m) && /(房|冷氣|空調|宿舍)/.test(m))
      ) {
        return 'submit_repair_request';
      }
      return 'general';
    }
    case 'transport':
    case 'print':
    case 'lost_found':
    case 'mood':
    case 'weather':
    case 'greeting':
    case 'thanks':
    default:
      return 'general';
  }
}

/**
 * @param {string} text
 * @returns {{
 *   name: string,
 *   confidence: number,
 *   category?: string,
 *   subIntent?: string,
 *   rawScore?: number,
 *   source: 'rich' | 'keyword_fallback',
 * }}
 */
function classifyIntent(text) {
  // 1) 邊界輸入：直接走澄清，不要丟功能列表
  const ambiguous = detectAmbiguousLowInfoInput(text);
  if (ambiguous.ambiguous) {
    return {
      name: 'general',
      confidence: 1,
      source: 'low_info_guard',
      askClarify: true,
      lowInfoReason: ambiguous.reason,
    };
  }

  // 2) 多語別名 → 中文正規化（不蓋掉原文，只用來分類）
  const normalized = normalizeMultilingualAliases(text);

  const rich = classifyRichIntent(normalized);
  const table = cases.intentConfidence || {};

  if (rich.rawScore > 0) {
    const name = mapRichCategoryToAssistantIntent(rich.category, normalized, rich.subIntent);
    const confidence = richRawScoreToConfidence01(rich.rawScore);
    return {
      name,
      confidence,
      category: rich.category,
      subIntent: rich.subIntent,
      rawScore: rich.rawScore,
      source: 'rich',
      ...(normalized !== text && { normalizedFromAlias: true }),
    };
  }

  const name = detectCampusAssistantIntent(normalized);
  const base = typeof table[name] === 'number' ? table[name] : 0.55;
  const confidence = Math.min(FALLBACK_CONFIDENCE_CAP, base * 0.85);

  return {
    name,
    confidence,
    source: 'keyword_fallback',
    ...(normalized !== text && { normalizedFromAlias: true }),
  };
}

module.exports = {
  classifyIntent,
  mapRichCategoryToAssistantIntent,
  normalizeMultilingualAliases,
  detectAmbiguousLowInfoInput,
};
