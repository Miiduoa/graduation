/* eslint-disable */
import React, { useState } from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../ui/theme';
import {
  markMicroCsatShown,
  submitProductFeedback,
  type MicroCsatContext,
} from '../services/productFeedback';

export function FeedbackPromptModal(props: {
  visible: boolean;
  context: MicroCsatContext;
  title?: string;
  schoolId: string;
  uid?: string | null;
  onClose: () => void;
}) {
  const { visible, context, title, schoolId, uid, onClose } = props;
  const [score, setScore] = useState(0);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);

  const reset = () => {
    setScore(0);
    setComment('');
    setBusy(false);
  };

  const handleDismiss = async () => {
    await markMicroCsatShown(context);
    reset();
    onClose();
  };

  const handleSubmit = async () => {
    if (score < 1 || score > 5) return;
    setBusy(true);
    try {
      await submitProductFeedback({
        kind: 'csat',
        feedbackType: 'improvement',
        title: `[Micro-CSAT] ${context}`,
        description:
          comment.trim() ||
          `情境：${context}，評分 ${score}/5（使用者未填寫文字）`,
        score,
        rating: score,
        context,
        submittedBy: uid ?? null,
        schoolId,
      });
      await markMicroCsatShown(context);
      reset();
      onClose();
    } finally {
      setBusy(false);
    }
  };

  const headline =
    title ??
    (context === 'crowd_report'
      ? '這次人潮回報順利嗎？'
      : '這次 AI／工具協助有用嗎？');

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={handleDismiss}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{
          flex: 1,
          backgroundColor: 'rgba(0,0,0,0.45)',
          justifyContent: 'center',
          padding: 24,
        }}
      >
        <View
          style={{
            backgroundColor: theme.colors.surface,
            borderRadius: theme.radius.lg,
            padding: 20,
            borderWidth: 1,
            borderColor: theme.colors.border,
          }}
        >
          <Text style={{ color: theme.colors.text, fontWeight: '800', fontSize: 17 }}>
            {headline}
          </Text>
          <Text style={{ color: theme.colors.muted, fontSize: 13, marginTop: 8, lineHeight: 20 }}>
            1～5 星，選填一句話給我們（不定期詢問，不打擾日常使用）。
          </Text>

          <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 10, marginTop: 18 }}>
            {[1, 2, 3, 4, 5].map((s) => (
              <Pressable key={s} onPress={() => setScore(s)} disabled={busy}>
                <Ionicons
                  name={s <= score ? 'star' : 'star-outline'}
                  size={34}
                  color={s <= score ? '#FF9500' : theme.colors.muted}
                />
              </Pressable>
            ))}
          </View>

          <TextInput
            value={comment}
            onChangeText={setComment}
            editable={!busy}
            placeholder="選填：哪裡可以更好？"
            placeholderTextColor={theme.colors.muted}
            multiline
            style={{
              marginTop: 16,
              minHeight: 72,
              padding: 12,
              borderRadius: theme.radius.md,
              borderWidth: 1,
              borderColor: theme.colors.border,
              backgroundColor: theme.colors.surface2,
              color: theme.colors.text,
              fontSize: 14,
              textAlignVertical: 'top',
            }}
          />

          <View style={{ flexDirection: 'row', gap: 12, marginTop: 18 }}>
            <Pressable
              onPress={handleDismiss}
              disabled={busy}
              style={({ pressed }) => ({
                flex: 1,
                paddingVertical: 12,
                borderRadius: theme.radius.md,
                alignItems: 'center',
                backgroundColor: theme.colors.surface2,
                opacity: pressed ? 0.85 : 1,
              })}
            >
              <Text style={{ color: theme.colors.text, fontWeight: '700' }}>稍後再說</Text>
            </Pressable>
            <Pressable
              onPress={handleSubmit}
              disabled={busy || score < 1}
              style={({ pressed }) => ({
                flex: 1,
                paddingVertical: 12,
                borderRadius: theme.radius.md,
                alignItems: 'center',
                backgroundColor: theme.colors.accent,
                opacity: pressed || score < 1 ? 0.7 : 1,
              })}
            >
              {busy ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={{ color: '#fff', fontWeight: '800' }}>送出</Text>
              )}
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
