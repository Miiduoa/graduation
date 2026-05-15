/**
 * Peer Review Submit Screen — 同儕互評本地化
 *
 * 學生在 APP 內看分配到的同儕作業 + 用 Rubric 打分 + 回饋 + 送出
 * 對應引擎：packages/shared/src/lms/rubricScoring
 * 對應端點：POST /courses/{id}/peer_reviews/{rid}/submissions
 */
import React, { useEffect, useState, useMemo, useCallback } from 'react';
import {
  ScrollView,
  View,
  Text,
  TextInput,
  Pressable,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  RefreshControl,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';

import { evaluateRubric, type Rubric, type RubricScore } from '@campus/shared';
import { tcFetchPeerReviews } from '../services/tronClassClient';
import { isDemoCourseId, demoFetchPeerReviews } from '../data/demoCoursesAdapter';
import { theme } from '../ui/theme';
import { EmptyState } from '../ui/components';
import {
  CourseChipHeader,
  CourseChipLoading,
  CourseDemoDataRibbon,
  courseChipScrollContentStyle,
} from '../ui/courseChipShell';

type RouteProps = {
  route?: {
    params?: {
      reviewId?: string;
      assignmentTitle?: string;
      anonymousAuthor?: string;
      submissionContent?: string;
      submissionAttachments?: Array<{ name: string; url: string }>;
      rubric?: Rubric;
      courseId?: string;
    };
  };
};

const SAMPLE_RUBRIC: Rubric = {
  id: 'r_pr',
  title: '同儕互評 Rubric',
  criteria: [
    {
      id: 'c1',
      title: '論述清晰',
      weight: 35,
      levels: [
        { id: 'l4', label: '優', points: 4 },
        { id: 'l3', label: '良', points: 3 },
        { id: 'l2', label: '可', points: 2 },
        { id: 'l1', label: '差', points: 1 },
      ],
    },
    {
      id: 'c2',
      title: '證據充分',
      weight: 35,
      levels: [
        { id: 'l4', label: '優', points: 4 },
        { id: 'l3', label: '良', points: 3 },
        { id: 'l1', label: '差', points: 1 },
      ],
    },
    {
      id: 'c3',
      title: '創意與洞察',
      weight: 30,
      levels: [
        { id: 'l4', label: '優', points: 4 },
        { id: 'l2', label: '可', points: 2 },
      ],
    },
  ],
};

export default function PeerReviewSubmitScreen(props: RouteProps) {
  const navigation = useNavigation<any>();
  const passedAssignmentTitle = props.route?.params?.assignmentTitle ?? '同儕互評';
  const courseId = Number(String(props.route?.params?.courseId ?? '').replace(/^tc:/, '')) || 0;

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [availableReviews, setAvailableReviews] = useState<
    Awaited<ReturnType<typeof tcFetchPeerReviews>>
  >([]);
  const [activeReviewIdx, setActiveReviewIdx] = useState(0);

  const fetchReviewsData = useCallback(async () => {
    if (!courseId) return [] as Awaited<ReturnType<typeof tcFetchPeerReviews>>;
    if (isDemoCourseId(courseId)) {
      return demoFetchPeerReviews(courseId) as Awaited<ReturnType<typeof tcFetchPeerReviews>>;
    }
    return await tcFetchPeerReviews(courseId);
  }, [courseId]);

  // 拉該課程的互評任務
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!courseId) {
        setLoading(false);
        return;
      }
      try {
        const list = await fetchReviewsData();
        if (!cancelled) setAvailableReviews(list);
      } catch {
        /* swallow */
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [courseId, fetchReviewsData]);

  const onRefresh = useCallback(async () => {
    if (!courseId) return;
    setRefreshing(true);
    try {
      const list = await fetchReviewsData();
      setAvailableReviews(list);
    } catch {
      /* swallow */
    } finally {
      setRefreshing(false);
    }
  }, [courseId, fetchReviewsData]);

  // 當前要評的：優先看 route param > 線上拉的第一個
  const onlineReview = availableReviews[activeReviewIdx];
  const assignmentTitle = onlineReview?.assignment_title ?? passedAssignmentTitle;
  const anonymousAuthor = onlineReview?.target_anonymous_name ?? props.route?.params?.anonymousAuthor ?? '匿名同學';
  const submissionContent =
    props.route?.params?.submissionContent ??
    '（線上拉到的對方繳交內容會顯示在這裡）';
  const submissionAttachments = props.route?.params?.submissionAttachments ?? [];
  const rubric =
    (onlineReview?.rubric as Rubric | null) ??
    props.route?.params?.rubric ??
    SAMPLE_RUBRIC;
  const reviewId = String(onlineReview?.id ?? props.route?.params?.reviewId ?? '');

  const [scores, setScores] = useState<Record<string, string>>({});
  const [comments, setComments] = useState<Record<string, string>>({});
  const [overallFeedback, setOverallFeedback] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  // 切換不同 review 時清空輸入
  useEffect(() => {
    setScores({});
    setComments({});
    setOverallFeedback('');
    setSubmitted(false);
  }, [activeReviewIdx]);

  const evaluation = useMemo(() => {
    const rs: RubricScore[] = Object.entries(scores)
      .filter(([, v]) => v)
      .map(([criterionId, levelId]) => ({
        criterionId,
        levelId,
        comment: comments[criterionId],
      }));
    return evaluateRubric(rubric, rs);
  }, [rubric, scores, comments]);

  const complete = rubric.criteria.every((c) => scores[c.id]);

  const handleSubmit = async () => {
    if (!complete) {
      Alert.alert('請完成所有評分項', '每個 criterion 都要選一個等級才能送出。');
      return;
    }
    setSubmitting(true);
    try {
      const courseId = Number(String(props.route?.params?.courseId ?? '').replace(/^tc:/, '')) || 0;
      const reviewIdNum = Number(String(reviewId).replace(/^tc:/, '')) || 0;
      const usingSample = !props.route?.params?.rubric || !reviewIdNum || !courseId;
      if (!usingSample) {
        const { tcSubmitPeerReview } = await import('../services/tronClassClient');
        const result = await tcSubmitPeerReview(courseId, reviewIdNum, {
          scores,
          comments,
          overallFeedback,
          totalScore: evaluation.totalScore,
        });
        if (!result.success) {
          Alert.alert('送出失敗', result.error ?? '請稍後再試。');
          return;
        }
      } else {
        await new Promise((r) => setTimeout(r, 400));
      }
      // 記錄 companion signal
      try {
        const { onPeerReviewGiven } = await import('../services/companionHooks');
        onPeerReviewGiven({ submissionId: reviewId });
      } catch {
        /* swallow */
      }
      setSubmitted(true);
      Alert.alert(
        '✅ 互評已送出',
        `總分 ${evaluation.totalScore} / 100\n對方會看到匿名版本。`,
        [{ text: '完成', onPress: () => navigation.goBack() }],
      );
    } catch (e) {
      Alert.alert('送出失敗', String((e as Error)?.message ?? e));
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return <CourseChipLoading title="正在載入互評任務" subtitle="抓取分配名單與 Rubric…" />;
  }

  // 沒有線上互評任務 + 沒有傳入 reviewId → 顯示空狀態
  if (availableReviews.length === 0 && !props.route?.params?.rubric) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: theme.colors.surfaceMuted,
          paddingHorizontal: theme.layout.screenHorizontalPadding,
          justifyContent: 'center',
          paddingBottom: theme.space.xxl,
        }}
      >
        {isDemoCourseId(courseId) ? (
          <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginBottom: theme.space.sm }}>
            <CourseDemoDataRibbon />
          </View>
        ) : null}
        <CourseChipHeader
          emoji="💯"
          eyebrow="同儕互評"
          title={passedAssignmentTitle}
          meta={courseId ? `課程 ID ${courseId}` : undefined}
        />
        <EmptyState
          icon="ribbon-outline"
          title="尚未有互評任務"
          subtitle="老師在 TronClass 發布並分配互評後，你評分的對象會出現在這裡。"
          hint="可先從課程卡重新進入，或請教師確認互評時程。"
          showCalmHero
          actionText="返回上一頁"
          onAction={() => navigation.goBack()}
        />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: theme.colors.surfaceMuted }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={courseChipScrollContentStyle(true)}
        accessibilityLabel="同儕互評表單"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            title="重新整理"
            tintColor={theme.colors.primary}
            accessibilityLabel="重新整理同儕互評任務"
            onRefresh={onRefresh}
          />
        }
      >
        {isDemoCourseId(courseId) ? (
          <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginBottom: theme.space.sm }}>
            <CourseDemoDataRibbon />
          </View>
        ) : null}
        <CourseChipHeader
          emoji="💯"
          eyebrow="同儕互評"
          title={assignmentTitle}
          meta={`對象 · ${anonymousAuthor}`}
        />
        {availableReviews.length > 1 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
            {availableReviews.map((r, i) => (
              <Pressable
                key={String(r.id)}
                onPress={() => setActiveReviewIdx(i)}
                accessibilityRole="button"
                accessibilityLabel={`互評第 ${i + 1} 份，${r.target_anonymous_name}${r.submitted ? '，已送出' : ''}`}
                style={{
                  paddingHorizontal: 12,
                  paddingVertical: 10,
                  borderRadius: theme.radius.full,
                  backgroundColor: i === activeReviewIdx ? theme.colors.primary : theme.colors.surface,
                  borderWidth: 1,
                  borderColor: i === activeReviewIdx ? theme.colors.primary : theme.colors.border,
                  marginRight: 8,
                  minHeight: 40,
                  justifyContent: 'center',
                }}
              >
                <Text
                  style={{
                    color: i === activeReviewIdx ? theme.colors.onAccent : theme.colors.text,
                    fontSize: 12,
                  }}
                >
                  {i + 1}. {r.target_anonymous_name}
                  {r.submitted ? ' ✓' : ''}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        )}

        <View
          style={{
            marginTop: theme.space.sm,
            backgroundColor: theme.colors.infoSoft,
            borderRadius: theme.radius.lg,
            padding: theme.space.md,
            borderWidth: 1,
            borderColor: `${theme.colors.info}44`,
          }}
        >
          <Text style={{ color: theme.colors.text, fontSize: 13, lineHeight: 20 }}>
            提示：對方看不到你是誰，請給有建設性的匿名回饋。
          </Text>
        </View>

        {/* 同學的作業內容 */}
        <View
          style={{
            marginTop: 16,
            backgroundColor: theme.colors.surface,
            borderRadius: theme.radius.lg,
            padding: 14,
            borderWidth: 1,
            borderColor: theme.colors.border,
          }}
        >
          <Text
            style={{ fontSize: 14, fontWeight: '600', color: theme.colors.text, marginBottom: 8 }}
          >
            📄 對方的作業
          </Text>
          <Text style={{ fontSize: 13, color: theme.colors.textSecondary, lineHeight: 20 }}>
            {submissionContent}
          </Text>
          {submissionAttachments.map((att, i) => (
            <Pressable
              key={`att-${i}-${att.name}`}
              accessibilityRole="button"
              accessibilityLabel={`開啟附件 ${att.name}`}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 6,
                padding: 8,
                marginTop: 6,
                backgroundColor: theme.colors.surface2,
                borderRadius: theme.radius.md,
                minHeight: 44,
              }}
              onPress={() =>
                navigation.navigate('CourseMaterialViewer', {
                  url: att.url,
                  title: att.name,
                  kind: 'homework',
                })
              }
            >
              <Ionicons name="document-outline" size={16} color={theme.colors.muted} />
              <Text style={{ fontSize: 13, color: theme.colors.primary }}>{att.name}</Text>
            </Pressable>
          ))}
        </View>

        {/* Rubric 評分 */}
        <Text style={{ marginTop: 20, fontSize: 16, fontWeight: '700', color: theme.colors.text }}>
          🎯 依 Rubric 打分
        </Text>
        {rubric.criteria.map((c) => (
          <View
            key={c.id}
            style={{
              marginTop: 12,
              backgroundColor: theme.colors.surface,
              borderRadius: theme.radius.lg,
              padding: 14,
              borderWidth: 1,
              borderColor: theme.colors.border,
            }}
          >
            <View
              style={{
                flexDirection: 'row',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <Text style={{ fontSize: 14, fontWeight: '600', color: theme.colors.text }}>
                {c.title}
              </Text>
              <Text style={{ fontSize: 12, color: theme.colors.muted }}>權重 {c.weight}%</Text>
            </View>
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
              {c.levels.map((l) => (
                <Pressable
                  key={l.id}
                  onPress={() =>
                    !submitted && setScores((s) => ({ ...s, [c.id]: l.id }))
                  }
                  accessibilityRole="button"
                  accessibilityLabel={`${c.title}：${l.label}，${l.points} 分`}
                  accessibilityState={{ selected: scores[c.id] === l.id, disabled: submitted }}
                  style={{
                    flex: 1,
                    padding: 10,
                    borderRadius: theme.radius.md,
                    backgroundColor: scores[c.id] === l.id ? theme.colors.primary : theme.colors.surface2,
                    alignItems: 'center',
                    minHeight: 44,
                    justifyContent: 'center',
                  }}
                >
                  <Text
                    style={{
                      color: scores[c.id] === l.id ? theme.colors.onAccent : theme.colors.text,
                      fontWeight: '600',
                    }}
                  >
                    {l.label}
                  </Text>
                  <Text
                    style={{
                      color: scores[c.id] === l.id ? theme.colors.onAccent : theme.colors.muted,
                      fontSize: 11,
                      marginTop: 2,
                    }}
                  >
                    {l.points} 分
                  </Text>
                </Pressable>
              ))}
            </View>
            <TextInput
              value={comments[c.id] ?? ''}
              onChangeText={(t) => setComments((cs) => ({ ...cs, [c.id]: t }))}
              editable={!submitted}
              accessibilityLabel={`${c.title}的逐項回饋`}
              placeholder="這一項的具體回饋（選填）"
              placeholderTextColor={theme.colors.muted}
              style={{
                marginTop: 10,
                backgroundColor: theme.colors.surfaceMuted,
                borderRadius: theme.radius.md,
                padding: 8,
                fontSize: 13,
                borderWidth: 1,
                borderColor: theme.colors.border,
                minHeight: 50,
                textAlignVertical: 'top',
                color: theme.colors.text,
              }}
              multiline
            />
          </View>
        ))}

        {/* 即時預覽 */}
        {complete && (
          <View
            style={{
              marginTop: 16,
              padding: 14,
              backgroundColor: theme.colors.successSoft,
              borderRadius: theme.radius.lg,
              borderWidth: 1,
              borderColor: `${theme.colors.success}33`,
            }}
          >
            <Text style={{ fontSize: 13, color: theme.colors.success }}>即時計算總分</Text>
            <Text style={{ fontSize: 28, fontWeight: '700', color: theme.colors.text, marginTop: 2 }}>
              {evaluation.totalScore} / 100
            </Text>
          </View>
        )}

        {/* 整體回饋 */}
        <Text style={{ marginTop: 16, fontSize: 14, fontWeight: '600', color: theme.colors.text }}>
          💬 整體回饋（會匿名給對方）
        </Text>
        <TextInput
          value={overallFeedback}
          onChangeText={setOverallFeedback}
          editable={!submitted}
          accessibilityLabel="整體匿名回饋"
          placeholder="例如：你的論述很清晰，但建議補一個反例會更有說服力。"
          placeholderTextColor={theme.colors.muted}
          multiline
          style={{
            marginTop: 6,
            backgroundColor: theme.colors.surface,
            borderRadius: theme.radius.md,
            padding: 10,
            fontSize: 13,
            borderWidth: 1,
            borderColor: theme.colors.border,
            minHeight: 80,
            textAlignVertical: 'top',
            color: theme.colors.text,
          }}
        />

        {!submitted && (
          <Pressable
            onPress={handleSubmit}
            disabled={submitting || !complete}
            accessibilityRole="button"
            accessibilityLabel={complete ? '送出互評' : '送出互評（尚未完成評分）'}
            accessibilityState={{ disabled: submitting || !complete }}
            style={{
              marginTop: 24,
              padding: 14,
              borderRadius: theme.radius.lg,
              backgroundColor: complete ? theme.colors.primary : theme.colors.disabledBg,
              alignItems: 'center',
              opacity: submitting ? 0.6 : 1,
              minHeight: 52,
              justifyContent: 'center',
            }}
          >
            {submitting ? (
              <ActivityIndicator color={theme.colors.onAccent} />
            ) : (
              <Text
                style={{
                  color: complete ? theme.colors.onAccent : theme.colors.disabledText,
                  fontSize: 16,
                  fontWeight: '700',
                }}
              >
                {complete ? '送出互評' : '請先完成所有評分項'}
              </Text>
            )}
          </Pressable>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
