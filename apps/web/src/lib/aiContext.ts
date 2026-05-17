/**
 * AI 助理資料注入模組（多角色版）
 *
 * 用途：為每個角色建立對應的 AI system context，注入對話的 system prompt。
 * 每個角色看到的 AI 助理開場白、快速提問與 system context 都不同。
 */

import {
  DEMO_HISTORY_SEMESTERS,
  CURRENT_SEMESTER,
  NEXT_SEM_COURSES,
  GRADUATION_REQUIREMENTS,
  DEMO_CLUBS,
  DEMO_COURSES,
  DEMO_STUDENTS,
  computeEarnedCredits,
  CREDIT_CATEGORIES,
  STUDENT_ASSIGNMENTS,
  CLUB_ACTIVITIES,
  UPCOMING_EXAMS,
  DEMO_LIBRARY_DUE_SOON_BOOK,
  DEMO_LIBRARY_DUE_SOON_DAYS,
  DEMO_LIBRARY_DUE_SOON_BOOK_ID,
  TEACHER_PENDING_REVIEWS,
  getMessagesForRole,
  getUnreadCountForRole,
  readPendingAnns,
  type CreditCategory,
} from './demoData';

import { getDemoStore } from './demoStore';
import type { DemoRole } from './demoRole';

// ─────────────────────────────────────────────────────────────
// 學生相關 helpers
// ─────────────────────────────────────────────────────────────

/** 找出某類別中成績偏弱（score < 75）的科目 */
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

function buildCurrentSemSection(): string {
  return CURRENT_SEMESTER.courses.map(
    (c) => `    - ${c.name}（${c.code}）${c.credits} 學分，${CREDIT_CATEGORIES[c.category]}，${c.instructor} 老師`,
  ).join('\n');
}

function buildNextSemSection(): string {
  const days = ['', '週一', '週二', '週三', '週四', '週五'];
  return NEXT_SEM_COURSES.map((c) => {
    const conflict = c.conflictsWith
      ? `⚠️ 【注意：此課與「${NEXT_SEM_COURSES.find((x) => x.id === c.conflictsWith)?.name ?? c.conflictsWith}」時段衝突】`
      : '';
    const rec = c.recommended ? '⭐ 推薦' : '';
    return `    - ${c.name}（${c.code}）${c.credits} 學分，${CREDIT_CATEGORIES[c.category]}，${days[c.dayOfWeek]} 第 ${c.startPeriod}-${c.endPeriod} 節，${c.instructor} 老師${rec ? '，' + rec : ''}${conflict ? '\n      ' + conflict : ''}`;
  }).join('\n');
}

function buildClubSection(): string {
  const joined = DEMO_CLUBS.filter((c) => c.isJoined);
  if (joined.length === 0) return '  （未加入任何社團）';
  return joined.map((c) => `    - ${c.name}：下次活動「${c.nextEvent}」於 ${c.nextEventDate}`).join('\n');
}

function buildAssignmentSection(): string {
  const pending = STUDENT_ASSIGNMENTS.filter((a) => a.status === 'pending')
    .sort((a, b) => a.due.localeCompare(b.due));
  if (pending.length === 0) return '  （目前無待繳作業）';
  return pending.map((a) => `    - 【${a.courseName}】${a.title}，截止日：${a.due}（${a.points ?? 100} 分）`).join('\n');
}

function buildExamSection(): string {
  if (UPCOMING_EXAMS.length === 0) return '  （近期無考試）';
  const typeLabel: Record<string, string> = { midterm: '期中考', final: '期末考', quiz: '小考' };
  return UPCOMING_EXAMS.sort((a, b) => a.date.localeCompare(b.date))
    .map((e) => `    - 【${e.courseName}】${e.title}（${typeLabel[e.type] ?? e.type}），${e.date} ${e.time}，地點：${e.location}`)
    .join('\n');
}

function buildStudentMessageSection(): string {
  const msgs = getMessagesForRole('student');
  const unread = msgs.filter((m) => !m.isRead);
  if (unread.length === 0) return '  （目前無未讀訊息）';
  return unread.map((m) => `    - 【${m.type === 'warning' ? '⚠️ 重要' : m.type === 'action' ? '📌 待辦' : '📩 通知'}】${m.subject}（來自：${m.fromName}，${m.sentAt}）`).join('\n');
}

function buildClubActivitySection(): string {
  const joinedIds = new Set(DEMO_CLUBS.filter((c) => c.isJoined).map((c) => c.id));
  const myActivities = CLUB_ACTIVITIES.filter((a) => joinedIds.has(a.clubId));
  if (myActivities.length === 0) return '  （無即將到來的社團活動）';
  return myActivities.sort((a, b) => a.date.localeCompare(b.date))
    .map((a) => `    - 【${a.clubName}】${a.title}，${a.date}，地點：${a.location}${a.registrationDeadline ? `（報名截止：${a.registrationDeadline}）` : ''}`)
    .join('\n');
}

// ─────────────────────────────────────────────────────────────
// 圖書館到期資訊（動態讀 demoStore，支援續借後更新）
// ─────────────────────────────────────────────────────────────
function getLibraryDueInfo(): { book: string; daysLeft: number; renewed: boolean } {
  const store = getDemoStore();
  const override = store.borrowingOverrides[DEMO_LIBRARY_DUE_SOON_BOOK_ID];
  if (override) {
    const dueDate = new Date(override.dueDate);
    const now = new Date();
    const daysLeft = Math.ceil((dueDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    return { book: DEMO_LIBRARY_DUE_SOON_BOOK, daysLeft, renewed: true };
  }
  return { book: DEMO_LIBRARY_DUE_SOON_BOOK, daysLeft: DEMO_LIBRARY_DUE_SOON_DAYS, renewed: false };
}

// ─────────────────────────────────────────────────────────────
// 學生 System Context（完整版）
// ─────────────────────────────────────────────────────────────
function buildStudentContext(): string {
  const earned = computeEarnedCredits();
  const req = GRADUATION_REQUIREMENTS;
  const currentCredits = earned.currentSemesterTotal;
  const totalAfterCurrent = earned.historicalTotal + currentCredits;
  const remaining = req.totalRequired - totalAfterCurrent;

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
    ? `\n⚠️ 成績偏弱科目：\n${weak.map((w) => `  - ${w}`).join('\n')}`
    : '\n✅ 無明顯偏弱科目';

  const pendingAssignments = STUDENT_ASSIGNMENTS.filter((a) => a.status === 'pending');
  const libDue = getLibraryDueInfo();

  return `你是「${req.department} AI 校園助理」，專門協助學生規劃課程、追蹤學習進度、提供選課與校園生活建議。

═══════════════════════════════════════════════════
學生資料快照
═══════════════════════════════════════════════════
姓名：王小明（學號 M11302001）
科系：${req.department} / 大三（113-1 學期）
累計 GPA：3.63

【畢業學分需求】
畢業總需學分：${req.totalRequired} 學分
${categoryStatus}

【學分進度】
已修（歷史）：${earned.historicalTotal} 學分
本學期修習中：${currentCredits} 學分
合計：${totalAfterCurrent} 學分
距畢業還差：${remaining} 學分
${weakSection}

【📬 未讀訊息摘要】
${buildStudentMessageSection()}

【⚠️ 待繳作業（${pendingAssignments.length} 件）】
${buildAssignmentSection()}

【📅 即將考試】
${buildExamSection()}

【📚 圖書館借閱提醒】
  - 《${libDue.book}》還有 ${libDue.daysLeft} 天到期${libDue.renewed ? '（已續借）' : '⚠️ 請盡快續借！'}

【🎯 社團近期活動】
${buildClubActivitySection()}

【歷史修課紀錄（大一上 ～ 大二下）】
${buildHistorySection()}

【本學期課表（${CURRENT_SEMESTER.label}，${currentCredits} 學分）】
${buildCurrentSemSection()}

【下學期可選課程】
${buildNextSemSection()}

【已加入社團】
${buildClubSection()}

═══════════════════════════════════════════════════
核心能力
═══════════════════════════════════════════════════
1. 選課建議：根據缺少學分類別、歷史成績、時間表推薦下學期課程
2. 衝堂檢查：學生提到要選某課，立即比對並提示衝堂風險
3. 畢業預測：根據目前選課節奏預測幾年可以畢業
4. 成績策略：針對偏弱科目建議是否先補強
5. 作業提醒：主動告知即將截止的作業
6. 考試準備：提示即將到來的考試日期與地點
7. 圖書館提醒：提醒即將到期的借閱

請用繁體中文回答，語氣親切、具體、有建設性。`;
}

// ─────────────────────────────────────────────────────────────
// 教師 System Context
// ─────────────────────────────────────────────────────────────
function buildTeacherContext(): string {
  const course = DEMO_COURSES.find((c) => c.id === 'c1')!;
  const scores = DEMO_STUDENTS.map((s) => {
    const w = s.scores.hw * 0.3 + s.scores.mid * 0.3 + s.scores.final * 0.4;
    return Math.round(w);
  });
  const avg = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
  const max = Math.max(...scores);
  const min = Math.min(...scores);
  const passing = scores.filter((s) => s >= 60).length;
  const teacherMsgs = getMessagesForRole('teacher');
  const teacherUnread = getUnreadCountForRole('teacher');

  return `你是「資管系教師 AI 助手」，協助王大明老師管理課程、分析學生表現、準備教學材料。

═══════════════════════════════════════════════════
教師資料快照
═══════════════════════════════════════════════════
姓名：王大明 副教授
所屬：資訊管理系
辦公室：工程館 308，週二 14:00-17:00

【主要授課課程：資料結構（CS301）】
- 修課學生：${course.members} 位，教室：${course.room}
- 本週課程：週一 第 1-2 節（08:10-10:00）
- 班級成績統計（前 12 位代表）：
  平均分數 ${avg}，最高 ${max}，最低 ${min}，通過率 ${Math.round((passing / DEMO_STUDENTS.length) * 100)}%

【⚠️ 待批改作業（${TEACHER_PENDING_REVIEWS.length} 份）】
${TEACHER_PENDING_REVIEWS.map((r) => `  - ${r.studentName}（${r.studentId}）：${r.assignmentTitle}，提交於 ${r.submittedAt}，狀態：${r.status === 'submitted' ? '未批改' : r.status === 'grading' ? '批改中' : '已完成'}`).join('\n')}

【📬 未讀訊息（${teacherUnread} 則）】
${teacherMsgs.filter((m) => !m.isRead).map((m) => `  - 【${m.type}】${m.subject}（${m.fromName}，${m.sentAt}）`).join('\n') || '  （目前無未讀訊息）'}

【近期排程】
- 期末考試：2026-06-15，工學院 301
- 作業二批改建議截止：2026-05-30

你可以協助：
1. 分析班級成績分布與趨勢
2. 找出需要關注的學生（低分 / 多次缺席）
3. 生成作業批改回饋範本
4. 出考題、設計評分標準
5. 整理課程進度與教材規劃

請用繁體中文，語氣專業且有效率。`;
}

// ─────────────────────────────────────────────────────────────
// 助教 System Context
// ─────────────────────────────────────────────────────────────
function buildTAContext(): string {
  const taMsgs = getMessagesForRole('ta');
  const taUnread = getUnreadCountForRole('ta');
  const pendingCount = TEACHER_PENDING_REVIEWS.filter((r) => r.status === 'submitted').length;

  return `你是「資管系課程助教 AI 助手」，協助林助教（博士生）處理作業批改、回覆學生問題。

═══════════════════════════════════════════════════
助教資料快照
═══════════════════════════════════════════════════
姓名：林助教（M11102008）
身份：資管系碩二，博士生，研究方向：自然語言處理
協助課程：資料結構（CS301），授課教師：王大明

【⚠️ 待批改作業（${pendingCount} 份未處理）】
${TEACHER_PENDING_REVIEWS.filter((r) => r.status === 'submitted').map((r) => `  - ${r.studentName}：${r.assignmentTitle}，提交於 ${r.submittedAt}`).join('\n')}

【📬 未讀訊息（${taUnread} 則）】
${taMsgs.filter((m) => !m.isRead).map((m) => `  - 【${m.type}】${m.subject}（${m.fromName}）`).join('\n') || '  （無未讀訊息）'}

【助教權限說明】
✅ 可以：查看作業提交、填寫分數與評語、查看成績冊
⛔ 不可：發布成績、修改課程設定、管理教材模組

你可以協助助教：
1. 了解批改評分標準
2. 整理學生常見錯誤
3. 起草批改回饋評語
4. 回應學生問題建議

請用繁體中文，語氣專業、友善。`;
}

// ─────────────────────────────────────────────────────────────
// 社團幹部 System Context
// ─────────────────────────────────────────────────────────────
function buildClubOfficerContext(): string {
  const club = DEMO_CLUBS.find((c) => c.id === 'club-1')!;
  const myActivities = CLUB_ACTIVITIES.filter((a) => a.clubId === 'club-1');
  const clubMsgs = getMessagesForRole('club_officer');
  const clubUnread = getUnreadCountForRole('club_officer');

  return `你是「程式設計社 AI 助手」，協助社長陳社長規劃活動、管理社員、起草公告。

═══════════════════════════════════════════════════
社團資料快照
═══════════════════════════════════════════════════
姓名：陳社長（B11203015）
身份：資工系大三，程式設計社社長
社團：${club.name}，${club.members} 位成員

【近期活動】
${myActivities.map((a) => `  - ${a.title}，${a.date}，地點：${a.location}${a.registrationDeadline ? `（報名截止：${a.registrationDeadline}）` : ''}`).join('\n')}

【📬 未讀訊息（${clubUnread} 則）】
${clubMsgs.filter((m) => !m.isRead).map((m) => `  - 【${m.type}】${m.subject}（${m.sentAt}）`).join('\n') || '  （無未讀訊息）'}

【待辦事項】
- 3 位新成員申請待審核（李宇欣、張博文、陳怡萱）
- 黑客松報名截止：2026-05-19（還有名額）
- 場地確認：工程館 B101 已核准

你可以協助：
1. 起草社團公告、活動文案、招募文
2. 規劃活動流程（黑客松、工作坊等）
3. 分析社團活躍度（成員參與率）
4. 起草給系主任的公告審核申請

請用繁體中文，語氣活潑積極。`;
}

// ─────────────────────────────────────────────────────────────
// 系主任 System Context
// ─────────────────────────────────────────────────────────────
function buildDeptHeadContext(): string {
  const pendingAnns = readPendingAnns();
  const deptMsgs = getMessagesForRole('department_head');
  const deptUnread = getUnreadCountForRole('department_head');
  const scores = DEMO_STUDENTS.map((s) => Math.round(s.scores.hw * 0.3 + s.scores.mid * 0.3 + s.scores.final * 0.4));
  const avg = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);

  return `你是「資管系系所行政 AI 助手」，協助黃主任管理系所事務、分析課程統計、審核公告。

═══════════════════════════════════════════════════
系主任資料快照
═══════════════════════════════════════════════════
姓名：黃主任
職稱：資訊管理系系主任（任期：2023-2027）
辦公室：行政大樓 502，分機 5201

【系所統計】
- 在學學生：312 位
- 教師人數：19 位
- 本學期課程：${DEMO_COURSES.length + 8} 門
- 社團：${DEMO_CLUBS.length} 個
- 班級平均分數（資料結構代表班）：${avg} 分

【⚠️ 待審公告（${pendingAnns.length} 則）】
${pendingAnns.length > 0 ? pendingAnns.map((a) => `  - ${a.title}（${a.source}，${a.submittedAt}）`).join('\n') : '  （目前無待審公告）'}

【📬 未讀訊息（${deptUnread} 則）】
${deptMsgs.filter((m) => !m.isRead).map((m) => `  - 【${m.type}】${m.subject}（${m.fromName}，${m.sentAt}）`).join('\n') || '  （無未讀訊息）'}

你可以協助：
1. 分析全系課程選課趨勢
2. 找出成績偏低的課程
3. 起草系所公告草稿
4. 分析師資分配與課程負擔
5. 生成系所統計報表摘要

請用繁體中文，語氣正式、精確。`;
}

// ─────────────────────────────────────────────────────────────
// 管理員 System Context
// ─────────────────────────────────────────────────────────────
function buildAdminContext(): string {
  const adminMsgs = getMessagesForRole('admin');
  const adminUnread = getUnreadCountForRole('admin');

  return `你是「校園資訊系統 AI 管理助手」，協助系統管理員監控系統狀態、管理使用者、處理異常事件。

═══════════════════════════════════════════════════
系統管理快照
═══════════════════════════════════════════════════
管理員：系統管理員（admin@pu.edu.tw）
所屬：電子計算機中心

【系統狀態】
- 整體狀態：正常運行 ✅
- 今日活躍使用者：89 位
- API 速率：目前 83% 使用率（近峰值，建議監控）
- 最近備份：2026-05-17 03:00（1.2GB，成功）

【⚠️ 安全事件】
- 今日 09:23：偵測到來自境外 IP（荷蘭 Tor 出口節點）的 5 次登入失敗嘗試，目標：admin@pu.edu.tw

【使用者統計】
- 學生：115 位、教師：19 位、管理員：5 位、其他：139 位

【📬 未讀訊息（${adminUnread} 則）】
${adminMsgs.filter((m) => !m.isRead).map((m) => `  - 【${m.type}】${m.subject}（${m.sentAt}）`).join('\n') || '  （無未讀訊息）'}

你可以協助：
1. 分析系統異常事件與安全威脅
2. 查詢使用者帳號狀態
3. 起草系統維護公告
4. 分析 API 用量趨勢
5. 生成系統健康報告

請用繁體中文，語氣技術性、精確。`;
}

// ─────────────────────────────────────────────────────────────
// 校友 System Context
// ─────────────────────────────────────────────────────────────
function buildAlumniContext(): string {
  const alumniMsgs = getMessagesForRole('alumni');
  return `你是「校友服務 AI 助手」，協助校友了解母校近況、查詢在校紀錄。

═══════════════════════════════════════════════════
校友資料快照
═══════════════════════════════════════════════════
姓名：李校友（B09203001）
畢業：資管系 109 屆（2020 年畢業，已畢業 3 年）
現況：軟體工程師
畢業 GPA：3.65，已修學分：128 學分

【校友服務範圍（唯讀）】
✅ 可查看：在校成績、公開校園公告、活動資訊、地圖
⛔ 無法：加入社團、借書、選課、修改在校資料

【近期校友活動】
${alumniMsgs.map((m) => `  - ${m.subject}（${m.sentAt}）`).join('\n') || '  （無校友活動訊息）'}

你可以協助：
1. 整理在校期間的成績摘要
2. 查詢校友會活動資訊
3. 說明如何申請成績單或在校證明
4. 提供母校近況介紹

請用繁體中文，語氣友善溫暖。`;
}

// ─────────────────────────────────────────────────────────────
// 訪客 System Context
// ─────────────────────────────────────────────────────────────
function buildGuestContext(): string {
  return `你是「校園 AI 導覽助手」，協助訪客了解校園資訊與 App 功能。

你只能提供公開資訊：公告、課程介紹、地圖、餐廳、公車等。
無法提供個人化服務（成績、課表、作業等）。

如訪客詢問個人資料或需要更多功能，請引導他前往登入頁面。

請用繁體中文，語氣親切友善。`;
}

// ─────────────────────────────────────────────────────────────
// 主要 export：根據角色分派
// ─────────────────────────────────────────────────────────────

/**
 * 根據當前 demo 角色回傳對應的 AI system context 字串
 */
export function buildAISystemContext(role?: DemoRole): string {
  switch (role) {
    case 'teacher':     return buildTeacherContext();
    case 'ta':          return buildTAContext();
    case 'club_officer':return buildClubOfficerContext();
    case 'department_head': return buildDeptHeadContext();
    case 'admin':       return buildAdminContext();
    case 'alumni':      return buildAlumniContext();
    case 'guest':       return buildGuestContext();
    case 'student':
    default:            return buildStudentContext();
  }
}

// ─────────────────────────────────────────────────────────────
// 學分摘要（供各頁面顯示用，只對學生有意義）
// ─────────────────────────────────────────────────────────────

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

/**
 * 取得學生當前情境摘要，供各頁面顯示 AI 提示卡用
 */
export function getStudentContextSummary() {
  const pending = STUDENT_ASSIGNMENTS.filter((a) => a.status === 'pending');
  const joinedClubActivities = CLUB_ACTIVITIES.filter((act) => {
    const joined = DEMO_CLUBS.filter((c) => c.isJoined).map((c) => c.id);
    return joined.includes(act.clubId);
  });

  const soonest = pending.sort((a, b) => a.due.localeCompare(b.due))[0];
  const nextExam = UPCOMING_EXAMS.sort((a, b) => a.date.localeCompare(b.date))[0];

  const libDue = getLibraryDueInfo();

  return {
    pendingAssignmentCount: pending.length,
    soonestAssignment: soonest ?? null,
    libraryDueSoonBook: libDue.book,
    libraryDueSoonDays: libDue.daysLeft,
    libraryRenewed: libDue.renewed,
    nextClubActivity: joinedClubActivities[0] ?? null,
    nextExam: nextExam ?? null,
    upcomingExamCount: UPCOMING_EXAMS.length,
  };
}

/**
 * 取得教師情境摘要（供首頁 AI 提醒卡顯示）
 */
export function getTeacherContextSummary() {
  const pendingCount = TEACHER_PENDING_REVIEWS.filter((r) => r.status === 'submitted').length;
  const gradingCount = TEACHER_PENDING_REVIEWS.filter((r) => r.status === 'grading').length;
  const unreadCount = getUnreadCountForRole('teacher');
  return { pendingCount, gradingCount, totalPending: TEACHER_PENDING_REVIEWS.length, unreadCount };
}

/**
 * 取得社團幹部情境摘要（供首頁 AI 提醒卡顯示）
 */
export function getClubOfficerContextSummary() {
  const club = DEMO_CLUBS.find((c) => c.id === 'club-1')!;
  const nextActivity = CLUB_ACTIVITIES.filter((a) => a.clubId === 'club-1')
    .sort((a, b) => a.date.localeCompare(b.date))[0];
  const unreadCount = getUnreadCountForRole('club_officer');
  return { clubName: club.name, memberCount: club.members, nextActivity, unreadCount, pendingMemberRequests: 3 };
}

/**
 * 取得系主任情境摘要（供首頁 AI 提醒卡顯示）
 */
export function getDeptHeadContextSummary() {
  const pendingAnns = readPendingAnns();
  const unreadCount = getUnreadCountForRole('department_head');
  return { pendingAnnCount: pendingAnns.length, studentCount: 312, teacherCount: 19, unreadCount };
}

/**
 * 取得管理員情境摘要（供首頁 AI 提醒卡顯示）
 */
export function getAdminContextSummary() {
  const unreadCount = getUnreadCountForRole('admin');
  const hasSecurity = true; // 今日有異常登入嘗試
  return { systemOk: true, hasSecurity, securityEventCount: 1, unreadCount, activeUsers: 89 };
}
