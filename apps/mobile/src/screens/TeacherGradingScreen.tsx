/**
 * Teacher Grading Screen — 教師端 mobile 批改作業
 *
 * 用 Rubric 批改示範繳交資料；只發本機事件，不寫入校務成績系統。
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
import { safeNavigate } from '../utils/safeNavigate';

import { evaluateRubric, type Rubric, type RubricScore } from '@campus/shared';

import { useAuth } from '../state/auth';
import { simulateTeacherGrade } from '../services/demoActionSimulator';
import { emitFeedbackDrafted } from '../services/roleEventBus';
import { prepareGradingDelivery } from '../services/prepareGradingDelivery';

interface Submission {
  id: string;
  studentName: string;
  studentId: string;
  studentUid?: string;
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
    studentName: '顧晉瑋',
    studentId: 'DEMO-001',
    studentUid: 'demo_student_kuchih',
    submittedAt: '2026-05-12T22:30:00+08:00',
    isLate: false,
    content: '這是阿明繳交的內容範例⋯⋯',
    currentGrade: null,
    currentFeedback: null,
  },
  {
    id: 's2',
    studentName: '林佳玲',
    studentId: 'DEMO-002',
    studentUid: 'u1',
    submittedAt: '2026-05-13T09:00:00+08:00',
    isLate: true,
    content: '這是小華繳交的內容範例⋯⋯',
    currentGrade: null,
    currentFeedback: null,
  },
  {
    id: 's3',
    studentName: '王冠宇',
    studentId: 'DEMO-003',
    studentUid: 'u2',
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
  const auth = useAuth();
  const assignmentTitle = props.route?.params?.assignmentTitle ?? '作業批改';
  const assignmentId = String(props.route?.params?.assignmentId ?? '1');
  const courseId = String(props.route?.params?.courseId ?? '71378');
  const courseName = props.route?.params?.courseName ?? '';
  const passingScore = props.route?.params?.passingScore ?? 60;
  const rubric = props.route?.params?.rubric ?? SAMPLE_RUBRIC;
  const initialSubs =
    props.route?.params?.submissions ?? (courseId === '71378' ? SAMPLE_SUBMISSIONS : []);

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
      const delivery = prepareGradingDelivery({
        actorUid: auth.user?.uid,
        actorRole: auth.profile?.role,
        studentUid: sub.studentUid,
        studentName: sub.studentName,
        courseId,
        assignmentId,
        score: evaluation.totalScore,
      });
      if ('reason' in delivery) {
        Alert.alert(
          '無法發佈示範成績',
          delivery.reason === 'student_missing'
            ? '缺少學生帳號識別碼，請回到繳交清單確認資料，不能依姓名猜測收件人。'
            : '教師身分或作業資料不完整，沒有發送任何成績事件。',
        );
        return;
      }
      await simulateTeacherGrade({
        teacherUid: delivery.actorUid,
        teacherName: auth.profile?.displayName ?? '示範教師',
        studentUid: delivery.studentUid,
        studentName: delivery.studentName,
        courseId: delivery.courseId,
        courseName: courseName || assignmentTitle.split(' ')[0],
        homeworkId: delivery.assignmentId,
        homeworkTitle: assignmentTitle,
        score: delivery.score,
        totalScore: 100,
      });
      if (feedback.trim()) {
        await emitFeedbackDrafted({
          actorUid: delivery.actorUid,
          actorName: auth.profile?.displayName ?? '示範教師',
          targetUids: [delivery.studentUid],
          courseId: delivery.courseId,
          courseName: courseName || assignmentTitle.split(' ')[0],
          payload: {
            studentName: sub.studentName,
            homeworkTitle: assignmentTitle,
            draftPreview: feedback.trim(),
          },
        });
      }

      // Demo-only local update; no real grade API is called.
      setSubmissions((ss) =>
        ss.map((s, i) =>
          s.id === sub.id
            ? { ...s, currentGrade: evaluation.totalScore, currentFeedback: feedback }
            : s,
        ),
      );
      // reset
      setScores({});
      setComments({});
      setFeedback('');
      // 跳到下一份
      const nextAfter = submissions.findIndex((s, i) => i > activeIdx && s.currentGrade === null);
      const nextBefore = submissions.findIndex((s, i) => i < activeIdx && s.currentGrade === null);
      const next = nextAfter >= 0 ? nextAfter : nextBefore;
      if (next >= 0) {
        setActiveIdx(next);
      } else {
        Alert.alert('示範批改完成', `${assignmentTitle} 已處理所有待批改的示範繳交。`, [
          { text: '完成', onPress: () => navigation.goBack() },
        ]);
      }
    } catch (e) {
      Alert.alert('儲存失敗', String((e as Error)?.message ?? e));
    } finally {
      setSaving(false);
    }
  };

  if (submissions.length === 0) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', padding: 24 }}>
        <Text style={{ fontSize: 16, fontWeight: '600' }}>沒有可批改的繳交資料</Text>
        <Text style={{ marginTop: 8, color: '#666' }}>
          此頁不會為其他課程自動產生學生或成績，請從作業清單開啟實際繳交資料。
        </Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: '#F2F2F7' }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {/* 頂部進度 */}
      <View style={{ backgroundColor: '#003F8A', padding: 12 }}>
        <Text style={{ color: '#fff', fontSize: 16, fontWeight: '700' }}>
          {assignmentTitle}
        </Text>
        <Text style={{ color: '#E5F2FF', fontSize: 12, marginTop: 2 }}>
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
        <View style={{ padding: 12, backgroundColor: '#FFF4D6', borderRadius: 8 }}>
          <Text style={{ fontSize: 12, color: '#6C4B00', lineHeight: 18 }}>
            示範批改：僅在本機建立成績與回饋通知，不會寫入 TronClass 或正式成績紀錄。
          </Text>
        </View>
        {/* 學生 tabs */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          {submissions.map((s, i) => (
            <Pressable
              key={s.id}
              disabled={saving}
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
                backgroundColor: i === activeIdx ? '#003F8A' : '#fff',
                borderWidth: 1,
                borderColor: i === activeIdx ? '#003F8A' : '#E5E5EA',
                flexDirection: 'row',
                gap: 6,
                alignItems: 'center',
              }}
            >
              <Text
                style={{
                  color: i === activeIdx ? '#fff' : '#1C1C1E',
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
                  color={i === activeIdx ? '#fbbf24' : '#34C759'}
                />
              )}
              {s.isLate && (
                <Text style={{ fontSize: 11, color: '#D70015' }}>遲</Text>
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
            borderColor: '#E5E5EA',
          }}
        >
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text style={{ fontSize: 14, fontWeight: '600', color: '#1C1C1E' }}>
              {sub.studentName}（{sub.studentId}）
            </Text>
            <Text style={{ fontSize: 12, color: '#8E8E93' }}>
              {new Date(sub.submittedAt).toLocaleString('zh-TW')}
            </Text>
          </View>
          <Text style={{ marginTop: 10, fontSize: 13, color: '#3C3C43', lineHeight: 20 }}>
            {sub.content}
          </Text>
          {sub.attachments?.map((att, i) => (
            <Pressable
              key={i}
              onPress={() =>
                safeNavigate(navigation, 'CourseMaterialViewer', {
                  url: att.url,
                  title: att.name,
                  kind: 'homework',
                })
              }
              style={{
                marginTop: 8,
                padding: 8,
                backgroundColor: '#F2F2F7',
                borderRadius: 6,
                flexDirection: 'row',
                gap: 6,
                alignItems: 'center',
              }}
            >
              <Ionicons name="document-outline" size={16} color="#8E8E93" />
              <Text style={{ fontSize: 13, color: '#003F8A' }}>{att.name}</Text>
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
            <Text style={{ fontSize: 14, fontWeight: '700', color: '#1C1C1E' }}>
              本份已批改：{sub.currentGrade} 分
            </Text>
            {sub.currentFeedback && (
              <Text style={{ marginTop: 4, fontSize: 13, color: '#3C3C43' }}>
                {sub.currentFeedback}
              </Text>
            )}
          </View>
        )}

        {/* Rubric 打分 */}
        <Text style={{ marginTop: 20, fontSize: 16, fontWeight: '700', color: '#1C1C1E' }}>
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
              borderColor: '#E5E5EA',
            }}
          >
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={{ fontSize: 14, fontWeight: '600', color: '#1C1C1E' }}>{c.title}</Text>
              <Text style={{ fontSize: 12, color: '#8E8E93' }}>權重 {c.weight}%</Text>
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
                    backgroundColor: scores[c.id] === l.id ? '#003F8A' : '#F2F2F7',
                    alignItems: 'center',
                  }}
                >
                  <Text
                    style={{
                      color: scores[c.id] === l.id ? '#fff' : '#1C1C1E',
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
        <Text style={{ marginTop: 16, fontSize: 14, fontWeight: '600', color: '#1C1C1E' }}>
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
            borderColor: '#E5E5EA',
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
            backgroundColor: allComplete ? '#003F8A' : '#AEAEB2',
            alignItems: 'center',
          }}
        >
          {saving ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={{ color: '#fff', fontSize: 16, fontWeight: '700' }}>
              {allComplete ? '發佈示範成績並繼續' : '請完成所有評分項'}
            </Text>
          )}
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
