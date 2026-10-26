import React, { useState } from 'react';
import { theme } from '../../ui/theme';
import { useThemeStyleSheet } from '../../ui/useThemeStyleSheet';
import { View, Text, TextInput, Pressable, ScrollView, Alert, StyleSheet } from 'react-native';
import { getSupabaseClient } from '../../services/supabaseClient';
import {
  submitAssignmentDraft,
  submitAssignmentFinal,
  readOwnAssignmentDraft,
} from '../../services/lmsV2WriteTools';
import {
  CourseV2Header,
  useCourseV2Params,
  useCourseV2Nav,
  useLoadable,
  CourseV2Loading,
  CourseV2Error,
} from './_courseV2Shell';

export default function CourseAssignmentDetailV2Screen() {
  const styles = useThemeStyleSheet(createStyles);
  const { courseId, assignmentId, courseName } = useCourseV2Params();
  const nav = useCourseV2Nav();
  const [content, setContent] = useState('');
  const [submitting, setSubmitting] = useState(false);


  const loadable = useLoadable(async () => {
    const sb = getSupabaseClient();
    if (!sb) throw new Error('LMS 服務尚未連線，請確認設定後重試。');
    if (!courseId || !assignmentId) throw new Error('缺少作業資訊，請返回課程重新選擇。');

    const { data: identity, error: identityError } = await sb.auth.getUser();
    if (identityError || !identity?.user?.id) throw new Error('登入狀態已失效，請重新登入 LMS。');
    const userId = String(identity.user.id);

    const { data: assignment, error: assignmentError } = await sb.from('assignments')
      .select('id, title, description, due_at, max_points')
      .eq('id', assignmentId).eq('course_id', courseId).maybeSingle();
    if (assignmentError) throw assignmentError;
    if (!assignment) throw new Error('找不到這份作業，或目前沒有存取權限。');

    const { data: ownSub, error: submissionError } = await sb.from('submissions')
      .select('id, body_text, submitted_at, grade, feedback, graded_at')
      .eq('assignment_id', assignmentId).eq('student_id', userId).maybeSingle();
    if (submissionError) throw submissionError;

    const draft = await readOwnAssignmentDraft({ courseId, assignmentId });
    const newerDraft = draft && (!ownSub?.submitted_at ||
      Date.parse(draft.savedAt) > Date.parse(ownSub.submitted_at));
    setContent(newerDraft ? draft.text : (ownSub?.body_text ?? ''));
    return { assignment, ownSub };
  });

  const handleSubmit = async (final: boolean) => {
    if (!courseId || !assignmentId || submitting || loadable.data?.ownSub?.graded_at) return;
    setSubmitting(true);
    try {
      const action = final ? submitAssignmentFinal : submitAssignmentDraft;
      const result = await action({ courseId, assignmentId, contentText: content });
      if (result.success && final) await loadable.refresh();
      Alert.alert(result.success ? (final ? '作業已繳交' : '草稿已保存') : '尚未完成', result.summary);
    } catch {
      Alert.alert('尚未完成', '操作沒有取得確認，請保留目前內容並重試。');
    } finally {
      setSubmitting(false);
    }
  };

  const handleAIHelp = () => {
    nav.navigate('AIAgentConsole', {
      seed: `協助我理解「${loadable.data?.assignment?.title ?? '這份作業'}」的要求，先不要幫我繳交。`,
      courseId,
    });
  };

  if (loadable.loading) return <CourseV2Loading />;
  if (loadable.error) return <CourseV2Error error={loadable.error} onRetry={loadable.refresh} />;
  const a = loadable.data?.assignment;
  const sub = loadable.data?.ownSub;


  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.bg }}>
      <CourseV2Header title={a?.title ?? '作業'} subtitle={courseName}
        rightAction={{ label: '學習協助', onPress: handleAIHelp }} />
      <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
        {a?.description ? <Text style={styles.body}>{a.description}</Text> : null}
        {sub?.submitted_at ? (
          <Text style={styles.receipt}>伺服器繳交紀錄：{new Date(sub.submitted_at).toLocaleString('zh-TW')}</Text>
        ) : null}
        {sub?.graded_at && sub?.grade != null ? (
          <View style={styles.scoreBox}>
            <Text style={styles.score}>分數：{sub.grade}</Text>
            {sub.feedback ? <Text style={styles.feedback}>{sub.feedback}</Text> : null}
          </View>
        ) : null}
        <Text style={styles.label}>我的作業內容</Text>
        <TextInput style={styles.input} multiline value={content} onChangeText={setContent}
          placeholder="在這裡編輯作業內容" editable={!sub?.graded_at && !submitting}
          accessibilityLabel="作業內容" />
        {sub?.graded_at ? (
          <Text style={styles.receipt}>老師已批改這份作業，請先聯絡老師確認重新繳交方式。</Text>
        ) : (
          <>
            <Text style={styles.draftNote}>
              「存草稿」僅保存在這台裝置。只有「送出作業」收到伺服器確認後，才算完成繳交。
            </Text>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Pressable accessibilityRole="button"
                style={[styles.btn, { backgroundColor: theme.colors.surface2 }]}
                disabled={submitting} onPress={() => void handleSubmit(false)}>
                <Text style={[styles.btnLabel, { color: theme.colors.text }]}>
                  {submitting ? '處理中…' : '存草稿'}
                </Text>
              </Pressable>
              <Pressable accessibilityRole="button"
                style={[styles.btn, { backgroundColor: theme.colors.accent }]}
                disabled={submitting || !content.trim()} onPress={() => void handleSubmit(true)}>
                <Text style={styles.btnLabel}>{submitting ? '確認中…' : '送出作業'}</Text>
              </Pressable>
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const createStyles = () => StyleSheet.create({
  body: { fontSize: 14, lineHeight: 20, color: theme.colors.textSecondary },
  label: { fontSize: 13, fontWeight: '600', color: theme.colors.textSecondary },
  receipt: { fontSize: 13, lineHeight: 20, color: theme.colors.text },
  draftNote: { fontSize: 12, lineHeight: 19, color: theme.colors.muted },
  input: {
    color: theme.colors.text,
    minHeight: 160,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
    padding: 12,
    backgroundColor: theme.colors.surface,
    textAlignVertical: 'top',
  },
  btn: {
    minHeight: 44,
    justifyContent: 'center',
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
  },
  btnLabel: { color: theme.colors.onAccent, fontWeight: '600' },
  scoreBox: {
    padding: 12,
    backgroundColor: theme.colors.successSoft,
    borderRadius: 8,
    borderColor: theme.colors.success,
    borderWidth: StyleSheet.hairlineWidth,
  },
  score: { fontSize: 18, fontWeight: '700', color: theme.colors.text },
  feedback: { marginTop: 4, color: theme.colors.text, fontSize: 13 },
});
