/* eslint-disable */
/**
 * AI 跨模組智慧串聯引擎 — aiCrossModuleInference.ts
 *
 * 打通所有模組資料，產生深層洞察：
 * - 天氣 + 課表 → 「明天下雨又有3堂課，建議提早出門帶傘」
 * - 成績 + 出席 → 「微積分出席率60%且成績偏低，高風險」
 * - 作業截止 + 空閒時間 → 「今天有3小時空檔，剛好可以完成明天截止的報告」
 * - 課程負載 + 身心健康 → 「本週課很滿，注意休息」
 * - 社交 + 學習 → 「你的讀書會成員也在準備同一門考試」
 *
 * 輸出 CrossModuleInsight[]，每條洞察包含：
 *   type、severity、message、actionSuggestion
 * 直接注入 AI system prompt，讓 Gemini 主動提出。
 */

import { computeRealtimeInsights, type RealtimeInsights, type RiskLevel } from './aiRealtimeAnalytics';

// ─── Types ───────────────────────────────────────────────

export type InsightType =
  | 'weather_schedule'
  | 'grade_attendance_risk'
  | 'assignment_free_time'
  | 'workload_health'
  | 'exam_preparation'
  | 'graduation_progress'
  | 'daily_briefing'
  | 'study_efficiency'
  | 'time_management'
  | 'proactive_suggestion';

export type CrossModuleInsight = {
  id: string;
  type: InsightType;
  severity: RiskLevel;
  title: string;
  message: string;
  actionSuggestion: string;
  relatedModules: string[];
  timestamp: number;
};

export type DailyBriefing = {
  greeting: string;
  todaySummary: string;
  topInsights: CrossModuleInsight[];
  quickActions: string[];
  motivationalNote: string;
};

// ─── Inference Engine ────────────────────────────────────

const DAY_NAMES = ['日', '一', '二', '三', '四', '五', '六'];

function getGreeting(hour: number): string {
  if (hour < 6) return '夜深了還沒睡嗎？';
  if (hour < 9) return '早安！新的一天開始了';
  if (hour < 12) return '上午好！';
  if (hour < 14) return '中午好，吃飯了嗎？';
  if (hour < 17) return '下午好！';
  if (hour < 20) return '傍晚好！';
  return '晚上好！';
}

/**
 * 從 RealtimeInsights 推導跨模組洞察。
 */
function inferCrossModuleInsights(insights: RealtimeInsights): CrossModuleInsight[] {
  const results: CrossModuleInsight[] = [];
  const now = Date.now();
  const today = new Date();
  const hour = today.getHours();

  // ── 1. 成績 + 出席交叉風險 ──
  if (insights.attendance.coursesAtRisk.length > 0 && insights.gpa.currentGPA !== null) {
    for (const course of insights.attendance.coursesAtRisk) {
      // 找出同名低分課程
      const lowScore = insights.gpa.lowScoreCourses.find(
        (c) => c.name.includes(course.courseName) || course.courseName.includes(c.name),
      );
      const failed = insights.gpa.failedCourses.find(
        (c) => c.name.includes(course.courseName) || course.courseName.includes(c.name),
      );

      if (lowScore || failed) {
        results.push({
          id: `grade_att_${course.courseName}`,
          type: 'grade_attendance_risk',
          severity: failed ? 'critical' : 'danger',
          title: `⚠️ ${course.courseName} 雙重危機`,
          message: `${course.courseName} 出席率只有 ${course.rate}%，` +
            `${failed ? `而且已經不及格(${failed.score}分)` : `而且成績偏低(${lowScore!.score}分)`}。` +
            `出席和成績都亮紅燈，必須立即行動！`,
          actionSuggestion: '建議：1) 接下來每堂必到 2) 找助教或同學組讀書會 3) 預約課輔',
          relatedModules: ['成績', '出席'],
          timestamp: now,
        });
      } else if (course.riskLevel === 'danger') {
        results.push({
          id: `att_risk_${course.courseName}`,
          type: 'grade_attendance_risk',
          severity: 'warning',
          title: `${course.courseName} 出席率偏低`,
          message: `出席率 ${course.rate}%，缺席 ${course.absent} 次。持續缺課可能影響期末成績（部分課程出席佔 10-20% 分數）`,
          actionSuggestion: '接下來每堂必到，並找同學借筆記補上進度',
          relatedModules: ['出席'],
          timestamp: now,
        });
      }
    }
  }

  // ── 2. 作業截止 + 空閒時間 ──
  const urgentTasks = insights.assignments.dueSoon.filter((t) => !t.isLate && t.hoursLeft <= 48);
  const freeHours = Math.round(insights.timeInsight.freeTimeToday / 60);

  if (urgentTasks.length > 0 && freeHours > 0) {
    const taskList = urgentTasks.slice(0, 3).map((t) => t.title).join('、');
    results.push({
      id: 'assignment_freetime',
      type: 'assignment_free_time',
      severity: urgentTasks.some((t) => t.hoursLeft <= 12) ? 'danger' : 'warning',
      title: '作業 + 空閒時間匹配',
      message: `你有 ${urgentTasks.length} 項作業即將到期（${taskList}），` +
        `今天還有約 ${freeHours} 小時空閒。` +
        (freeHours >= urgentTasks.length * 2
          ? '時間足夠完成！'
          : '時間有點緊，建議集中精力先完成最急的'),
      actionSuggestion: freeHours >= 3
        ? `建議用空閒時間完成「${urgentTasks[0].title}」`
        : `利用零碎時間先看看「${urgentTasks[0].title}」的要求`,
      relatedModules: ['作業', '課表', '時間管理'],
      timestamp: now,
    });
  }

  // ── 3. 逾期作業緊急提醒 ──
  if (insights.assignments.overdue > 0) {
    const overdueList = insights.assignments.dueSoon
      .filter((t) => t.isLate)
      .slice(0, 3)
      .map((t) => `${t.title}(${t.courseName})`)
      .join('、');

    results.push({
      id: 'overdue_urgent',
      type: 'assignment_free_time',
      severity: 'critical',
      title: `🚨 ${insights.assignments.overdue} 項作業已逾期`,
      message: `逾期作業：${overdueList}。部分老師接受遲交但會扣分，越晚交扣越多！`,
      actionSuggestion: '立刻打開 TronClass 確認是否還能繳交，並盡快完成',
      relatedModules: ['作業'],
      timestamp: now,
    });
  }

  // ── 4. 課程負載 + 身心提醒 ──
  const busiestDayLoad = insights.courseLoad.dailyLoad[0];
  if (busiestDayLoad && busiestDayLoad.hours >= 6) {
    const todayDow = today.getDay();
    const isBusyDayToday = busiestDayLoad.dayIndex === todayDow;
    const isBusyDayTomorrow = busiestDayLoad.dayIndex === (todayDow + 1) % 7;

    if (isBusyDayToday) {
      results.push({
        id: 'heavy_today',
        type: 'workload_health',
        severity: 'watch',
        title: '今天課很滿',
        message: `今天有 ${busiestDayLoad.courseCount} 堂課（${busiestDayLoad.hours} 小時），是本週最忙的一天。記得補充水分和適當休息`,
        actionSuggestion: '課間休息時走動一下，午餐不要跳過',
        relatedModules: ['課表', '健康'],
        timestamp: now,
      });
    } else if (isBusyDayTomorrow) {
      results.push({
        id: 'heavy_tomorrow',
        type: 'workload_health',
        severity: 'watch',
        title: `明天（${busiestDayLoad.day}）課很多`,
        message: `明天有 ${busiestDayLoad.courseCount} 堂課（${busiestDayLoad.hours} 小時），建議今晚早點休息`,
        actionSuggestion: '今晚準備好明天需要的教材，設好鬧鐘，早點睡',
        relatedModules: ['課表', '健康'],
        timestamp: now,
      });
    }
  }

  // ── 5. GPA 趨勢 + 畢業風險 ──
  if (insights.gpa.trend === 'declining' && !insights.credits.onTrack) {
    results.push({
      id: 'gpa_graduation_risk',
      type: 'graduation_progress',
      severity: 'danger',
      title: '畢業風險：成績下滑 + 學分不足',
      message: `GPA 趨勢下滑（${insights.gpa.trendDelta > 0 ? '+' : ''}${insights.gpa.trendDelta}），` +
        `同時還需 ${insights.credits.remainingCredits} 學分才能畢業。` +
        `如果繼續下滑可能影響畢業時間`,
      actionSuggestion: '建議：1) 預約學業輔導 2) 下學期多選幾門有把握的課 3) 考慮暑修補學分',
      relatedModules: ['成績', '學分', '畢業'],
      timestamp: now,
    });
  }

  // ── 6. 下一堂課提醒（整合位置）──
  if (insights.timeInsight.nextClass) {
    const next = insights.timeInsight.nextClass;
    if (next.minutesUntil <= 15) {
      results.push({
        id: 'class_imminent',
        type: 'daily_briefing',
        severity: 'watch',
        title: `${next.minutesUntil} 分鐘後上課`,
        message: `${next.name} 即將開始，教室：${next.location || '請查課表'}`,
        actionSuggestion: next.location ? `前往 ${next.location}` : '準備出發',
        relatedModules: ['課表'],
        timestamp: now,
      });
    } else if (next.minutesUntil <= 30) {
      results.push({
        id: 'class_soon',
        type: 'daily_briefing',
        severity: 'safe',
        title: `${next.minutesUntil} 分鐘後上 ${next.name}`,
        message: `還有一些時間，可以先複習一下上次的內容`,
        actionSuggestion: '翻翻課本或筆記做個快速回顧',
        relatedModules: ['課表', '學習'],
        timestamp: now,
      });
    }
  }

  // ── 7. 學習效率分析 ──
  if (insights.assignments.completionRate < 60 && insights.assignments.total >= 5) {
    results.push({
      id: 'low_completion',
      type: 'study_efficiency',
      severity: 'warning',
      title: '作業完成率偏低',
      message: `作業完成率只有 ${insights.assignments.completionRate}%（${insights.assignments.total} 項中完成 ${Math.round(insights.assignments.total * insights.assignments.completionRate / 100)} 項）。` +
        `及時完成作業對期末成績很重要`,
      actionSuggestion: '試試「兩分鐘法則」：先花2分鐘看作業要求，降低開始的心理門檻',
      relatedModules: ['作業', '學習效率'],
      timestamp: now,
    });
  }

  // ── 8. 時段特定建議 ──
  if (hour >= 22 && insights.timeInsight.todayCourses.length > 0) {
    const tomorrow = (today.getDay() + 1) % 7;
    const tomorrowCourses = insights.courseLoad.dailyLoad.find((d) => d.dayIndex === tomorrow);
    if (tomorrowCourses && tomorrowCourses.courseCount > 0) {
      results.push({
        id: 'night_reminder',
        type: 'time_management',
        severity: 'safe',
        title: '夜間提醒',
        message: `已經 ${hour} 點了，明天有 ${tomorrowCourses.courseCount} 堂課。` +
          `睡眠不足會影響注意力和記憶力`,
        actionSuggestion: '建議準備休息，設好明天的鬧鐘',
        relatedModules: ['健康', '課表'],
        timestamp: now,
      });
    }
  }

  // ── 9. 空閒日建議 ──
  if (insights.timeInsight.todayCourses.length === 0) {
    const hasPendingWork = insights.assignments.dueSoon.length > 0 || insights.assignments.overdue > 0;
    results.push({
      id: 'free_day',
      type: 'proactive_suggestion',
      severity: 'safe',
      title: '今天沒有課',
      message: hasPendingWork
        ? `今天沒課，是處理待辦事項的好機會！有 ${insights.assignments.dueSoon.length} 項作業等著你`
        : '今天沒課也沒有緊急作業，可以好好放鬆或探索新事物',
      actionSuggestion: hasPendingWork
        ? '趁沒課把最急的作業搞定'
        : '可以去圖書館看書、參加社團活動、或運動放鬆',
      relatedModules: ['課表', '作業', '生活'],
      timestamp: now,
    });
  }

  // ── 10. 成績進步鼓勵 ──
  if (insights.gpa.trend === 'rising' && insights.gpa.trendDelta > 3) {
    results.push({
      id: 'gpa_improving',
      type: 'proactive_suggestion',
      severity: 'safe',
      title: '成績持續進步！',
      message: `GPA 上升了 ${insights.gpa.trendDelta} 分，繼續保持！`,
      actionSuggestion: '你的努力正在得到回報，維持目前的學習節奏',
      relatedModules: ['成績'],
      timestamp: now,
    });
  }

  // Sort by severity
  const order: Record<RiskLevel, number> = { critical: 0, danger: 1, warning: 2, watch: 3, safe: 4 };
  results.sort((a, b) => order[a.severity] - order[b.severity]);

  return results;
}

// ─── Daily Briefing ──────────────────────────────────────

/**
 * 產生個人化每日簡報，整合所有模組資料。
 */
export async function generateDailyBriefing(): Promise<DailyBriefing> {
  const insights = await computeRealtimeInsights();
  const now = new Date();
  const hour = now.getHours();
  const todayName = `週${DAY_NAMES[now.getDay()]}`;

  const crossInsights = inferCrossModuleInsights(insights);

  // Greeting
  const greeting = getGreeting(hour);

  // Today summary
  const parts: string[] = [];
  if (insights.timeInsight.todayCourses.length > 0) {
    parts.push(`今天（${todayName}）有 ${insights.timeInsight.todayCourses.length} 堂課`);
  } else {
    parts.push(`今天（${todayName}）沒有課`);
  }

  if (insights.assignments.overdue > 0) {
    parts.push(`${insights.assignments.overdue} 項逾期作業`);
  }
  const urgent = insights.assignments.dueSoon.filter((t) => !t.isLate && t.hoursLeft <= 48);
  if (urgent.length > 0) {
    parts.push(`${urgent.length} 項作業即將到期`);
  }

  if (insights.alerts.length > 0) {
    parts.push(`${insights.alerts.length} 項提醒`);
  }

  const todaySummary = parts.join('，');

  // Quick actions based on context
  const quickActions: string[] = [];
  if (insights.timeInsight.nextClass) {
    quickActions.push(`查看下一堂：${insights.timeInsight.nextClass.name}`);
  }
  if (insights.assignments.overdue > 0) {
    quickActions.push('查看逾期作業');
  }
  if (urgent.length > 0) {
    quickActions.push('查看待繳作業');
  }
  quickActions.push('查看完整分析');

  // Motivational note
  const motivations = [
    '每一步都算數，加油！',
    '今天也要元氣滿滿 💪',
    '學習是場馬拉松，不是短跑',
    '休息是為了走更長遠的路',
    '你比你想像的更強大',
    '專注當下，一步一步來',
    '不要和別人比，和昨天的自己比',
  ];
  const motivationalNote = motivations[now.getDate() % motivations.length];

  return {
    greeting,
    todaySummary,
    topInsights: crossInsights.slice(0, 6),
    quickActions,
    motivationalNote,
  };
}

// ─── Prompt Injection ────────────────────────────────────

/**
 * 將跨模組洞察轉為 system prompt 段落。
 */
export function crossInsightsToPromptText(crossInsights: CrossModuleInsight[]): string {
  if (crossInsights.length === 0) return '';

  const sections: string[] = [];
  sections.push('## 跨模組智慧洞察（AI 主動發現）');
  sections.push('以下是你分析使用者資料後發現的重要洞察，請在回答時主動提及相關的洞察：');
  sections.push('');

  for (const insight of crossInsights.slice(0, 8)) {
    const icon = insight.severity === 'critical' ? '🚨' :
      insight.severity === 'danger' ? '⚠️' :
      insight.severity === 'warning' ? '⚡' :
      insight.severity === 'watch' ? '👀' : 'ℹ️';

    sections.push(`${icon} **${insight.title}**`);
    sections.push(`   ${insight.message}`);
    sections.push(`   → 建議：${insight.actionSuggestion}`);
    sections.push('');
  }

  sections.push('**規則：當使用者的問題與某個洞察相關時，你必須主動引用該洞察並提出建議。例如使用者問「今天有什麼課」時，如果有「作業截止+空閒時間」洞察，也要一併提醒。**');

  return sections.join('\n');
}

/**
 * 將每日簡報轉為 system prompt 段落。
 */
export function dailyBriefingToPromptText(briefing: DailyBriefing): string {
  const sections: string[] = [];
  sections.push('## 今日簡報');
  sections.push(`${briefing.greeting}，${briefing.todaySummary}。`);

  if (briefing.topInsights.length > 0) {
    sections.push('');
    sections.push('重點提醒：');
    for (const ins of briefing.topInsights.slice(0, 4)) {
      sections.push(`- ${ins.title}：${ins.message}`);
    }
  }

  sections.push('');
  sections.push(`💪 ${briefing.motivationalNote}`);

  return sections.join('\n');
}

// ─── Main Export ─────────────────────────────────────────

/**
 * 一次取得所有跨模組洞察。
 */
export async function computeCrossModuleInsights(): Promise<CrossModuleInsight[]> {
  const insights = await computeRealtimeInsights();
  return inferCrossModuleInsights(insights);
}
