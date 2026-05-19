/**
 * AI Thinking Engine — 主動式 AI 的思考能力
 *
 * 設計：規則匹配是「if X then Y」，但思考是：
 *   觀察 → 推論 → 權衡 → 選擇 → 為什麼
 *
 * 本檔提供 5 個推理函式：
 *  1. observeStudentState — 從多個 signal 抽出觀察
 *  2. inferConcerns — 根據觀察推論可能的問題
 *  3. detectTradeoffs — 找出衝突的目標（讀書 vs 休息）
 *  4. rankActions — 用權重比較多個候選 action
 *  5. explainChain — 把整個思考過程組成可解釋的「思考鏈」
 *
 * 完全純函式，無 LLM。每步可單測。output 給 UI 顯示「為什麼」。
 */

// ─────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────

export type ThinkingSeverity = 'critical' | 'high' | 'medium' | 'low';

export interface StateSignal {
  /** 來源 domain，例如 'homework' / 'attendance' / 'mistake' */
  domain: string;
  /** 該 signal 的事實描述（給 AI 觀察） */
  fact: string;
  /** 數值化權重 0-100 — 影響後續推論 */
  weight: number;
  /** Raw 資料（給後續用） */
  payload?: Record<string, unknown>;
}

export interface Observation {
  /** 觀察到的 pattern，例如「累積 3 件作業逾期」 */
  pattern: string;
  /** 涉及的 signal 來源 */
  domains: string[];
  /** 嚴重度 */
  severity: ThinkingSeverity;
}

export interface Concern {
  /** 推論出來的問題，例如「可能放棄了某門課」 */
  inference: string;
  /** 推論的基礎 (Observation patterns) */
  basedOn: string[];
  /** 信心 0-100 */
  confidence: number;
  /** 嚴重度 */
  severity: ThinkingSeverity;
}

export interface Tradeoff {
  /** 對立的兩個目標 */
  optionA: string;
  optionB: string;
  /** 為什麼是 tradeoff（解釋衝突） */
  conflict: string;
  /** AI 推薦哪一邊 + 理由 */
  recommendation: 'A' | 'B' | 'balanced';
  reasoning: string;
}

export interface CandidateAction {
  /** 動作 ID */
  id: string;
  /** 動作描述 */
  description: string;
  /** 預估好處 0-100 */
  benefit: number;
  /** 預估成本 0-100（時間 / 心力） */
  cost: number;
  /** 緊迫程度 0-100 */
  urgency: number;
  /** 對應 domain */
  domain: string;
}

export interface RankedAction extends CandidateAction {
  /** 內部排序分數，由 thinking engine 計算 */
  score: number;
  /** AI 為何選這個的解釋 */
  rationale: string;
  /** 排名 */
  rank: number;
}

export interface ThinkingChain {
  /** 觀察 */
  observations: Observation[];
  /** 推論 */
  concerns: Concern[];
  /** 權衡 */
  tradeoffs: Tradeoff[];
  /** 排序後的 action */
  rankedActions: RankedAction[];
  /** 最後選的 action */
  finalChoice: RankedAction | null;
  /** 完整 narrative：給 UI 顯示「AI 怎麼想的」 */
  narrative: string[];
}

// ─────────────────────────────────────────────────────────
// 1. observeStudentState — 從 signals 整合出 observations
// ─────────────────────────────────────────────────────────

export function observeStudentState(signals: StateSignal[]): Observation[] {
  const observations: Observation[] = [];

  // Pattern A: 多 domain 累積高 weight signal → 觀察「跨領域壓力」
  const highSignals = signals.filter((s) => s.weight >= 70);
  if (highSignals.length >= 3) {
    const domains = Array.from(new Set(highSignals.map((s) => s.domain)));
    observations.push({
      pattern: `${highSignals.length} 項高重要度 signal 集中在 ${domains.length} 個領域，壓力呈跨領域分布`,
      domains,
      severity: highSignals.length >= 5 ? 'critical' : 'high',
    });
  }

  // Pattern B: 單一 domain 多個 signal → 觀察「該領域失衡」
  const byDomain = new Map<string, StateSignal[]>();
  for (const s of signals) {
    const arr = byDomain.get(s.domain) ?? [];
    arr.push(s);
    byDomain.set(s.domain, arr);
  }
  for (const [domain, list] of byDomain) {
    if (list.length >= 3) {
      const avgWeight = list.reduce((sum, s) => sum + s.weight, 0) / list.length;
      observations.push({
        pattern: `${domain} 領域有 ${list.length} 項 signal（平均權重 ${Math.round(avgWeight)}），明顯失衡`,
        domains: [domain],
        severity: avgWeight >= 70 ? 'high' : 'medium',
      });
    }
  }

  // Pattern C: 沒有任何高 weight signal → 觀察「節奏穩定」
  if (highSignals.length === 0 && signals.length > 0) {
    observations.push({
      pattern: '無高重要度 signal，整體節奏穩定',
      domains: Array.from(new Set(signals.map((s) => s.domain))),
      severity: 'low',
    });
  }

  return observations;
}

// ─────────────────────────────────────────────────────────
// 2. inferConcerns — 從 observations 推論 concerns
// ─────────────────────────────────────────────────────────

export function inferConcerns(observations: Observation[]): Concern[] {
  const concerns: Concern[] = [];

  for (const obs of observations) {
    // 跨領域壓力 → 推論可能 burnout
    if (obs.pattern.includes('跨領域')) {
      concerns.push({
        inference: '學生可能正在累積壓力，繼續推進會降低效率甚至放棄某些任務',
        basedOn: [obs.pattern],
        confidence: 80,
        severity: obs.severity,
      });
    }
    // 單一領域失衡
    if (obs.pattern.includes('明顯失衡')) {
      concerns.push({
        inference: `學生在 ${obs.domains[0]} 領域投入不足或進度落後，需重點介入`,
        basedOn: [obs.pattern],
        confidence: 70,
        severity: obs.severity,
      });
    }
    // 節奏穩定
    if (obs.pattern.includes('節奏穩定')) {
      concerns.push({
        inference: '學生現況良好，可投入長期任務（複習 / 預習 / 深度學習）',
        basedOn: [obs.pattern],
        confidence: 65,
        severity: 'low',
      });
    }
  }

  return concerns;
}

// ─────────────────────────────────────────────────────────
// 3. detectTradeoffs — 找出衝突的目標
// ─────────────────────────────────────────────────────────

export function detectTradeoffs(
  concerns: Concern[],
  candidateActions: CandidateAction[],
): Tradeoff[] {
  const tradeoffs: Tradeoff[] = [];

  // 範例 1：burnout 推論 vs 高 cost action → 建議休息
  const hasBurnout = concerns.some((c) => c.inference.includes('累積壓力'));
  const highCostAction = candidateActions.find((a) => a.cost >= 70);
  if (hasBurnout && highCostAction) {
    tradeoffs.push({
      optionA: highCostAction.description,
      optionB: '短暫休息（10-15 分鐘）後再繼續',
      conflict: '學生有壓力 signal，現在硬上會降低後續效率',
      recommendation: 'B',
      reasoning: '短期成本（休息 15 分）換回後續長時段的高效率，淨值正',
    });
  }

  // 範例 2：高 urgency vs 高 cost
  const urgentHighCost = candidateActions.find((a) => a.urgency >= 80 && a.cost >= 60);
  const urgentLowCost = candidateActions.find((a) => a.urgency >= 80 && a.cost < 50);
  if (urgentHighCost && urgentLowCost) {
    tradeoffs.push({
      optionA: urgentHighCost.description,
      optionB: urgentLowCost.description,
      conflict: '兩個都很急但成本不同',
      recommendation: 'B',
      reasoning: '先吃低成本緊急項，快速 unlock 心理空間後再處理高成本項',
    });
  }

  // 範例 3：deadline 近 vs 高 benefit 但 deadline 遠
  const dueNow = candidateActions.find((a) => a.urgency >= 80);
  const longTermHigh = candidateActions.find((a) => a.benefit >= 80 && a.urgency < 40);
  if (dueNow && longTermHigh) {
    tradeoffs.push({
      optionA: dueNow.description,
      optionB: longTermHigh.description,
      conflict: 'deadline 近 vs 長期回報高',
      recommendation: 'A',
      reasoning: '錯過 deadline 的成本通常 > 長期項目延一天的成本',
    });
  }

  return tradeoffs;
}

// ─────────────────────────────────────────────────────────
// 4. rankActions — 多面向打分 + 排序
// ─────────────────────────────────────────────────────────

/**
 * 分數 = urgency * 0.5 + benefit * 0.35 - cost * 0.15
 * 簡單 weighted sum，可未來換成 LLM-as-judge。
 */
export function rankActions(candidates: CandidateAction[]): RankedAction[] {
  const ranked = candidates
    .map((c) => ({
      ...c,
      score: Math.round(c.urgency * 0.5 + c.benefit * 0.35 - c.cost * 0.15),
      rationale: '', // fill below
      rank: 0,
    }))
    .sort((a, b) => b.score - a.score)
    .map((r, i) => ({
      ...r,
      rank: i + 1,
      rationale: `urgency ${r.urgency} + benefit ${r.benefit} - cost ${r.cost} → ${r.score} 分`,
    }));

  // 為前 3 名補上 narrative rationale
  if (ranked[0]) {
    ranked[0].rationale = `最值得做：${ranked[0].rationale}，CP 值最高`;
  }
  if (ranked[1]) {
    ranked[1].rationale = `備案：${ranked[1].rationale}，差第一名 ${ranked[0].score - ranked[1].score} 分`;
  }
  if (ranked[2]) {
    ranked[2].rationale = `延後：${ranked[2].rationale}，可放到下一個番茄鐘`;
  }
  return ranked;
}

// ─────────────────────────────────────────────────────────
// 5. explainChain — 把上述 4 步驟組合成完整思考鏈
// ─────────────────────────────────────────────────────────

export function explainChain(input: {
  signals: StateSignal[];
  candidates: CandidateAction[];
}): ThinkingChain {
  const observations = observeStudentState(input.signals);
  const concerns = inferConcerns(observations);
  const tradeoffs = detectTradeoffs(concerns, input.candidates);
  const rankedActions = rankActions(input.candidates);
  const finalChoice = rankedActions[0] ?? null;

  const narrative: string[] = [];

  // 觀察階段
  if (observations.length > 0) {
    narrative.push(`🔍 觀察：${observations.map((o) => o.pattern).join('；')}`);
  }

  // 推論階段
  if (concerns.length > 0) {
    narrative.push(`💭 推論：${concerns.map((c) => c.inference).join('；')}`);
  }

  // 權衡階段
  if (tradeoffs.length > 0) {
    narrative.push(
      `⚖️ 權衡：` + tradeoffs.map((t) => `「${t.conflict}」→ 選 ${t.recommendation === 'A' ? t.optionA : t.optionB}（${t.reasoning}）`).join('；'),
    );
  }

  // 排序階段
  if (rankedActions.length > 0) {
    const top = rankedActions.slice(0, 3);
    narrative.push(`📋 排序：${top.map((r) => `${r.rank}. ${r.description} (${r.score} 分)`).join('；')}`);
  }

  // 最終決定
  if (finalChoice) {
    narrative.push(`✅ 決定：${finalChoice.description}（${finalChoice.rationale}）`);
  } else {
    narrative.push('✅ 結論：目前沒有需要主動推送的動作');
  }

  return {
    observations,
    concerns,
    tradeoffs,
    rankedActions,
    finalChoice,
    narrative,
  };
}

// ─────────────────────────────────────────────────────────
// 6. reflectOnDay — 一日結束的反思
// ─────────────────────────────────────────────────────────

export interface DailyReflection {
  /** 完成的任務數 */
  completed: number;
  /** 未完成的高優先項 */
  missed: string[];
  /** 觀察到的模式 */
  patterns: string[];
  /** 下一步建議 */
  suggestions: string[];
  /** 整體評價 */
  verdict: 'great' | 'okay' | 'rough' | 'reset';
}

export function reflectOnDay(input: {
  totalTasks: number;
  completedTasks: number;
  overdueTasks: number;
  pomodorosCompleted: number;
  pomodorosPlanned: number;
  highPriorityMissed: string[];
}): DailyReflection {
  const completionRate = input.totalTasks > 0 ? input.completedTasks / input.totalTasks : 0;
  const pomoRate = input.pomodorosPlanned > 0 ? input.pomodorosCompleted / input.pomodorosPlanned : 0;

  const patterns: string[] = [];
  const suggestions: string[] = [];

  if (completionRate >= 0.8) patterns.push('完成度 ≥ 80%，今天節奏非常好');
  else if (completionRate >= 0.5) patterns.push('完成度 50-80%，穩定推進');
  else if (input.completedTasks > 0) patterns.push('完成度偏低，可能任務量估太多');
  else patterns.push('今天幾乎沒有產出，可能卡住或休息');

  if (input.overdueTasks > 0) {
    patterns.push(`${input.overdueTasks} 項變為逾期`);
    suggestions.push(`明天先聯絡老師補交 ${input.overdueTasks} 項逾期作業`);
  }

  if (pomoRate >= 0.75) {
    patterns.push('番茄鐘執行率高，專注度好');
  } else if (input.pomodorosPlanned >= 4 && pomoRate < 0.5) {
    patterns.push('番茄鐘執行率偏低，可能環境干擾');
    suggestions.push('明天試試把高優先項排在早上 + 戴耳機減少干擾');
  }

  if (input.highPriorityMissed.length > 0) {
    suggestions.push(`高優先未完成項目（${input.highPriorityMissed.slice(0, 2).join('、')}）建議明天第一個處理`);
  }

  let verdict: DailyReflection['verdict'];
  if (completionRate >= 0.8 && input.overdueTasks === 0) verdict = 'great';
  else if (completionRate >= 0.5) verdict = 'okay';
  else if (input.overdueTasks >= 3) verdict = 'reset';
  else verdict = 'rough';

  if (verdict === 'great') suggestions.push('做得很好！可以給自己一點獎勵');
  if (verdict === 'reset') suggestions.push('明天從 1 個小任務開始重啟節奏，不要一次推所有事');

  return {
    completed: input.completedTasks,
    missed: input.highPriorityMissed,
    patterns,
    suggestions,
    verdict,
  };
}
