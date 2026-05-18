/**
 * TA Dashboard — 助教今日駕駛艙（統一設計系統）
 */
import React, { useMemo, useState, useEffect } from 'react';
import { ScrollView, View, LayoutAnimation, Platform, UIManager, Pressable, Text, Alert, Modal, TextInput, StyleSheet, KeyboardAvoidingView } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  subscribeRoleEvent,
  emitFeedbackDrafted,
  loadRoleEventInbox,
  type HelpRequestedPayload,
  type HomeworkSubmittedPayload,
  type DiscussionPostedPayload,
} from '../services/roleEventBus';
import { safeNavigate } from '../utils/safeNavigate';

/** 本地 AI 助教決策層 — 對應 aiOrchestrator.aiTANextAction（demo inline） */
function aiTANextAction(input: {
  gradingCount: number;
  discussionCount: number;
  highUrgencyHelp: number;
  totalHelp: number;
}): { headline: string; severity: 'critical' | 'high' | 'medium' | 'low'; suggestion: string } {
  if (input.highUrgencyHelp > 0) {
    return { headline: `🚨 ${input.highUrgencyHelp} 位學生高優先求助`, severity: 'critical', suggestion: '建議優先回覆求助訊息，再處理批改與討論。' };
  }
  if (input.discussionCount >= 3) {
    return { headline: `💬 ${input.discussionCount} 串學生討論待回覆`, severity: 'high', suggestion: '討論串容易積壓，建議能 1 句解決的先回。' };
  }
  if (input.gradingCount >= 5) {
    return { headline: `✍️ ${input.gradingCount} 份待批改`, severity: 'high', suggestion: '建議用 25 分鐘專注批改 5 份，分段消化。' };
  }
  if (input.gradingCount + input.discussionCount + input.totalHelp === 0) {
    return { headline: '✨ 今日協助任務都清空了', severity: 'low', suggestion: '可以主動巡一次討論區或關心一下缺繳學生。' };
  }
  return { headline: `今日 ${input.gradingCount} 份批改、${input.discussionCount} 串待回覆`, severity: 'medium', suggestion: '節奏穩定，建議先回討論再批改。' };
}

import {
  DEMO_COURSES,
  getDemoHomeworksByCourse,
  getDemoDiscussionsByCourse,
  getDemoAttendanceByCourse,
} from '../data/demoCoursesMock';
import { theme } from '../ui/theme';
import { useTabBarContentBottomPadding } from '../ui/navigationTheme';
import { AgentSummaryBanner } from '../components/AgentSummaryBanner';
import { AIMissionControl } from '../components/AIMissionControl';
import {
  CockpitHero,
  CockpitMetricRow,
  CockpitMetricChip,
  CockpitSection,
  CockpitRow,
  CockpitToolChip,
} from '../ui/cockpitShell';
import { useAuth } from '../state/auth';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

export default function TADashboardScreen() {
  const navigation = useNavigation<any>();
  const auth = useAuth();
  const tabBarBottomPad = useTabBarContentBottomPadding();
  const [openSection, setOpenSection] = useState<null | 'grading' | 'discussion' | 'absent' | 'help'>('grading');
  const [replyTarget, setReplyTarget] = useState<{
    helpId: string;
    studentUid: string;
    studentName: string;
    courseId: number | string;
    courseName: string;
    topic: string;
    preview: string;
  } | null>(null);
  const [replyText, setReplyText] = useState('');
  const [resolvedHelps, setResolvedHelps] = useState<Set<string>>(new Set());
  const [liveHelp, setLiveHelp] = useState<Array<{
    id: string;
    studentUid: string;
    studentName: string;
    courseId: number | string;
    courseName: string;
    topic: string;
    preview: string;
    urgency: 'low' | 'medium' | 'high';
    at: string;
  }>>([]);
  const [liveDiscussions, setLiveDiscussions] = useState<Array<{
    id: string;
    studentName: string;
    courseName: string;
    courseId: number | string;
    threadTitle: string;
    preview: string;
    at: string;
  }>>([]);
  const [liveSubmits, setLiveSubmits] = useState<Array<{
    id: string;
    studentName: string;
    courseName: string;
    hwTitle: string;
    at: string;
  }>>([]);

  const toggle = (k: typeof openSection) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setOpenSection(openSection === k ? null : k);
  };

  // 載入歷史 inbox + 訂閱即時：學生求助 + 發討論 + 繳交
  useEffect(() => {
    const taUid = auth.user?.uid ?? 'demo_ta_lin';
    let cancelled = false;

    // 1. 載入歷史 — 從 inbox 拉所有相關事件
    (async () => {
      const events = await loadRoleEventInbox(taUid).catch(() => []);
      if (cancelled) return;
      const helps: typeof liveHelp = [];
      const discussions: typeof liveDiscussions = [];
      const submits: typeof liveSubmits = [];
      for (const event of events) {
        if (event.kind === 'help_requested') {
          const p = event.payload as HelpRequestedPayload;
          helps.push({
            id: event.id,
            studentUid: event.actorUid,
            studentName: event.actorName ?? '學生',
            courseId: event.courseId,
            courseName: event.courseName,
            topic: p.topic,
            preview: p.preview,
            urgency: p.urgency,
            at: event.occurredAt,
          });
        } else if (event.kind === 'discussion_posted') {
          const p = event.payload as DiscussionPostedPayload;
          discussions.push({
            id: event.id,
            studentName: p.authorName,
            courseName: event.courseName,
            courseId: event.courseId,
            threadTitle: p.threadTitle,
            preview: p.preview,
            at: event.occurredAt,
          });
        } else if (event.kind === 'homework_submitted') {
          const p = event.payload as HomeworkSubmittedPayload;
          submits.push({
            id: event.id,
            studentName: event.actorName ?? '學生',
            courseName: event.courseName,
            hwTitle: p.homeworkTitle,
            at: event.occurredAt,
          });
        }
      }
      setLiveHelp(helps.slice(0, 20));
      setLiveDiscussions(discussions.slice(0, 20));
      setLiveSubmits(submits.slice(0, 20));
      if (helps.length > 0) setOpenSection('help');
    })();

    // 2. 訂閱即時（同 session 中其他動作）
    const unsubHelp = subscribeRoleEvent<HelpRequestedPayload>('help_requested', (event) => {
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      setLiveHelp((prev) => {
        if (prev.find((h) => h.id === event.id)) return prev;
        return [
          {
            id: event.id,
            studentUid: event.actorUid,
            studentName: event.actorName ?? '學生',
            courseId: event.courseId,
            courseName: event.courseName,
            topic: event.payload.topic,
            preview: event.payload.preview,
            urgency: event.payload.urgency,
            at: event.occurredAt,
          },
          ...prev,
        ].slice(0, 20);
      });
      setOpenSection('help');
    });
    const unsubDiscussion = subscribeRoleEvent<DiscussionPostedPayload>('discussion_posted', (event) => {
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      setLiveDiscussions((prev) => {
        if (prev.find((d) => d.id === event.id)) return prev;
        return [
          {
            id: event.id,
            studentName: event.payload.authorName,
            courseName: event.courseName,
            courseId: event.courseId,
            threadTitle: event.payload.threadTitle,
            preview: event.payload.preview,
            at: event.occurredAt,
          },
          ...prev,
        ].slice(0, 20);
      });
    });
    const unsubSubmit = subscribeRoleEvent<HomeworkSubmittedPayload>('homework_submitted', (event) => {
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      setLiveSubmits((prev) => {
        if (prev.find((s) => s.id === event.id)) return prev;
        return [
          {
            id: event.id,
            studentName: event.actorName ?? '學生',
            courseName: event.courseName,
            hwTitle: event.payload.homeworkTitle,
            at: event.occurredAt,
          },
          ...prev,
        ].slice(0, 20);
      });
    });
    return () => {
      cancelled = true;
      unsubHelp();
      unsubDiscussion();
      unsubSubmit();
    };
  }, [auth.user?.uid]);

  const ta = useMemo(() => {
    const gradingTasks: Array<{ courseId: number; courseName: string; hwTitle: string; count: number }> = [];
    const discussions: Array<{ courseId: number; courseName: string; title: string }> = [];
    const absentStudents: Array<{ courseId: number; courseName: string; name: string; reason: string }> = [];

    for (const c of DEMO_COURSES) {
      const hws = getDemoHomeworksByCourse(c.id);
      const ungraded = hws.filter((h) => h.submitted && !h.graded);
      for (const h of ungraded) {
        gradingTasks.push({
          courseId: c.id,
          courseName: c.name,
          hwTitle: h.title,
          // 用 hw.id 確定性算「待改份數」，避免 Math.random 每次跳
          count: 1 + ((h.id ?? 1) % 5),
        });
      }
      const ds = getDemoDiscussionsByCourse(c.id);
      for (const d of ds.slice(0, 1)) {
        if (!d.hasTeacherEndorsement) {
          discussions.push({ courseId: c.id, courseName: c.name, title: d.title });
        }
      }
      const att = getDemoAttendanceByCourse(c.id);
      const absent = att.filter((a) => a.myStatus === 'absent');
      if (absent.length > 0) {
        absentStudents.push({
          courseId: c.id,
          courseName: c.name,
          name: '匿名學生（示意）',
          reason: `${absent.length} 次缺席`,
        });
      }
    }
    return { gradingTasks, discussions, absentStudents };
  }, []);

  // 合併 base + live
  const totalDiscussionCount = ta.discussions.length + liveDiscussions.length;
  const totalGradingCount = ta.gradingTasks.length + liveSubmits.length;
  const highUrgency = liveHelp.filter((h) => h.urgency === 'high').length;
  const aiAdvice = useMemo(
    () => aiTANextAction({
      gradingCount: totalGradingCount,
      discussionCount: totalDiscussionCount,
      highUrgencyHelp: highUrgency,
      totalHelp: liveHelp.length,
    }),
    [totalGradingCount, totalDiscussionCount, highUrgency, liveHelp.length],
  );

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
          eyebrow={`午安，${auth.profile?.displayName?.split('（')[0] ?? '助教'}`}
          title="AI 協助中樞"
          summary={`🤖 ${aiAdvice.headline} · ${aiAdvice.suggestion}`}
        />

        {/* 🤖 AI Agent 摘要 */}
        <AgentSummaryBanner cockpitLabel="助教" />

        {/* AI 任務指揮 — 助教專屬下一步 */}
        <View style={{ marginVertical: theme.space.md }}>
          <AIMissionControl uid={auth.user?.uid} maxVisible={3} hideWhenEmpty />
        </View>

        <CockpitMetricRow>
          <CockpitMetricChip
            label="待批改"
            value={totalGradingCount}
            tone={totalGradingCount >= 5 ? 'warn' : undefined}
          />
          <CockpitMetricChip
            label="待回覆"
            value={totalDiscussionCount}
            tone={totalDiscussionCount > 0 ? 'warn' : undefined}
          />
          <CockpitMetricChip
            label="求助"
            value={liveHelp.length}
            tone={highUrgency > 0 ? 'danger' : (liveHelp.length > 0 ? 'warn' : undefined)}
          />
        </CockpitMetricRow>

        {/* 工具列 */}
        <View style={{
          flexDirection: 'row',
          gap: theme.space.xs + 2,
          flexWrap: 'wrap',
          marginTop: theme.space.sm,
          marginBottom: theme.space.sm,
        }}>
          <CockpitToolChip
            icon="library-outline"
            label="課程列表"
            onPress={() => safeNavigate(navigation, 'CoursesHome', undefined, { fallbackMessage: '請從學習分頁進入' })}
          />
          <CockpitToolChip
            icon="create-outline"
            label="批改中心"
            onPress={() => safeNavigate(navigation, 'TeacherGrading', undefined, { fallbackMessage: '批改中心暫不可用' })}
          />
          <CockpitToolChip
            icon="call-outline"
            label="聯繫學生"
            onPress={() => safeNavigate(navigation, 'Inbox', undefined, { fallbackMessage: '請從訊息分頁進入' })}
          />
        </View>

        {/* 即時學生繳交 */}
        {liveSubmits.length > 0 && (
          <View style={{ marginTop: theme.space.sm, marginBottom: theme.space.sm }}>
            <CockpitSection
              label="🔴 即時：學生剛繳交"
              count={liveSubmits.length}
              open={openSection === 'grading'}
              onToggle={() => toggle('grading')}
            >
              {liveSubmits.slice(0, 6).map((s, i) => (
                <CockpitRow
                  key={`live_sub_${i}`}
                  icon="✍️"
                  title={`${s.studentName} 剛交了 ${s.hwTitle}`}
                  subtitle={`${s.courseName} · ${Math.max(0, Math.round((Date.now() - new Date(s.at).getTime()) / 60_000))} 分鐘前`}
                  tone="warn"
                />
              ))}
            </CockpitSection>
          </View>
        )}

        {/* 即時學生求助 */}
        {liveHelp.length > 0 && (
          <View style={{ marginBottom: theme.space.sm }}>
            <CockpitSection
              label={highUrgency > 0 ? '🚨 學生求助（高優先）' : '🆘 學生求助'}
              count={liveHelp.length}
              open={openSection === 'help'}
              onToggle={() => toggle('help')}
            >
              {liveHelp.map((h) => {
                const resolved = resolvedHelps.has(h.id);
                return (
                  <CockpitRow
                    key={h.id}
                    icon={resolved ? '✅' : h.urgency === 'high' ? '🚨' : h.urgency === 'medium' ? '⚠️' : '💬'}
                    title={resolved ? `[已回覆] ${h.studentName} · ${h.topic}` : `${h.studentName} · ${h.topic}`}
                    subtitle={`${h.courseName} · ${h.preview}`}
                    tone={resolved ? 'success' : h.urgency === 'high' ? 'danger' : h.urgency === 'medium' ? 'warn' : undefined}
                    onPress={() => {
                      if (resolved) {
                        Alert.alert('已回覆', `${h.topic}\n\n你已回覆這則求助，學生 inbox 看得到。`);
                        return;
                      }
                      setReplyTarget({
                        helpId: h.id,
                        studentUid: h.studentUid,
                        studentName: h.studentName,
                        courseId: h.courseId,
                        courseName: h.courseName,
                        topic: h.topic,
                        preview: h.preview,
                      });
                      setReplyText('');
                    }}
                  />
                );
              })}
            </CockpitSection>
          </View>
        )}

        {/* 即時學生發討論 */}
        {liveDiscussions.length > 0 && (
          <View style={{ marginBottom: theme.space.sm }}>
            <CockpitSection
              label="🆕 學生剛發討論"
              count={liveDiscussions.length}
              open={openSection === 'discussion'}
              onToggle={() => toggle('discussion')}
            >
              {liveDiscussions.map((d) => (
                <CockpitRow
                  key={d.id}
                  icon="💬"
                  title={`${d.studentName}：${d.threadTitle}`}
                  subtitle={`${d.courseName} · ${d.preview}`}
                  tone="warn"
                  onPress={() =>
                    safeNavigate(
                      navigation,
                      'CourseDiscussion',
                      { groupId: String(d.courseId), groupName: d.courseName },
                      { fallbackMessage: `${d.threadTitle}\n${d.preview}` },
                    )
                  }
                />
              ))}
            </CockpitSection>
          </View>
        )}

        <View style={{ marginTop: theme.space.sm }}>
          <CockpitSection
            label="✍️ 老師指派的批改"
            count={ta.gradingTasks.length}
            open={openSection === 'grading'}
            onToggle={() => toggle('grading')}
          >
            {ta.gradingTasks.length === 0 ? (
              <CockpitRow title="目前沒有待批改的任務" />
            ) : (
              ta.gradingTasks.slice(0, 6).map((t, i) => (
                <CockpitRow
                  key={`${t.courseId}_${i}`}
                  title={t.hwTitle}
                  subtitle={`${t.courseName} · 預估 ${t.count} 份待改`}
                  onPress={() =>
                    safeNavigate(navigation, 'CourseModules', {
                      groupId: String(t.courseId),
                      groupName: t.courseName,
                    }, { fallbackMessage: '即將跳到課程教材' })
                  }
                />
              ))
            )}
          </CockpitSection>

          <CockpitSection
            label="💬 學生提問"
            count={ta.discussions.length}
            open={openSection === 'discussion'}
            onToggle={() => toggle('discussion')}
          >
            {ta.discussions.length === 0 ? (
              <CockpitRow title="所有討論串都有老師回覆了" />
            ) : (
              ta.discussions.map((d, i) => (
                <CockpitRow
                  key={`${d.courseId}_${i}`}
                  title={d.title}
                  subtitle={d.courseName}
                  onPress={() =>
                    safeNavigate(navigation, 'CourseDiscussion', {
                      groupId: String(d.courseId),
                      groupName: d.courseName,
                    }, { fallbackMessage: '即將跳到課程討論' })
                  }
                />
              ))
            )}
          </CockpitSection>

          {ta.absentStudents.length > 0 && (
            <CockpitSection
              label="📞 需聯繫學生"
              count={ta.absentStudents.length}
              open={openSection === 'absent'}
              onToggle={() => toggle('absent')}
            >
              {ta.absentStudents.map((s, i) => (
                <CockpitRow
                  key={`${s.courseId}_${i}`}
                  icon="👤"
                  title={s.name}
                  subtitle={`${s.courseName} · ${s.reason}`}
                  tone="warn"
                />
              ))}
            </CockpitSection>
          )}
        </View>
      </ScrollView>

      {/* 快速回覆 modal */}
      <Modal
        visible={!!replyTarget}
        animationType="slide"
        transparent
        onRequestClose={() => setReplyTarget(null)}
      >
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <Pressable
            style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' }}
            onPress={() => setReplyTarget(null)}
          />
          <View
            style={{
              backgroundColor: theme.colors.bg,
              borderTopLeftRadius: theme.radius.xl,
              borderTopRightRadius: theme.radius.xl,
              padding: theme.space.lg,
              paddingBottom: theme.space.xxl,
              gap: theme.space.md,
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space.sm }}>
              <Text style={{ fontSize: 24 }}>🆘</Text>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 16, fontWeight: '700', color: theme.colors.text }}>
                  回覆 {replyTarget?.studentName} 的求助
                </Text>
                <Text style={{ fontSize: 11, color: theme.colors.muted }}>
                  {replyTarget?.courseName}
                </Text>
              </View>
              <Pressable onPress={() => setReplyTarget(null)} hitSlop={20}>
                <Text style={{ color: theme.colors.muted, fontSize: 14 }}>取消</Text>
              </Pressable>
            </View>

            {/* 原始問題 */}
            <View
              style={{
                padding: theme.space.md,
                borderRadius: theme.radius.md,
                backgroundColor: theme.colors.surface,
                borderLeftWidth: 3,
                borderLeftColor: theme.colors.warning,
              }}
            >
              <Text style={{ fontSize: 13, fontWeight: '700', color: theme.colors.text }}>
                {replyTarget?.topic}
              </Text>
              <Text style={{ fontSize: 12, color: theme.colors.muted, marginTop: 4 }}>
                {replyTarget?.preview}
              </Text>
            </View>

            {/* 快速範本 */}
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space.xs }}>
              {[
                '先閱讀第 X 章複習一下，再試試看',
                '把題目拍下來貼到課程討論區，我幫你看',
                '建議到 office hour 當面討論',
                '可以參考同學的 demo（不貼答案）',
              ].map((tpl) => (
                <Pressable
                  key={tpl}
                  onPress={() => setReplyText(tpl)}
                  style={({ pressed }) => ({
                    paddingHorizontal: theme.space.sm + 2,
                    paddingVertical: theme.space.xs + 2,
                    borderRadius: theme.radius.full,
                    backgroundColor: theme.colors.surface,
                    borderWidth: StyleSheet.hairlineWidth,
                    borderColor: theme.colors.border,
                    opacity: pressed ? 0.6 : 1,
                  })}
                >
                  <Text style={{ fontSize: 11, color: theme.colors.muted }}>
                    {tpl.slice(0, 14)}{tpl.length > 14 ? '…' : ''}
                  </Text>
                </Pressable>
              ))}
            </View>

            {/* 輸入回覆 */}
            <TextInput
              value={replyText}
              onChangeText={setReplyText}
              placeholder="寫一段回覆給學生（不要直接給答案）"
              placeholderTextColor={theme.colors.muted}
              multiline
              numberOfLines={4}
              style={{
                padding: theme.space.md,
                borderRadius: theme.radius.md,
                backgroundColor: theme.colors.surface,
                borderWidth: 1,
                borderColor: theme.colors.border,
                color: theme.colors.text,
                fontSize: 14,
                minHeight: 100,
                textAlignVertical: 'top',
              }}
            />

            <Pressable
              onPress={async () => {
                if (!replyTarget) return;
                if (!replyText.trim()) {
                  Alert.alert('請輸入回覆');
                  return;
                }
                try {
                  await emitFeedbackDrafted({
                    actorUid: auth.user?.uid ?? 'demo_ta_lin',
                    actorName: auth.profile?.displayName ?? '林助教',
                    targetUids: [replyTarget.studentUid],
                    courseId: replyTarget.courseId,
                    courseName: replyTarget.courseName,
                    payload: {
                      studentName: replyTarget.studentName,
                      homeworkTitle: `回覆求助：${replyTarget.topic}`,
                      draftPreview: replyText.trim(),
                    },
                  });
                  setResolvedHelps((prev) => new Set([...prev, replyTarget.helpId]));
                  setReplyTarget(null);
                  Alert.alert('✅ 已回覆', '學生 inbox 立刻會收到通知');
                } catch (e) {
                  Alert.alert('回覆失敗', String(e));
                }
              }}
              style={({ pressed }) => ({
                padding: theme.space.md,
                borderRadius: theme.radius.lg,
                backgroundColor: theme.colors.text,
                alignItems: 'center',
                opacity: pressed ? 0.85 : 1,
              })}
            >
              <Text style={{ color: theme.colors.bg, fontWeight: '700', fontSize: 14 }}>
                送出回覆給 {replyTarget?.studentName}
              </Text>
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}
