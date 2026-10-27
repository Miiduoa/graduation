import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, ScrollView, Alert, StyleSheet } from 'react-native';
import { theme } from '../../ui/theme';
import { useThemeStyleSheet } from '../../ui/useThemeStyleSheet';
import {
  loadLmsQuizWorkspace, beginLmsQuizAttempt, storeLmsQuizAnswer, finishLmsQuizAttempt,
} from '../../services/lmsV2QuizDelivery';
import { quizOptions, type QuizAnswerInput } from '../../services/lmsV2QuizModels';
import { QuizQuestionEditor } from './QuizQuestionEditor';
import {
  CourseV2Header, useCourseV2Params, useLoadable, CourseV2Loading, CourseV2Error,
} from './_courseV2Shell';

export default function CourseQuizTakingV2Screen() {
  const styles = useThemeStyleSheet(createStyles);
  const { courseId, quizId, courseName } = useCourseV2Params();
  const loadable = useLoadable(() => loadLmsQuizWorkspace(courseId, quizId!));
  const [drafts, setDrafts] = useState<Record<string, QuizAnswerInput>>({});
  const [saved, setSaved] = useState<Record<string, QuizAnswerInput>>({});
  const [sessionKey, setSessionKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [now, setNow] = useState(Date.now());
  const busyRef = useRef(false);

  const session = loadable.data;
  const attempt = session?.attempt;
  const currentKey = attempt ? attempt.id + ':' + (attempt.submitted_at ?? '') : '';
  useEffect(() => {
    if (session && sessionKey !== currentKey) {
      setDrafts({});
      setSaved(session.answers);
      setSessionKey(currentKey);
      setMessage('');
    }
  }, [currentKey, sessionKey, session]);
  useEffect(() => {
    if (!attempt || attempt.submitted_at) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [attempt?.id, attempt?.submitted_at]);

  const valueOf = (questionId: string): QuizAnswerInput =>
    Object.prototype.hasOwnProperty.call(drafts, questionId)
      ? drafts[questionId]
      : (saved[questionId] ?? null);

  const changed = session?.questions.filter((question) =>
    JSON.stringify(valueOf(question.id)) !== JSON.stringify(saved[question.id] ?? null)) ?? [];
  const active = !!attempt && !attempt.submitted_at;
  const unsupported = session?.questions.some((q) =>
    !['single', 'multiple', 'boolean', 'short', 'essay'].includes(q.question_type) ||
    (['single', 'multiple'].includes(q.question_type) && quizOptions(q.choices).length === 0)
  ) ?? false;
  const totalAllowed = session?.quiz.max_attempts ?? 1;

  const begin = async () => {
    if (busyRef.current || !quizId || !courseId) return;
    busyRef.current = true;
    setBusy(true);
    setMessage('');
    try {
      const result = await beginLmsQuizAttempt({ courseId, quizId });
      if (!result.success) {
        setMessage(result.summary);
        return;
      }
      await loadable.refresh();
      setMessage(result.summary);
    } catch {
      setMessage('目前無法確認測驗狀態，請重新整理再試。');
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const persist = async (submit: boolean) => {
    if (!attempt || busyRef.current || !active || !session) return;
    busyRef.current = true;
    setBusy(true);
    setMessage('');
    try {
      for (const question of changed) {
        const next = valueOf(question.id);
        const result = await storeLmsQuizAnswer({
          attemptId: attempt.id, questionId: question.id, answer: next,
        });
        if (!result.success) {
          setMessage('第 ' + (session.questions.indexOf(question) + 1) + ' 題沒有儲存成功：' + result.summary);
          return;
        }
        setSaved((current) => ({ ...current, [question.id]: next }));
        setDrafts((current) => {
          const remaining = { ...current };
          delete remaining[question.id];
          return remaining;
        });
      }
      if (!submit) {
        setMessage('所有變更已由伺服器確認儲存；尚未交卷。');
        return;
      }
      const result = await finishLmsQuizAttempt({ attemptId: attempt.id });
      if (!result.success) {
        setMessage(result.summary);
        return;
      }
      setMessage(result.summary);
      await loadable.refresh();
      Alert.alert('交卷已確認', result.summary);
    } catch {
      setMessage('未取得完整確認。請保留作答內容並重新讀取，避免重複操作。');
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const confirmSubmit = () => {
    if (!active || busyRef.current) return;
    Alert.alert('確認交卷', '交卷前會先儲存變更。正式交卷後，這次作答不能再修改。', [
      { text: '繼續作答', style: 'cancel' },
      { text: '確認交卷', onPress: () => void persist(true) },
    ]);
  };

  if (loadable.loading && !session) return <CourseV2Loading label="正在核對測驗及作答紀錄…" />;
  if (loadable.error) return <CourseV2Error error={loadable.error} onRetry={loadable.refresh} />;
  if (!session) return <CourseV2Loading />;
  const { quiz, questions } = session;
  const elapsed = attempt ? Math.max(0, Math.floor((now - Date.parse(attempt.started_at)) / 1000)) : 0;
  const limit = quiz.enforce_time_limit ? quiz.time_limit_seconds : null;
  const remaining = typeof limit === 'number' ? Math.max(0, limit - elapsed) : null;
  const hasMoreAttempts = session.attemptCount < totalAllowed;

  return (
    <View style={styles.page}>
      <CourseV2Header title={quiz.title} subtitle={courseName} />
      <ScrollView contentContainerStyle={styles.content}>
        {quiz.description ? <Text style={styles.description}>{quiz.description}</Text> : null}
        <View style={styles.info}>
          <Text style={styles.infoTitle}>作答規則</Text>
          <Text style={styles.infoDetail}>
            最多 {totalAllowed} 次 · 已開始 {session.attemptCount} 次
            {quiz.time_limit_seconds ? ' · 每次 ' + Math.ceil(quiz.time_limit_seconds / 60) + ' 分鐘' : ' · 未設定時間限制'}
          </Text>
          <Text style={styles.infoDetail}>開啟頁面不會占用作答次數；請按下開始作答。</Text>
        </View>

        {attempt?.submitted_at ? (
          <View style={styles.receipt}>
            <Text style={styles.receiptTitle}>本次測驗已交卷</Text>
            <Text style={styles.receiptDetail}>
              伺服器繳交時間：{new Date(attempt.submitted_at).toLocaleString('zh-TW')}
            </Text>
            <Text style={styles.receiptDetail}>
              目前登記分數：{attempt.score ?? '尚未提供'}
            </Text>
            <Text style={styles.infoDetail}>如含申論題，分數仍可能待教師評閱調整。</Text>
          </View>
        ) : null}

        {!active && hasMoreAttempts && (
          <Pressable accessibilityRole="button" style={styles.primary}
            disabled={busy} onPress={() => void begin()}>
            <Text style={styles.primaryText}>{busy ? '正在確認…' : attempt ? '開始下一次作答' : '開始作答'}</Text>
          </Pressable>
        )}
        {!active && !hasMoreAttempts && (
          <Text style={styles.infoDetail}>已使用本測驗所有作答機會。若需補考，請洽授課教師。</Text>
        )}

        {active && (
          <>
            <View style={styles.info}>
              <Text style={styles.infoTitle}>第 {attempt.attempt_no} 次作答</Text>
              <Text style={styles.infoDetail}>
                {remaining === null ? '未設定倒數' : remaining === 0
                  ? '作答時間可能已結束；是否能交卷以伺服器為準'
                  : '參考剩餘時間 ' + Math.floor(remaining / 60) + ':' + String(remaining % 60).padStart(2, '0')}
              </Text>
              <Text style={styles.infoDetail}>已存答案可在重新進入時恢復；未儲存的文字尚未送到伺服器。</Text>
            </View>
            {questions.length === 0 && (
              <Text style={styles.warning}>這次作答沒有可讀取的題目，請聯絡授課教師。系統不會替你交空白試卷。</Text>
            )}
            {questions.map((question, index) => (
              <QuizQuestionEditor
                key={question.id}
                question={question}
                number={index + 1}
                value={valueOf(question.id)}
                disabled={busy}
                onChange={(next) => setDrafts((current) => ({ ...current, [question.id]: next }))}
              />
            ))}
            {!!questions.length && !unsupported && (
              <View style={styles.actions}>
                <Pressable accessibilityRole="button" style={styles.secondary}
                  disabled={busy} onPress={() => void persist(false)}>
                  <Text style={styles.secondaryText}>
                    {busy ? '確認中…' : changed.length ? '儲存變更（' + changed.length + ' 題）' : '答案已儲存'}
                  </Text>
                </Pressable>
                <Pressable accessibilityRole="button" style={styles.primary}
                  disabled={busy} onPress={confirmSubmit}>
                  <Text style={styles.primaryText}>{busy ? '處理中…' : '確認交卷'}</Text>
                </Pressable>
              </View>
            )}
            {unsupported && <Text style={styles.warning}>部分題型目前無法正確處理，已停止交卷，請聯絡老師。</Text>}
          </>
        )}
        {!!message && <Text accessibilityRole="alert" style={styles.message}>{message}</Text>}
      </ScrollView>
    </View>
  );
}

const createStyles = () => StyleSheet.create({
  page: { flex: 1, backgroundColor: theme.colors.bg },
  content: { padding: 16, paddingBottom: 64, gap: 16 },
  description: { color: theme.colors.text, fontSize: 14, lineHeight: 22 },
  info: {
    padding: 14, borderRadius: 10, borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border, backgroundColor: theme.colors.surface, gap: 7,
  },
  infoTitle: { color: theme.colors.text, fontSize: 15, fontWeight: '700' },
  infoDetail: { color: theme.colors.muted, fontSize: 13, lineHeight: 21 },
  receipt: { padding: 14, borderRadius: 10, backgroundColor: theme.colors.successSoft, gap: 8 },
  receiptTitle: { color: theme.colors.text, fontSize: 16, fontWeight: '700' },
  receiptDetail: { color: theme.colors.text, fontSize: 13, lineHeight: 21 },
  actions: { gap: 10 },
  primary: {
    backgroundColor: theme.colors.accent, minHeight: 48, borderRadius: 10,
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14, paddingVertical: 12,
  },
  primaryText: { color: theme.colors.onAccent, fontSize: 15, fontWeight: '700' },
  secondary: {
    borderWidth: StyleSheet.hairlineWidth, borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface, minHeight: 48, borderRadius: 10,
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14, paddingVertical: 12,
  },
  secondaryText: { color: theme.colors.text, fontWeight: '600', fontSize: 14 },
  message: { color: theme.colors.text, fontSize: 13, lineHeight: 21 },
  warning: { color: theme.colors.danger, fontSize: 13, lineHeight: 21 },
});
