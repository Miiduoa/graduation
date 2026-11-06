import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { View, Text } from 'react-native';
import { SavedCampusPlansPanel } from '../../../apps/mobile/src/screens/SavedCampusPlansPanel';
import { CampusPlanComparisonCard } from '../../../apps/mobile/src/screens/CampusPlanComparisonCard';
import { CampusEvidencePlanCard } from '../../../apps/mobile/src/screens/CampusEvidencePlanCard';
import { applyTheme, theme } from '../../../apps/mobile/src/ui/theme';
import type { SavedCampusPlan } from '../../../apps/mobile/src/services/savedCampusPlans';
import type { CampusPlanComparison } from '../../../apps/mobile/src/services/campusPlanComparison';
import type { CampusEvidencePlan } from '../../../apps/mobile/src/services/offlineCampusPlanner';

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

declare global { interface Window { qaEvents: unknown[] } }
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
createRoot(document.getElementById('root')!).render(<App />);
