/**
 * Teacher Cockpit — 教師駕駛艙（統一設計系統 v2）
 */
import React, { useEffect, useMemo, useState, useCallback } from 'react';
import {
  ScrollView,
  View,
  Text,
  Pressable,
  Modal,
  TextInput,
  Alert,
  KeyboardAvoidingView,
  Platform,
  LayoutAnimation,
  UIManager,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  draftFeedback,
  bulkReminders,
  type DraftFeedbackOutput,
  type BulkReminderItem,
  type FeedbackTone,
} from '@campus/shared';
import {
  DEMO_COURSES,
  getDemoCoursesForUid,
  getDemoHomeworksByCourse,
  type MockHomework,
} from '../data/demoCoursesMock';
import { theme } from '../ui/theme';
import { useTabBarContentBottomPadding } from '../ui/navigationTheme';
import {
  CockpitHero,
  CockpitMetricRow,
  CockpitMetricChip,
  CockpitSection,
  CockpitRow,
} from '../ui/cockpitShell';
import { AgentSummaryBanner } from '../components/AgentSummaryBanner';
import { useAuth } from '../state/auth';
import {
  emitBulkReminder,
  emitFeedbackDrafted,
  emitLeaveDecision,
  subscribeRoleEvent,
  loadRoleEventInbox,
  type HomeworkSubmittedPayload,
  type DiscussionPostedPayload,
  type LeaveRequestedPayload,
} from '../services/roleEventBus';
import {
  aiForecastBulkReminder,
  aiPreReviewGrade,
} from '../services/aiOrchestrator';
import { AIMissionControl } from '../components/AIMissionControl';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

// 🔗 demo 學生主角是「顧晉瑋」(uid: demo_student_kuchih)
// 每門課都把他放在第一位，這樣老師在任一課對學生 #1 動作時，
// 都會以 demo 學生為對象 → 學生登入後在 Today「📥 來自老師」立刻看到。
const STUDENT_PRIMARY = {
  uid: 'demo_student_kuchih',
  displayName: '顧晉瑋',
  email: 'demo.student@pu.edu.tw',
};

const DEMO_STUDENTS: Record<number, Array<{ uid: string; displayName: string; email: string }>> = {
  71378: [
    STUDENT_PRIMARY,
    { uid: 'u1', displayName: '林佳玲', email: 'jia@example.edu' },
    { uid: 'u2', displayName: '王冠宇', email: 'kuan@example.edu' },
    { uid: 'u3', displayName: '陳柏翰', email: 'po@example.edu' },
    { uid: 'u4', displayName: '楊涵真', email: 'han@example.edu' },
    { uid: 'u5', displayName: '張瑞祥', email: 'rui@example.edu' },
    { uid: 'u6', displayName: '李宜珊', email: 'yi@example.edu' },
  ],
  71282: [
    STUDENT_PRIMARY,
    { uid: 'u11', displayName: '吳子翔', email: 'tzu@example.edu' },
    { uid: 'u12', displayName: '黃詩涵', email: 'shi@example.edu' },
  ],
  71240: [
    STUDENT_PRIMARY,
    { uid: 'u21', displayName: '蔡明哲', email: 'min@example.edu' },
  ],
  71393: [
    STUDENT_PRIMARY,
    { uid: 'u31', displayName: '林依靜', email: 'yj@example.edu' },
    { uid: 'u32', displayName: '周冠廷', email: 'zh@example.edu' },
    { uid: 'u33', displayName: '阮品逸', email: 'pp@example.edu' },
  ],
  77418: [
    STUDENT_PRIMARY,
    { uid: 'u41', displayName: '謝芷涵', email: 'zh4@example.edu' },
  ],
};

function fakeSubmittedSet(hwId: number, studentCount: number): Set<string> {
  const submitted = new Set<string>();
  for (let i = 0; i < studentCount; i++) {
    if ((hwId + i) % 3 !== 0) submitted.add(`u${i}`);
  }
  return submitted;
}

export default function TeacherCockpitScreen() {
  const navigation = useNavigation<any>();
  const auth = useAuth();
  const tabBarBottomPad = useTabBarContentBottomPadding();
  // 權限隔離：教師只看自己教的課。demo_teacher_chang 只教機器學習 71378。
  const teacherCourses = useMemo(
    () => getDemoCoursesForUid(auth.user?.uid),
    [auth.user?.uid],
  );
  const [courseId, setCourseId] = useState<number>(
    () => teacherCourses[0]?.id ?? DEMO_COURSES[0].id,
  );
  const [tone, setTone] = useState<FeedbackTone>('encouraging');
  const [openSection, setOpenSection] = useState<null | 'flagged' | 'homeworks' | 'tone'>('flagged');
  const toggle = (k: typeof openSection) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setOpenSection(openSection === k ? null : k);
  };

  // Modal 狀態
  const [draftHw, setDraftHw] = useState<MockHomework | null>(null);
  const [draftStudent, setDraftStudent] = useState<{ uid: string; displayName: string } | null>(null);
  const [draftResult, setDraftResult] = useState<DraftFeedbackOutput | null>(null);
  const [draftEditing, setDraftEditing] = useState('');
  const [reminderHw, setReminderHw] = useState<MockHomework | null>(null);
  const [reminderItems, setReminderItems] = useState<BulkReminderItem[]>([]);

  const course =
    teacherCourses.find((c) => c.id === courseId) ??
    DEMO_COURSES.find((c) => c.id === courseId) ??
    teacherCourses[0] ??
    DEMO_COURSES[0];
  const homeworks = useMemo(() => getDemoHomeworksByCourse(courseId), [courseId]);
  const students = DEMO_STUDENTS[courseId] ?? [];

  const homeworkStats = useMemo(
    () =>
      homeworks.map((hw) => {
        const submitted = fakeSubmittedSet(hw.id, students.length);
        const missing = students.length - submitted.size;
        return { hw, submittedCount: submitted.size, missing, total: students.length };
      }),
    [homeworks, students.length],
  );

  const pendingGradeCount = useMemo(
    () => homeworks.filter((hw) => hw.submitted && !hw.graded).length,
    [homeworks],
  );

  const totalMissing = homeworkStats.reduce((s, x) => s + x.missing, 0);

  // 🔔 即時收學生反向事件（繳交 / 發討論 / 請假）→ 更新待批改 / 待回覆計數
  const [liveSubmits, setLiveSubmits] = useState<Array<{ id: string; studentName: string; homeworkTitle: string; at: string }>>([]);
  const [liveDiscussions, setLiveDiscussions] = useState<Array<{ id: string; studentName: string; threadTitle: string; preview: string }>>([]);
  const [liveLeaves, setLiveLeaves] = useState<Array<{
    id: string;
    studentUid: string;
    studentName: string;
    leaveId: string;
    category: LeaveRequestedPayload['category'];
    fromDate: string;
    toDate: string;
    reason: string;
    at: string;
    decision?: 'approved' | 'rejected';
  }>>([]);

  // 載入歷史 inbox events（學生在切到老師帳號前已經做的動作）+ 訂閱即時
  useEffect(() => {
    const teacherUid = auth.user?.uid ?? 'demo_teacher_chang';
    let cancelled = false;

    // 1. 載入歷史 — 從 inbox 拉所有 homework_submitted / discussion_posted / leave_requested
    (async () => {
      const events = await loadRoleEventInbox(teacherUid).catch(() => []);
      if (cancelled) return;
      const submits: typeof liveSubmits = [];
      const discussions: typeof liveDiscussions = [];
      const leaves: typeof liveLeaves = [];
      for (const event of events) {
        if (event.kind === 'homework_submitted') {
          const p = event.payload as HomeworkSubmittedPayload;
          submits.push({
            id: event.id,
            studentName: event.actorName ?? '學生',
            homeworkTitle: p.homeworkTitle,
            at: event.occurredAt,
          });
        } else if (event.kind === 'discussion_posted') {
          const p = event.payload as DiscussionPostedPayload;
          discussions.push({
            id: event.id,
            studentName: p.authorName,
            threadTitle: p.threadTitle,
            preview: p.preview,
          });
        } else if (event.kind === 'leave_requested') {
          const p = event.payload as LeaveRequestedPayload;
          leaves.push({
            id: event.id,
            studentUid: event.actorUid,
            studentName: p.studentName,
            leaveId: p.leaveId,
            category: p.category,
            fromDate: p.fromDate,
            toDate: p.toDate,
            reason: p.reason,
            at: event.occurredAt,
          });
        }
      }
      setLiveSubmits(submits.slice(0, 10));
      setLiveDiscussions(discussions.slice(0, 10));
      setLiveLeaves(leaves.slice(0, 10));
    })();

    // 2. 訂閱即時（同 session 中其他動作觸發）
    const unsubSubmit = subscribeRoleEvent<HomeworkSubmittedPayload>('homework_submitted', (event) => {
      setLiveSubmits((prev) => {
        if (prev.find((s) => s.id === event.id)) return prev;
        return [
          { id: event.id, studentName: event.actorName ?? '學生', homeworkTitle: event.payload.homeworkTitle, at: event.occurredAt },
          ...prev,
        ].slice(0, 10);
      });
    });
    const unsubDiscussion = subscribeRoleEvent<DiscussionPostedPayload>('discussion_posted', (event) => {
      setLiveDiscussions((prev) => {
        if (prev.find((d) => d.id === event.id)) return prev;
        return [
          { id: event.id, studentName: event.payload.authorName, threadTitle: event.payload.threadTitle, preview: event.payload.preview },
          ...prev,
        ].slice(0, 10);
      });
    });
    const unsubLeave = subscribeRoleEvent<LeaveRequestedPayload>('leave_requested', (event) => {
      setLiveLeaves((prev) => {
        if (prev.find((l) => l.id === event.id)) return prev;
        return [
          {
            id: event.id,
            studentUid: event.actorUid,
            studentName: event.payload.studentName,
            leaveId: event.payload.leaveId,
            category: event.payload.category,
            fromDate: event.payload.fromDate,
            toDate: event.payload.toDate,
            reason: event.payload.reason,
            at: event.occurredAt,
          },
          ...prev,
        ].slice(0, 10);
      });
    });
    return () => {
      cancelled = true;
      unsubSubmit();
      unsubDiscussion();
      unsubLeave();
    };
  }, [auth.user?.uid]);

  // 處理請假審核
  const handleLeaveDecision = useCallback(async (
    leave: typeof liveLeaves[number],
    decision: 'approved' | 'rejected',
  ) => {
    try {
      await emitLeaveDecision({
        actorUid: auth.user?.uid ?? 'demo_teacher_chang',
        actorName: auth.profile?.displayName ?? '張怡君',
        targetUids: [leave.studentUid],
        courseId: 'leave',
        courseName: '請假審核',
        payload: {
          leaveId: leave.leaveId,
          decision,
          decidedBy: auth.profile?.displayName ?? '張怡君',
          message: decision === 'approved'
            ? `已核准 ${leave.fromDate} ~ ${leave.toDate} 的${leave.category === 'sick' ? '病假' : leave.category === 'personal' ? '事假' : leave.category === 'official' ? '公假' : '喪假'}`
            : '請另外提交補件資料',
        },
      });
      setLiveLeaves((prev) => prev.map((l) => l.id === leave.id ? { ...l, decision } : l));
      Alert.alert(
        decision === 'approved' ? '✅ 已核准' : '❌ 已駁回',
        `${leave.studentName} 的 inbox 立刻會收到結果。`,
      );
    } catch (e) {
      Alert.alert('送出失敗', String(e));
    }
  }, [auth.user?.uid, auth.profile?.displayName]);

  const flagged = useMemo(() => {
    const out: Array<{ student: typeof students[number]; reason: string; severity: 'high' | 'medium' }> = [];
    students.forEach((s, i) => {
      const missing = homeworkStats.filter((hs) => {
        const submitted = fakeSubmittedSet(hs.hw.id, students.length);
        return !submitted.has(`u${i}`);
      }).length;
      if (missing >= 3) {
        out.push({ student: s, reason: `已 ${missing} 份作業未繳`, severity: 'high' });
      } else if (missing === 2) {
        out.push({ student: s, reason: '已 2 份作業未繳', severity: 'medium' });
      }
    });
    return out;
  }, [students, homeworkStats]);

  const [aiPreview, setAiPreview] = useState<ReturnType<typeof aiPreReviewGrade> | null>(null);

  const openDraftFor = useCallback(
    (hw: MockHomework, student: { uid: string; displayName: string }) => {
      // 🤖 AI 動作前預判：給老師「目前學生若收到這個分數會怎樣」的預警
      const preview = aiPreReviewGrade({
        courseId: course.id,
        homeworkId: hw.id,
        studentUid: student.uid,
        studentName: student.displayName,
        newScore: hw.score ?? 75,
      });
      setAiPreview(preview);

      const result = draftFeedback({
        studentName: student.displayName,
        scorePercent: hw.score ?? 75,
        isLate: hw.isLate,
        tone,
        seed: student.uid + '_' + hw.id,
        courseName: course.name,
      });
      setDraftHw(hw);
      setDraftStudent(student);
      setDraftResult(result);
      setDraftEditing(result.draft);
    },
    [tone, course.id, course.name],
  );

  const openBulkReminderFor = useCallback(
    (hw: MockHomework) => {
      const submitted = fakeSubmittedSet(hw.id, students.length);
      const missing = students.filter((_, i) => !submitted.has(`u${i}`));

      // 🤖 AI 預測：先告訴老師發了會有多少人補交
      const hoursUntilDue = Math.max(0, (new Date(hw.dueAt).getTime() - Date.now()) / 3_600_000);
      const aiForecast = aiForecastBulkReminder({
        homeworkTitle: hw.title,
        hoursUntilDue,
        studentCount: missing.length,
        tone,
      });

      if (aiForecast.needsConfirm) {
        Alert.alert(
          '🤖 AI 建議檢視',
          aiForecast.suggestion,
          [
            { text: '取消', style: 'cancel' },
            {
              text: '仍要發送',
              onPress: () => {
                const items = bulkReminders({
                  students: missing,
                  homeworkTitle: hw.title,
                  courseId: course.id,
                  homeworkId: hw.id,
                  courseName: course.name,
                  dueAt: hw.dueAt,
                  tone,
                });
                setReminderHw(hw);
                setReminderItems(items);
              },
            },
          ],
        );
        return;
      }

      const items = bulkReminders({
        students: missing,
        homeworkTitle: hw.title,
        courseId: course.id,
        homeworkId: hw.id,
        courseName: course.name,
        dueAt: hw.dueAt,
        tone,
      });
      setReminderHw(hw);
      setReminderItems(items);
    },
    [students, course.id, course.name, tone],
  );

  const handleSendDraft = useCallback(async () => {
    if (draftHw && draftStudent) {
      await emitFeedbackDrafted({
        actorUid: auth.user?.uid ?? 'teacher_demo',
        actorName: auth.profile?.displayName ?? '老師',
        targetUids: [draftStudent.uid],
        courseId: course.id,
        courseName: course.name,
        payload: {
          studentName: draftStudent.displayName,
          homeworkTitle: draftHw.title,
          draftPreview: draftEditing.slice(0, 100),
        },
      });
    }
    Alert.alert('✅ 已送出', `${draftStudent?.displayName} 的評語已進學生 inbox。`);
    setDraftHw(null);
    setDraftStudent(null);
    setDraftResult(null);
  }, [draftStudent, draftHw, draftEditing, course, auth.user?.uid, auth.profile?.displayName]);

  const handleSendReminders = useCallback(async () => {
    if (reminderHw && reminderItems.length > 0) {
      await emitBulkReminder({
        actorUid: auth.user?.uid ?? 'teacher_demo',
        actorName: auth.profile?.displayName ?? '老師',
        targetUids: reminderItems.map((r) => r.uid),
        courseId: course.id,
        courseName: course.name,
        payload: {
          homeworkTitle: reminderHw.title,
          homeworkId: reminderHw.id,
          count: reminderItems.length,
        },
      });
    }
    Alert.alert('✅ 已發送', `${reminderItems.length} 份個人化提醒。`);
    setReminderHw(null);
    setReminderItems([]);
  }, [reminderItems, reminderHw, course, auth.user?.uid, auth.profile?.displayName]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.bg }} edges={['top']}>
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: theme.layout.screenHorizontalPadding,
          paddingTop: theme.space.md,
          paddingBottom: tabBarBottomPad,
        }}
        showsVerticalScrollIndicator={false}
      >
        <CockpitHero
          eyebrow={(() => {
            try {
              // 動態載入避免循環依賴
              const { getDemoUserStory } = require('../data/demoUserStories');
              const story = auth.user?.uid ? getDemoUserStory(auth.user.uid) : null;
              if (story?.office) {
                return `${auth.profile?.displayName?.split('（')[0] ?? '老師'} · ${story.office.building} ${story.office.room}`;
              }
            } catch { /* swallow */ }
            return `午安，${auth.profile?.displayName?.split('（')[0] ?? '老師'}`;
          })()}
          title="AI 教學中樞"
          summary={(() => {
            try {
              const { getDemoUserStory } = require('../data/demoUserStories');
              const story = auth.user?.uid ? getDemoUserStory(auth.user.uid) : null;
              const oh = story?.office?.officeHours
                ?.map((h: any) => `${h.day} ${h.from}-${h.to}`)
                .join('、');
              const base = `${flagged.length} 位需關注、${totalMissing} 人次缺繳`;
              if (oh) return `${base}\nOffice Hour：${oh}`;
              return base;
            } catch {
              return `${flagged.length} 位需關注、${totalMissing} 人次缺繳`;
            }
          })()}
        />

        {/* 🤖 AI Agent 摘要 — 點進 AIAgentConsole */}
        <AgentSummaryBanner cockpitLabel="老師" />

        {/* AI 任務指揮 — 角色身分專屬下一步 */}
        <View style={{ marginVertical: theme.space.md }}>
          <AIMissionControl uid={auth.user?.uid} maxVisible={3} hideWhenEmpty />
        </View>

        {/* 一鍵跨角色 demo */}
        <Pressable
          onPress={async () => {
            Alert.alert(
              '一鍵示範跨角色',
              '會 emit 一筆 demo 成績 + 評語給學生 顧晉瑋（demo_student_kuchih）。\n切到學生 demo 帳號就能看到。',
              [
                { text: '取消', style: 'cancel' },
                {
                  text: '送出',
                  onPress: async () => {
                    try {
                      const { simulateFullGradingCycle } = await import('../services/demoActionSimulator');
                      const out = await simulateFullGradingCycle({
                        studentUid: 'demo_student_kuchih',
                        studentName: '顧晉瑋',
                        teacherUid: auth.user?.uid ?? 'demo_teacher_chang',
                        teacherName: auth.profile?.displayName ?? '張怡君',
                        courseId: DEMO_COURSES[0].id,
                        courseName: DEMO_COURSES[0].name,
                        homeworkId: 99,
                        homeworkTitle: 'demo 即席批改作業',
                        score: 92,
                        totalScore: 100,
                        feedbackPreview: '結構清楚，正規化處理紮實。可在資料正確性檢查上加強。',
                      });
                      Alert.alert('✅ Demo 跑完', out.steps.join('\n'));
                    } catch (e) {
                      Alert.alert('demo 失敗', String(e));
                    }
                  },
                },
              ],
            );
          }}
          style={({ pressed }) => ({
            padding: theme.space.md,
            borderRadius: theme.radius.lg,
            backgroundColor: theme.colors.accent,
            marginBottom: theme.space.md,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
            opacity: pressed ? 0.85 : 1,
          })}
        >
          <Ionicons name="git-network-outline" size={16} color={theme.colors.onAccent} />
          <Text style={{ color: theme.colors.onAccent, fontWeight: '700', fontSize: 14 }}>
            🎬 一鍵示範：批改 → 學生收到評語
          </Text>
        </Pressable>

        <CockpitMetricRow>
          <CockpitMetricChip label="待批改" value={pendingGradeCount} />
          <CockpitMetricChip label="缺繳人次" value={totalMissing} tone={totalMissing > 0 ? 'warn' : undefined} />
          <CockpitMetricChip label="🚩 紅旗" value={flagged.length} tone={flagged.length > 0 ? 'danger' : 'success'} />
          <CockpitMetricChip
            label="📝 請假"
            value={liveLeaves.filter((l) => !l.decision).length}
            tone={liveLeaves.filter((l) => !l.decision).length > 0 ? 'warn' : undefined}
          />
        </CockpitMetricRow>

        {/* 待審請假 */}
        {liveLeaves.length > 0 && (
          <View
            style={{
              marginTop: theme.space.sm,
              marginBottom: theme.space.sm,
              padding: theme.space.md,
              borderRadius: theme.radius.lg,
              backgroundColor: theme.colors.surface,
              borderLeftWidth: 3,
              borderLeftColor: theme.colors.warning,
              gap: theme.space.sm,
            }}
          >
            <Text style={{ fontSize: 13, fontWeight: '700', color: theme.colors.text }}>
              📝 學生請假申請 ({liveLeaves.length})
            </Text>
            {liveLeaves.map((l) => {
              const catLabel = l.category === 'sick' ? '🤒 病假' : l.category === 'personal' ? '📅 事假' : l.category === 'official' ? '🏛 公假' : '🕯 喪假';
              return (
                <View
                  key={l.id}
                  style={{
                    padding: theme.space.sm + 2,
                    borderRadius: theme.radius.md,
                    backgroundColor: theme.colors.surfaceMuted,
                    gap: 4,
                  }}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space.xs }}>
                    <Text style={{ fontSize: 13, fontWeight: '700', color: theme.colors.text, flex: 1 }}>
                      {l.studentName} · {catLabel}
                    </Text>
                    {l.decision && (
                      <Text style={{
                        fontSize: 11,
                        fontWeight: '700',
                        color: l.decision === 'approved' ? theme.colors.success : theme.colors.danger,
                      }}>
                        {l.decision === 'approved' ? '✅ 已核准' : '❌ 已駁回'}
                      </Text>
                    )}
                  </View>
                  <Text style={{ fontSize: 11, color: theme.colors.muted }}>
                    {l.fromDate} → {l.toDate} · {l.reason}
                  </Text>
                  {!l.decision && (
                    <View style={{ flexDirection: 'row', gap: theme.space.xs, marginTop: 4 }}>
                      <Pressable
                        onPress={() => handleLeaveDecision(l, 'approved')}
                        style={({ pressed }) => ({
                          paddingHorizontal: theme.space.sm + 2,
                          paddingVertical: theme.space.xs + 2,
                          borderRadius: theme.radius.full,
                          backgroundColor: theme.colors.success + '20',
                          opacity: pressed ? 0.6 : 1,
                        })}
                      >
                        <Text style={{ color: theme.colors.success, fontSize: 12, fontWeight: '700' }}>
                          ✓ 核准
                        </Text>
                      </Pressable>
                      <Pressable
                        onPress={() => handleLeaveDecision(l, 'rejected')}
                        style={({ pressed }) => ({
                          paddingHorizontal: theme.space.sm + 2,
                          paddingVertical: theme.space.xs + 2,
                          borderRadius: theme.radius.full,
                          backgroundColor: theme.colors.surface,
                          opacity: pressed ? 0.6 : 1,
                        })}
                      >
                        <Text style={{ color: theme.colors.muted, fontSize: 12, fontWeight: '600' }}>
                          ✗ 駁回
                        </Text>
                      </Pressable>
                    </View>
                  )}
                </View>
              );
            })}
          </View>
        )}

        {/* 課程切換 */}
        <View style={{
          flexDirection: 'row',
          gap: theme.space.xs + 2,
          flexWrap: 'wrap',
          marginBottom: theme.space.md,
        }}>
          {teacherCourses.map((c) => (
            <Pressable
              key={c.id}
              onPress={() => setCourseId(c.id)}
              style={({ pressed }) => ({
                paddingHorizontal: theme.space.sm + 2,
                paddingVertical: theme.space.xs + 2,
                borderRadius: theme.radius.full,
                backgroundColor: courseId === c.id ? theme.colors.accent : theme.colors.surface,
                opacity: pressed ? 0.7 : 1,
              })}
            >
              <Text style={{
                color: courseId === c.id ? theme.colors.onAccent : theme.colors.text,
                fontSize: theme.typography.labelSmall.fontSize,
                fontWeight: '600',
              }}>
                {c.iconEmoji} {c.name.slice(0, 6)}
              </Text>
            </Pressable>
          ))}
        </View>

        <View style={{ marginTop: theme.space.xs }}>
          {/* 紅旗學生 */}
          {flagged.length > 0 && (
            <CockpitSection
              label="🚩 需關注學生"
              count={flagged.length}
              open={openSection === 'flagged'}
              onToggle={() => toggle('flagged')}
            >
              {flagged.map((f) => (
                <CockpitRow
                  key={f.student.uid}
                  icon="👤"
                  title={f.student.displayName}
                  subtitle={f.reason}
                  tone={f.severity === 'high' ? 'danger' : 'warn'}
                />
              ))}
            </CockpitSection>
          )}

          {/* 評語 tone */}
          <CockpitSection
            label="⚙️ 評語風格"
            count={undefined}
            open={openSection === 'tone'}
            onToggle={() => toggle('tone')}
          >
            <View style={{ flexDirection: 'row', gap: theme.space.xs + 2, paddingVertical: theme.space.sm }}>
              {(['strict', 'neutral', 'encouraging'] as const).map((t) => (
                <Pressable
                  key={t}
                  onPress={() => setTone(t)}
                  style={({ pressed }) => ({
                    flex: 1,
                    paddingVertical: theme.space.sm,
                    borderRadius: theme.radius.md,
                    backgroundColor: tone === t ? theme.colors.accent : theme.colors.surface,
                    alignItems: 'center',
                    opacity: pressed ? 0.7 : 1,
                  })}
                >
                  <Text style={{
                    color: tone === t ? theme.colors.onAccent : theme.colors.text,
                    fontSize: theme.typography.labelSmall.fontSize,
                    fontWeight: '600',
                  }}>
                    {t === 'strict' ? '嚴格' : t === 'neutral' ? '中性' : '鼓勵'}
                  </Text>
                </Pressable>
              ))}
            </View>
          </CockpitSection>

          {/* 作業批改情況 */}
          <CockpitSection
            label="📋 本課作業批改情況"
            count={homeworkStats.length}
            open={openSection === 'homeworks'}
            onToggle={() => toggle('homeworks')}
          >
            {homeworkStats.map(({ hw, missing, total }) => {
              const submittedCount = total - missing;
              return (
                <View
                  key={hw.id}
                  style={{
                    paddingVertical: theme.space.sm,
                    borderBottomWidth: 1,
                    borderBottomColor: theme.colors.separator,
                  }}
                >
                  <Text style={{
                    fontSize: theme.typography.body.fontSize,
                    color: theme.colors.text,
                    fontWeight: '500',
                  }} numberOfLines={1}>
                    {hw.title}
                  </Text>
                  <Text style={{
                    fontSize: theme.typography.bodySmall.fontSize,
                    color: theme.colors.muted,
                    marginTop: 2,
                  }}>
                    截止 {new Date(hw.dueAt).toLocaleDateString('zh-TW')} · 已交 {submittedCount}/{total}
                  </Text>
                  <View style={{ flexDirection: 'row', gap: theme.space.xs + 2, marginTop: theme.space.xs + 4 }}>
                    {submittedCount > 0 && (
                      <Pressable
                        onPress={() => openDraftFor(hw, students[0] ?? { uid: 'demo', displayName: '示範學生' })}
                        style={({ pressed }) => ({
                          flex: 1,
                          paddingVertical: theme.space.xs + 4,
                          borderRadius: theme.radius.full,
                          backgroundColor: theme.colors.accent,
                          alignItems: 'center',
                          opacity: pressed ? 0.85 : 1,
                        })}
                      >
                        <Text style={{
                          color: theme.colors.onAccent,
                          fontSize: theme.typography.labelSmall.fontSize,
                          fontWeight: '700',
                        }}>✨ AI 評語</Text>
                      </Pressable>
                    )}
                    {missing > 0 && (
                      <Pressable
                        onPress={() => openBulkReminderFor(hw)}
                        style={({ pressed }) => ({
                          flex: 1,
                          paddingVertical: theme.space.xs + 4,
                          borderRadius: theme.radius.full,
                          backgroundColor: theme.colors.warning,
                          alignItems: 'center',
                          opacity: pressed ? 0.85 : 1,
                        })}
                      >
                        <Text style={{
                          color: theme.colors.onAccent,
                          fontSize: theme.typography.labelSmall.fontSize,
                          fontWeight: '700',
                        }}>📣 提醒 {missing} 人</Text>
                      </Pressable>
                    )}
                  </View>
                </View>
              );
            })}
          </CockpitSection>
        </View>

        {/* Draft Feedback Modal */}
        <Modal visible={!!draftHw} animationType="slide" transparent>
          <KeyboardAvoidingView
            style={{ flex: 1, backgroundColor: theme.colors.overlay ?? 'rgba(0,0,0,0.5)' }}
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          >
            <View
              style={{
                backgroundColor: theme.colors.surface,
                borderTopLeftRadius: theme.radius.lg,
                borderTopRightRadius: theme.radius.lg,
                padding: theme.space.lg,
                maxHeight: '90%',
                marginTop: 'auto',
              }}
            >
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text style={{
                  fontSize: theme.typography.h3.fontSize,
                  fontWeight: '700',
                  color: theme.colors.text,
                }}>
                  AI 起草：{draftStudent?.displayName}
                </Text>
                <Pressable onPress={() => { setDraftHw(null); setAiPreview(null); }} hitSlop={8}>
                  <Ionicons name="close-circle" size={24} color={theme.colors.muted} />
                </Pressable>
              </View>

              {/* 🤖 AI 動作前預判 banner — aiPreReviewGrade 結果 */}
              {aiPreview && (
                <View style={{
                  marginTop: theme.space.sm,
                  padding: theme.space.sm,
                  borderRadius: theme.radius.md,
                  backgroundColor: aiPreview.needsConfirm ? '#FEF3C7' : theme.colors.surfaceMuted,
                  borderLeftWidth: 3,
                  borderLeftColor: aiPreview.needsConfirm ? theme.colors.warning : theme.colors.accent,
                }}>
                  <Text style={{
                    fontSize: theme.typography.labelSmall.fontSize,
                    fontWeight: '700',
                    color: aiPreview.needsConfirm ? theme.colors.warning : theme.colors.accent,
                    marginBottom: 4,
                  }}>
                    🤖 AI 預判（confidence {aiPreview.confidence}%）
                  </Text>
                  <Text style={{
                    fontSize: theme.typography.body.fontSize,
                    color: theme.colors.text,
                    lineHeight: 20,
                  }}>
                    {aiPreview.suggestion}
                  </Text>
                  {aiPreview.forecast && (
                    <Text style={{
                      marginTop: 4,
                      fontSize: theme.typography.labelSmall.fontSize,
                      color: theme.colors.muted,
                    }}>
                      📊 {aiPreview.forecast.metric}：{aiPreview.forecast.before}% → {aiPreview.forecast.after}% ({aiPreview.forecast.delta > 0 ? '+' : ''}{aiPreview.forecast.delta})
                    </Text>
                  )}
                </View>
              )}

              <ScrollView style={{ marginTop: theme.space.sm, maxHeight: 320 }}>
                <TextInput
                  multiline
                  value={draftEditing}
                  onChangeText={setDraftEditing}
                  style={{
                    padding: theme.space.sm,
                    borderRadius: theme.radius.md,
                    borderWidth: 1,
                    borderColor: theme.colors.border,
                    backgroundColor: theme.colors.bg,
                    color: theme.colors.text,
                    textAlignVertical: 'top',
                    minHeight: 200,
                    fontSize: theme.typography.body.fontSize,
                    lineHeight: theme.typography.body.lineHeight,
                  }}
                />
              </ScrollView>
              <View style={{ flexDirection: 'row', gap: theme.space.xs + 2, marginTop: theme.space.sm }}>
                <Pressable
                  onPress={() => {
                    if (draftHw && draftStudent) openDraftFor(draftHw, draftStudent);
                  }}
                  style={({ pressed }) => ({
                    flex: 1,
                    paddingVertical: theme.space.sm + 2,
                    borderRadius: theme.radius.md,
                    alignItems: 'center',
                    backgroundColor: theme.colors.surfaceMuted,
                    opacity: pressed ? 0.7 : 1,
                  })}
                >
                  <Text style={{ color: theme.colors.accent, fontWeight: '600' }}>重新草擬</Text>
                </Pressable>
                <Pressable
                  onPress={handleSendDraft}
                  style={({ pressed }) => ({
                    flex: 2,
                    paddingVertical: theme.space.sm + 2,
                    borderRadius: theme.radius.md,
                    alignItems: 'center',
                    backgroundColor: theme.colors.accent,
                    opacity: pressed ? 0.85 : 1,
                  })}
                >
                  <Text style={{ color: theme.colors.onAccent, fontWeight: '700' }}>送出評語</Text>
                </Pressable>
              </View>
            </View>
          </KeyboardAvoidingView>
        </Modal>

        {/* Bulk Reminder Modal */}
        <Modal visible={!!reminderHw} animationType="slide" transparent>
          <View style={{ flex: 1, backgroundColor: theme.colors.overlay ?? 'rgba(0,0,0,0.5)' }}>
            <View
              style={{
                backgroundColor: theme.colors.surface,
                borderTopLeftRadius: theme.radius.lg,
                borderTopRightRadius: theme.radius.lg,
                padding: theme.space.lg,
                maxHeight: '85%',
                marginTop: 'auto',
              }}
            >
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text style={{
                  fontSize: theme.typography.h3.fontSize,
                  fontWeight: '700',
                  color: theme.colors.text,
                }}>
                  批量提醒：{reminderItems.length} 位
                </Text>
                <Pressable onPress={() => setReminderHw(null)} hitSlop={8}>
                  <Ionicons name="close-circle" size={24} color={theme.colors.muted} />
                </Pressable>
              </View>
              <Text style={{
                fontSize: theme.typography.bodySmall.fontSize,
                color: theme.colors.muted,
                marginTop: theme.space.xs,
              }}>
                每位學生會收到個人化內容
              </Text>
              <ScrollView style={{ marginTop: theme.space.sm, maxHeight: 380 }}>
                {reminderItems.map((item) => (
                  <View
                    key={item.uid}
                    style={{
                      padding: theme.space.sm,
                      borderRadius: theme.radius.md,
                      backgroundColor: theme.colors.bg,
                      marginBottom: theme.space.xs + 2,
                    }}
                  >
                    <Text style={{
                      fontWeight: '700',
                      color: theme.colors.text,
                      fontSize: theme.typography.bodySmall.fontSize,
                    }}>
                      {item.title}
                    </Text>
                    <Text style={{
                      color: theme.colors.muted,
                      fontSize: theme.typography.bodySmall.fontSize,
                      marginTop: 4,
                      lineHeight: theme.typography.bodySmall.lineHeight,
                    }}>
                      {item.body}
                    </Text>
                  </View>
                ))}
              </ScrollView>
              <View style={{ flexDirection: 'row', gap: theme.space.xs + 2, marginTop: theme.space.sm }}>
                <Pressable
                  onPress={() => setReminderHw(null)}
                  style={({ pressed }) => ({
                    flex: 1,
                    paddingVertical: theme.space.sm + 2,
                    borderRadius: theme.radius.md,
                    alignItems: 'center',
                    backgroundColor: theme.colors.surfaceMuted,
                    opacity: pressed ? 0.7 : 1,
                  })}
                >
                  <Text style={{ color: theme.colors.muted, fontWeight: '600' }}>取消</Text>
                </Pressable>
                <Pressable
                  onPress={handleSendReminders}
                  style={({ pressed }) => ({
                    flex: 2,
                    paddingVertical: theme.space.sm + 2,
                    borderRadius: theme.radius.md,
                    alignItems: 'center',
                    backgroundColor: theme.colors.warning,
                    opacity: pressed ? 0.85 : 1,
                  })}
                >
                  <Text style={{ color: theme.colors.onAccent, fontWeight: '700' }}>📣 全部發送</Text>
                </Pressable>
              </View>
            </View>
          </View>
        </Modal>
      </ScrollView>
    </SafeAreaView>
  );
}
