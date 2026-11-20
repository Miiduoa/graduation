import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Text, View } from 'react-native';
import { CampusEvidencePlanCard } from '../../apps/mobile/src/screens/CampusEvidencePlanCard';
import { SavedCampusPlansPanel } from '../../apps/mobile/src/screens/SavedCampusPlansPanel';
import { NuniStudyPlanActions } from '../../apps/mobile/src/screens/NuniStudyPlanActions';
import {
  NuniPlanAssignmentOpenButton,
  type NuniPlanAssignmentOpenContext,
} from '../../apps/mobile/src/screens/NuniPlanAssignmentOpenButton';
import { NuniCourseworkStudyAction } from '../../apps/mobile/src/screens/NuniCourseworkStudyAction';
import { AICard } from '../../apps/mobile/src/ui/aiFirst';
import { applyTheme, theme } from '../../apps/mobile/src/ui/theme';
import type { CampusEvidencePlan } from '../../apps/mobile/src/services/offlineCampusPlanner';
import type { SavedCampusPlan } from '../../apps/mobile/src/services/savedCampusPlans';
import type { CourseworkRead } from '../../apps/mobile/src/features/nuniCourseworkFollowUp';

const mode = new URLSearchParams(location.search).get('theme') === 'dark' ? 'dark' : 'light';
applyTheme(mode);
document.body.style.backgroundColor = theme.colors.bg;
Date.now = () => Date.parse('2026-11-08T02:00:00.000Z');
const checkedAt = '2026-11-08T02:00:00.000Z';
const accountId = 'pa_11111111-1111-4111-8111-111111111111';
const workspaceId = 'cw_11111111-1111-4111-8111-111111111111';
const assignmentId = 'cwa_11111111-1111-4111-8111-111111111111';
const source = {
  accountId,
  workspaceId,
  assignmentId,
  schoolId: 'pu',
  academicYear: '115',
  semester: '1',
};
const events: unknown[] = [];
Object.assign(window, { previewEvents: events });
const plan: CampusEvidencePlan = {
  title: '未來七天課業計畫',
  checkedAt,
  overview: '先處理快到期的作業，再安排課間複習。',
  content: '依保存課表與已授權課程摘要，整理這週準備順序。',
  limitations: ['課表與課業資料仍以原服務的最新資訊為準。'],
  steps: [
    {
      id: 'model-report',
      title: '資料模型設計報告',
      detail: '資料庫系統｜11/10 18:00 截止。先完成資料表關聯，再整理設計說明。',
      priority: 'soon',
      evidence: 'authorized-assignments',
      route: '/classroom',
      groupName: '資料庫系統',
      dueAt: '2026-11-10T10:00:00.000Z',
      nuniSource: source,
    },
    {
      id: 'interface-review',
      title: '行動應用介面練習',
      detail: '行動應用程式設計｜11/12 23:59 截止。核對作業要求與老師的回饋。',
      priority: 'normal',
      evidence: 'authorized-assignments',
      route: '/classroom',
      groupName: '行動應用程式設計',
      dueAt: '2026-11-12T15:59:00.000Z',
    },
  ],
  agenda: {
    timetableAvailable: true,
    assignmentsAvailable: true,
    ignoredCourses: 0,
    outsideWindow: [],
    days: [
      {
        date: '2026-11-09',
        label: '11/9（週一）',
        courses: [],
        gaps: [],
        conflicts: [],
        deadlines: [],
        scheduledClasses: [
          {
            name: '資料庫系統',
            room: '資訊大樓 305',
            startAt: '2026-11-09T01:00:00.000Z',
            endAt: '2026-11-09T02:00:00.000Z',
          },
          {
            name: '行動應用程式設計',
            room: '資訊大樓 401',
            startAt: '2026-11-09T05:10:00.000Z',
            endAt: '2026-11-09T07:00:00.000Z',
          },
        ],
      },
      {
        date: '2026-11-10',
        label: '11/10（週二）',
        courses: [],
        gaps: [],
        conflicts: [],
        scheduledClasses: [],
        deadlines: [
          {
            title: '資料模型設計報告',
            groupName: '資料庫系統',
            dueAt: '2026-11-10T10:00:00.000Z',
            timeLabel: '18:00',
            overdue: false,
            nuniSource: source,
          },
        ],
      },
    ],
  },
};
// Synthetic seven-day input; rendering remains the production component.
const shownDays = plan.agenda!.days;
plan.agenda!.days = Array.from({ length: 7 }, (_, index) => {
  const date = `2026-11-${String(8 + index).padStart(2, '0')}`;
  return (
    shownDays.find((day) => day.date === date) ?? {
      date,
      label: `11/${8 + index}（週${['日', '一', '二', '三', '四', '五', '六'][index]}）`,
      courses: [],
      gaps: [],
      conflicts: [],
      deadlines: [],
      scheduledClasses: [],
    }
  );
});
const saved: SavedCampusPlan = {
  id: 'readme-week',
  question: '幫我整理這週要完成的作業，先安排快到期的。',
  savedAt: checkedAt,
  updatedAt: checkedAt,
  completedStepIds: ['model-report'],
  plan: {
    ...plan,
    title: '這週的課業安排',
    steps: plan.steps.map(({ nuniSource, ...step }) => step),
    agenda: undefined,
  },
};
const context: NuniPlanAssignmentOpenContext = {
  accountId,
  schoolId: 'pu',
  isCurrent: () => true,
  request: async () => {
    throw new Error('No platform API in the README preview');
  },
  bffRequest: async () => {
    throw new Error('No platform API in the README preview');
  },
  readTarget: async () => ({ kind: 'unavailable' }),
  readQuizTarget: async () => ({ kind: 'unavailable' }),
};
const navigation = {
  getState: () => ({ routeNames: ['NuniWorkspace'] }),
  navigate: (route: string, params?: unknown) => {
    events.push({ route, params });
  },
};
const read: CourseworkRead = {
  anchor: {
    uid: '',
    owner: `nuni:${accountId}`,
    schoolId: 'pu',
    updatedAt: checkedAt,
    classes: [
      {
        courseId: 'readme-database',
        name: '資料庫系統',
        date: '2026-11-09',
        term: '115|1',
        room: '資訊大樓 305',
        startTime: '09:00',
        endTime: '10:00',
      },
    ],
  },
  checkedAt,
  result: {
    kind: 'assignments',
    workspace: { id: workspaceId, title: '資料庫系統' },
    limited: false,
    assignments: [
      {
        id: assignmentId,
        title: '資料模型設計報告',
        dueAt: '2026-11-10T10:00:00.000Z',
        state: 'open',
        submittedAt: null,
      },
    ],
  },
};

function Note() {
  return (
    <Text
      style={{
        marginHorizontal: 20,
        marginTop: 14,
        color: theme.colors.muted,
        fontSize: 12,
        lineHeight: 19,
      }}
    >
      元件展示・合成課程資料。未連接正式帳號，操作不會提交至平台。
    </Text>
  );
}
function Plan() {
  const [selection, setSelection] = useState<'today' | 'week'>('week');
  const selected =
    selection === 'week' ? plan : { ...plan, title: '今日課業重點', steps: plan.steps.slice(0, 1) };
  return (
    <>
      <AICard title="我的課業安排">
        <NuniStudyPlanActions
          disabled={false}
          onToday={() => setSelection('today')}
          onWeek={() => setSelection('week')}
        />
      </AICard>
      <AICard title="校園行動計畫">
        <CampusEvidencePlanCard
          plan={selected}
          disabled={false}
          onOpenRoute={(route) => events.push({ kind: 'open-route', route })}
          renderAssignmentAction={(assignment) => (
            <NuniPlanAssignmentOpenButton
              assignment={assignment}
              context={context}
              navigation={navigation}
              disabled={false}
            />
          )}
        />
      </AICard>
    </>
  );
}
function Saved() {
  const [plans, setPlans] = useState([
    saved,
    {
      ...saved,
      id: 'readme-next',
      question: '明天上課前要準備什麼？',
      completedStepIds: [],
      plan: { ...saved.plan, title: '明天上課前的準備', steps: saved.plan.steps.slice(1) },
    },
  ]);
  return (
    <SavedCampusPlansPanel
      plans={plans}
      initialExpandedId={saved.id}
      loading={false}
      busy={false}
      error=""
      onRetry={() => events.push({ kind: 'retry' })}
      onDelete={(id) => setPlans((rows) => rows.filter((row) => row.id !== id))}
      onToggleStep={(id, stepId, done) =>
        setPlans((rows) =>
          rows.map((row) =>
            row.id !== id
              ? row
              : {
                  ...row,
                  completedStepIds: done
                    ? [...row.completedStepIds, stepId]
                    : row.completedStepIds.filter((v) => v !== stepId),
                },
          ),
        )
      }
      onReplan={(row) => events.push({ kind: 'replan', id: row.id })}
      onOpenRoute={(route) => events.push({ kind: 'open-route', route })}
    />
  );
}
function Confirm() {
  return (
    <AICard title="作業準備行程">
      <NuniCourseworkStudyAction
        read={read}
        assignmentIds={[assignmentId]}
        latest
        initialTime={{ date: '2026-11-09', startTime: '10:10', endTime: '10:40' }}
        context={{
          uid: '',
          schoolId: 'pu',
          platformTimetable: { accountId, isCurrent: () => true },
          isCurrent: () => true,
        }}
        onTask={(task) => events.push({ kind: 'task', task })}
      />
    </AICard>
  );
}

const scene = document.body.dataset.scene;
createRoot(document.getElementById('root')!).render(
  <View
    style={{
      minHeight: '100vh' as never,
      backgroundColor: theme.colors.bg,
      paddingTop: 16,
      paddingBottom: 24,
    }}
  >
    <Text
      accessibilityRole="header"
      style={{
        marginHorizontal: 20,
        marginBottom: 16,
        color: theme.colors.text,
        fontSize: 22,
        fontWeight: '700',
      }}
    >
      課業助理
    </Text>
    {scene === 'saved' ? <Saved /> : scene === 'confirm' ? <Confirm /> : <Plan />}
    <Note />
  </View>,
);
