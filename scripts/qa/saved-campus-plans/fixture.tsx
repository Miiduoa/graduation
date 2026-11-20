import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { View, Text } from 'react-native';
import { SavedCampusPlansPanel } from '../../../apps/mobile/src/screens/SavedCampusPlansPanel';
import { CampusPlanComparisonCard } from '../../../apps/mobile/src/screens/CampusPlanComparisonCard';
import { CampusEvidencePlanCard } from '../../../apps/mobile/src/screens/CampusEvidencePlanCard';
import { NuniStudyPlanActions } from '../../../apps/mobile/src/screens/NuniStudyPlanActions';
import { NuniPlanAssignmentOpenButton, type NuniPlanAssignmentOpenContext } from '../../../apps/mobile/src/screens/NuniPlanAssignmentOpenButton';
import { StudyAssignmentAssistant } from '../../../apps/mobile/src/screens/nuni/StudyAssignmentAssistant';
import { ThemeProvider } from '../../../apps/mobile/src/state/theme';
import { applyTheme, theme } from '../../../apps/mobile/src/ui/theme';
import type { NuniStudyAgenda, NuniStudyTask } from '../../../packages/shared/src/nuniStudyAgenda';
import type { SavedCampusPlan } from '../../../apps/mobile/src/services/savedCampusPlans';
import { compareCampusPlans, type CampusPlanComparison, type CampusPlanComparisonBasis } from '../../../apps/mobile/src/services/campusPlanComparison';
import { copyCampusEvidencePlan } from '../../../apps/mobile/src/services/savedCampusPlanValidation';
import type { CampusEvidencePlan } from '../../../apps/mobile/src/services/offlineCampusPlanner';
import type { NuniPlanAssignmentSource, NuniPlanQuizSource } from '../../../apps/mobile/src/services/nuniPlanAssignmentTarget';

const mode = new URLSearchParams(location.search).get('theme') === 'dark' ? 'dark' : 'light';
applyTheme(mode);
document.body.style.backgroundColor = theme.colors.bg;

const first: SavedCampusPlan = {
  id: 'week-study', question: '幫我安排這週的資料庫報告、行動應用作業和課程複習，先處理快到期的。',
  savedAt: '2026-11-06T16:05:00.000Z', updatedAt: '2026-11-06T16:05:00.000Z', completedStepIds: [],
  plan: {
    title: '這週的資料庫期末報告與跨課程學習行動計畫', checkedAt: '2026-11-06T15:58:00.000Z',
    overview: '根據個人課表和授權課程摘要整理。',
    content: '資料庫報告、課表與最新公告需要核對。',
    limitations: ['課程與期限以原服務的最新資訊為準。'],
    steps: [
      { id: 'assignment-0', title: '資料庫系統期末專題：校園跨校資料整合與權限隔離實作報告',
        detail: '資料庫系統｜截止 11/6 23:59。請到課程頁確認老師公布的繳交方式與最新狀態。',
        priority: 'urgent', evidence: 'authorized-assignments', route: '/classroom',
        dueAt: '2026-11-06T15:59:00.000Z', groupName: '資料庫系統' },
      { id: 'assignment-1', title: '行動應用程式設計作業二',
        detail: '行動應用程式設計｜原期限 11/5 23:59，整理時已經過期，請核對是否有補交安排。',
        priority: 'overdue', evidence: 'authorized-assignments', route: '/classroom',
        dueAt: '2026-11-05T15:59:00.000Z', groupName: '行動應用程式設計' },
      { id: 'timetable-review', title: '確認週末與下週的課表', detail: '以已儲存的課表為準，請確認停課與調課是否另有公告。',
        priority: 'verify', evidence: 'saved-timetable', route: '/timetable' },
    ],
    agenda: {
      days: [
        { date: '2026-11-06', label: '11/6（週五）', courses: [{ name: '資料庫系統', day: 5, start: 3, end: 4, room: '資訊大樓 401' }],
          gaps: [], conflicts: [], deadlines: [{ title: '資料庫系統期末專題', groupName: '資料庫系統',
            dueAt: '2026-11-06T15:59:00.000Z', timeLabel: '23:59', overdue: false }] },
        { date: '2026-11-07', label: '11/7（週六）', courses: [], gaps: [], conflicts: [], deadlines: [] },
      ],
      timetableAvailable: true, assignmentsAvailable: true, ignoredCourses: 0, outsideWindow: [],
    },
  },
};
const second: SavedCampusPlan = {
  id: 'tomorrow-study', question: '幫我規劃明天的讀書進度', savedAt: '2026-11-05T08:00:00.000Z',
  updatedAt: '2026-11-05T08:02:00.000Z', completedStepIds: ['timetable-review'],
  plan: {
    title: '明日學習行動', checkedAt: '2026-11-05T07:59:00.000Z', overview: '手機課表副本。', content: '核對課表。',
    limitations: [], steps: [{ id: 'timetable-review', title: '核對已儲存課表', detail: '確認教室與上課時間。',
      priority: 'normal', evidence: 'saved-timetable', route: '/timetable' }],
  },
};

// This fixture exercises the real presentation components. Comparisons and new
// plans are synthetic; the comparison service and authenticated flow have their
// own regression tests and are not substituted by this browser check.
const updatedComparison: CampusPlanComparison = {
  previousCheckedAt: first.plan.checkedAt, currentCheckedAt: '2026-11-07T02:15:00.000Z',
  comparableDates: 1, unchangedAssignments: 0,
  limitations: [
    '本次只取得部分課程摘要，未列出的作業不能當作已繳交或已取消。',
    '課表仍是手機保存的副本，教室與停課消息請以學校最新公告為準。',
  ],
  changes: [
    { id: 'deadline', category: 'assignment', kind: 'changed', title: first.plan.steps[0].title,
      before: '2026/11/06 23:59 截止', after: '2026/11/07 18:00 截止',
      detail: '本次摘要的截止時間不同，請到課程頁確認最新繳交要求。', route: '/classroom' },
    { id: 'class', category: 'timetable', kind: 'changed', title: '11/7 資料庫系統討論課',
      before: '第 5–6 節 · 資訊大樓 401', after: '第 7–8 節 · 資訊大樓 502',
      detail: '時段與教室都有調整，請重新核對前後行程。', route: '/timetable' },
    { id: 'new-assignment', category: 'assignment', kind: 'added', title: '行銷資訊系統：消費者研究小組簡報與資料蒐集',
      after: '2026/11/09 12:00 截止', detail: '這份作業出現在本次摘要，請確認需要準備的內容。', route: '/classroom' },
    { id: 'missing-assignment', category: 'assignment', kind: 'missing', title: '行動應用程式設計作業二',
      before: '原計畫列有這份作業', detail: '本次摘要未列出，不能判定已繳交或已取消。', route: '/classroom' },
    { id: 'date-window', category: 'scope', kind: 'window', title: '規劃日期往後移',
      before: '2026/11/06–2026/11/07', after: '2026/11/07–2026/11/08',
      detail: '只比較兩份計畫共同涵蓋的日期。' },
    { id: 'source', category: 'source', kind: 'unverifiable', title: '部分課程資料還沒同步',
      detail: '資料不完整，請先重新同步課程，再核對沒有列出的作業。', route: '/classroom' },
    { id: 'long-class', category: 'timetable', kind: 'changed', title: '資訊管理實務與跨校協作研究方法：課堂討論及期末共同專題工作坊',
      before: '第 2–3 節', after: '第 3–4 節', detail: '已保存的時段有調整，請確認課表。', route: '/timetable' },
    { id: 'long-title', category: 'assignment', kind: 'unverifiable',
      title: 'InterdisciplinaryCampusSystemsResearchAndCrossSchoolInformationManagementFinalPresentation',
      detail: '這項作業尚無可核對的截止時間，請到課程頁查看。', route: '/classroom' },
  ],
};
const legacyComparison: CampusPlanComparison = {
  previousCheckedAt: second.plan.checkedAt, currentCheckedAt: updatedComparison.currentCheckedAt,
  comparableDates: 0, unchangedAssignments: 0, changes: [],
  limitations: ['這份舊計畫沒有逐日資料，無法完整比對課表與作業期限；請重新核對課程頁。'],
};
const replannedPlan: CampusEvidencePlan = {
  title: '重新整理的學習安排', checkedAt: updatedComparison.currentCheckedAt,
  overview: '依目前已同步的部分資料重新整理。', content: '核對最新截止時間與教室。',
  limitations: updatedComparison.limitations,
  steps: [{ ...first.plan.steps[0], dueAt: '2026-11-07T10:00:00.000Z',
    detail: '資料庫系統｜截止 11/7 18:00。請開啟課程頁核對。' }],
};

declare global {
  interface Window {
    qaEvents: unknown[];
    qaSettleAssignmentRead?: (kind: 'ready' | 'unavailable' | 'changed') => void;
    qaSettleQuizRead?: (kind: 'ready' | 'unavailable' | 'changed') => void;
    qaReceiptRead?: 'received' | 'closed' | 'unavailable';
  }
}
window.qaEvents = [];
function App() {
  const [plans, setPlans] = useState([first, second]);
  const [replannedFrom, setReplannedFrom] = useState<SavedCampusPlan | null>(null);
  return <View style={{ minHeight: '100vh' as never, backgroundColor: theme.colors.bg, paddingTop: 14, paddingBottom: 24 }}>
    <Text accessibilityRole="header" style={{ marginHorizontal: 20, marginBottom: 16, color: theme.colors.text, fontSize: 22, fontWeight: '700' }}>校園工具</Text>
    {replannedFrom ? (
      <View testID="comparison-preview" style={{ marginHorizontal: 20, marginBottom: 20 }}>
        <CampusPlanComparisonCard
          key={replannedFrom.id}
          comparison={replannedFrom.id === first.id ? updatedComparison : legacyComparison}
          disabled={false}
          onOpenOriginal={() => {
            window.qaEvents.push({ kind: 'original', id: replannedFrom.id });
            setReplannedFrom(null);
          }}
        />
        <CampusEvidencePlanCard plan={replannedPlan} disabled={false}
          onOpenRoute={(route) => { window.qaEvents.push({ kind: 'open-route', route }); }} />
      </View>
    ) : null}
    <SavedCampusPlansPanel plans={plans} loading={false} busy={false} error=""
      onRetry={() => { window.qaEvents.push({ kind: 'retry' }); }}
      onDelete={(id) => { window.qaEvents.push({ kind: 'delete', id }); setPlans((old) => old.filter((row) => row.id !== id)); }}
      onToggleStep={(id, stepId, done) => {
        window.qaEvents.push({ kind: 'toggle', id, stepId, done });
        setPlans((old) => old.map((row) => row.id !== id ? row : { ...row,
          completedStepIds: done ? [...row.completedStepIds, stepId] : row.completedStepIds.filter((value) => value !== stepId),
        }));
      }}
      onReplan={(saved) => {
        window.qaEvents.push({ kind: 'replan', id: saved.id, completed: saved.completedStepIds });
        setReplannedFrom(saved);
      }}
      onOpenRoute={(route) => { window.qaEvents.push({ kind: 'open-route', route }); }} />
    <Text style={{ marginHorizontal: 20, marginTop: 16, color: theme.colors.muted, fontSize: 12, lineHeight: 20 }}>
      測試畫面：比較內容與重新規劃資料為合成範例，未連線取得校務資料。
    </Text>
  </View>;
}

// Platform planning uses the real action and plan components with synthetic,
// dated clock occurrences. It does not exercise login, school linkage or fetches.
const longPlatformCourse = 'InterdisciplinaryCampusSystemsResearchAndCrossSchoolInformationManagementFinalPresentation';
const overnightClass = {
  name: '跨夜資料整理與小組討論', room: '資訊大樓協作研究室',
  startAt: '2026-11-08T15:30:00.000Z', endAt: '2026-11-08T16:30:00.000Z',
};
const platformWeek: CampusEvidencePlan = {
  title: '未來七天課業計畫', overview: '依手機保存的課表與部分平台課堂作業整理。',
  checkedAt: '2026-11-08T00:00:00.000Z', content: '先核對平台課表日期，再安排作業。',
  limitations: [
    '本次只取得部分 nuni 課堂作業，未列出的作業不能當作已完成。',
    '尚未連接校務資料，這份計畫只使用平台來源與手機課表副本。',
    '已略過 1 筆時間未確認的課程，請回課表頁核對。',
    '部分課堂尚未連結作業來源，缺少的資料不代表沒有作業。',
  ],
  steps: [{ id: 'timetable-review', title: '核對這週的課程與作業',
    detail: '課程使用保存的日期與鐘點；請確認調課與課程連結，資料缺漏時先回原頁核對。',
    evidence: 'saved-timetable', priority: 'verify', route: '/timetable' }],
  agenda: {
    timetableAvailable: true, assignmentsAvailable: true, ignoredCourses: 1,
    days: Array.from({ length: 7 }, (_, index) => ({
      date: `2026-11-${String(8 + index).padStart(2, '0')}`,
      label: `11/${8 + index}（週${['日', '一', '二', '三', '四', '五', '六'][index]}）`,
      courses: [], gaps: [], conflicts: [],
      scheduledClasses: index === 0 ? [
        { name: longPlatformCourse, room: '資訊管理大樓 401 跨校協作教室',
          startAt: '2026-11-08T01:10:00.000Z', endAt: '2026-11-08T02:00:00.000Z' },
        overnightClass,
      ] : index === 1 ? [overnightClass] : [],
      deadlines: index === 0 ? [{
        title: '資訊管理實務與跨校協作研究方法：期末共同專題資料整合報告',
        groupName: '資訊管理實務', dueAt: '2026-11-08T15:59:00.000Z',
        timeLabel: '23:59', overdue: false,
      }] : [],
    })),
    outsideWindow: [{ title: '企業資源規劃跨校協作專題資料蒐集', groupName: '企業資源規劃',
      dueAt: null, reason: 'undated' }],
  },
};
const platformToday: CampusEvidencePlan = {
  ...platformWeek, title: '今日課業重點',
  agenda: { ...platformWeek.agenda!, days: platformWeek.agenda!.days.slice(0, 1) },
};

// The production agenda derives gaps and conflicts from these occurrences.
// Nested and touching courses deliberately rule out a false 11:00–12:00 gap.
const clockOverlapClasses = [
  { name: '跨課程研究與資料整合工作坊', room: '資訊大樓 301',
    startAt: '2026-11-10T01:00:00.000Z', endAt: '2026-11-10T04:00:00.000Z' },
  { name: '工作坊內的專題短講', room: '資訊大樓 301',
    startAt: '2026-11-10T01:30:00.000Z', endAt: '2026-11-10T02:00:00.000Z' },
  { name: '緊接短講的小組討論', room: '資訊大樓 301',
    startAt: '2026-11-10T02:00:00.000Z', endAt: '2026-11-10T03:00:00.000Z' },
  { name: '接續工作坊的課程', room: '資訊大樓 302',
    startAt: '2026-11-10T04:00:00.000Z', endAt: '2026-11-10T05:00:00.000Z' },
  { name: '下午資料分析實作', room: '資訊大樓 401',
    startAt: '2026-11-10T06:00:00.000Z', endAt: '2026-11-10T07:00:00.000Z' },
];
const clockOvernightClasses = [
  { name: '跨夜專題工作坊', room: '資訊大樓協作研究室',
    startAt: '2026-11-10T15:30:00.000Z', endAt: '2026-11-10T16:30:00.000Z' },
  { name: '跨夜報告討論', room: '線上課堂',
    startAt: '2026-11-10T15:45:00.000Z', endAt: '2026-11-10T16:15:00.000Z' },
];
const clockWeek: CampusEvidencePlan = {
  ...platformWeek,
  overview: '以保存的鐘點課表核對課間時段與重疊，並顯示作業準備建議。',
  limitations: [
    '課表是手機保存的副本，尚未排除私人行程、通勤及臨時調課。',
    '準備建議只取 08:00–22:00 的課間時段，課前後各保留 10 分鐘，每次先安排 30 分鐘；未核對通勤與私人行程，也不代表能在 30 分鐘內完成作業。這些是建議，尚未建立行事曆事件。',
    '本次只納入已連結課程的作業，其他校務來源仍須自行核對。',
  ],
  // Representative planner output, not a second implementation of slot policy.
  steps: [{ id: 'assignment-clock-preparation',
    title: '資訊管理實務與跨校協作研究方法：期末共同專題資料整合報告',
    detail: '資訊管理實務｜截止 11/8 23:59。建議先用 11/8（週日） 10:10–10:40（30 分鐘）準備這份作業，再依進度調整。請開啟 nuni 課程核對最新狀態。',
    evidence: 'authorized-assignments', priority: 'urgent', route: '/classroom',
    dueAt: '2026-11-08T15:59:00.000Z', groupName: '資訊管理實務',
  }, ...platformWeek.steps],
  agenda: {
    ...platformWeek.agenda!, ignoredCourses: 0,
    days: platformWeek.agenda!.days.map((day, index) => ({
      ...day,
      scheduledClasses: index === 2 ? [...clockOverlapClasses, ...clockOvernightClasses]
        : index === 3 ? [...clockOvernightClasses,
          { name: '凌晨實作收尾', room: '資訊大樓協作研究室',
            startAt: '2026-11-10T17:00:00.000Z', endAt: '2026-11-10T17:30:00.000Z' }]
          : index === 4 ? [
            { name: '相鄰第一堂課', room: '資訊大樓 301',
              startAt: '2026-11-12T01:00:00.000Z', endAt: '2026-11-12T02:00:00.000Z' },
            { name: '相鄰第二堂課', room: '資訊大樓 301',
              startAt: '2026-11-12T02:00:00.000Z', endAt: '2026-11-12T03:00:00.000Z' },
          ] : day.scheduledClasses,
    })),
  },
};
const clockToday: CampusEvidencePlan = {
  ...clockWeek, title: '今日課業重點',
  agenda: { ...clockWeek.agenda!, days: clockWeek.agenda!.days.slice(0, 1) },
};

function PlatformPlanningApp({ clock = false }: { clock?: boolean }) {
  const [selection, setSelection] = useState<'today' | 'week' | null>(null);
  const todayPlan = clock ? clockToday : platformToday;
  const weekPlan = clock ? clockWeek : platformWeek;
  return <View style={{ minHeight: '100vh' as never, backgroundColor: theme.colors.bg, padding: 20, gap: 12 }}>
    <Text accessibilityRole="header" style={{ color: theme.colors.text, fontSize: 22, fontWeight: '700' }}>課業助理</Text>
    <NuniStudyPlanActions disabled={false}
      onToday={() => { window.qaEvents.push({ kind: 'today' }); setSelection('today'); }}
      onWeek={() => { window.qaEvents.push({ kind: 'week' }); setSelection('week'); }} />
    {selection ? <View testID="platform-plan-preview">
      <CampusEvidencePlanCard plan={selection === 'today' ? todayPlan : weekPlan} disabled={false}
        onOpenRoute={(route) => { window.qaEvents.push({ kind: 'open-route', route }); }} />
    </View> : null}
    <Text style={{ color: theme.colors.muted, fontSize: 12, lineHeight: 20 }}>
      {clock
        ? '測試畫面：課程、期限與準備建議皆為合成範例；課間與重疊由正式計算元件呈現。未驗證即時規劃、登入或真實平台、校務資料。'
        : '測試畫面：日期、課程與作業皆為合成範例，只驗證正式元件顯示與操作；未連線登入或取得平台、校務資料。'}
    </Text>
  </View>;
}

const assignmentSource: NuniPlanAssignmentSource = {
  accountId: 'pa_11111111-1111-4111-8111-111111111111', schoolId: 'pu', academicYear: '115', semester: '1',
  workspaceId: 'cw_11111111-1111-4111-8111-111111111111',
  assignmentId: 'cwa_11111111-1111-4111-8111-111111111111',
};
const outsideAssignmentSource: NuniPlanAssignmentSource = {
  ...assignmentSource, workspaceId: 'cw_22222222-2222-4222-8222-222222222222',
  assignmentId: 'cwa_22222222-2222-4222-8222-222222222222',
};
const assignmentPlan: CampusEvidencePlan = {
  ...clockToday, title: '從計畫核對原始作業',
  steps: [{ ...clockToday.steps[0], nuniSource: assignmentSource }],
  agenda: {
    ...clockToday.agenda!,
    days: clockToday.agenda!.days.map((day) => ({
      ...day, deadlines: day.deadlines.map((task) => ({ ...task, nuniSource: assignmentSource })),
    })),
    outsideWindow: clockToday.agenda!.outsideWindow.map((task) => ({ ...task, nuniSource: outsideAssignmentSource })),
  },
};

const quizSource: NuniPlanQuizSource = {
  accountId: assignmentSource.accountId, schoolId: assignmentSource.schoolId,
  academicYear: assignmentSource.academicYear, semester: assignmentSource.semester,
  workspaceId: assignmentSource.workspaceId, quizId: 'cwq_11111111-1111-4111-8111-111111111111',
};
const quizTask = {
  kind: 'quiz' as const, title: '資料庫系統線上測驗：跨校課程整合、資料正規化與權限隔離',
  groupName: '資料庫系統', dueAt: '2026-11-08T10:00:00.000Z', nuniQuizSource: quizSource,
};
const quizPlan: CampusEvidencePlan = {
  ...assignmentPlan, title: '作業與測驗一起安排',
  limitations: [
    ...assignmentPlan.limitations.slice(0, 2),
    '本次只納入已連結課程的作業與測驗，其他校務來源仍須自行核對。',
  ],
  steps: [{ ...quizTask, id: 'quiz-preparation', priority: 'urgent', evidence: 'authorized-quizzes', route: '/classroom',
    detail: '參考期限 11/8 18:00。建議先用 10:10–10:40 複習這份測驗的課程內容；開考時間與作答方式請到課程頁核對。' },
  ...assignmentPlan.steps.map((step) => ({ ...step,
    detail: step.detail.replace('10:10–10:40', '10:40–11:10') })),
  ],
  agenda: { ...assignmentPlan.agenda!, quizzesAvailable: true,
    days: assignmentPlan.agenda!.days.map((day) => ({ ...day,
      deadlines: [{ ...quizTask, timeLabel: '18:00', overdue: false }, ...day.deadlines] })),
    outsideWindow: [{ ...quizTask, title: '尚未確認期限的測驗', dueAt: null, reason: 'undated',
      nuniQuizSource: { ...quizSource, quizId: 'cwq_22222222-2222-4222-8222-222222222222' } }],
  },
};

// The production button and card are real. Only their injected reader and
// navigation are controlled here; the navigation integration suite covers the
// real planner, source checks, account guard and destination separately.
const assignmentContext: NuniPlanAssignmentOpenContext = {
  accountId: assignmentSource.accountId, schoolId: assignmentSource.schoolId, isCurrent: () => true,
  request: async () => { throw new Error('The browser fixture must not read a platform source'); },
  bffRequest: async () => { throw new Error('The browser fixture must not read assignment content'); },
  readTarget: async (input) => {
    window.qaEvents.push({ kind: 'assignment-read', source: input.source });
    return new Promise((resolve) => {
      window.qaSettleAssignmentRead = (kind) => {
        delete window.qaSettleAssignmentRead;
        resolve(kind === 'ready' ? { kind, params: {
          tab: 'courses', workspaceId: input.source.workspaceId,
          assignmentId: input.source.assignmentId, assistantAccountId: input.accountId,
        } } : { kind });
      };
    });
  },
  readQuizTarget: async (input) => {
    window.qaEvents.push({ kind: 'quiz-read', source: input.source });
    return new Promise((resolve) => {
      window.qaSettleQuizRead = (kind) => {
        delete window.qaSettleQuizRead;
        resolve(kind === 'ready' ? { kind, params: {
          tab: 'courses', workspaceId: input.source.workspaceId,
          assignmentId: input.source.quizId, assistantAccountId: input.accountId,
        } } : { kind });
      };
    });
  },
};
const assignmentNavigation = {
  getState: () => ({ routeNames: ['NuniWorkspace'] }),
  navigate: (route: string, params?: Record<string, unknown>) => {
    window.qaEvents.push({ kind: 'assignment-navigation', route, params });
  },
};

function AssignmentPlanningApp({ quiz = false }: { quiz?: boolean }) {
  const [completedStepIds, setCompletedStepIds] = useState<string[]>([]);
  return <View style={{ minHeight: '100vh' as never, backgroundColor: theme.colors.bg, padding: 20, gap: 12 }}>
    <Text accessibilityRole="header" style={{ color: theme.colors.text, fontSize: 22, fontWeight: '700' }}>課業助理</Text>
    <View testID={quiz ? 'quiz-plan-preview' : 'assignment-plan-preview'}>
      <CampusEvidencePlanCard plan={quiz ? quizPlan : assignmentPlan} disabled={false}
        progress={{ completedStepIds, onToggleStep: (stepId, done) => {
          window.qaEvents.push({ kind: 'toggle', stepId, done });
          setCompletedStepIds(done ? [stepId] : []);
        } }}
        onOpenRoute={(route) => { window.qaEvents.push({ kind: 'open-route', route }); }}
        renderAssignmentAction={(assignment) => (
          <NuniPlanAssignmentOpenButton assignment={assignment} context={assignmentContext}
            navigation={assignmentNavigation} disabled={false} />
        )} />
    </View>
    <Text style={{ color: theme.colors.muted, fontSize: 12, lineHeight: 20 }}>
      測試畫面：使用正式卡片與課業按鈕；來源、核對回覆與導覽皆為合成控制。本情境只驗證顯示與互動，未連接平台，也未載入課程接收頁。
    </Text>
  </View>;
}

// Exercise the real saved-plan projection and comparison with controlled source
// snapshots. Account verification and submissions are covered by native tests.
const receiptBefore = copyCampusEvidencePlan({
  ...quizPlan, title: '回到計畫核對作業與測驗',
  agenda: { ...quizPlan.agenda!, outsideWindow: [] },
  comparisonBasis: {
    assignments: { status: 'complete', checkedAt: quizPlan.checkedAt, total: 1, items: [{
      identity: [assignmentSource.workspaceId, assignmentSource.assignmentId],
      title: assignmentPlan.steps[0].title, groupName: '資訊管理實務', dueAt: '2026-11-08T15:59:00.000Z',
      activity: { state: 'open', receipt: null },
    }] },
    quizzes: { status: 'complete', checkedAt: quizPlan.checkedAt, total: 1, items: [{
      identity: [quizSource.workspaceId, quizSource.quizId],
      title: quizTask.title, groupName: quizTask.groupName, dueAt: quizTask.dueAt,
      activity: { state: 'open', receipt: null },
    }] },
    timetableUpdatedAt: quizPlan.checkedAt,
  },
});
const receiptSaved: SavedCampusPlan = {
  id: 'receipt-study', question: '幫我安排今天的作業與測驗', plan: receiptBefore,
  savedAt: receiptBefore.checkedAt, updatedAt: receiptBefore.checkedAt, completedStepIds: [],
};

function receiptAfter(read: NonNullable<Window['qaReceiptRead']>): CampusEvidencePlan {
  const checkedAt = '2026-11-08T01:00:00.000Z';
  const basis = (kind: 'assignment' | 'quiz'): CampusPlanComparisonBasis['assignments'] => {
    if (read === 'unavailable') return { status: 'unavailable', checkedAt: null, total: null, items: [] };
    const before = kind === 'assignment' ? receiptBefore.comparisonBasis!.assignments
      : receiptBefore.comparisonBasis!.quizzes!;
    return { ...before, checkedAt, items: before.items.map((item) => ({ ...item,
      activity: { state: read === 'closed' ? 'closed' : 'open', receipt: read === 'received' ? {
        submittedAt: kind === 'assignment' ? '2026-11-08T00:30:00.000Z' : '2026-11-08T00:31:00.000Z',
      } : null },
    })) };
  };
  return copyCampusEvidencePlan({
    ...receiptBefore, checkedAt, title: '重新核對後的計畫',
    overview: '依本次課程來源重新核對作業與測驗。',
    steps: [{ id: 'receipt-review', title: '核對後續課業安排',
      detail: read === 'unavailable' ? '本次資料來源無法讀取，請稍後重新核對。'
        : '請查看前後紀錄的差異，並到課程頁核對後續要求。',
      priority: 'verify', evidence: 'verification', route: '/classroom' }],
    agenda: { ...receiptBefore.agenda!, assignmentsAvailable: read !== 'unavailable',
      quizzesAvailable: read !== 'unavailable', days: receiptBefore.agenda!.days.map((day) => ({ ...day, deadlines: [] })) },
    comparisonBasis: { assignments: basis('assignment'), quizzes: basis('quiz'),
      timetableUpdatedAt: receiptBefore.comparisonBasis!.timetableUpdatedAt },
  });
}

function ReceiptComparisonApp() {
  const [plans, setPlans] = useState([receiptSaved]);
  const [review, setReview] = useState<{ plan: CampusEvidencePlan; comparison: CampusPlanComparison } | null>(null);
  return <View style={{ minHeight: '100vh' as never, backgroundColor: theme.colors.bg, padding: 20, gap: 14 }}>
    <Text accessibilityRole="header" style={{ color: theme.colors.text, fontSize: 22, fontWeight: '700' }}>核對繳交與作答紀錄</Text>
    {review ? <View testID="receipt-comparison-preview">
      <CampusPlanComparisonCard comparison={review.comparison} disabled={false}
        onOpenOriginal={() => { window.qaEvents.push({ kind: 'receipt-original' }); setReview(null); }} />
      <CampusEvidencePlanCard plan={review.plan} disabled={false}
        onOpenRoute={(route) => { window.qaEvents.push({ kind: 'open-route', route }); }} />
    </View> : null}
    <SavedCampusPlansPanel plans={plans} loading={false} busy={false} error=""
      onRetry={() => { window.qaEvents.push({ kind: 'retry' }); }}
      onDelete={(id) => { setPlans((old) => old.filter((saved) => saved.id !== id)); }}
      onToggleStep={(id, stepId, done) => {
        window.qaEvents.push({ kind: 'receipt-toggle', stepId, done });
        setPlans((old) => old.map((saved) => saved.id === id ? { ...saved,
          completedStepIds: done ? [...saved.completedStepIds, stepId]
            : saved.completedStepIds.filter((value) => value !== stepId),
        } : saved));
      }}
      onReplan={(saved) => {
        const read = window.qaReceiptRead ?? 'received';
        const plan = receiptAfter(read);
        const comparison = compareCampusPlans(saved.plan, plan);
        window.qaEvents.push({ kind: 'receipt-replan', read, completed: saved.completedStepIds,
          receiptKinds: comparison.changes.filter((change) => change.kind === 'receipt').map((change) => change.category) });
        setReview({ plan, comparison });
      }}
      onOpenRoute={(route) => { window.qaEvents.push({ kind: 'open-route', route }); }} />
    <Text style={{ color: theme.colors.muted, fontSize: 12, lineHeight: 20 }}>
      測試畫面：使用正式保存投影、比較與畫面元件；資料及重新讀取結果為合成範例，未連線登入、提交或查詢平台紀錄。
    </Text>
  </View>;
}

// The production assistant owns query parsing, date/status follow-ups and row
// selection. Only its loaded course snapshot and navigation callback are fixed.
const receiptQueryCourses: NuniStudyAgenda['workspaces'] = [
  { id: 'receipt-database', title: '資料庫', state: 'active', memberRole: 'student' },
  { id: 'receipt-programming', title: '程式設計', state: 'active', memberRole: 'student' },
  { id: 'receipt-unavailable', title: '資訊管理實務', state: 'active', memberRole: 'student' },
];
function receiptQueryTask(
  id: string, courseId: string, title: string, dueAt: string | null, submittedAt: string | null = null,
): NuniStudyTask {
  return {
    id, courseId, title, dueAt, submittedAt,
    courseTitle: receiptQueryCourses.find((course) => course.id === courseId)!.title,
    kind: 'assignment', state: 'open', feedback: null, reviewedAt: null,
  };
}
const receiptQueryAgenda: NuniStudyAgenda = {
  workspaces: receiptQueryCourses, studiedCourseCount: receiptQueryCourses.length,
  failedCourseIds: ['receipt-unavailable'], limitedCourseIds: ['receipt-database'],
  tasks: [
    receiptQueryTask('database-tomorrow-pending', 'receipt-database', '明日資料整理報告', '2026-11-08T10:00:00+08:00'),
    receiptQueryTask('database-tomorrow-received', 'receipt-database', '資料庫概念摘要', '2026-11-08T18:00:00+08:00',
      '2026-11-07T09:15:00+08:00'),
    receiptQueryTask('database-next-week-pending', 'receipt-database', '下週索引練習', '2026-11-10T09:00:00+08:00'),
    receiptQueryTask('database-next-week-received', 'receipt-database', '期末報告', '2026-11-10T18:00:00+08:00',
      '2026-11-06T17:30:00+08:00'),
    // A same-title receipt from another course must never replace the chosen course.
    receiptQueryTask('programming-next-week-received', 'receipt-programming', '期末報告', '2026-11-10T18:00:00+08:00',
      '2026-11-07T09:20:00+08:00'),
    receiptQueryTask('database-undated-pending', 'receipt-database', '期限待確認報告', null),
    receiptQueryTask('database-undated-received', 'receipt-database', '期限待確認摘要', null,
      '2026-11-07T08:00:00+08:00'),
  ],
};

function ReceiptDateQueryApp() {
  return <ThemeProvider>
    <View style={{ minHeight: '100vh' as never, backgroundColor: theme.colors.bg, padding: 20, gap: 14 }}>
      <Text accessibilityRole="header" style={{ color: theme.colors.text, fontSize: 22, fontWeight: '700' }}>
        依期限核對繳交紀錄
      </Text>
      <View testID="receipt-date-query-preview">
        <StudyAssignmentAssistant data={receiptQueryAgenda} open={(courseId, activityId) => {
          window.qaEvents.push({ kind: 'receipt-date-open', courseId, activityId });
        }} />
      </View>
      <Text style={{ color: theme.colors.muted, fontSize: 12, lineHeight: 20 }}>
        測試畫面：使用正式課業助理及日期查詢，課程與繳交紀錄為合成範例，開啟結果只記錄目標，未連接平台或載入原課程頁。
      </Text>
    </View>
  </ThemeProvider>;
}

const scenario = new URLSearchParams(location.search).get('scenario');
if (scenario === 'receipt-date-query') {
  // The real ThemeProvider reads this same preference through AsyncStorage Web.
  localStorage.setItem('campus.themeMode.v2', mode);
}
createRoot(document.getElementById('root')!).render(scenario === 'receipt-date-query' ? <ReceiptDateQueryApp />
  : scenario === 'receipt' ? <ReceiptComparisonApp />
  : scenario === 'assignment' || scenario === 'quiz' ? <AssignmentPlanningApp quiz={scenario === 'quiz'} />
  : scenario === 'platform' || scenario === 'clock'
    ? <PlatformPlanningApp clock={scenario === 'clock'} /> : <App />);
