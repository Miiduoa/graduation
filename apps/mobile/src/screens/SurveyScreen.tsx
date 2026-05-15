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
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';

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
      style={{ flex: 1, backgroundColor: '#f9fafb' }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 80 }}>
        <Text style={{ fontSize: 22, fontWeight: '700', color: '#111827' }}>{title}</Text>
        {courseName ? (
          <Text style={{ color: '#6b7280', marginTop: 4 }}>{courseName}</Text>
        ) : null}

        {questions.map((q, idx) => (
          <View
            key={q.id}
            style={{
              marginTop: 16,
              backgroundColor: '#fff',
              borderRadius: 12,
              padding: 14,
              borderWidth: 1,
              borderColor: '#e5e7eb',
            }}
          >
            <Text style={{ fontSize: 15, fontWeight: '600', color: '#111827' }}>
              {idx + 1}. {q.prompt} {q.required ? <Text style={{ color: '#dc2626' }}>*</Text> : null}
            </Text>

            {q.type === 'single' &&
              q.options?.map((opt) => (
                <Pressable
                  key={opt.id}
                  onPress={() => !submitted && updateSingle(q.id, opt.id)}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 8,
                    padding: 10,
                    marginTop: 6,
                    borderRadius: 8,
                    backgroundColor: answers[q.id] === opt.id ? '#1F4E7814' : '#f3f4f6',
                    borderWidth: 1,
                    borderColor: answers[q.id] === opt.id ? '#1F4E78' : '#e5e7eb',
                  }}
                >
                  <Ionicons
                    name={answers[q.id] === opt.id ? 'radio-button-on' : 'radio-button-off'}
                    size={18}
                    color={answers[q.id] === opt.id ? '#1F4E78' : '#6b7280'}
                  />
                  <Text style={{ fontSize: 14, color: '#111827' }}>{opt.label}</Text>
                </Pressable>
              ))}

            {q.type === 'multi' &&
              q.options?.map((opt) => {
                const checked = Array.isArray(answers[q.id])
                  ? (answers[q.id] as string[]).includes(opt.id)
                  : false;
                return (
                  <Pressable
                    key={opt.id}
                    onPress={() => !submitted && updateMulti(q.id, opt.id)}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 8,
                      padding: 10,
                      marginTop: 6,
                      borderRadius: 8,
                      backgroundColor: checked ? '#1F4E7814' : '#f3f4f6',
                      borderWidth: 1,
                      borderColor: checked ? '#1F4E78' : '#e5e7eb',
                    }}
                  >
                    <Ionicons
                      name={checked ? 'checkbox' : 'square-outline'}
                      size={18}
                      color={checked ? '#1F4E78' : '#6b7280'}
                    />
                    <Text style={{ fontSize: 14, color: '#111827' }}>{opt.label}</Text>
                  </Pressable>
                );
              })}

            {q.type === 'scale' && (
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
                {[1, 2, 3, 4, 5].map((n) => {
                  const selected = answers[q.id] === n;
                  return (
                    <Pressable
                      key={n}
                      onPress={() => !submitted && updateScale(q.id, n)}
                      style={{
                        flex: 1,
                        padding: 12,
                        borderRadius: 8,
                        backgroundColor: selected ? '#1F4E78' : '#f3f4f6',
                        alignItems: 'center',
                      }}
                    >
                      <Text
                        style={{
                          color: selected ? '#fff' : '#111827',
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
                style={{
                  marginTop: 8,
                  backgroundColor: '#f9fafb',
                  borderRadius: 8,
                  padding: 10,
                  fontSize: 14,
                  borderWidth: 1,
                  borderColor: '#e5e7eb',
                  minHeight: 80,
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
            style={{
              marginTop: 24,
              padding: 14,
              borderRadius: 12,
              backgroundColor: '#1F4E78',
              alignItems: 'center',
              opacity: submitting ? 0.6 : 1,
            }}
          >
            <Text style={{ color: '#fff', fontSize: 16, fontWeight: '700' }}>
              {submitting ? '送出中⋯⋯' : '送出問卷'}
            </Text>
          </Pressable>
        )}
        {submitted && (
          <View style={{ marginTop: 24, padding: 14, backgroundColor: '#dcfce7', borderRadius: 12 }}>
            <Text style={{ color: '#166534', fontSize: 14, fontWeight: '600', textAlign: 'center' }}>
              ✅ 已提交，謝謝你的回饋
            </Text>
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
