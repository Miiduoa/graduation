/**
 * Monthly Summary — 學生本月學習摘要
 *
 * 整合多個資料源算出本月真實表現：
 *  - 出席率（從 demoCoursesMock attendance）
 *  - 作業繳交率
 *  - 成績趨勢（每課平均）
 *  - 餐廳點餐次數（從 inbox order events）
 *  - AI 採納率（從 aiLearning interactionHistory）
 *
 * 純讀取本地資料、無 API。給 demo + 期末口試證明跨模組整合。
 */
import React, { useEffect, useMemo, useState } from 'react';
import { ScrollView, View, Text, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { theme } from '../ui/theme';
import { useTabBarContentBottomPadding } from '../ui/navigationTheme';
import {
  CockpitHero,
  CockpitMetricRow,
  CockpitMetricChip,
  CockpitSection,
  CockpitRow,
} from '../ui/cockpitShell';
import { useAuth } from '../state/auth';

import {
  DEMO_COURSES,
  getDemoHomeworksByCourse,
  getDemoAttendanceByCourse,
  getDemoScoreItemsByCourse,
} from '../data/demoCoursesMock';
import { loadInteractionHistory, computePreferenceProfile, selfReflect } from '../services/aiLearning';
import { loadRoleEventInbox, type RoleEvent } from '../services/roleEventBus';
import { predictCurrent, type PredictorItem } from '@campus/shared';

export default function MonthlySummaryScreen() {
  const auth = useAuth();
  const uid = auth.user?.uid ?? null;
  const bottomPad = useTabBarContentBottomPadding();
  const [interactionCount, setInteractionCount] = useState(0);
  const [acceptRate, setAcceptRate] = useState(0);
  const [aiSelfAdjustment, setAiSelfAdjustment] = useState<string>('');
  const [orderEvents, setOrderEvents] = useState<RoleEvent<unknown>[]>([]);
  const [feedbackEvents, setFeedbackEvents] = useState<RoleEvent<unknown>[]>([]);

  // 異步載入 AI 學習 + inbox 事件
  useEffect(() => {
    if (!uid) return;
    (async () => {
      const hist = await loadInteractionHistory(uid).catch(() => []);
      const profile = computePreferenceProfile(hist);
      setInteractionCount(profile.overall.samples);
      setAcceptRate(profile.overall.acceptRate);
      const reflect = selfReflect(hist);
      setAiSelfAdjustment(reflect.selfAdjustment);

      const inbox = await loadRoleEventInbox(uid).catch(() => []);
      setOrderEvents(inbox.filter((e) => e.kind === 'order_placed' || e.kind === 'order_status_changed'));
      setFeedbackEvents(inbox.filter((e) => e.kind === 'feedback_drafted' || e.kind === 'grade_published'));
    })();
  }, [uid]);

  // 出席 + 作業統計
  const summary = useMemo(() => {
    let totalAtt = 0, presentAtt = 0, lateAtt = 0, absentAtt = 0;
    let totalHw = 0, submittedHw = 0, gradedHw = 0;
    const courseScores: Array<{ name: string; emoji: string; likely: number | null; trend: 'up' | 'flat' | 'down' }> = [];

    for (const c of DEMO_COURSES) {
      const atts = getDemoAttendanceByCourse(c.id);
      totalAtt += atts.length;
      presentAtt += atts.filter((a) => a.myStatus === 'present').length;
      lateAtt += atts.filter((a) => a.myStatus === 'late').length;
      absentAtt += atts.filter((a) => a.myStatus === 'absent').length;

      const hws = getDemoHomeworksByCourse(c.id);
      totalHw += hws.length;
      submittedHw += hws.filter((h) => h.submitted).length;
      gradedHw += hws.filter((h) => h.graded).length;

      const items = getDemoScoreItemsByCourse(c.id);
      const pred = predictCurrent(
        items.map((s): PredictorItem => ({
          id: String(s.id),
          title: s.name,
          weight: s.weight,
          maxScore: s.totalScore,
          score: s.studentScore,
          graded: s.studentScore !== null,
        })),
      );
      // demo 趨勢：取最新兩筆 graded score 比較
      const graded = items.filter((s) => s.studentScore !== null);
      const trend =
        graded.length >= 2
          ? (graded[graded.length - 1].studentScore! / graded[graded.length - 1].totalScore) >=
            (graded[graded.length - 2].studentScore! / graded[graded.length - 2].totalScore)
            ? 'up' as const
            : 'down' as const
          : 'flat' as const;
      courseScores.push({
        name: c.name,
        emoji: c.iconEmoji,
        likely: pred.likelyCase,
        trend,
      });
    }

    return {
      attendance: {
        totalAtt,
        presentAtt,
        lateAtt,
        absentAtt,
        rate: totalAtt > 0 ? Math.round((presentAtt / totalAtt) * 100) : 0,
      },
      homework: {
        totalHw,
        submittedHw,
        gradedHw,
        rate: totalHw > 0 ? Math.round((submittedHw / totalHw) * 100) : 0,
      },
      courseScores,
    };
  }, []);

  // AI 給的整體評語
  const overallNarrative = useMemo(() => {
    const att = summary.attendance.rate;
    const sub = summary.homework.rate;
    const avg = summary.courseScores.reduce((s, c) => s + (c.likely ?? 70), 0) / Math.max(1, summary.courseScores.length);
    const lines: string[] = [];
    if (att >= 90) lines.push(`📍 出席率 ${att}% — 全勤級表現，給自己一個讚`);
    else if (att >= 75) lines.push(`📍 出席率 ${att}% — 還可以，但有幾堂該補上`);
    else lines.push(`⚠️ 出席率 ${att}% — 偏低，建議下個月排好早課提醒`);

    if (sub >= 90) lines.push(`📝 作業繳交率 ${sub}% — 沒落下任何一份，繼續保持`);
    else lines.push(`📝 作業繳交率 ${sub}% — 漏交時用 AI 觀察台「接受 overdue 建議」開番茄補上`);

    if (avg >= 85) lines.push(`📊 各課平均約 ${Math.round(avg)}% — 表現穩定`);
    else if (avg >= 75) lines.push(`📊 各課平均約 ${Math.round(avg)}% — 中段班，What-If 試算找出最容易拉高的科目`);
    else lines.push(`📊 各課平均約 ${Math.round(avg)}% — 該找老師談談學習策略了`);

    return lines.join('\n');
  }, [summary]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.bg }} edges={['top']}>
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: theme.layout.screenHorizontalPadding,
          paddingTop: theme.space.md,
          paddingBottom: bottomPad,
        }}
        showsVerticalScrollIndicator={false}
      >
        <CockpitHero
          eyebrow={`${new Date().toLocaleDateString('zh-TW', { year: 'numeric', month: 'long' })} 摘要`}
          title="📅 本月學習回顧"
          summary={overallNarrative}
        />

        <CockpitMetricRow>
          <CockpitMetricChip
            label="出席率"
            value={`${summary.attendance.rate}%`}
            tone={summary.attendance.rate >= 85 ? 'success' : summary.attendance.rate >= 75 ? 'warn' : 'danger'}
          />
          <CockpitMetricChip
            label="作業率"
            value={`${summary.homework.rate}%`}
            tone={summary.homework.rate >= 85 ? 'success' : summary.homework.rate >= 70 ? 'warn' : 'danger'}
          />
          <CockpitMetricChip
            label="點餐"
            value={orderEvents.length}
          />
          <CockpitMetricChip
            label="AI 採納"
            value={`${Math.round(acceptRate * 100)}%`}
            tone={acceptRate >= 0.6 ? 'success' : undefined}
          />
        </CockpitMetricRow>

        <View style={{ marginTop: theme.space.sm }}>
          {/* 出席詳細 */}
          <CockpitSection
            label="📍 出席詳情"
            count={summary.attendance.totalAtt}
            open
            onToggle={() => {}}
          >
            <CockpitRow
              icon="✅"
              title={`準時 ${summary.attendance.presentAtt} 堂`}
              subtitle={`占 ${summary.attendance.totalAtt > 0 ? Math.round((summary.attendance.presentAtt / summary.attendance.totalAtt) * 100) : 0}%`}
              tone="success"
            />
            <CockpitRow
              icon="⏰"
              title={`遲到 ${summary.attendance.lateAtt} 堂`}
              subtitle={`占 ${summary.attendance.totalAtt > 0 ? Math.round((summary.attendance.lateAtt / summary.attendance.totalAtt) * 100) : 0}%`}
              tone={summary.attendance.lateAtt > 0 ? 'warn' : undefined}
            />
            <CockpitRow
              icon="❌"
              title={`缺席 ${summary.attendance.absentAtt} 堂`}
              subtitle={`占 ${summary.attendance.totalAtt > 0 ? Math.round((summary.attendance.absentAtt / summary.attendance.totalAtt) * 100) : 0}%`}
              tone={summary.attendance.absentAtt > 0 ? 'danger' : undefined}
            />
          </CockpitSection>

          {/* 課程趨勢 */}
          <CockpitSection
            label="📊 各課表現"
            count={summary.courseScores.length}
            open
            onToggle={() => {}}
          >
            {summary.courseScores.map((c) => (
              <CockpitRow
                key={c.name}
                icon={c.emoji}
                title={c.name}
                subtitle={`預估 ${c.likely ?? '—'}% · ${c.trend === 'up' ? '📈 上升中' : c.trend === 'down' ? '📉 下滑' : '→ 持平'}`}
                tone={c.trend === 'down' ? 'warn' : c.trend === 'up' ? 'success' : undefined}
              />
            ))}
          </CockpitSection>

          {/* 餐廳消費 */}
          {orderEvents.length > 0 && (
            <CockpitSection
              label="🍱 餐廳消費"
              count={orderEvents.length}
              open
              onToggle={() => {}}
            >
              {orderEvents.slice(0, 5).map((e) => (
                <CockpitRow
                  key={e.id}
                  icon="🛒"
                  title={(e.payload as any)?.merchantName ?? '餐廳'}
                  subtitle={`${e.kind === 'order_placed' ? '已下訂' : '狀態：' + ((e.payload as any)?.newStatus ?? '')} · ${new Date(e.occurredAt).toLocaleDateString('zh-TW')}`}
                />
              ))}
            </CockpitSection>
          )}

          {/* AI 學習 */}
          <CockpitSection
            label="🤖 AI 互動歷史"
            count={interactionCount}
            open
            onToggle={() => {}}
          >
            <CockpitRow
              icon="🎯"
              title={`採納率 ${Math.round(acceptRate * 100)}%`}
              subtitle={`${interactionCount} 次互動累積`}
              tone={acceptRate >= 0.6 ? 'success' : acceptRate < 0.3 ? 'warn' : undefined}
            />
            {aiSelfAdjustment ? (
              <View
                style={{
                  marginTop: theme.space.sm,
                  padding: theme.space.md,
                  borderRadius: theme.radius.md,
                  backgroundColor: theme.colors.accentSoft,
                }}
              >
                <Text style={{ fontSize: 11, color: theme.colors.muted, marginBottom: 4 }}>
                  AI 對你的下一步調整
                </Text>
                <Text style={{ fontSize: 13, color: theme.colors.text, lineHeight: 19 }}>
                  {aiSelfAdjustment}
                </Text>
              </View>
            ) : null}
          </CockpitSection>

          {/* 老師回饋 */}
          {feedbackEvents.length > 0 && (
            <CockpitSection
              label="✏️ 老師給的回饋"
              count={feedbackEvents.length}
              open
              onToggle={() => {}}
            >
              {feedbackEvents.slice(0, 5).map((e) => {
                const p = e.payload as any;
                const title = e.kind === 'grade_published'
                  ? `${p.itemTitle ?? '評分'} ${p.score}/${p.totalScore}`
                  : `${p.homeworkTitle ?? '評語'}`;
                const subtitle = e.kind === 'feedback_drafted'
                  ? p.draftPreview?.slice(0, 60)
                  : `${e.courseName} · ${new Date(e.occurredAt).toLocaleDateString('zh-TW')}`;
                return (
                  <CockpitRow
                    key={e.id}
                    icon={e.kind === 'grade_published' ? '📊' : '✏️'}
                    title={title}
                    subtitle={subtitle}
                  />
                );
              })}
            </CockpitSection>
          )}
        </View>

        <View
          style={{
            marginTop: theme.space.lg,
            padding: theme.space.md,
            borderRadius: theme.radius.lg,
            backgroundColor: theme.colors.surface,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: theme.colors.border,
          }}
        >
          <Text style={{ fontSize: 11, color: theme.colors.muted, marginBottom: 4 }}>
            本摘要整合來源
          </Text>
          <Text style={{ fontSize: 12, color: theme.colors.text, lineHeight: 18 }}>
            • 出席：demoCoursesMock 點名紀錄{'\n'}
            • 作業：demoCoursesMock 作業狀態{'\n'}
            • 成績：gradePredictor.predictCurrent{'\n'}
            • 餐廳：roleEventBus inbox（order_placed / order_status_changed）{'\n'}
            • AI：aiLearning interaction history + selfReflect{'\n'}
            • 老師回饋：inbox 內 grade_published / feedback_drafted
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
