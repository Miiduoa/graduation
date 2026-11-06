import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { View, Text } from 'react-native';
import { SavedCampusPlansPanel } from '../../../apps/mobile/src/screens/SavedCampusPlansPanel';
import { applyTheme, theme } from '../../../apps/mobile/src/ui/theme';
import type { SavedCampusPlan } from '../../../apps/mobile/src/services/savedCampusPlans';

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

declare global { interface Window { qaEvents: unknown[] } }
window.qaEvents = [];
function App() {
  const [plans, setPlans] = useState([first, second]);
  return <View style={{ minHeight: '100vh' as never, backgroundColor: theme.colors.bg, paddingTop: 14, paddingBottom: 24 }}>
    <Text accessibilityRole="header" style={{ marginHorizontal: 20, marginBottom: 16, color: theme.colors.text, fontSize: 22, fontWeight: '700' }}>校園工具</Text>
    <SavedCampusPlansPanel plans={plans} loading={false} busy={false} error=""
      onRetry={() => { window.qaEvents.push({ kind: 'retry' }); }}
      onDelete={(id) => { window.qaEvents.push({ kind: 'delete', id }); setPlans((old) => old.filter((row) => row.id !== id)); }}
      onToggleStep={(id, stepId, done) => {
        window.qaEvents.push({ kind: 'toggle', id, stepId, done });
        setPlans((old) => old.map((row) => row.id !== id ? row : { ...row,
          completedStepIds: done ? [...row.completedStepIds, stepId] : row.completedStepIds.filter((value) => value !== stepId),
        }));
      }}
      onReplan={(saved) => { window.qaEvents.push({ kind: 'replan', id: saved.id, completed: saved.completedStepIds }); }}
      onOpenRoute={(route) => { window.qaEvents.push({ kind: 'open-route', route }); }} />
  </View>;
}
createRoot(document.getElementById('root')!).render(<App />);
