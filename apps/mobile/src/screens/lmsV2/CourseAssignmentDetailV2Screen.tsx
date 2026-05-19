import React, { useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, Alert, StyleSheet } from 'react-native';
import { getSupabaseClient } from '../../services/supabaseClient';
import {
  submitAssignmentDraft,
  submitAssignmentFinal,
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
  const { courseId, assignmentId, courseName } = useCourseV2Params();
  const nav = useCourseV2Nav();
  const [content, setContent] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const loadable = useLoadable(async () => {
    const sb = getSupabaseClient();
    if (!sb) return null;
    const { data: assignment } = await sb
      .from('assignments')
      .select('id, title, description, due_at, max_points')
      .eq('id', assignmentId)
      .maybeSingle();
    const { data: ownSub } = await sb
      .from('submissions')
      .select('id, body_text, submitted_at, grade, feedback, graded_at')
      .eq('assignment_id', assignmentId)
      .maybeSingle();
    if (ownSub?.body_text) setContent(ownSub.body_text);
    return { assignment, ownSub };
  });

  const handleSubmit = async (final: boolean) => {
    if (!assignmentId) return;
    setSubmitting(true);
    const fn = final ? submitAssignmentFinal : submitAssignmentDraft;
    const r = await fn({ courseId: courseId!, assignmentId, contentText: content });
    setSubmitting(false);
    Alert.alert(r.success ? '完成' : '失敗', r.summary);
    if (r.success && final) nav.goBack();
  };

  const handleAIHelp = () => {
    nav.navigate('AIChat', {
      seed: `幫我針對「${loadable.data?.assignment?.title ?? '這份作業'}」起一段大約 200 字的草稿`,
      courseId,
    });
  };

  if (loadable.loading) return <CourseV2Loading />;
  if (loadable.error) return <CourseV2Error error={loadable.error} onRetry={loadable.refresh} />;
  const a = loadable.data?.assignment;
  const sub = loadable.data?.ownSub;

  return (
    <View style={{ flex: 1, backgroundColor: '#F2F2F7' }}>
      <CourseV2Header
        title={a?.title ?? '作業'}
        subtitle={courseName}
        rightAction={{ label: 'AI 協助', onPress: handleAIHelp }}
      />
      <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
        {a?.description ? <Text style={styles.body}>{a.description}</Text> : null}
        {sub?.graded_at && sub?.grade != null ? (
          <View style={styles.scoreBox}>
            <Text style={styles.score}>分數:{sub.grade}</Text>
            {sub.feedback ? <Text style={styles.feedback}>{sub.feedback}</Text> : null}
          </View>
        ) : null}
        <Text style={styles.label}>我的繳交內容</Text>
        <TextInput
          style={styles.input}
          multiline
          value={content}
          onChangeText={setContent}
          placeholder="在這裡輸入..."
          editable={!sub?.graded_at}
        />
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Pressable
            style={[styles.btn, { backgroundColor: '#AEAEB2' }]}
            disabled={submitting}
            onPress={() => handleSubmit(false)}
          >
            <Text style={styles.btnLabel}>存草稿</Text>
          </Pressable>
          <Pressable
            style={[styles.btn, { backgroundColor: '#5856D6' }]}
            disabled={submitting}
            onPress={() => handleSubmit(true)}
          >
            <Text style={styles.btnLabel}>送出作業</Text>
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  body: { fontSize: 14, lineHeight: 20, color: '#3C3C43' },
  label: { fontSize: 13, fontWeight: '600', color: '#3C3C43' },
  input: {
    minHeight: 160,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#E5E5EA',
    padding: 12,
    backgroundColor: '#FFFFFF',
    textAlignVertical: 'top',
  },
  btn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
  },
  btnLabel: { color: '#FFFFFF', fontWeight: '600' },
  scoreBox: {
    padding: 12,
    backgroundColor: '#ECFDF5',
    borderRadius: 8,
    borderColor: '#34C759',
    borderWidth: StyleSheet.hairlineWidth,
  },
  score: { fontSize: 18, fontWeight: '700', color: '#065F46' },
  feedback: { marginTop: 4, color: '#065F46', fontSize: 13 },
});
