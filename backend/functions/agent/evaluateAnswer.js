'use strict';

const { callAssistantModel } = require('../assistantAgent');
const { isProductionRuntime } = require('../securityUtils');
const { loadPrompt } = require('./loadPrompts');

function heuristicEvaluate({ userQuestion, answerText, intentConfidence }) {
  const text = String(answerText || '');
  const q = String(userQuestion || '');
  let score = 0.78;
  let needsUserReview = false;
  const reasons = [];

  if (intentConfidence < 0.62) {
    needsUserReview = true;
    score = Math.min(score, 0.55);
    reasons.push('意圖信心偏低');
  }
  if (/請確認|建議你確認|可能不正確|我不確定|無法保證/i.test(text)) {
    needsUserReview = true;
    score = Math.min(score, 0.6);
    reasons.push('語句提示需確認');
  }
  if (q.length > 8 && text.length < 12) {
    score = Math.min(score, 0.5);
    reasons.push('回答過短');
  }

  return {
    score,
    needsUserReview,
    reason: reasons.join('；') || '',
  };
}

async function evaluateAnswer({ userQuestion, answerText, intentConfidence = 0.8 }) {
  const heuristic = heuristicEvaluate({ userQuestion, answerText, intentConfidence });
  if (isProductionRuntime()) {
    return heuristic;
  }

  try {
    const system = loadPrompt('evaluate');
    const modelResult = await callAssistantModel({
      messages: [
        { role: 'system', content: system },
        {
          role: 'user',
          content: `問題：${String(userQuestion).slice(0, 800)}\n\n回答：${String(answerText).slice(0, 4000)}\n\n只輸出 JSON：{"score":0.0,"needsUserReview":false,"reason":""}`,
        },
      ],
    });
    const raw = String(modelResult?.content || '');
    const m = raw.match(/\{[\s\S]*\}/);
    const parsed = m ? JSON.parse(m[0]) : {};
    return {
      score: typeof parsed.score === 'number' ? parsed.score : heuristic.score,
      needsUserReview: Boolean(parsed.needsUserReview) || heuristic.needsUserReview,
      reason: String(parsed.reason || heuristic.reason || ''),
    };
  } catch {
    return heuristic;
  }
}

module.exports = { evaluateAnswer, heuristicEvaluate };
