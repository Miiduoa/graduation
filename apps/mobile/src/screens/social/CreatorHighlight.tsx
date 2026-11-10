import React, { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useThemeStyleSheet } from '../../ui/useThemeStyleSheet';
import { theme } from '../../ui/theme';
import type { CampusPostDoc } from '../../services/feed';
import {
  featureCreatorPost,
  readCreatorHighlight,
  removeCreatorHighlight,
  type CreatorHighlight as Highlight,
} from '../../services/creatorHighlight';

type ReadState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; value: Highlight | null };

export function CreatorHighlight({
  schoolId, memberUid, own, candidates, openPost,
}: {
  schoolId: string;
  memberUid: string;
  own: boolean;
  candidates: CampusPostDoc[];
  openPost: (postId: string) => void;
}) {
  const styles = useThemeStyleSheet(createStyles);
  const [state, setState] = useState<ReadState>({ status: 'loading' });
  const [revision, setRevision] = useState(0);
  const [choice, setChoice] = useState('');
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState('');
  const mounted = useRef(false);
  const lock = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    let active = true;
    setState({ status: 'loading' });
    setFeedback('');
    void readCreatorHighlight(schoolId, memberUid).then(
      (result) => { if (active) setState({ status: 'ready', value: result }); },
      () => { if (active) setState({ status: 'error' }); },
    );
    return () => { active = false; };
  }, [schoolId, memberUid, revision]);

  const eligible = candidates.filter((post) =>
    post.schoolId === schoolId && post.authorUid === memberUid && post.anonymous === false,
  );
  const selected = eligible.find((post) => post.id === choice);
  const highlighted = state.status === 'ready' ? state.value : null;

  async function update(nextId: string | null) {
    if (!own || lock.current || state.status !== 'ready') return;
    if (nextId && !eligible.some((post) => post.id === nextId)) return;
    lock.current = true;
    setBusy(true);
    setFeedback('');
    try {
      if (nextId) {
        const confirmed = await featureCreatorPost(schoolId, memberUid, nextId);
        if (mounted.current) {
          setState({ status: 'ready', value: confirmed });
          setChoice('');
          setFeedback('精選作品已更新。');
        }
      } else {
        await removeCreatorHighlight(schoolId, memberUid);
        if (mounted.current) {
          setState({ status: 'ready', value: null });
          setFeedback('已取消精選。');
        }
      }
    } catch {
      if (mounted.current) {
        setState({ status: 'error' });
        setFeedback('尚未確認變更結果，請重新讀取後再操作。');
      }
    } finally {
      lock.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  if (state.status === 'loading') {
    return own ? <Text style={styles.note}>正在確認精選作品…</Text> : null;
  }

  if (state.status === 'error') {
    return (
      <View style={styles.wrapper}>
        <Text accessibilityRole="alert" style={styles.note}>{feedback || '精選作品暫時無法確認。'}</Text>
        <Pressable accessibilityRole="button" style={styles.button}
          onPress={() => setRevision((n) => n + 1)}>
          <Text style={styles.buttonText}>重新讀取</Text>
        </Pressable>
      </View>
    );
  }

  if (!own && !highlighted?.post) return null;

  return (
    <View style={styles.wrapper} accessibilityLabel="精選作品">
      <View style={styles.heading}>
        <Text style={styles.title}>精選作品</Text>
        <Text style={styles.subtitle}>由作者挑選</Text>
      </View>
      {highlighted?.post ? (
        <Pressable style={({ pressed }) => [styles.featured, pressed && { opacity: 0.72 }]}
          accessibilityRole="button"
          accessibilityLabel={'閱讀精選作品：' + (highlighted.post.title || '未命名貼文')}
          onPress={() => openPost(highlighted.post!.id)}>
          <Text style={styles.pinned}>精選貼文</Text>
          <Text style={styles.featureTitle} numberOfLines={2}>{highlighted.post.title || '未命名貼文'}</Text>
          <Text style={styles.note} numberOfLines={2}>{highlighted.post.content || '查看作者的作品'}</Text>
          <Text style={styles.go}>閱讀作品 ↗</Text>
        </Pressable>
      ) : (
        <Text style={styles.note}>
          {highlighted ? '先前精選的貼文已刪除、改為匿名，或目前無法顯示。'
            : '從已發表的署名貼文選一篇，讓來訪的同學先看見你的代表作。'}
        </Text>
      )}
      {own && (
        <View style={styles.editor}>
          <Text style={styles.fieldLabel}>挑選一篇署名貼文</Text>
          {eligible.length ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.choices}>
              {eligible.map((post) => (
                <Pressable key={post.id} accessibilityRole="button"
                  accessibilityLabel={'選擇精選作品：' + (post.title || '未命名貼文')}
                  accessibilityState={{ selected: selected?.id === post.id }}
                  style={[styles.choice, selected?.id === post.id && styles.choiceActive]}
                  disabled={busy} onPress={() => setChoice(post.id)}>
                  <Text numberOfLines={1} style={styles.choiceLabel}>{post.title || '未命名貼文'}</Text>
                </Pressable>
              ))}
            </ScrollView>
          ) : <Text style={styles.note}>目前載入的貼文沒有可精選的署名作品。</Text>}
          <View style={styles.actions}>
            <Pressable accessibilityRole="button" style={[styles.button, styles.primary, (!selected || busy) && styles.disabled]}
              disabled={!selected || busy} onPress={() => void update(selected?.id ?? null)}>
              <Text style={styles.primaryText}>設為精選</Text>
            </Pressable>
            {highlighted && (
              <Pressable accessibilityRole="button" style={[styles.button, busy && styles.disabled]}
                disabled={busy} onPress={() => void update(null)}>
                <Text style={styles.buttonText}>取消精選</Text>
              </Pressable>
            )}
          </View>
          <Text style={styles.hint}>只從已載入的署名貼文挑選；匿名作品不會公開。</Text>
        </View>
      )}
      {!!feedback && <Text accessibilityRole="text" style={styles.note}>{feedback}</Text>}
    </View>
  );
}

const createStyles = () => StyleSheet.create({
  wrapper: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.colors.border, paddingTop: 20, marginTop: 20, gap: 10 },
  heading: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', gap: 9 },
  title: { color: theme.colors.text, fontSize: 17, fontWeight: '700' },
  subtitle: { color: theme.colors.textSecondary, fontSize: 12 },
  featured: { borderWidth: StyleSheet.hairlineWidth, borderColor: theme.colors.border, backgroundColor: theme.colors.surface, borderRadius: 12, padding: 16, gap: 7 },
  pinned: { color: theme.colors.accent, fontSize: 12, fontWeight: '700' },
  featureTitle: { color: theme.colors.text, fontSize: 16, fontWeight: '700', lineHeight: 23 },
  note: { color: theme.colors.textSecondary, fontSize: 13, lineHeight: 20 },
  go: { color: theme.colors.accent, fontWeight: '600', fontSize: 13 },
  editor: { gap: 10, paddingTop: 8 },
  fieldLabel: { color: theme.colors.text, fontWeight: '600', fontSize: 13 },
  choices: { gap: 8, paddingVertical: 4 },
  choice: { borderWidth: StyleSheet.hairlineWidth, borderColor: theme.colors.border, paddingHorizontal: 14, minHeight: 44, justifyContent: 'center', borderRadius: 10, maxWidth: 190 },
  choiceActive: { borderColor: theme.colors.accent, backgroundColor: theme.colors.accentSoft },
  choiceLabel: { color: theme.colors.text, fontSize: 13 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  button: { minHeight: 44, borderWidth: StyleSheet.hairlineWidth, borderColor: theme.colors.border, paddingHorizontal: 15, justifyContent: 'center', alignItems: 'center', borderRadius: 10 },
  primary: { backgroundColor: theme.colors.accent, borderColor: theme.colors.accent },
  buttonText: { color: theme.colors.text, fontWeight: '600', fontSize: 13 },
  primaryText: { color: theme.colors.onAccent, fontWeight: '600', fontSize: 13 },
  disabled: { opacity: 0.5 },
  hint: { color: theme.colors.textSecondary, fontSize: 12, lineHeight: 19 },
});
