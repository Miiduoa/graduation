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
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { theme } from '../ui/theme';
import { markNpsShown, submitProductFeedback } from '../services/productFeedback';

export function NpsPromptModal(props: {
  visible: boolean;
  schoolId: string;
  uid?: string | null;
  onClose: () => void;
}) {
  const { visible, schoolId, uid, onClose } = props;
  const [score, setScore] = useState<number | null>(null);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);

  const reset = () => {
    setScore(null);
    setComment('');
    setBusy(false);
  };

  const handleLater = async () => {
    await markNpsShown();
    reset();
    onClose();
  };

  const handleSubmit = async () => {
    if (score === null) return;
    setBusy(true);
    try {
      await submitProductFeedback({
        kind: 'nps',
        feedbackType: 'improvement',
        title: '[NPS] 推薦意願',
        description:
          comment.trim() ||
          `使用者評分 NPS ${score}/10（標準題：您有多大可能推薦 Campus One？）`,
        score,
        rating: score,
        context: 'nps_dashboard',
        submittedBy: uid ?? null,
        schoolId,
      });
      await markNpsShown();
      reset();
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={handleLater}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{
          flex: 1,
          backgroundColor: 'rgba(0,0,0,0.45)',
          justifyContent: 'center',
          padding: 20,
        }}
      >
        <View
          style={{
            backgroundColor: theme.colors.surface,
            borderRadius: theme.radius.lg,
            padding: 18,
            maxHeight: '82%',
            borderWidth: 1,
            borderColor: theme.colors.border,
          }}
        >
          <Text style={{ color: theme.colors.text, fontWeight: '800', fontSize: 17 }}>
            推薦我們給同學？
          </Text>
          <Text style={{ color: theme.colors.muted, fontSize: 13, marginTop: 8, lineHeight: 20 }}>
            0 = 完全不會，10 = 非常可能（約每季詢問一次，也可選稍後）。
          </Text>

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: 8, paddingVertical: 14 }}
          >
            {Array.from({ length: 11 }, (_, i) => i).map((n) => (
              <Pressable
                key={n}
                onPress={() => setScore(n)}
                disabled={busy}
                style={{
                  paddingHorizontal: 12,
                  paddingVertical: 10,
                  borderRadius: theme.radius.md,
                  backgroundColor: score === n ? theme.colors.accent : theme.colors.surface2,
                  borderWidth: 1,
                  borderColor: score === n ? theme.colors.accent : theme.colors.border,
                }}
              >
                <Text
                  style={{
                    color: score === n ? '#fff' : theme.colors.text,
                    fontWeight: '700',
                    fontSize: 15,
                  }}
                >
                  {n}
                </Text>
              </Pressable>
            ))}
          </ScrollView>

          <TextInput
            value={comment}
            onChangeText={setComment}
            editable={!busy}
            placeholder="選填：最想改善的一件事"
            placeholderTextColor={theme.colors.muted}
            multiline
            style={{
              minHeight: 64,
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

          <View style={{ flexDirection: 'row', gap: 10, marginTop: 16 }}>
            <Pressable
              onPress={handleLater}
              disabled={busy}
              style={{
                flex: 1,
                paddingVertical: 12,
                borderRadius: theme.radius.md,
                alignItems: 'center',
                backgroundColor: theme.colors.surface2,
              }}
            >
              <Text style={{ color: theme.colors.text, fontWeight: '700' }}>稍後</Text>
            </Pressable>
            <Pressable
              onPress={handleSubmit}
              disabled={busy || score === null}
              style={{
                flex: 1,
                paddingVertical: 12,
                borderRadius: theme.radius.md,
                alignItems: 'center',
                backgroundColor: theme.colors.accent,
                opacity: score === null ? 0.55 : 1,
              }}
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
