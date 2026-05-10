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
 */
function mapRichCategoryToAssistantIntent(category, rawMessage) {
  const m = String(rawMessage ?? '').toLowerCase();
  switch (category) {
    case 'food':
      return 'menus';
    case 'leave':
      return 'leave_request';
    case 'location':
    case 'library':
      return 'pois';
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
    case 'dorm':
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
    const name = mapRichCategoryToAssistantIntent(rich.category, text);
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
