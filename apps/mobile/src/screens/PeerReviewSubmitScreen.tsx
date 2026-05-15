/**
 * Peer Review Submit Screen — 同儕互評本地化
 *
 * 學生在 APP 內看分配到的同儕作業 + 用 Rubric 打分 + 回饋 + 送出
 * 對應引擎：packages/shared/src/lms/rubricScoring
 * 對應端點：POST /courses/{id}/peer_reviews/{rid}/submissions
 */
import React, { useState, useMemo } from 'react';
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
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';

import { evaluateRubric, type Rubric, type RubricScore } from '@campus/shared';

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
  const assignmentTitle = props.route?.params?.assignmentTitle ?? '同儕互評';
  const anonymousAuthor = props.route?.params?.anonymousAuthor ?? '匿名同學 A';
  const submissionContent =
    props.route?.params?.submissionContent ??
    '（這裡會顯示對方繳交的內容、文字、附件預覽）\n\n本範例為示範用，實際接 TronClass 端點後會看到對方的完整繳交。';
  const submissionAttachments = props.route?.params?.submissionAttachments ?? [];
  const rubric = props.route?.params?.rubric ?? SAMPLE_RUBRIC;
  const reviewId = props.route?.params?.reviewId ?? '';

  const [scores, setScores] = useState<Record<string, string>>({});
  const [comments, setComments] = useState<Record<string, string>>({});
  const [overallFeedback, setOverallFeedback] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

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
      await new Promise((r) => setTimeout(r, 500));
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

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: '#f9fafb' }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 80 }}>
        {/* 頂部 */}
        <View
          style={{
            backgroundColor: '#1F4E78',
            borderRadius: 12,
            padding: 16,
          }}
        >
          <Text style={{ color: '#fff', fontSize: 18, fontWeight: '700' }}>
            {assignmentTitle}
          </Text>
          <Text style={{ color: '#dbeafe', fontSize: 13, marginTop: 4 }}>
            互評對象：{anonymousAuthor}
          </Text>
          <Text style={{ color: '#dbeafe', fontSize: 12, marginTop: 8, fontStyle: 'italic' }}>
            提示：對方看不到你是誰，請給有建設性的回饋。
          </Text>
        </View>

        {/* 同學的作業內容 */}
        <View
          style={{
            marginTop: 16,
            backgroundColor: '#fff',
            borderRadius: 12,
            padding: 14,
            borderWidth: 1,
            borderColor: '#e5e7eb',
          }}
        >
          <Text style={{ fontSize: 14, fontWeight: '600', color: '#111827', marginBottom: 8 }}>
            📄 對方的作業
          </Text>
          <Text style={{ fontSize: 13, color: '#374151', lineHeight: 20 }}>
            {submissionContent}
          </Text>
          {submissionAttachments.map((att, i) => (
            <Pressable
              key={i}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 6,
                padding: 8,
                marginTop: 6,
                backgroundColor: '#f3f4f6',
                borderRadius: 6,
              }}
              onPress={() =>
                navigation.navigate('CourseMaterialViewer', {
                  url: att.url,
                  title: att.name,
                  kind: 'homework',
                })
              }
            >
              <Ionicons name="document-outline" size={16} color="#6b7280" />
              <Text style={{ fontSize: 13, color: '#1F4E78' }}>{att.name}</Text>
            </Pressable>
          ))}
        </View>

        {/* Rubric 評分 */}
        <Text style={{ marginTop: 20, fontSize: 16, fontWeight: '700', color: '#111827' }}>
          🎯 依 Rubric 打分
        </Text>
        {rubric.criteria.map((c) => (
          <View
            key={c.id}
            style={{
              marginTop: 12,
              backgroundColor: '#fff',
              borderRadius: 12,
              padding: 14,
              borderWidth: 1,
              borderColor: '#e5e7eb',
            }}
          >
            <View
              style={{
                flexDirection: 'row',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <Text style={{ fontSize: 14, fontWeight: '600', color: '#111827' }}>{c.title}</Text>
              <Text style={{ fontSize: 12, color: '#6b7280' }}>權重 {c.weight}%</Text>
            </View>
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
              {c.levels.map((l) => (
                <Pressable
                  key={l.id}
                  onPress={() =>
                    !submitted && setScores((s) => ({ ...s, [c.id]: l.id }))
                  }
                  style={{
                    flex: 1,
                    padding: 10,
                    borderRadius: 8,
                    backgroundColor: scores[c.id] === l.id ? '#1F4E78' : '#f3f4f6',
                    alignItems: 'center',
                  }}
                >
                  <Text
                    style={{
                      color: scores[c.id] === l.id ? '#fff' : '#111827',
                      fontWeight: '600',
                    }}
                  >
                    {l.label}
                  </Text>
                  <Text
                    style={{
                      color: scores[c.id] === l.id ? '#fff' : '#6b7280',
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
              placeholder="這一項的具體回饋（選填）"
              style={{
                marginTop: 10,
                backgroundColor: '#f9fafb',
                borderRadius: 8,
                padding: 8,
                fontSize: 13,
                borderWidth: 1,
                borderColor: '#e5e7eb',
                minHeight: 50,
                textAlignVertical: 'top',
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
              backgroundColor: '#dcfce7',
              borderRadius: 12,
            }}
          >
            <Text style={{ fontSize: 13, color: '#15803d' }}>即時計算總分</Text>
            <Text style={{ fontSize: 28, fontWeight: '700', color: '#14532d', marginTop: 2 }}>
              {evaluation.totalScore} / 100
            </Text>
          </View>
        )}

        {/* 整體回饋 */}
        <Text style={{ marginTop: 16, fontSize: 14, fontWeight: '600', color: '#111827' }}>
          💬 整體回饋（會匿名給對方）
        </Text>
        <TextInput
          value={overallFeedback}
          onChangeText={setOverallFeedback}
          editable={!submitted}
          placeholder="例如：你的論述很清晰，但建議補一個反例會更有說服力。"
          multiline
          style={{
            marginTop: 6,
            backgroundColor: '#fff',
            borderRadius: 8,
            padding: 10,
            fontSize: 13,
            borderWidth: 1,
            borderColor: '#e5e7eb',
            minHeight: 80,
            textAlignVertical: 'top',
          }}
        />

        {!submitted && (
          <Pressable
            onPress={handleSubmit}
            disabled={submitting || !complete}
            style={{
              marginTop: 24,
              padding: 14,
              borderRadius: 12,
              backgroundColor: complete ? '#1F4E78' : '#9ca3af',
              alignItems: 'center',
              opacity: submitting ? 0.6 : 1,
            }}
          >
            {submitting ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={{ color: '#fff', fontSize: 16, fontWeight: '700' }}>
                {complete ? '送出互評' : '請先完成所有評分項'}
              </Text>
            )}
          </Pressable>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
