import React, { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useAuth } from '../state/auth';
import { useSchool } from '../state/school';
import { useUnsavedQuizExit } from '../hooks/useUnsavedQuizExit';
import { useDataSource } from '../hooks/useDataSource';
import type { Question, Quiz, Submission } from '../data/types';
import { publishedAssignmentGrade } from '../data/assignmentGrade';

type RouteProps = {
  route?: {
    params?: {
      groupId?: string;
      courseSpaceId?: string;
      courseId?: string;
      quizId?: string;
      assignmentId?: string;
      hwId?: string;
    };
  };
};

function asText(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

export function QuizTakingScreen(props: RouteProps) {
  const auth = useAuth();
  const { school } = useSchool();
  const params = props.route?.params ?? {};
  const groupId = asText(params.groupId || params.courseSpaceId || params.courseId);
  const quizId = asText(params.quizId || params.assignmentId || params.hwId);
  const uid = auth.user?.uid ?? '';
  const schoolId = auth.profile?.schoolId;
  return (
    <QuizAttempt
      key={JSON.stringify([uid, school.id, schoolId, groupId, quizId])}
      uid={uid}
      schoolId={schoolId}
      groupId={groupId}
      quizId={quizId}
    />
  );
}

function QuizAttempt({ uid, schoolId, groupId, quizId }: {
  uid: string;
  schoolId?: string;
  groupId: string;
  quizId: string;
}) {
  const navigation = useNavigation();
  const ds = useDataSource();
  const mounted = useRef(false);
  const readVersion = useRef(0);
  const sending = useRef(false);
  useLayoutEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [quiz, setQuiz] = useState<Quiz | null>(null);
  const [savedAnswers, setSavedAnswers] = useState<Record<string, string | string[]>>({});
  const [savedText, setSavedText] = useState('');
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [submittedAt, setSubmittedAt] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [grade, setGrade] = useState(publishedAssignmentGrade(null));

  const load = useCallback(async () => {
    if (sending.current) return;
    const version = ++readVersion.current;
    const current = () => mounted.current && version === readVersion.current;
    setLoading(true);
    setError('');
    try {
      if (!groupId || !quizId) throw new Error('找不到這份評量。');
      if (!uid) throw new Error('請先登入。');
      const [row, submission] = await Promise.all([
        ds.getQuiz(quizId, uid, groupId, schoolId),
        ds.getSubmission(quizId, uid, groupId) as Promise<Submission | null>,
      ]);
      if (!current()) return;
      if (!row) throw new Error('找不到這份評量，或你尚未加入這門課。');
      setQuiz(row);
      const already = asText(submission?.submittedAt) || null;
      setSubmittedAt(already);
      setGrade(publishedAssignmentGrade(submission as unknown as Record<string, unknown>));
      const recordedAnswers = (submission as { answers?: Record<string, string | string[]> } | null)
        ?.answers;
      setSavedAnswers(recordedAnswers && typeof recordedAnswers === 'object' ? recordedAnswers : {});
      setSavedText(asText(submission?.content));
      if (already) setEdits({});
    } catch (e) {
      if (current()) setError(String((e as Error)?.message ?? e));
    } finally {
      if (current()) setLoading(false);
    }
  }, [ds, groupId, quizId, schoolId, uid]);

  useFocusEffect(
    useCallback(() => {
      void load();
      return () => { readVersion.current++; };
    }, [load]),
  );

  const questions = quiz?.questions ?? [];
  const answers: Record<string, string | string[]> = {};
  for (const { id } of questions) {
    const value = edits[id] ?? savedAnswers[id];
    if (Array.isArray(value) ? value.length : value?.trim()) answers[id] = value;
  }
  const freeText = edits.response ?? savedText;
  const dirty = questions.length
    ? questions.some(({ id }) => edits[id] !== undefined && edits[id] !== (savedAnswers[id] ?? ''))
    : freeText !== savedText;
  useUnsavedQuizExit(!submittedAt && dirty, submitting, edits);
  const overdue = useMemo(() => {
    if (!quiz?.dueAt) return false;
    const due = quiz.dueAt instanceof Date ? quiz.dueAt : new Date(quiz.dueAt);
    return Number.isFinite(due.getTime()) && due.getTime() < Date.now();
  }, [quiz]);

  const editAnswer = (questionId: string, value: string) => {
    if (sending.current) return;
    const original = questions.length ? savedAnswers[questionId] ?? '' : savedText;
    setEdits((current) => {
      if (value !== original) return { ...current, [questionId]: value };
      const next = { ...current };
      delete next[questionId];
      return next;
    });
  };

  const handleSubmit = async () => {
    if (sending.current || submittedAt || loading || error) return;
    const payload =
      questions.length > 0
        ? answers
        : freeText.trim()
          ? { response: freeText.trim() }
          : {};
    if (Object.keys(payload).length === 0) {
      Alert.alert('請先作答', '請輸入作答內容再送出。');
      return;
    }
    sending.current = true;
    setSubmitting(true);
    try {
      const receipt = await ds.submitQuiz({
        courseSpaceId: groupId,
        quizId,
        userId: uid,
        content: questions.length > 0 ? '' : freeText.trim(),
        answers: payload,
      });
      if (!mounted.current) return;
      setSubmittedAt(receipt.submittedAt);
      if (navigation.isFocused()) {
        Alert.alert('已繳交', '這份評量已寫入與作業相同的繳交紀錄。', [
          { text: '返回', onPress: () => {
            if (mounted.current && navigation.isFocused()) navigation.goBack();
          } },
        ]);
      }
    } catch (e) {
      if (mounted.current && navigation.isFocused()) Alert.alert('送出失敗', String((e as Error)?.message ?? e));
    } finally {
      sending.current = false;
      if (mounted.current) setSubmitting(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: '#F2F2F7' }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 80 }}>
        <Text style={{ fontSize: 18, fontWeight: '700', color: '#1C1C1E' }}>
          {quiz?.title ?? '課程評量'}
        </Text>
        {quiz?.description ? (
          <Text style={{ marginTop: 8, fontSize: 14, color: '#3C3C43', lineHeight: 22 }}>
            {quiz.description}
          </Text>
        ) : null}
        {overdue ? (
          <Text style={{ marginTop: 8, color: '#D70015' }}>已截止</Text>
        ) : null}

        {loading ? (
          <ActivityIndicator color="#003F8A" style={{ marginTop: 24 }} accessibilityLabel="讀取評量" />
        ) : error ? (
          <View style={{ marginTop: 16 }}>
            <Text style={{ color: '#D70015', lineHeight: 22 }}>{error}</Text>
            <Pressable onPress={() => void load()} style={{ marginTop: 12 }}>
              <Text style={{ color: '#003F8A', fontWeight: '600' }}>重新讀取</Text>
            </Pressable>
          </View>
        ) : submittedAt ? (
          <View style={{ marginTop: 16 }}>
            <Text style={{ fontSize: 14, fontWeight: '600', color: '#1C1C1E' }}>已繳交</Text>
            {questions.length > 0 ? (
              questions.map((question) => (
                <Text key={question.id} style={{ marginTop: 8, color: '#3C3C43', lineHeight: 22 }}>
                  {question.prompt}
                  {'\n'}
                  {formatAnswer(answers[question.id])}
                </Text>
              ))
            ) : (
              <Text style={{ marginTop: 8, color: '#3C3C43', lineHeight: 22 }}>
                {freeText || '（無文字內容）'}
              </Text>
            )}
            {grade ? (
              <View accessibilityLabel="作業評分" style={{ marginTop: 16 }}>
                <Text style={{ fontWeight: '700' }}>
                  教師已評分：{grade.score}
                  {quiz?.points != null ? ` / ${quiz.points}` : ''} 分
                </Text>
                {grade.feedback ? (
                  <Text style={{ marginTop: 6, color: '#3C3C43' }}>{grade.feedback}</Text>
                ) : null}
              </View>
            ) : null}
          </View>
        ) : (
          <View style={{ marginTop: 16, gap: 16 }}>
            {questions.length > 0 ? (
              questions.map((question) => (
                <QuestionField
                  key={question.id}
                  question={question}
                  value={edits[question.id] ?? savedAnswers[question.id]}
                  disabled={submitting}
                  onChange={(value) => editAnswer(question.id, value)}
                />
              ))
            ) : (
              <View>
                <Text style={{ fontSize: 14, fontWeight: '600', marginBottom: 6 }}>作答內容</Text>
                <TextInput
                  value={freeText}
                  editable={!submitting}
                  onChangeText={(value) => editAnswer('response', value)}
                  placeholder="依教師說明作答"
                  multiline
                  accessibilityLabel="作答內容"
                  style={{
                    backgroundColor: '#fff',
                    borderRadius: 12,
                    padding: 12,
                    minHeight: 140,
                    textAlignVertical: 'top',
                    borderWidth: 1,
                    borderColor: '#E5E5EA',
                  }}
                />
              </View>
            )}
            <Pressable
              onPress={handleSubmit}
              disabled={submitting}
              accessibilityRole="button"
              accessibilityLabel="繳交評量"
              style={{
                padding: 14,
                borderRadius: 12,
                backgroundColor: '#003F8A',
                alignItems: 'center',
                opacity: submitting ? 0.6 : 1,
              }}
            >
              {submitting ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={{ color: '#fff', fontWeight: '700' }}>繳交評量</Text>
              )}
            </Pressable>
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function formatAnswer(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value.join('、') || '（未作答）';
  return value?.trim() || '（未作答）';
}

function QuestionField({
  question,
  value,
  disabled,
  onChange,
}: {
  question: Question;
  value: string | string[] | undefined;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  const selected = typeof value === 'string' ? value : '';
  if (question.type === 'short_answer' || question.type === 'essay') {
    return (
      <View>
        <Text style={{ fontWeight: '600', marginBottom: 6 }}>{question.prompt}</Text>
        <TextInput
          editable={!disabled}
          value={selected}
          onChangeText={onChange}
          multiline={question.type === 'essay'}
          accessibilityLabel={question.prompt}
          style={{
            backgroundColor: '#fff',
            borderRadius: 12,
            padding: 12,
            minHeight: question.type === 'essay' ? 120 : 44,
            textAlignVertical: 'top',
            borderWidth: 1,
            borderColor: '#E5E5EA',
          }}
        />
      </View>
    );
  }
  return (
    <View>
      <Text style={{ fontWeight: '600', marginBottom: 6 }}>{question.prompt}</Text>
      {(question.options ?? []).map((option) => {
        const active = selected === option.value;
        return (
          <Pressable
            key={option.id}
            disabled={disabled}
            accessibilityState={{ disabled, selected: active }}
            onPress={() => onChange(option.value)}
            accessibilityRole="button"
            accessibilityLabel={option.label}
            style={{
              marginTop: 6,
              padding: 12,
              borderRadius: 10,
              borderWidth: 1,
              borderColor: active ? '#003F8A' : '#E5E5EA',
              backgroundColor: active ? '#E8F1FF' : '#fff',
            }}
          >
            <Text style={{ color: '#1C1C1E' }}>{option.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export default QuizTakingScreen;
