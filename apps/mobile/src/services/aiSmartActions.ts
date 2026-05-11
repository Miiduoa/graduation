/* eslint-disable */
/**
 * AI 智慧行動系統 — aiSmartActions.ts
 *
 * AI 分析使用者對話意圖後，即時從快取資料中檢索並格式化結果：
 * - 查成績 → 顯示完整成績單 + 分析
 * - 查課表 → 顯示今日/本週課表
 * - 查出席 → 顯示出席統計
 * - 查作業 → 顯示待繳作業清單 + 優先排序
 * - 查學分 → 顯示畢業學分進度
 * - 下一堂課 → 精確顯示
 * - 空閒時間 → 分析今日空檔
 * - 全面分析 → GPA+學分+出席+作業一次看
 * - 讀書計畫 → AI 根據資料產生個人化計畫
 *
 * 每個 Action 回傳結構化結果，直接嵌入 AI 回覆中，
 * 讓 Gemini 可以引用精確數據。
 */

import {
  getAnyCachedCourses,
  getAnyCachedGrades,
  getAnyCachedTCCourses,
  getAnyCachedTCActivities,
  getAnyCachedTCAttendance,
  getAnyCachedTCTodos,
  getAnyCachedStudentInfo,
} from './puDataCache';
import { resolveActivePostLoginContext } from './postLoginContextFromCaches';
import type { PUCourse, PUGrade } from './puDirectScraper';
import type { TCActivity, TCAttendance } from './tronClassClient';
import { computeRealtimeInsights } from './aiRealtimeAnalytics';

// ─── Types ───────────────────────────────────────────────

export type SmartActionType =
  | 'query_grades'
  | 'query_schedule'
  | 'query_attendance'
  | 'query_assignments'
  | 'query_credits'
  | 'query_student_info'
  | 'query_gpa_prediction'
  | 'query_today_schedule'
  | 'query_next_class'
  | 'query_free_time'
  | 'query_course_load'
  | 'query_risk_analysis'
  | 'suggest_study_plan'
  | 'full_analysis';

export type SmartActionResult = {
  success: boolean;
  action: SmartActionType;
  title: string;
  data: string;
  structuredData?: Record<string, unknown>;
  suggestions?: string[];
};

export type IntentMatch = {
  action: SmartActionType;
  confidence: number;
};

// ─── Constants ───────────────────────────────────────────

const DAY_NAMES = ['日', '一', '二', '三', '四', '五', '六'];

const PERIOD_TIMES: Record<number, { start: string; end: string }> = {
  1: { start: '08:10', end: '09:00' },
  2: { start: '09:10', end: '10:00' },
  3: { start: '10:10', end: '11:00' },
  4: { start: '11:10', end: '12:00' },
  5: { start: '12:40', end: '13:30' },
  6: { start: '13:40', end: '14:30' },
  7: { start: '14:40', end: '15:30' },
  8: { start: '15:40', end: '16:30' },
  9: { start: '16:40', end: '17:30' },
  10: { start: '17:40', end: '18:30' },
  11: { start: '18:35', end: '19:25' },
  12: { start: '19:30', end: '20:20' },
  13: { start: '20:25', end: '21:15' },
};

// ─── Intent Patterns ─────────────────────────────────────

const INTENT_PATTERNS: Array<{
  patterns: RegExp[];
  action: SmartActionType;
  priority: number;
}> = [
  {
    patterns: [/(?:查|看|顯示|我的|給我).*成績/, /成績.*(?:怎|如何|多少|幾分)/, /(?:考|得).*幾分/, /gpa/i, /幾分/, /分數/, /(?:會不會|是不是|有沒有).*被當/, /及格/],
    action: 'query_grades', priority: 8,
  },
  {
    patterns: [/(?:查|看|顯示|我的).*課表/, /(?:這週|本週|下週).*(?:課|有什麼)/, /(?:星期|週).*有.*課/, /(?:幾堂|幾門)課/],
    action: 'query_schedule', priority: 7,
  },
  {
    patterns: [/今天.*(?:課|上什麼)/, /(?:今天|今日).*(?:課表|行程|排課)/, /等等.*(?:課|要上)/, /(?:現在|待會).*上/],
    action: 'query_today_schedule', priority: 9,
  },
  {
    patterns: [/下一堂/, /(?:下一節|接下來).*課/, /(?:幾點|什麼時候).*(?:上課|下課)/],
    action: 'query_next_class', priority: 9,
  },
  {
    patterns: [/(?:查|看|我的).*(?:出席|出勤|缺席|曠課)/, /出席率/, /(?:缺|曠).*幾次/, /翹課/],
    action: 'query_attendance', priority: 7,
  },
  {
    patterns: [/(?:查|看|有什麼|待繳|未交).*作業/, /(?:作業|報告|assignment).*(?:什麼時候|截止|deadline)/, /(?:還有|哪些).*(?:要交|要繳)/, /deadline/i, /截止日/],
    action: 'query_assignments', priority: 8,
  },
  {
    patterns: [/(?:查|看|我的).*學分/, /(?:還差|還需要|還要).*(?:幾|多少).*學分/, /畢業.*(?:學分|夠不夠|能不能)/, /(?:能|可以|會).*畢業/, /修了.*(?:幾|多少).*學分/],
    action: 'query_credits', priority: 8,
  },
  {
    patterns: [/(?:查|看|我的).*(?:個人|學生|基本).*(?:資料|資訊)/, /我是誰/, /我.*(?:學號|班級|系|科系)/],
    action: 'query_student_info', priority: 6,
  },
  {
    patterns: [/(?:預測|預估).*(?:成績|GPA|分數)/, /(?:下學期|未來).*(?:成績|GPA)/, /趨勢/],
    action: 'query_gpa_prediction', priority: 7,
  },
  {
    patterns: [/(?:有空|空閒|自由|沒事)/, /(?:下午|今天|明天).*(?:有空|沒課|空堂)/, /什麼時候.*(?:有空|沒課)/],
    action: 'query_free_time', priority: 7,
  },
  {
    patterns: [/(?:課|負擔|負荷).*(?:多|重|滿)/, /(?:忙不忙|會不會太滿)/, /課程.*(?:安排|分配)/],
    action: 'query_course_load', priority: 6,
  },
  {
    patterns: [/(?:風險|危險|警告).*(?:分析|報告)/, /(?:哪些|什麼).*(?:要注意|需要注意)/, /(?:整體|全面).*(?:分析|狀況)/],
    action: 'query_risk_analysis', priority: 7,
  },
  {
    patterns: [/(?:讀書|複習|學習).*(?:計畫|規劃|安排)/, /(?:怎麼|如何).*(?:準備|複習).*(?:考試|期末|期中)/, /(?:幫|替).*(?:安排|規劃).*(?:學習|讀書)/],
    action: 'suggest_study_plan', priority: 6,
  },
  {
    patterns: [/(?:全面|完整|詳細).*(?:分析|報告|檢查)/, /(?:幫|替).*(?:分析|檢查|看看).*(?:所有|全部)/],
    action: 'full_analysis', priority: 5,
  },
];

// ─── Intent Detection ────────────────────────────────────

export function detectIntents(message: string): IntentMatch[] {
  const matches: IntentMatch[] = [];
  const lower = message.toLowerCase().trim();

  for (const { patterns, action, priority } of INTENT_PATTERNS) {
    for (const re of patterns) {
      if (re.test(lower) || re.test(message)) {
        const existing = matches.find((m) => m.action === action);
        if (!existing) {
          matches.push({ action, confidence: priority / 10 });
        }
        break;
      }
    }
  }

  return matches.sort((a, b) => b.confidence - a.confidence);
}

// ─── Action Executors ────────────────────────────────────

async function execQueryGrades(): Promise<SmartActionResult> {
  const result = await getAnyCachedGrades();
  if (!result || result.grades.length === 0) {
    return { success: false, action: 'query_grades', title: '成績查詢', data: '目前沒有成績資料。請先登入 E校園 同步。', suggestions: ['登入E校園'] };
  }

  const { grades, summary } = result;
  const bySemester = new Map<string, PUGrade[]>();
  for (const g of grades) {
    const sem = g.semester || '未知';
    if (!bySemester.has(sem)) bySemester.set(sem, []);
    bySemester.get(sem)!.push(g);
  }

  const lines: string[] = ['📊 完整成績單：\n'];
  for (const sem of Array.from(bySemester.keys()).sort()) {
    const sg = bySemester.get(sem)!;
    let pts = 0, creds = 0;
    lines.push(`📌 ${sem} 學期：`);
    for (const g of sg) {
      const score = typeof g.score === 'number' ? g.score : parseFloat(String(g.score));
      const icon = isNaN(score) ? '⬜' : score >= 60 ? '✅' : '❌';
      lines.push(`  ${icon} ${g.courseName}（${g.courseType}，${g.credits}學分）：${g.score}`);
      if (!isNaN(score) && g.credits > 0) { pts += score * g.credits; creds += g.credits; }
    }
    const avg = creds > 0 ? (pts / creds).toFixed(1) : '—';
    lines.push(`  📈 學期平均：${avg}（${creds}學分）`);
    if (summary[sem]?.departmentRanking) lines.push(`  🏆 系排：${summary[sem].departmentRanking}`);
    if (summary[sem]?.classRanking) lines.push(`  🏆 班排：${summary[sem].classRanking}`);
    lines.push('');
  }

  return { success: true, action: 'query_grades', title: '成績查詢', data: lines.join('\n'), structuredData: { grades }, suggestions: ['分析趨勢', '查學分進度', '哪科需要加強'] };
}

async function execQuerySchedule(): Promise<SmartActionResult> {
  const r = await getAnyCachedCourses();
  if (!r || r.courses.length === 0) {
    return { success: false, action: 'query_schedule', title: '課表', data: '沒有課程資料，請登入 E校園。' };
  }
  const { courses, totalCredits, semester } = r;
  const byDay = new Map<number, PUCourse[]>();
  for (const c of courses) { if (c.dayOfWeek != null && c.dayOfWeek >= 0) { if (!byDay.has(c.dayOfWeek)) byDay.set(c.dayOfWeek, []); byDay.get(c.dayOfWeek)!.push(c); } }

  const lines: string[] = [`📅 ${semester ?? ''}課表（${courses.length}門，${totalCredits}學分）：\n`];
  for (let d = 1; d <= 6; d++) {
    const dc = (byDay.get(d) ?? []).sort((a, b) => { const pa = a.periods?.length ? Math.min(...a.periods) : 99; const pb = b.periods?.length ? Math.min(...b.periods) : 99; return pa - pb; });
    lines.push(`📌 週${DAY_NAMES[d]}：${dc.length === 0 ? '沒課 🎉' : ''}`);
    for (const c of dc) {
      const time = c.startTime && c.endTime ? `${c.startTime}-${c.endTime}` : c.periods?.length ? `第${c.periods.join(',')}節` : '';
      lines.push(`  ${time} ${c.name}（${c.location ?? ''}）${c.teacherName ?? ''}`);
    }
  }
  return { success: true, action: 'query_schedule', title: '課表', data: lines.join('\n'), suggestions: ['今天有什麼課', '哪天最忙', '查作業截止日'] };
}

async function execQueryTodaySchedule(): Promise<SmartActionResult> {
  const r = await getAnyCachedCourses();
  const now = new Date();
  const today = now.getDay();

  if (!r) return { success: false, action: 'query_today_schedule', title: '今日課表', data: '沒有課程資料。' };

  const todayCourses = r.courses.filter((c) => c.dayOfWeek === today)
    .sort((a, b) => { const pa = a.periods?.length ? Math.min(...a.periods) : 99; const pb = b.periods?.length ? Math.min(...b.periods) : 99; return pa - pb; });

  if (todayCourses.length === 0) {
    return { success: true, action: 'query_today_schedule', title: '今日課表', data: `今天（週${DAY_NAMES[today]}）沒課！🎉`, suggestions: ['明天有什麼課', '查作業', '空閒時間做什麼'] };
  }

  const nowMin = now.getHours() * 60 + now.getMinutes();
  const lines: string[] = [`📅 今天（週${DAY_NAMES[today]}）${todayCourses.length}堂課：\n`];

  for (const c of todayCourses) {
    const st = c.startTime ?? (c.periods?.length ? PERIOD_TIMES[Math.min(...c.periods)]?.start : null) ?? '';
    const et = c.endTime ?? (c.periods?.length ? PERIOD_TIMES[Math.max(...c.periods)]?.end : null) ?? '';
    let status = '⏳';
    if (st && et) {
      const [sh, sm] = st.split(':').map(Number);
      const [eh, em] = et.split(':').map(Number);
      if (nowMin >= sh * 60 + sm && nowMin <= eh * 60 + em) status = '📍正在上';
      else if (nowMin > eh * 60 + em) status = '✅已結束';
      else { const diff = sh * 60 + sm - nowMin; status = diff <= 30 ? `⏰${diff}分鐘後` : '⏳待上課'; }
    }
    lines.push(`${status} ${st}-${et} ${c.name}`);
    lines.push(`   📍${c.location || '教室未定'} | ${c.teacherName || ''}`);
  }

  return { success: true, action: 'query_today_schedule', title: '今日課表', data: lines.join('\n'), suggestions: ['下一堂是什麼', '今天有空嗎', '查作業'] };
}

async function execQueryNextClass(): Promise<SmartActionResult> {
  const r = await getAnyCachedCourses();
  if (!r) return { success: false, action: 'query_next_class', title: '下一堂', data: '沒有課程資料。' };

  const now = new Date();
  const today = now.getDay();
  const nowMin = now.getHours() * 60 + now.getMinutes();

  // Today's remaining classes
  const remaining = r.courses.filter((c) => c.dayOfWeek === today).map((c) => {
    const st = c.startTime ?? (c.periods?.length ? PERIOD_TIMES[Math.min(...c.periods)]?.start : null) ?? '0:0';
    const [h, m] = st.split(':').map(Number);
    return { ...c, _startMin: h * 60 + m, _startTime: st };
  }).filter((c) => c._startMin > nowMin).sort((a, b) => a._startMin - b._startMin);

  if (remaining.length > 0) {
    const n = remaining[0];
    const diff = n._startMin - nowMin;
    return {
      success: true, action: 'query_next_class', title: '下一堂',
      data: `⏰ 下一堂：${n.name}\n📍 ${n.location || '教室未定'} | ${n._startTime}\n⏳ 還有 ${diff} 分鐘\n👨‍🏫 ${n.teacherName || ''}`,
      suggestions: ['今天還有幾堂', '怎麼去教室'],
    };
  }

  // Find next day
  for (let off = 1; off <= 7; off++) {
    const d = (today + off) % 7;
    const dc = r.courses.filter((c) => c.dayOfWeek === d).sort((a, b) => { const pa = a.periods?.length ? Math.min(...a.periods) : 99; const pb = b.periods?.length ? Math.min(...b.periods) : 99; return pa - pb; });
    if (dc.length > 0) {
      const n = dc[0];
      const st = n.startTime ?? (n.periods?.length ? PERIOD_TIMES[Math.min(...n.periods)]?.start : null) ?? '';
      return { success: true, action: 'query_next_class', title: '下一堂', data: `今天沒更多課了！\n📅 下一堂：週${DAY_NAMES[d]} ${n.name}（${st}）\n📍 ${n.location || ''} | ${n.teacherName || ''}`, suggestions: ['查課表', '查作業'] };
    }
  }

  return { success: true, action: 'query_next_class', title: '下一堂', data: '找不到接下來的課程。' };
}

async function execQueryAttendance(): Promise<SmartActionResult> {
  const att = await getAnyCachedTCAttendance();
  if (!att || att.length === 0) return { success: false, action: 'query_attendance', title: '出席', data: '沒有出席資料，請登入 TronClass。' };

  const sorted = [...att].sort((a, b) => a.rate - b.rate);
  let totalA = 0, totalS = 0;
  const lines: string[] = ['📋 出席紀錄：\n'];
  for (const a of sorted) {
    const e = a.rate >= 90 ? '🟢' : a.rate >= 75 ? '🟡' : a.rate >= 60 ? '🟠' : '🔴';
    lines.push(`${e} ${a.course_name}：${a.rate}%（出席${a.attended}/${a.total_sessions}，缺席${a.absent}，遲到${a.late}）`);
    totalA += a.attended; totalS += a.total_sessions;
  }
  const overall = totalS > 0 ? Math.round((totalA / totalS) * 100) : 0;
  lines.push(`\n📊 整體出席率：${overall}%`);
  const atRisk = sorted.filter((a) => a.rate < 75);
  if (atRisk.length > 0) lines.push(`⚠️ 需注意：${atRisk.map((a) => a.course_name).join('、')}`);

  return { success: true, action: 'query_attendance', title: '出席', data: lines.join('\n'), suggestions: ['哪些課要注意', '會影響成績嗎', '查課表'] };
}

async function execQueryAssignments(): Promise<SmartActionResult> {
  const [acts, todos, tcc, ctx] = await Promise.all([
    getAnyCachedTCActivities(),
    getAnyCachedTCTodos(),
    getAnyCachedTCCourses(),
    resolveActivePostLoginContext(),
  ]);
  const cm = new Map<number, string>();
  if (tcc) for (const c of tcc) cm.set(c.id, c.name);

  type T = TCActivity & { _cn: string };
  const all: T[] = [];
  if (acts) for (const [cid, as] of Object.entries(acts)) { const cn = cm.get(Number(cid)) ?? `課程#${cid}`; for (const a of as) if (['homework', 'quiz', 'exam'].includes(a.type)) all.push({ ...a, _cn: cn }); }
  if (todos) for (const t of todos) if (!all.some((a) => a.id === t.id)) all.push({ ...t, _cn: cm.get(t.course_id) ?? `課程#${t.course_id}` });

  if (all.length === 0 && ctx?.asStudent?.pendingAssignments?.length) {
    const pend = ctx.asStudent.pendingAssignments;
    const lines = [
      '📝 作業（PostLogin 標準化視角）：\n',
      ...pend.map((a) => `  📋 ${a.title}（課程 id ${a.courseId}）— 截止：${a.dueAt || '未設定'} — ${a.status}`),
    ];
    return { success: true, action: 'query_assignments', title: '作業', data: lines.join('\n'), suggestions: ['查課表', '全面分析'] };
  }

  if (all.length === 0) return { success: true, action: 'query_assignments', title: '作業', data: '目前沒有作業資料。' };

  const now = Date.now();
  const od: T[] = [], pend: T[] = [], done: T[] = [];
  for (const t of all) {
    if (t.status === 'graded' || t.status === 'submitted') { done.push(t); continue; }
    if (t.end_time && new Date(t.end_time).getTime() < now) od.push(t); else pend.push(t);
  }
  pend.sort((a, b) => { const da = a.end_time ? new Date(a.end_time).getTime() : Infinity; const db = b.end_time ? new Date(b.end_time).getTime() : Infinity; return da - db; });

  const lines: string[] = ['📝 作業追蹤：\n'];
  if (od.length > 0) { lines.push(`🚨 已逾期（${od.length}項）：`); for (const t of od) lines.push(`  ❌ ${t.title}（${t._cn}）— 截止：${t.end_time}`); lines.push(''); }
  if (pend.length > 0) {
    lines.push(`⏳ 待繳（${pend.length}項）：`);
    for (const t of pend) {
      const d = t.end_time ? new Date(t.end_time) : null;
      let u = '';
      if (d) { const h = (d.getTime() - now) / 3600000; u = h <= 24 ? '🔴今天截止！' : h <= 72 ? '🟡3天內' : `📅${d.toLocaleDateString('zh-TW')}`; }
      lines.push(`  📋 ${t.title}（${t._cn}）${u}`);
    }
    lines.push('');
  }
  lines.push(`✅ 已完成：${done.length}項 | 完成率：${Math.round((done.length / all.length) * 100)}%`);

  return { success: true, action: 'query_assignments', title: '作業', data: lines.join('\n'), suggestions: ['哪個最急', '安排讀書計畫', '查成績'] };
}

async function execQueryCredits(): Promise<SmartActionResult> {
  const insights = await computeRealtimeInsights();
  const { credits: c } = insights;
  const filled = Math.round(c.completionPercent / 5);
  const bar = '█'.repeat(filled) + '░'.repeat(20 - filled);

  const lines = [
    '🎓 畢業學分進度：\n',
    `[${bar}] ${c.completionPercent}%`,
    `📊 已修：${c.totalEarned} / ${c.totalRequired} 學分`,
    `📚 本學期：${c.currentSemesterCredits} 學分`,
    `📐 還需：${c.remainingCredits} 學分`,
    `📅 預估還需 ${c.estimatedGraduationSemesters} 學期`,
    '', '📂 分類進度：',
    ...c.byCategory.map((cat) => `  ${cat.category}：${cat.earned}/${cat.required}（${cat.percent}%）`),
    '', c.onTrack ? '✅ 畢業進度正常' : '⚠️ 建議增加選課數量',
  ];

  return { success: true, action: 'query_credits', title: '學分進度', data: lines.join('\n'), suggestions: ['推薦選什麼課', '查成績', '還需哪些通識'] };
}

async function execQueryStudentInfo(): Promise<SmartActionResult> {
  const info = await getAnyCachedStudentInfo();
  if (!info) return { success: false, action: 'query_student_info', title: '個人資料', data: '沒有學生資料，請登入 E校園。' };
  const lines = ['👤 基本資料：\n'];
  if (info.name) lines.push(`姓名：${info.name}`);
  if (info.studentId) lines.push(`學號：${info.studentId}`);
  if (info.department) lines.push(`科系：${info.department}`);
  if (info.grade) lines.push(`年級：${info.grade}`);
  if (info.className) lines.push(`班級：${info.className}`);
  return { success: true, action: 'query_student_info', title: '個人資料', data: lines.join('\n'), suggestions: ['查成績', '查課表', '學分進度'] };
}

async function execFullAnalysis(): Promise<SmartActionResult> {
  const ins = await computeRealtimeInsights();
  const lines = [
    '📊 全面學業分析報告：\n',
    '━━━ 成績 ━━━', ins.gpa.summary, '',
    '━━━ 學分 ━━━', ins.credits.summary, '',
    '━━━ 出席 ━━━', ins.attendance.summary, '',
    '━━━ 作業 ━━━', ins.assignments.summary, '',
    '━━━ 課程負載 ━━━', ins.courseLoad.summary, '',
    '━━━ 今日 ━━━', ins.timeInsight.summary, '',
  ];
  if (ins.alerts.length > 0) {
    lines.push('━━━ 提醒 ━━━');
    for (const a of ins.alerts.slice(0, 6)) {
      const ic = a.severity === 'critical' ? '🚨' : a.severity === 'danger' ? '⚠️' : 'ℹ️';
      lines.push(`${ic} ${a.title} → ${a.actionSuggestion}`);
    }
    lines.push('');
  }
  const he = ins.overallHealth === 'safe' ? '✅' : ins.overallHealth === 'watch' ? '👀' : '⚠️';
  lines.push(`━━━ 整體：${he} ${ins.overallHealth.toUpperCase()} ━━━`);
  lines.push(ins.overallSummary);
  return { success: true, action: 'full_analysis', title: '全面分析', data: lines.join('\n'), suggestions: ['哪科要注意', '安排讀書計畫', '推薦選課'] };
}

async function execSuggestStudyPlan(): Promise<SmartActionResult> {
  const ins = await computeRealtimeInsights();
  const { assignments, timeInsight, gpa, attendance } = ins;
  const lines: string[] = ['📖 AI 讀書計畫：\n'];

  if (assignments.overdue > 0) {
    lines.push('🚨 最優先 — 逾期作業：');
    for (const t of assignments.dueSoon.filter((d) => d.isLate).slice(0, 3)) lines.push(`  → 立即完成：${t.title}（${t.courseName}）`);
    lines.push('');
  }
  const urgent = assignments.dueSoon.filter((d) => !d.isLate && d.hoursLeft <= 72);
  if (urgent.length > 0) {
    lines.push('⏰ 本週重點：');
    for (const t of urgent.slice(0, 5)) lines.push(`  → ${t.title}（${t.courseName}）— 剩${t.hoursLeft}小時`);
    lines.push('');
  }
  if (attendance.coursesAtRisk.length > 0) {
    lines.push('📋 出席偏低 — 務必出席+複習：');
    for (const c of attendance.coursesAtRisk.slice(0, 3)) lines.push(`  → ${c.courseName}（${c.rate}%）`);
    lines.push('');
  }
  if (gpa.lowScoreCourses.length > 0) {
    lines.push('📉 需加強：');
    for (const c of gpa.lowScoreCourses.slice(0, 3)) lines.push(`  → ${c.name}（${c.score}分）`);
    lines.push('');
  }

  const freeH = Math.round(timeInsight.freeTimeToday / 60);
  lines.push(`📅 今日建議（空閒約${freeH}小時）：`);
  if (freeH >= 4) {
    lines.push('  → 2h 處理最急作業', '  → 1h 複習弱科', '  → 1h 預習明天的課');
  } else if (freeH >= 2) {
    lines.push(urgent.length > 0 ? `  → 全力完成：${urgent[0].title}` : '  → 複習今天上課內容');
  } else {
    lines.push('  → 利用零碎時間複習筆記');
  }

  return { success: true, action: 'suggest_study_plan', title: '讀書計畫', data: lines.join('\n'), suggestions: ['更詳細計畫', '查作業截止日', '查成績'] };
}

// ─── Action Router ───────────────────────────────────────

const HANDLERS: Record<SmartActionType, () => Promise<SmartActionResult>> = {
  query_grades: execQueryGrades,
  query_schedule: execQuerySchedule,
  query_today_schedule: execQueryTodaySchedule,
  query_next_class: execQueryNextClass,
  query_attendance: execQueryAttendance,
  query_assignments: execQueryAssignments,
  query_credits: execQueryCredits,
  query_student_info: execQueryStudentInfo,
  query_gpa_prediction: async () => {
    const ins = await computeRealtimeInsights();
    const { gpa } = ins;
    const lines = ['📈 GPA 預測：\n'];
    if (gpa.semesterGPAs.length > 0) { lines.push('歷史趨勢：'); for (const s of gpa.semesterGPAs) { const bar = '█'.repeat(Math.round(s.gpa / 5)); lines.push(`  ${s.semester}：${s.gpa} ${bar}`); } lines.push(''); }
    const te = gpa.trend === 'rising' ? '📈上升' : gpa.trend === 'declining' ? '📉下降' : '➡️穩定';
    lines.push(`趨勢：${te}`);
    if (gpa.predictedNextGPA !== null) lines.push(`預測下學期：${gpa.predictedNextGPA}`);
    if (gpa.failedCourses.length > 0) lines.push(`\n⚠️ 不及格：${gpa.failedCourses.map((f) => f.name).join('、')}`);
    return { success: true, action: 'query_gpa_prediction', title: 'GPA預測', data: lines.join('\n'), suggestions: ['怎麼提升', '查完整成績', '哪些課可補'] };
  },
  query_free_time: async () => {
    const ins = await computeRealtimeInsights();
    const { timeInsight: ti, courseLoad: cl } = ins;
    const lines = ['🕐 空閒時間：\n', ti.summary, ''];
    if (ti.todayCourses.length > 0) {
      lines.push('今天空檔：');
      const sorted = [...ti.todayCourses].sort((a, b) => a.startTime.localeCompare(b.startTime));
      let last = '08:10';
      for (const c of sorted) { if (c.startTime > last) lines.push(`  🟢 ${last}-${c.startTime} 空閒`); lines.push(`  📚 ${c.startTime}-${c.endTime} ${c.name}`); last = c.endTime; }
      if (last < '21:00') lines.push(`  🟢 ${last}-21:00 空閒`);
    } else { lines.push('今天整天空閒！🎉'); }
    lines.push('', `⏳ 剩餘：約${Math.round(ti.freeTimeToday / 60)}小時`, '', '本週分布：');
    for (const d of cl.dailyLoad) lines.push(`  ${d.day}：${d.courseCount === 0 ? '空閒🎉' : `${d.courseCount}堂(${d.hours}h)`}`);
    return { success: true, action: 'query_free_time', title: '空閒時間', data: lines.join('\n'), suggestions: ['安排讀書計畫', '推薦活動', '附近好吃的'] };
  },
  query_course_load: async () => {
    const ins = await computeRealtimeInsights();
    return { success: true, action: 'query_course_load', title: '課程負載', data: ins.courseLoad.summary, suggestions: ['哪天最忙', '查課表', '分析空閒'] };
  },
  query_risk_analysis: async () => {
    const ins = await computeRealtimeInsights();
    if (ins.alerts.length === 0) return { success: true, action: 'query_risk_analysis', title: '風險分析', data: '✅ 目前沒有風險項目！', suggestions: ['全面分析', '查成績', '查課表'] };
    const lines = [`⚡ 風險分析（${ins.alerts.length}項）：\n`];
    for (const a of ins.alerts) {
      const ic = a.severity === 'critical' ? '🚨' : a.severity === 'danger' ? '⚠️' : 'ℹ️';
      lines.push(`${ic} [${a.severity.toUpperCase()}] ${a.title}`, `   ${a.message}`, `   💡 ${a.actionSuggestion}`, '');
    }
    return { success: true, action: 'query_risk_analysis', title: '風險分析', data: lines.join('\n'), suggestions: ['怎麼改善', '查成績', '讀書計畫'] };
  },
  suggest_study_plan: execSuggestStudyPlan,
  full_analysis: execFullAnalysis,
};

/**
 * 執行指定行動，回傳格式化結果。
 */
export async function executeSmartAction(action: SmartActionType): Promise<SmartActionResult> {
  const handler = HANDLERS[action];
  if (!handler) return { success: false, action, title: '未知', data: `不支援：${action}` };
  try { return await handler(); }
  catch (e: any) { return { success: false, action, title: '失敗', data: `執行失敗：${e?.message ?? '未知'}` }; }
}

/**
 * 偵測意圖 + 自動執行。
 * 回傳 null 表示無匹配意圖，由 AI 自由回答。
 */
export async function detectAndExecuteSmartAction(message: string): Promise<SmartActionResult | null> {
  const intents = detectIntents(message);
  if (intents.length === 0 || intents[0].confidence < 0.5) return null;
  return executeSmartAction(intents[0].action);
}
