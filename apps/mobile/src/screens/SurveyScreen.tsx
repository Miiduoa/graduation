/**
 * Survey Screen — TronClass 問卷本地化
 *
 * 支援題型：單選 / 複選 / 文字 / 量表 (1-5)
 * 提交後寫 TronClass，並紀錄 companion signal。
 */
import React, { useState } from 'react';
import {
  ScrollView,
  View,
  Text,
  TextInput,
  Pressable,
  Alert,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';

import { theme } from '../ui/theme';
import { useThemeVersion } from '../ui/useThemeStyleSheet';

type SurveyQuestionType = 'single' | 'multi' | 'text' | 'scale';

interface SurveyQuestion {
  id: string;
  type: SurveyQuestionType;
  prompt: string;
  required?: boolean;
  options?: Array<{ id: string; label: string }>;
}

type RouteProps = {
  route?: {
    params?: {
      surveyId?: string;
      courseId?: string;
      title?: string;
      questions?: SurveyQuestion[];
      courseName?: string;
    };
  };
};

const SAMPLE_QUESTIONS: SurveyQuestion[] = [
  {
    id: 'q1',
    type: 'single',
    prompt: '你對本週課程的整體滿意度？',
    required: true,
    options: [
      { id: 'a', label: '非常滿意' },
      { id: 'b', label: '滿意' },
      { id: 'c', label: '普通' },
      { id: 'd', label: '需要改進' },
    ],
  },
  {
    id: 'q2',
    type: 'multi',
    prompt: '對本週收穫最大的環節（可複選）',
    options: [
      { id: 'lecture', label: '課堂講授' },
      { id: 'discussion', label: '小組討論' },
      { id: 'hw', label: '作業實作' },
      { id: 'quiz', label: '隨堂測驗' },
    ],
  },
  {
    id: 'q3',
    type: 'scale',
    prompt: '這次教材難度 1（太簡單）— 5（太難）',
    required: true,
  },
  {
    id: 'q4',
    type: 'text',
    prompt: '你想對老師說什麼？（匿名）',
  },
];

export default function SurveyScreen(props: RouteProps) {
  useThemeVersion();
  const navigation = useNavigation<any>();
  const title = props.route?.params?.title ?? '課程問卷';
  const courseName = props.route?.params?.courseName;
  const surveyId = props.route?.params?.surveyId ?? '';
  const courseId = props.route?.params?.courseId ?? '';
  const questions = props.route?.params?.questions ?? SAMPLE_QUESTIONS;

  const [answers, setAnswers] = useState<Record<string, string | string[] | number>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const usingSample = !props.route?.params?.questions;

  const updateSingle = (qid: string, val: string) =>
    setAnswers((a) => ({ ...a, [qid]: val }));
  const updateMulti = (qid: string, optId: string) => {
    setAnswers((a) => {
      const cur = Array.isArray(a[qid]) ? (a[qid] as string[]) : [];
      const next = cur.includes(optId) ? cur.filter((x) => x !== optId) : [...cur, optId];
      return { ...a, [qid]: next };
    });
  };
  const updateText = (qid: string, val: string) =>
    setAnswers((a) => ({ ...a, [qid]: val }));
  const updateScale = (qid: string, n: number) =>
    setAnswers((a) => ({ ...a, [qid]: n }));

  const handleSubmit = async () => {
    // 必填檢查
    for (const q of questions) {
      if (q.required && (answers[q.id] === undefined || answers[q.id] === '')) {
        Alert.alert('還有必填題沒答', q.prompt);
        return;
      }
    }
    setSubmitting(true);
    try {
      const numericCourseId = Number(String(courseId).replace(/^tc:/, '')) || 0;
      const numericSurveyId = Number(String(surveyId).replace(/^tc:/, '')) || 0;
      if (usingSample || !numericCourseId || !numericSurveyId) {
        // 範例問卷模式（沒接到真 API）— 仍模擬送出讓使用者體驗完整流程
        await new Promise((r) => setTimeout(r, 400));
      } else {
        const { tcSubmitSurvey } = await import('../services/tronClassClient');
        const result = await tcSubmitSurvey(numericCourseId, numericSurveyId, answers);
        if (!result.success) {
          Alert.alert('送出失敗', result.error ?? '請檢查網路後再試一次。');
          return;
        }
      }
      setSubmitted(true);
      Alert.alert('🎉 已提交', '感謝你的回饋，老師會看到。', [
        { text: '完成', onPress: () => navigation.goBack() },
      ]);
    } catch (e) {
      Alert.alert('送出失敗', String((e as Error)?.message ?? e));
    } finally {
      setSubmitting(false);
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
            style={{ fontSize: 22, fontWeight: '700', color: theme.colors.text, lineHeight: 28 }}
          >
            {title}
          </Text>
          {courseName ? (
            <Text style={{ color: theme.colors.textSecondary, fontSize: 13, marginTop: 4 }}>
              {courseName}
            </Text>
          ) : null}
        </View>

        {questions.map((q, idx) => (
          <View
            key={q.id}
            style={{
              paddingVertical: 18,
              borderBottomWidth: StyleSheet.hairlineWidth,
              borderBottomColor: theme.colors.separator,
            }}
          >
            <Text style={{ fontSize: 15, fontWeight: '600', color: theme.colors.text, lineHeight: 22 }}>
              {idx + 1}. {q.prompt}{' '}
              {q.required ? <Text style={{ color: theme.colors.danger }}>*</Text> : null}
            </Text>

            {q.type === 'single' && (
              <View style={{ gap: 8, marginTop: 10 }}>
                {q.options?.map((opt) => {
                  const selected = answers[q.id] === opt.id;
                  return (
                    <Pressable
                      key={opt.id}
                      onPress={() => !submitted && updateSingle(q.id, opt.id)}
                      accessibilityRole="radio"
                      accessibilityState={{ selected, disabled: submitted }}
                      style={({ pressed }) => ({
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: 10,
                        minHeight: 44,
                        paddingHorizontal: 12,
                        paddingVertical: 10,
                        borderRadius: theme.radius.md,
                        backgroundColor: selected ? theme.colors.accentSoft : theme.colors.surface,
                        borderWidth: 1,
                        borderColor: selected ? theme.colors.accent : theme.colors.border,
                        opacity: pressed && !submitted ? 0.85 : 1,
                      })}
                    >
                      <Ionicons
                        name={selected ? 'radio-button-on' : 'radio-button-off'}
                        size={18}
                        color={selected ? theme.colors.accent : theme.colors.muted}
                      />
                      <Text style={{ fontSize: 14, color: theme.colors.text, flex: 1 }}>
                        {opt.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            )}

            {q.type === 'multi' && (
              <View style={{ gap: 8, marginTop: 10 }}>
                {q.options?.map((opt) => {
                  const checked = Array.isArray(answers[q.id])
                    ? (answers[q.id] as string[]).includes(opt.id)
                    : false;
                  return (
                    <Pressable
                      key={opt.id}
                      onPress={() => !submitted && updateMulti(q.id, opt.id)}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked, disabled: submitted }}
                      style={({ pressed }) => ({
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: 10,
                        minHeight: 44,
                        paddingHorizontal: 12,
                        paddingVertical: 10,
                        borderRadius: theme.radius.md,
                        backgroundColor: checked ? theme.colors.accentSoft : theme.colors.surface,
                        borderWidth: 1,
                        borderColor: checked ? theme.colors.accent : theme.colors.border,
                        opacity: pressed && !submitted ? 0.85 : 1,
                      })}
                    >
                      <Ionicons
                        name={checked ? 'checkbox' : 'square-outline'}
                        size={18}
                        color={checked ? theme.colors.accent : theme.colors.muted}
                      />
                      <Text style={{ fontSize: 14, color: theme.colors.text, flex: 1 }}>
                        {opt.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            )}

            {q.type === 'scale' && (
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
                {[1, 2, 3, 4, 5].map((n) => {
                  const selected = answers[q.id] === n;
                  return (
                    <Pressable
                      key={n}
                      onPress={() => !submitted && updateScale(q.id, n)}
                      accessibilityRole="button"
                      accessibilityState={{ selected, disabled: submitted }}
                      style={({ pressed }) => ({
                        flex: 1,
                        minHeight: 44,
                        justifyContent: 'center',
                        alignItems: 'center',
                        borderRadius: theme.radius.md,
                        borderWidth: 1,
                        borderColor: selected ? theme.colors.accent : theme.colors.border,
                        backgroundColor: selected ? theme.colors.accent : theme.colors.surface,
                        opacity: pressed && !submitted ? 0.85 : 1,
                      })}
                    >
                      <Text
                        style={{
                          color: selected ? theme.colors.onAccent : theme.colors.text,
                          fontWeight: '700',
                          fontSize: 16,
                        }}
                      >
                        {n}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            )}

            {q.type === 'text' && (
              <TextInput
                value={String(answers[q.id] ?? '')}
                onChangeText={(t) => updateText(q.id, t)}
                editable={!submitted}
                multiline
                numberOfLines={4}
                placeholder="自由作答（可空白）"
                placeholderTextColor={theme.colors.muted}
                style={{
                  marginTop: 10,
                  backgroundColor: theme.colors.surface,
                  borderRadius: theme.radius.md,
                  padding: 12,
                  fontSize: 14,
                  color: theme.colors.text,
                  borderWidth: 1,
                  borderColor: theme.colors.border,
                  minHeight: 88,
                  textAlignVertical: 'top',
                }}
              />
            )}
          </View>
        ))}

        {!submitted && (
          <Pressable
            onPress={handleSubmit}
            disabled={submitting}
            accessibilityRole="button"
            style={({ pressed }) => ({
              marginTop: 24,
              minHeight: 48,
              justifyContent: 'center',
              alignItems: 'center',
              borderRadius: theme.radius.md,
              backgroundColor: theme.colors.accent,
              opacity: submitting || pressed ? 0.7 : 1,
            })}
          >
            <Text style={{ color: theme.colors.onAccent, fontSize: 16, fontWeight: '700' }}>
              {submitting ? '送出中⋯⋯' : '送出問卷'}
            </Text>
          </Pressable>
        )}
        {submitted && (
          <View
            style={{
              marginTop: 24,
              padding: 14,
              backgroundColor: theme.colors.successSoft,
              borderRadius: theme.radius.md,
              borderWidth: 1,
              borderColor: theme.colors.border,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
            }}
          >
            <Ionicons name="checkmark-circle-outline" size={18} color={theme.colors.success} />
            <Text style={{ color: theme.colors.success, fontSize: 14, fontWeight: '600' }}>
              已提交，謝謝你的回饋
            </Text>
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
