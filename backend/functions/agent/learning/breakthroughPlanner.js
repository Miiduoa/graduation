'use strict';

const nodeCrypto = require('crypto');

const TOOL_HINTS = [
  {
    name: 'getTodaySchedule',
    description: '讀取今日課表與上課資訊',
    keywords: ['課表', '上課', '課程', '教室', '老師', '今天', '明天'],
  },
  {
    name: 'getAssignments',
    description: '讀取待繳作業、截止日與學習待辦',
    keywords: ['作業', '待繳', '截止', 'deadline', '繳交', '待辦'],
  },
  {
    name: 'getAnnouncements',
    description: '讀取校園公告',
    keywords: ['公告', '通知', '行政', '最新消息'],
  },
  {
    name: 'searchCampusDocs',
    description: '搜尋校園文件與知識庫',
    keywords: ['規定', '辦法', '流程', '文件', '查詢', '不知道', '資料'],
  },
  {
    name: 'getPrioritySummary',
    description: '整理今日課程、作業、公告等優先事項',
    keywords: ['整理', '摘要', '今天', '優先', '安排'],
  },
  {
    name: 'getLibraryLoans',
    description: '讀取圖書館借閱紀錄',
    keywords: ['圖書館', '借書', '借閱', '還書', '逾期', '續借'],
  },
  {
    name: 'getLeaveRequestStatus',
    description: '查詢請假申請狀態',
    keywords: ['請假', '假單', '審核', '病假', '事假', '公假'],
  },
  {
    name: 'listMyDormRepairs',
    description: '列出宿舍報修紀錄',
    keywords: ['宿舍', '報修', '維修', '冷氣', '水管', '故障'],
  },
  {
    name: 'getDormRepairStatus',
    description: '查詢單一宿舍報修狀態',
    keywords: ['宿舍', '報修', '維修', '工單', '狀態'],
  },
  {
    name: 'reflectOnGap',
    description: '記錄缺口並產生下一步學習計畫',
    keywords: ['缺口', '不會', '學習', '突破'],
  },
];

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\s+/g, '')
    .slice(0, 600);
}

function fingerprintFor(parts) {
  const base = parts.map(normalizeText).filter(Boolean).join('|') || 'unknown-gap';
  return nodeCrypto.createHash('sha1').update(base).digest('hex').slice(0, 16);
}

function tokenize(value) {
  const text = normalizeText(value);
  const tokens = new Set();
  const latin = text.match(/[a-z0-9_]{2,}/g) || [];
  latin.forEach((t) => tokens.add(t));
  for (let i = 0; i < text.length; i += 1) {
    const one = text.slice(i, i + 1);
    const two = text.slice(i, i + 2);
    if (/[\u4e00-\u9fff]/.test(one)) tokens.add(one);
    if (/[\u4e00-\u9fff]{2}/.test(two)) tokens.add(two);
  }
  return tokens;
}

function hasAny(text, words) {
  return words.some((word) => text.includes(String(word).toLowerCase()));
}

function classifyGapType(text) {
  if (hasAny(text, ['權限', '登入', '授權', 'permission', 'unauthorized', 'auth'])) return 'permission_or_auth';
  if (hasAny(text, ['api', '工具', '功能', 'connector', '串接', '端點'])) return 'tool_or_integration';
  if (hasAny(text, ['資料', '沒有', '空', '查不到', '缺', 'not found'])) return 'missing_data';
  if (hasAny(text, ['不確定', '模糊', '哪個', '哪一個', '多個'])) return 'ambiguous_request';
  return 'unknown_capability';
}

function scoreTool(textTokens, hint) {
  const hintTokens = tokenize(`${hint.name}${hint.description}${hint.keywords.join('')}`);
  let hit = 0;
  textTokens.forEach((token) => {
    if (hintTokens.has(token)) hit += token.length >= 2 ? 2 : 1;
  });
  for (const keyword of hint.keywords) {
    if (textTokens.has(String(keyword).toLowerCase()) || normalizeText([...textTokens].join('')).includes(normalizeText(keyword))) {
      hit += 4;
    }
  }
  return hit;
}

function rankSuggestedTools(text, attemptedTools = []) {
  const tokens = tokenize(text);
  const normalized = normalizeText(text);
  const isLibraryDomain = hasAny(normalized, ['圖書', '借書', '借閱', '續借', '還書', '逾期']);
  const isDormDomain = hasAny(normalized, ['宿舍', '報修', '維修', '冷氣', '空調', '洗衣', '工單']);
  const attempted = new Set((attemptedTools || []).map((t) => String(t)));
  return TOOL_HINTS.map((hint) => ({
    name: hint.name,
    reason: hint.description,
    score:
      scoreTool(tokens, hint) +
      (isLibraryDomain && hint.name === 'getLibraryLoans' ? 8 : 0) +
      (isLibraryDomain && hint.name === 'searchCampusDocs' ? 3 : 0) -
      (!isDormDomain && /Dorm|Washing/i.test(hint.name) ? 8 : 0),
    alreadyAttempted: attempted.has(hint.name),
  }))
    .filter((item) => item.score > 0 && item.name !== 'reflectOnGap')
    .sort((a, b) => b.score - a.score)
    .slice(0, 4);
}

function buildLearningSteps({ gapType, suggestedTools, attemptedTools, desiredCapability }) {
  const steps = [];
  const untried = suggestedTools.filter((tool) => !tool.alreadyAttempted);

  if (untried.length > 0) {
    steps.push(`先嘗試 ${untried.map((tool) => tool.name).join(' → ')}，用現有資料做替代解法。`);
  }
  if (!suggestedTools.some((tool) => tool.name === 'searchCampusDocs')) {
    steps.push('若結構化工具沒有答案，改用 searchCampusDocs 搜校園文件與公告。');
  }
  if (gapType === 'permission_or_auth') {
    steps.push('確認使用者是否已登入且具備對應角色權限；不要要求多餘個資。');
  } else if (gapType === 'tool_or_integration') {
    steps.push('標記需要新增資料 connector 或工具 API，並保留最小必要欄位。');
  } else if (gapType === 'missing_data') {
    steps.push('辨識資料來源缺漏：cache、FireStore collection、後端 scraper 或第三方 API。');
  } else if (gapType === 'ambiguous_request') {
    steps.push('反問一個最小澄清問題，取得關鍵欄位後再執行。');
  }
  steps.push('下次若同類問題成功解決，把「觸發語句 → 工具/資料路徑 → 回覆模板」蒸餾成 learned skill。');

  if (desiredCapability) {
    steps.push(`目標能力：${String(desiredCapability).slice(0, 160)}`);
  }
  if ((attemptedTools || []).length > 0) {
    steps.push(`已嘗試工具：${attemptedTools.join(', ')}`);
  }
  return steps;
}

function buildBreakthroughPlan(input = {}) {
  const text = [input.query, input.gap, input.reason, input.failedBecause, input.desiredCapability]
    .map((v) => String(v || '').trim())
    .filter(Boolean)
    .join(' ');
  const attemptedTools = Array.isArray(input.attemptedTools)
    ? input.attemptedTools.map((tool) => String(tool).trim()).filter(Boolean).slice(0, 12)
    : [];
  const gapType = classifyGapType(normalizeText(text));
  const suggestedTools = rankSuggestedTools(text, attemptedTools);
  const learningSteps = buildLearningSteps({
    gapType,
    suggestedTools,
    attemptedTools,
    desiredCapability: input.desiredCapability,
  });
  const confidence = suggestedTools.length > 0 ? Math.min(0.85, 0.45 + suggestedTools[0].score / 30) : 0.35;

  return {
    fingerprint: fingerprintFor([input.query, input.gap, input.reason, input.desiredCapability]),
    gapType,
    suggestedTools,
    learningSteps,
    confidence,
    canSelfResolveNow: suggestedTools.some((tool) => !tool.alreadyAttempted),
  };
}

module.exports = {
  buildBreakthroughPlan,
  classifyGapType,
  rankSuggestedTools,
};
