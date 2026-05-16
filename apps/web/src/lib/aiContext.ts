/**
 * AI 助理資料注入模組
 *
 * 用途：把學生所有學籍資料組成完整的 system context 字串，
 * 注入到 AI 對話的 system prompt，讓助理每次對話都掌握完整背景。
 */

import {
  DEMO_HISTORY_SEMESTERS,
  CURRENT_SEMESTER,
  NEXT_SEM_COURSES,
  GRADUATION_REQUIREMENTS,
  DEMO_CLUBS,
  computeEarnedCredits,
  CREDIT_CATEGORIES,
  type CreditCategory,
} from './demoData';

/** 找出某類別中成績偏弱（score < 75 或 GPA < 3.0）的科目 */
function weakSubjects(): string[] {
  const weak: string[] = [];
  for (const sem of DEMO_HISTORY_SEMESTERS) {
    for (const c of sem.courses) {
      if (c.score > 0 && c.score < 75) {
        weak.push(`${c.name}（${sem.label}，${c.score} 分）`);
      }
    }
  }
  return weak;
}

/** 組出歷史修課摘要 */
function buildHistorySection(): string {
  return DEMO_HISTORY_SEMESTERS.map((sem) => {
    const lines = sem.courses.map(
      (c) =>
        `    - ${c.name}（${c.code}）${c.credits} 學分，${CREDIT_CATEGORIES[c.category]}，${c.grade}${c.score > 0 ? `（${c.score} 分）` : ''}，${c.instructor} 老師`,
    );
    const semCredits = sem.courses.reduce((s, c) => s + c.credits, 0);
    return `  【${sem.label}，學期 GPA ${sem.semesterGpa}，共 ${semCredits} 學分】\n${lines.join('\n')}`;
  }).join('\n\n');
}

/** 組出本學期課表 */
function buildCurrentSemSection(): string {
  const lines = CURRENT_SEMESTER.courses.map(
    (c) => `    - ${c.name}（${c.code}）${c.credits} 學分，${CREDIT_CATEGORIES[c.category]}，${c.instructor} 老師`,
  );
  return lines.join('\n');
}

/** 組出下學期可選課 */
function buildNextSemSection(): string {
  const days = ['', '週一', '週二', '週三', '週四', '週五'];
  return NEXT_SEM_COURSES.map((c) => {
    const conflict = c.conflictsWith
      ? `⚠️ 【注意：此課與「${NEXT_SEM_COURSES.find((x) => x.id === c.conflictsWith)?.name ?? c.conflictsWith}」時段衝突，不可同時選修】`
      : '';
    const rec = c.recommended ? '⭐ 推薦' : '';
    return `    - ${c.name}（${c.code}）${c.credits} 學分，${CREDIT_CATEGORIES[c.category]}，${days[c.dayOfWeek]} 第 ${c.startPeriod}-${c.endPeriod} 節，${c.instructor} 老師${rec ? '，' + rec : ''}${conflict ? '\n      ' + conflict : ''}`;
  }).join('\n');
}

/** 組出社團活動時間（避免衝堂警示用） */
function buildClubSection(): string {
  const joined = DEMO_CLUBS.filter((c) => c.isJoined);
  if (joined.length === 0) return '  （未加入任何社團）';
  return joined
    .map((c) => `    - ${c.name}：下次活動「${c.nextEvent}」於 ${c.nextEventDate}`)
    .join('\n');
}

/**
 * 建立完整的 AI system context 字串
 * 呼叫此函式後將字串放入 AI 對話的 system prompt
 */
export function buildAISystemContext(): string {
  const earned = computeEarnedCredits();
  const req = GRADUATION_REQUIREMENTS;
  const currentCredits = earned.currentSemesterTotal;
  const totalAfterCurrent = earned.historicalTotal + currentCredits;
  const remaining = req.totalRequired - totalAfterCurrent;

  // 各類別剩餘需求
  const categoryStatus = (Object.keys(req.breakdown) as CreditCategory[]).map((cat) => {
    const need = req.breakdown[cat];
    const done = earned.byCategory[cat];
    const inProgress = CURRENT_SEMESTER.courses
      .filter((c) => c.category === cat)
      .reduce((s, c) => s + c.credits, 0);
    const left = Math.max(0, need - done - inProgress);
    return `    ${CREDIT_CATEGORIES[cat]}：需 ${need} 學分，已修 ${done}，修習中 ${inProgress}，還差 ${left}`;
  }).join('\n');

  const weak = weakSubjects();
  const weakSection = weak.length > 0
    ? `\n⚠️ 成績偏弱科目（建議補強後再修進階課）：\n${weak.map((w) => `  - ${w}`).join('\n')}`
    : '\n✅ 無明顯偏弱科目';

  return `你是「${req.department} AI 選課助理」，專門協助學生規劃課程、試算學分、提供選課建議。
你掌握以下學生的完整學籍快照，請在每次對話中主動運用這些資訊。

═══════════════════════════════════════════════════
學生資料快照
═══════════════════════════════════════════════════
姓名：王小明（學號 M11302001）
科系：${req.department} / 大三（113-1 學期）
累計 GPA：3.63

【畢業學分需求】
科系：${req.department}
畢業總需學分：${req.totalRequired} 學分
${categoryStatus}

【學分進度摘要】
已修（歷史）：${earned.historicalTotal} 學分
本學期修習中：${currentCredits} 學分
已修 + 修習中合計：${totalAfterCurrent} 學分
距畢業還差：${remaining} 學分（不含本學期仍在修習中的部分）
${weakSection}

【歷史修課紀錄（大一上 ～ 大二下）】
${buildHistorySection()}

【本學期課表（${CURRENT_SEMESTER.label}，共 ${currentCredits} 學分，修習中）】
${buildCurrentSemSection()}

【下學期可選課程（${NEXT_SEM_COURSES.length} 門）】
${buildNextSemSection()}

【已加入社團活動時間】
${buildClubSection()}

═══════════════════════════════════════════════════
你的核心能力（請主動提供以下服務）：
═══════════════════════════════════════════════════
1. 【選課建議】根據缺少的學分類別、歷史成績、時間表自動推薦下學期課程
2. 【衝堂檢查】當學生提到要選某課，立即比對現有課表並提示衝堂風險
3. 【畢業年限預測】根據目前選課節奏預測幾年可以畢業
4. 【成績策略建議】針對成績偏弱科目，建議是否先補強再修進階課
5. 【學期規劃】幫學生規劃剩下學期的完整選課計畫，確保按時畢業

請用繁體中文回答，語氣親切、具體、有建設性。
當學生問「我下學期要選什麼？」時，請主動計算缺少的學分類別，並從下學期可選課程中推薦最合適的組合。`;
}

/** 快速取得學分摘要（供頁面顯示用） */
export function getCreditSummary() {
  const earned = computeEarnedCredits();
  const req = GRADUATION_REQUIREMENTS;
  const currentCredits = earned.currentSemesterTotal;
  const totalAfterCurrent = earned.historicalTotal + currentCredits;
  const remaining = req.totalRequired - totalAfterCurrent;

  return {
    totalRequired: req.totalRequired,
    historicalEarned: earned.historicalTotal,
    currentSemester: currentCredits,
    totalSoFar: totalAfterCurrent,
    remaining,
    byCategory: earned.byCategory,
    categoryRequired: req.breakdown,
    department: req.department,
  };
}
