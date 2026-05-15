/**
 * Teacher Grading Screen — 教師端 mobile 批改作業
 *
 * 用 Rubric 或自由打分；可一次處理多份；同步寫 TronClass。
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

interface Submission {
  id: string;
  studentName: string;
  studentId: string;
  submittedAt: string;
  isLate: boolean;
  content: string;
  attachments?: Array<{ name: string; url: string }>;
  currentGrade: number | null;
  currentFeedback: string | null;
}

type RouteProps = {
  route?: {
    params?: {
      assignmentId?: string;
      assignmentTitle?: string;
      courseId?: string;
      courseName?: string;
      submissions?: Submission[];
      rubric?: Rubric;
      passingScore?: number;
    };
  };
};

const SAMPLE_SUBMISSIONS: Submission[] = [
  {
    id: 's1',
    studentName: '阿明',
    studentId: 'ku-001',
    submittedAt: '2026-05-12T22:30:00+08:00',
    isLate: false,
    content: '這是阿明繳交的內容範例⋯⋯',
    currentGrade: null,
    currentFeedback: null,
  },
  {
    id: 's2',
    studentName: '小華',
    studentId: 'ku-002',
    submittedAt: '2026-05-13T09:00:00+08:00',
    isLate: true,
    content: '這是小華繳交的內容範例⋯⋯',
    currentGrade: null,
    currentFeedback: null,
  },
  {
    id: 's3',
    studentName: '小芳',
    studentId: 'ku-003',
    submittedAt: '2026-05-11T18:00:00+08:00',
    isLate: false,
    content: '這是小芳繳交的內容範例⋯⋯',
    currentGrade: 92,
    currentFeedback: '論述完整，繼續加油！',
  },
];

const SAMPLE_RUBRIC: Rubric = {
  id: 'r_t',
  title: '作業評分標準',
  criteria: [
    {
      id: 'c1',
      title: '內容深度',
      weight: 40,
      levels: [
        { id: 'l4', label: '優', points: 4 },
        { id: 'l3', label: '良', points: 3 },
        { id: 'l2', label: '可', points: 2 },
        { id: 'l1', label: '差', points: 1 },
      ],
    },
    {
      id: 'c2',
      title: '結構',
      weight: 30,
      levels: [
        { id: 'l3', label: '清晰', points: 3 },
        { id: 'l1', label: '混亂', points: 1 },
      ],
    },
    {
      id: 'c3',
      title: '完成度',
      weight: 30,
      levels: [
        { id: 'l4', label: '完整', points: 4 },
        { id: 'l2', label: '部分', points: 2 },
      ],
    },
  ],
};

export default function TeacherGradingScreen(props: RouteProps) {
  const navigation = useNavigation<any>();
  const assignmentTitle = props.route?.params?.assignmentTitle ?? '作業批改';
  const courseName = props.route?.params?.courseName ?? '';
  const passingScore = props.route?.params?.passingScore ?? 60;
  const rubric = props.route?.params?.rubric ?? SAMPLE_RUBRIC;
  const initialSubs = props.route?.params?.submissions ?? SAMPLE_SUBMISSIONS;

  const [submissions, setSubmissions] = useState(initialSubs);
  const [activeIdx, setActiveIdx] = useState(0);
  const [scores, setScores] = useState<Record<string, string>>({});
  const [comments, setComments] = useState<Record<string, string>>({});
  const [feedback, setFeedback] = useState('');
  const [saving, setSaving] = useState(false);

  const sub = submissions[activeIdx];
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

  const allComplete = rubric.criteria.every((c) => scores[c.id]);

  const gradedCount = submissions.filter((s) => s.currentGrade !== null).length;

  const handleSaveAndNext = async () => {
    if (!allComplete) {
      Alert.alert('請完成所有評分項');
      return;
    }
    setSaving(true);
    try {
      await new Promise((r) => setTimeout(r, 400));
      // 更新本機 state（真實實作會 PATCH /submissions/{id}）
      setSubmissions((ss) =>
        ss.map((s, i) =>
          i === activeIdx
            ? { ...s, currentGrade: evaluation.totalScore, currentFeedback: feedback }
            : s,
        ),
      );
      // reset
      setScores({});
      setComments({});
      setFeedback('');
      // 跳到下一份
      const next = submissions.findIndex((s, i) => i > activeIdx && s.currentGrade === null);
      if (next >= 0) {
        setActiveIdx(next);
      } else {
        Alert.alert('🎉 全部批改完成', `${assignmentTitle} 所有繳交都已給分。`, [
          { text: '完成', onPress: () => navigation.goBack() },
        ]);
      }
    } catch (e) {
      Alert.alert('儲存失敗', String((e as Error)?.message ?? e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: '#f9fafb' }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {/* 頂部進度 */}
      <View style={{ backgroundColor: '#1F4E78', padding: 12 }}>
        <Text style={{ color: '#fff', fontSize: 16, fontWeight: '700' }}>
          {assignmentTitle}
        </Text>
        <Text style={{ color: '#dbeafe', fontSize: 12, marginTop: 2 }}>
          {courseName} ・ 已批改 {gradedCount} / {submissions.length}
        </Text>
        <View
          style={{
            marginTop: 8,
            height: 4,
            backgroundColor: '#1e3a5f',
            borderRadius: 2,
            overflow: 'hidden',
          }}
        >
          <View
            style={{
              width: `${(gradedCount / submissions.length) * 100}%`,
              height: 4,
              backgroundColor: '#fbbf24',
            }}
          />
        </View>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 80 }}>
        {/* 學生 tabs */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          {submissions.map((s, i) => (
            <Pressable
              key={s.id}
              onPress={() => {
                setActiveIdx(i);
                setScores({});
                setComments({});
                setFeedback(s.currentFeedback ?? '');
              }}
              style={{
                paddingHorizontal: 12,
                paddingVertical: 8,
                marginRight: 8,
                borderRadius: 999,
                backgroundColor: i === activeIdx ? '#1F4E78' : '#fff',
                borderWidth: 1,
                borderColor: i === activeIdx ? '#1F4E78' : '#e5e7eb',
                flexDirection: 'row',
                gap: 6,
                alignItems: 'center',
              }}
            >
              <Text
                style={{
                  color: i === activeIdx ? '#fff' : '#111827',
                  fontSize: 13,
                  fontWeight: '600',
                }}
              >
                {s.studentName}
              </Text>
              {s.currentGrade !== null && (
                <Ionicons
                  name="checkmark-circle"
                  size={16}
                  color={i === activeIdx ? '#fbbf24' : '#16a34a'}
                />
              )}
              {s.isLate && (
                <Text style={{ fontSize: 11, color: '#dc2626' }}>遲</Text>
              )}
            </Pressable>
          ))}
        </ScrollView>

        {/* 學生繳交內容 */}
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
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text style={{ fontSize: 14, fontWeight: '600', color: '#111827' }}>
              {sub.studentName}（{sub.studentId}）
            </Text>
            <Text style={{ fontSize: 12, color: '#6b7280' }}>
              {new Date(sub.submittedAt).toLocaleString('zh-TW')}
            </Text>
          </View>
          <Text style={{ marginTop: 10, fontSize: 13, color: '#374151', lineHeight: 20 }}>
            {sub.content}
          </Text>
          {sub.attachments?.map((att, i) => (
            <Pressable
              key={i}
              onPress={() =>
                navigation.navigate('CourseMaterialViewer', {
                  url: att.url,
                  title: att.name,
                  kind: 'homework',
                })
              }
              style={{
                marginTop: 8,
                padding: 8,
                backgroundColor: '#f3f4f6',
                borderRadius: 6,
                flexDirection: 'row',
                gap: 6,
                alignItems: 'center',
              }}
            >
              <Ionicons name="document-outline" size={16} color="#6b7280" />
              <Text style={{ fontSize: 13, color: '#1F4E78' }}>{att.name}</Text>
            </Pressable>
          ))}
        </View>

        {/* 已批改提示 */}
        {sub.currentGrade !== null && (
          <View
            style={{
              marginTop: 12,
              padding: 12,
              backgroundColor: sub.currentGrade >= passingScore ? '#dcfce7' : '#fee2e2',
              borderRadius: 12,
            }}
          >
            <Text style={{ fontSize: 14, fontWeight: '700', color: '#111827' }}>
              本份已批改：{sub.currentGrade} 分
            </Text>
            {sub.currentFeedback && (
              <Text style={{ marginTop: 4, fontSize: 13, color: '#374151' }}>
                {sub.currentFeedback}
              </Text>
            )}
          </View>
        )}

        {/* Rubric 打分 */}
        <Text style={{ marginTop: 20, fontSize: 16, fontWeight: '700', color: '#111827' }}>
          🎯 Rubric 評分
        </Text>
        {rubric.criteria.map((c) => (
          <View
            key={c.id}
            style={{
              marginTop: 10,
              backgroundColor: '#fff',
              borderRadius: 12,
              padding: 14,
              borderWidth: 1,
              borderColor: '#e5e7eb',
            }}
          >
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={{ fontSize: 14, fontWeight: '600', color: '#111827' }}>{c.title}</Text>
              <Text style={{ fontSize: 12, color: '#6b7280' }}>權重 {c.weight}%</Text>
            </View>
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
              {c.levels.map((l) => (
                <Pressable
                  key={l.id}
                  onPress={() => setScores((s) => ({ ...s, [c.id]: l.id }))}
                  style={{
                    flex: 1,
                    minWidth: 80,
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
                </Pressable>
              ))}
            </View>
          </View>
        ))}

        {/* 即時預覽 */}
        {allComplete && (
          <View
            style={{
              marginTop: 16,
              padding: 14,
              backgroundColor: '#dcfce7',
              borderRadius: 12,
            }}
          >
            <Text style={{ fontSize: 13, color: '#15803d' }}>加權後分數</Text>
            <Text style={{ fontSize: 28, fontWeight: '700', color: '#14532d', marginTop: 2 }}>
              {evaluation.totalScore} / 100
            </Text>
          </View>
        )}

        {/* 整體回饋 */}
        <Text style={{ marginTop: 16, fontSize: 14, fontWeight: '600', color: '#111827' }}>
          💬 給學生的回饋
        </Text>
        <TextInput
          value={feedback}
          onChangeText={setFeedback}
          placeholder="例如：論述完整，建議補一個實際案例。"
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

        <Pressable
          onPress={handleSaveAndNext}
          disabled={saving || !allComplete}
          style={{
            marginTop: 20,
            padding: 14,
            borderRadius: 12,
            backgroundColor: allComplete ? '#1F4E78' : '#9ca3af',
            alignItems: 'center',
          }}
        >
          {saving ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={{ color: '#fff', fontSize: 16, fontWeight: '700' }}>
              {allComplete ? '儲存並批改下一份' : '請完成所有評分項'}
            </Text>
          )}
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
