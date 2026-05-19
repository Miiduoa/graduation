import React, { useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, Alert, StyleSheet } from 'react-native';
import { getSupabaseClient } from '../../services/supabaseClient';
import { postForumReply } from '../../services/lmsV2WriteTools';
import {
  CourseV2Header,
  useCourseV2Params,
  useLoadable,
  CourseV2Loading,
  CourseV2Error,
} from './_courseV2Shell';

export default function CourseForumTopicV2Screen() {
  const { courseId, topicId, courseName } = useCourseV2Params();
  const [reply, setReply] = useState('');
  const [posting, setPosting] = useState(false);

  const loadable = useLoadable(async () => {
    const sb = getSupabaseClient();
    if (!sb) return { topic: null, posts: [] };
    const { data: topic } = await sb
      .from('forum_topics')
      .select('id, title')
      .eq('id', topicId)
      .maybeSingle();
    const { data: posts } = await sb
      .from('forum_posts')
      .select('id, body, body_html, author_id, parent_post_id, created_at, deleted_at')
      .eq('topic_id', topicId)
      .order('created_at', { ascending: true })
      .limit(200);
    return { topic, posts: (posts ?? []).filter((p: any) => !p.deleted_at) };
  });

  const handlePost = async () => {
    if (!reply.trim() || !topicId) return;
    setPosting(true);
    const r = await postForumReply({ courseId: courseId!, topicId, body: reply });
    setPosting(false);
    if (r.success) {
      setReply('');
      loadable.refresh();
    } else {
      Alert.alert('發文失敗', r.summary);
    }
  };

  if (loadable.loading) return <CourseV2Loading />;
  if (loadable.error) return <CourseV2Error error={loadable.error} onRetry={loadable.refresh} />;
  const { topic, posts } = loadable.data!;

  return (
    <View style={{ flex: 1, backgroundColor: '#F2F2F7' }}>
      <CourseV2Header title={topic?.title ?? '討論串'} subtitle={courseName} />
      <ScrollView contentContainerStyle={{ padding: 12, gap: 10 }}>
        {posts.map((p: any) => (
          <View key={p.id} style={styles.post}>
            <Text style={styles.author}>{String(p.author_id).slice(0, 8)}</Text>
            <Text style={styles.body}>{p.body}</Text>
            <Text style={styles.time}>{new Date(p.created_at).toLocaleString()}</Text>
          </View>
        ))}
        {posts.length === 0 ? <Text style={{ color: '#8E8E93' }}>尚無回覆</Text> : null}
      </ScrollView>
      <View style={styles.composer}>
        <TextInput
          style={styles.input}
          value={reply}
          onChangeText={setReply}
          placeholder="輸入回覆..."
          multiline
        />
        <Pressable
          style={[styles.send, !reply.trim() && { opacity: 0.5 }]}
          disabled={!reply.trim() || posting}
          onPress={handlePost}
        >
          <Text style={styles.sendLabel}>送出</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  post: {
    backgroundColor: '#FFFFFF',
    padding: 12,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#E5E5EA',
  },
  author: { fontSize: 12, fontWeight: '600', color: '#3C3C43' },
  body: { fontSize: 14, lineHeight: 20, marginTop: 4 },
  time: { fontSize: 11, color: '#AEAEB2', marginTop: 6 },
  composer: {
    flexDirection: 'row',
    padding: 12,
    gap: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: '#E5E5EA',
    backgroundColor: '#FFFFFF',
  },
  input: {
    flex: 1,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#E5E5EA',
    borderRadius: 8,
    padding: 8,
    maxHeight: 100,
  },
  send: { paddingHorizontal: 16, justifyContent: 'center', backgroundColor: '#5856D6', borderRadius: 8 },
  sendLabel: { color: '#FFFFFF', fontWeight: '600' },
});
