import React, { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
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
import { theme } from '../ui/theme';
import { useThemeVersion } from '../ui/useThemeStyleSheet';

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
  useThemeVersion();
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
  useThemeVersion();
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
      style={{ flex: 1, backgroundColor: theme.colors.bg }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: theme.layout.screenHorizontalPadding,
          paddingTop: 16,
          paddingBottom: 80,
        }}
      >
        <View
          style={{
            paddingBottom: 16,
            borderBottomWidth: StyleSheet.hairlineWidth,
            borderBottomColor: theme.colors.separator,
          }}
        >
          <Text
            accessibilityRole="header"
            style={{ fontSize: 20, fontWeight: '700', color: theme.colors.text, lineHeight: 26 }}
          >
            {quiz?.title ?? '課程評量'}
          </Text>
          {quiz?.description ? (
            <Text style={{ marginTop: 8, fontSize: 14, color: theme.colors.textSecondary, lineHeight: 22 }}>
              {quiz.description}
            </Text>
          ) : null}
          {overdue ? (
            <Text style={{ marginTop: 8, fontSize: 13, fontWeight: '600', color: theme.colors.danger }}>
              已截止
            </Text>
          ) : null}
        </View>

        {loading ? (
          <ActivityIndicator color={theme.colors.accent} style={{ marginTop: 24 }} accessibilityLabel="讀取評量" />
        ) : error ? (
          <View style={{ marginTop: 16, gap: 8 }}>
            <Text style={{ color: theme.colors.danger, lineHeight: 22 }}>{error}</Text>
            <Pressable
              onPress={() => void load()}
              accessibilityRole="button"
              style={({ pressed }) => ({
                alignSelf: 'flex-start',
                minHeight: 44,
                justifyContent: 'center',
                opacity: pressed ? 0.7 : 1,
              })}
            >
              <Text style={{ color: theme.colors.accent, fontWeight: '600', fontSize: 15 }}>重新讀取</Text>
            </Pressable>
          </View>
        ) : submittedAt ? (
          <View
            style={{
              marginTop: 16,
              backgroundColor: theme.colors.surface,
              borderRadius: theme.radius.lg,
              borderWidth: 1,
              borderColor: theme.colors.border,
              padding: 16,
              gap: 12,
            }}
          >
            <Text style={{ fontSize: 14, fontWeight: '700', color: theme.colors.success }}>已繳交</Text>
            {questions.length > 0 ? (
              questions.map((question, idx) => (
                <View
                  key={question.id}
                  style={{
                    paddingTop: idx === 0 ? 0 : 12,
                    borderTopWidth: idx === 0 ? 0 : StyleSheet.hairlineWidth,
                    borderTopColor: theme.colors.separator,
                  }}
                >
                  <Text style={{ color: theme.colors.textSecondary, lineHeight: 22 }}>
                    {question.prompt}
                    {'\n'}
                    {formatAnswer(answers[question.id])}
                  </Text>
                </View>
              ))
            ) : (
              <Text style={{ color: theme.colors.textSecondary, lineHeight: 22 }}>
                {freeText || '（無文字內容）'}
              </Text>
            )}
            {grade ? (
              <View
                accessibilityLabel="作業評分"
                style={{
                  marginTop: 4,
                  paddingTop: 12,
                  borderTopWidth: StyleSheet.hairlineWidth,
                  borderTopColor: theme.colors.separator,
                }}
              >
                <Text style={{ fontWeight: '700', color: theme.colors.text }}>
                  教師已評分：{grade.score}
                  {quiz?.points != null ? ` / ${quiz.points}` : ''} 分
                </Text>
                {grade.feedback ? (
                  <Text style={{ marginTop: 6, color: theme.colors.textSecondary, lineHeight: 20 }}>
                    {grade.feedback}
                  </Text>
                ) : null}
              </View>
            ) : null}
          </View>
        ) : (
          <View style={{ marginTop: 16, gap: 18 }}>
            {questions.length > 0 ? (
              questions.map((question, idx) => (
                <View
                  key={question.id}
                  style={{
                    paddingTop: idx === 0 ? 0 : 16,
                    borderTopWidth: idx === 0 ? 0 : StyleSheet.hairlineWidth,
                    borderTopColor: theme.colors.separator,
                  }}
                >
                  <QuestionField
                    question={question}
                    value={edits[question.id] ?? savedAnswers[question.id]}
                    disabled={submitting}
                    onChange={(value) => editAnswer(question.id, value)}
                  />
                </View>
              ))
            ) : (
              <View>
                <Text
                  style={{
                    fontSize: 14,
                    fontWeight: '600',
                    color: theme.colors.text,
                    marginBottom: 8,
                  }}
                >
                  作答內容
                </Text>
                <TextInput
                  value={freeText}
                  editable={!submitting}
                  onChangeText={(value) => editAnswer('response', value)}
                  placeholder="依教師說明作答"
                  placeholderTextColor={theme.colors.muted}
                  multiline
                  accessibilityLabel="作答內容"
                  style={{
                    backgroundColor: theme.colors.surface,
                    color: theme.colors.text,
                    borderRadius: theme.radius.md,
                    padding: 12,
                    minHeight: 140,
                    fontSize: 14,
                    textAlignVertical: 'top',
                    borderWidth: 1,
                    borderColor: theme.colors.border,
                  }}
                />
              </View>
            )}
            <Pressable
              onPress={handleSubmit}
              disabled={submitting}
              accessibilityRole="button"
              accessibilityLabel="繳交評量"
              style={({ pressed }) => ({
                minHeight: 48,
                justifyContent: 'center',
                alignItems: 'center',
                borderRadius: theme.radius.md,
                backgroundColor: theme.colors.accent,
                opacity: submitting || pressed ? 0.7 : 1,
              })}
            >
              {submitting ? (
                <ActivityIndicator color={theme.colors.onAccent} />
              ) : (
                <Text style={{ color: theme.colors.onAccent, fontWeight: '700', fontSize: 15 }}>
                  繳交評量
                </Text>
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
        <Text style={{ fontWeight: '600', fontSize: 15, color: theme.colors.text, marginBottom: 8 }}>
          {question.prompt}
        </Text>
        <TextInput
          editable={!disabled}
          value={selected}
          onChangeText={onChange}
          multiline={question.type === 'essay'}
          placeholderTextColor={theme.colors.muted}
          accessibilityLabel={question.prompt}
          style={{
            backgroundColor: theme.colors.surface,
            color: theme.colors.text,
            borderRadius: theme.radius.md,
            padding: 12,
            fontSize: 14,
            minHeight: question.type === 'essay' ? 120 : 44,
            textAlignVertical: 'top',
            borderWidth: 1,
            borderColor: theme.colors.border,
          }}
        />
      </View>
    );
  }
  return (
    <View>
      <Text style={{ fontWeight: '600', fontSize: 15, color: theme.colors.text, marginBottom: 8 }}>
        {question.prompt}
      </Text>
      <View style={{ gap: 8 }}>
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
              style={({ pressed }) => ({
                minHeight: 44,
                justifyContent: 'center',
                paddingHorizontal: 14,
                paddingVertical: 10,
                borderRadius: theme.radius.md,
                borderWidth: 1,
                borderColor: active ? theme.colors.accent : theme.colors.border,
                backgroundColor: active ? theme.colors.accentSoft : theme.colors.surface,
                opacity: pressed && !disabled ? 0.85 : 1,
              })}
            >
              <Text
                style={{
                  color: theme.colors.text,
                  fontSize: 14,
                  fontWeight: active ? '600' : '400',
                }}
              >
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export default QuizTakingScreen;
