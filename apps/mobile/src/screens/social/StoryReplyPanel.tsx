import React, { useLayoutEffect, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { randomUUID } from 'expo-crypto';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { sendStoryReply } from '../../services/storyReply';
import type { CampusStoryDoc } from '../../services/stories';

const MAX_LENGTH = 500;

export function StoryReplyPanel({
  open,
  story,
  viewerUid,
  author,
  onBack,
  onSent,
}: {
  open: boolean;
  story: CampusStoryDoc;
  viewerUid: string;
  author: string;
  onBack: () => void;
  onSent: (conversationId: string) => void;
}) {
  const [draft, setDraft] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const sending = useRef(false);
  const attempt = useRef<{ content: string; id: string } | null>(null);
  const mounted = useRef(false);
  const insets = useSafeAreaInsets();
  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  if (!open) return null;
  const content = draft.trim();
  const disabled = !content || content.length > MAX_LENGTH || pending;

  async function submit() {
    if (disabled || sending.current) return;
    sending.current = true;
    setPending(true);
    setError('');
    try {
      if (attempt.current?.content !== content) attempt.current = { content, id: randomUUID() };
      const conversationId = await sendStoryReply({
        viewerUid,
        schoolId: story.schoolId,
        storyId: story.id,
        authorUid: story.authorUid,
        replyId: attempt.current.id,
        content,
      });
      if (!mounted.current) return;
      attempt.current = null;
      setDraft('');
      onSent(conversationId);
    } catch (reason) {
      if (!mounted.current) return;
      const code = (reason as { code?: string } | null)?.code;
      setError(
        code === 'functions/permission-denied' ||
          code === 'functions/not-found' ||
          code === 'functions/failed-precondition'
          ? '目前無法回覆這則限時動態'
          : '尚未確認送達。可以保留這段文字，再試一次。',
      );
    } finally {
      sending.current = false;
      if (mounted.current) setPending(false);
    }
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={styles.overlay}
      accessibilityViewIsModal
      onAccessibilityEscape={onBack}
    >
      <ScrollView
        keyboardShouldPersistTaps="handled"
        bounces={false}
        contentContainerStyle={[styles.container, { paddingTop: Math.max(12, insets.top) }]}
      >
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 16) }]}>
          <View style={styles.header}>
            <Text accessibilityRole="header" style={styles.title}>
              私訊回覆
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="返回限時動態"
              onPress={onBack}
              style={styles.back}
            >
              <Text style={styles.backText}>返回</Text>
            </Pressable>
          </View>
          <Text style={styles.subtitle}>這段文字會傳到你與{author}的私訊。</Text>
          <TextInput
            autoFocus
            multiline
            maxLength={MAX_LENGTH}
            editable={!pending}
            accessibilityLabel="私訊回覆內容"
            placeholder="想跟對方說什麼？"
            placeholderTextColor="#a5b1ab"
            value={draft}
            style={styles.field}
            onChangeText={(value) => {
              setDraft(value);
              setError('');
            }}
          />
          {!!error && (
            <Text accessibilityLiveRegion="polite" style={styles.error}>
              {error}
            </Text>
          )}
          <View style={styles.footer}>
            <Text style={styles.subtitle}>
              {draft.length} / {MAX_LENGTH}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled, busy: pending }}
              disabled={disabled}
              onPress={() => void submit()}
              style={[styles.send, disabled && styles.disabled]}
            >
              <Text style={styles.sendText}>
                {pending ? '傳送中…' : error ? '再試一次' : '傳送私訊'}
              </Text>
            </Pressable>
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  overlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.62)' },
  container: { flexGrow: 1, justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: '#18201d',
    paddingHorizontal: 18,
    paddingTop: 8,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    gap: 8,
  },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { color: '#fff', fontSize: 21, fontWeight: '700', flexShrink: 1 },
  back: { minHeight: 44, minWidth: 44, alignItems: 'center', justifyContent: 'center' },
  backText: { color: '#d6f4e7', fontSize: 16 },
  subtitle: { color: '#c2cbc8', fontSize: 14 },
  field: {
    minHeight: 84,
    maxHeight: 144,
    textAlignVertical: 'top',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#81958b',
    padding: 12,
    backgroundColor: '#101613',
    color: '#fff',
    fontSize: 16,
  },
  footer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  send: {
    minHeight: 44,
    paddingHorizontal: 18,
    borderRadius: 22,
    backgroundColor: '#b8e7d4',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendText: { fontSize: 16, fontWeight: '700', color: '#10221b' },
  disabled: { opacity: 0.5 },
  error: { fontSize: 14, color: '#ffcebb' },
});
