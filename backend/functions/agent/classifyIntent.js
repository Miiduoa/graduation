'use strict';

const cases = require('./cases.json');
const { detectCampusAssistantIntent } = require('../lib/assistantFormat');
const {
  classifyRichIntent,
  richRawScoreToConfidence01,
} = require('./richIntentClassify');

const FALLBACK_CONFIDENCE_CAP = 0.58;

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
        /幫我(?:在)?[^。]{0,12}訂餐|我要訂餐|線上訂餐|幫我點|我要點|外帶|來一份|雞排飯|學生餐廳.*點|點一份|點一杯/.test(m) ||
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
      if (/洗衣機|洗衣/.test(m) && /預約|幫我|訂|今晚|明天/.test(m)) return 'wash_reserve';
      if (
        /報修|維修|送.*單|送一個.*單/.test(m) ||
        (/壞了|故障|不冷|不會轉|漏水/.test(m) && /宿舍|冷氣|房|燈|水|馬桶/.test(m))
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
  const rich = classifyRichIntent(text);
  const table = cases.intentConfidence || {};

  if (rich.rawScore > 0) {
    const name = mapRichCategoryToAssistantIntent(rich.category, text, rich.subIntent);
    const confidence = richRawScoreToConfidence01(rich.rawScore);
    return {
      name,
      confidence,
      category: rich.category,
      subIntent: rich.subIntent,
      rawScore: rich.rawScore,
      source: 'rich',
    };
  }

  const name = detectCampusAssistantIntent(text);
  const base = typeof table[name] === 'number' ? table[name] : 0.55;
  const confidence = Math.min(FALLBACK_CONFIDENCE_CAP, base * 0.85);

  return {
    name,
    confidence,
    source: 'keyword_fallback',
  };
}

module.exports = { classifyIntent, mapRichCategoryToAssistantIntent };
