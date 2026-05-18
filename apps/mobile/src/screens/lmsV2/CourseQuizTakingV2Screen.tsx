import React, { useState, useEffect } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, Alert, StyleSheet } from 'react-native';
import { getSupabaseClient } from '../../services/supabaseClient';
import {
  startQuizAttempt,
  answerQuizQuestion,
  submitQuizAttempt,
} from '../../services/lmsV2WriteTools';
import {
  CourseV2Header,
  useCourseV2Params,
  useCourseV2Nav,
  useLoadable,
  CourseV2Loading,
  CourseV2Error,
} from './_courseV2Shell';

export default function CourseQuizTakingV2Screen() {
  const { courseId, quizId, courseName } = useCourseV2Params();
  const nav = useCourseV2Nav();
  const [attemptId, setAttemptId] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  const loadable = useLoadable(async () => {
    const sb = getSupabaseClient();
    if (!sb) return { quiz: null, questions: [] };
    const { data: quiz } = await sb
      .from('quizzes')
      .select('id, title, description, time_limit_seconds, max_attempts')
      .eq('id', quizId)
      .maybeSingle();
    const { data: questions } = await sb
      .from('quiz_questions')
      .select('id, prompt, question_type, choices, points')
      .eq('quiz_id', quizId)
      .order('sort_order', { ascending: true });
    return { quiz, questions: questions ?? [] };
  });

  useEffect(() => {
    (async () => {
      if (!quizId) return;
      const r = await startQuizAttempt({ courseId: courseId!, quizId });
      if (r.success && r.data?.attemptId) setAttemptId(String(r.data.attemptId));
    })();
  }, [quizId, courseId]);

  const handleAnswerChange = async (questionId: string, value: string) => {
    setAnswers(prev => ({ ...prev, [questionId]: value }));
    if (attemptId) {
      await answerQuizQuestion({ attemptId, questionId, answer: value });
    }
  };

  const handleSubmit = async () => {
    if (!attemptId) return;
    setSubmitting(true);
    const r = await submitQuizAttempt({ attemptId });
    setSubmitting(false);
    Alert.alert(r.success ? '已交卷' : '失敗', r.summary);
    if (r.success) nav.goBack();
  };

  if (loadable.loading) return <CourseV2Loading />;
  if (loadable.error) return <CourseV2Error error={loadable.error} onRetry={loadable.refresh} />;
  const { quiz, questions } = loadable.data!;

  return (
    <View style={{ flex: 1, backgroundColor: '#F2F2F7' }}>
      <CourseV2Header title={quiz?.title ?? '測驗'} subtitle={courseName} />
      <ScrollView contentContainerStyle={{ padding: 16, gap: 16 }}>
        {questions.map((q: any, idx: number) => (
          <View key={q.id} style={styles.qBox}>
            <Text style={styles.qIndex}>
              第 {idx + 1} 題 · {q.points ?? 0} 分
            </Text>
            <Text style={styles.qPrompt}>{q.prompt}</Text>
            <TextInput
              style={styles.input}
              value={answers[q.id] ?? ''}
              onChangeText={v => handleAnswerChange(q.id, v)}
              placeholder="輸入答案..."
              multiline
            />
          </View>
        ))}
        {questions.length > 0 ? (
          <Pressable
            style={[styles.submitBtn, submitting && { opacity: 0.5 }]}
            disabled={submitting}
            onPress={handleSubmit}
          >
            <Text style={styles.submitLabel}>{submitting ? '交卷中...' : '交卷'}</Text>
          </Pressable>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  qBox: {
    padding: 14,
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#E5E5EA',
    gap: 8,
  },
  qIndex: { fontSize: 12, color: '#8E8E93', fontWeight: '600' },
  qPrompt: { fontSize: 15, lineHeight: 22 },
  input: {
    minHeight: 80,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#E5E5EA',
    borderRadius: 6,
    padding: 8,
    textAlignVertical: 'top',
  },
  submitBtn: {
    paddingVertical: 12,
    backgroundColor: '#5856D6',
    borderRadius: 8,
    alignItems: 'center',
  },
  submitLabel: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
});
