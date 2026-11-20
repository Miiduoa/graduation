import React from 'react';
import { View, Text, TextInput, Pressable, StyleSheet } from 'react-native';
import { theme } from '../../ui/theme';
import { useThemeStyleSheet } from '../../ui/useThemeStyleSheet';
import { quizOptions, type QuizAnswerInput } from '../../services/lmsV2QuizModels';
import type { LmsQuizQuestion } from '../../services/lmsV2QuizDelivery';

type Props = {
  question: LmsQuizQuestion;
  number: number;
  value: QuizAnswerInput;
  disabled: boolean;
  onChange: (value: QuizAnswerInput) => void;
};

export function QuizQuestionEditor({ question, number, value, disabled, onChange }: Props) {
  const styles = useThemeStyleSheet(createStyles);
  const type = question.question_type;
  const options = type === 'single' || type === 'multiple' ? quizOptions(question.choices) : [];
  const selected = Array.isArray(value) ? value : typeof value === 'string' ? [value] : [];
  const choose = (optionId: string) => {
    if (disabled) return;
    if (type === 'single') {
      onChange(selected.includes(optionId) ? null : optionId);
      return;
    }
    const updated = selected.includes(optionId)
      ? selected.filter((id) => id !== optionId)
      : [...selected, optionId];
    onChange(updated.length ? updated : null);
  };

  return (
    <View style={styles.card} accessibilityLabel={'第 ' + number + ' 題'}>
      <Text style={styles.label}>第 {number} 題 · {question.points ?? 0} 分</Text>
      <Text style={styles.title}>{question.prompt}</Text>
      {(type === 'single' || type === 'multiple') && (
        options.length ? (
          <View style={styles.options}>
            {options.map((option) => {
              const checked = selected.includes(option.id);
              return (
                <Pressable
                  key={option.id}
                  accessibilityRole={type === 'single' ? 'radio' : 'checkbox'}
                  accessibilityState={{ checked, disabled }}
                  accessibilityLabel={option.label}
                  disabled={disabled}
                  style={[styles.option, checked && styles.activeOption]}
                  onPress={() => choose(option.id)}
                >
                  <View style={[styles.indicator, checked && styles.activeIndicator]} />
                  <Text style={styles.optionText}>{option.label}</Text>
                </Pressable>
              );
            })}
          </View>
        ) : <Text style={styles.warning}>題目缺少有效選項，請聯絡老師。</Text>
      )}
      {type === 'boolean' && (
        <View style={styles.options}>
          {([true, false] as const).map((choice) => (
            <Pressable
              key={String(choice)}
              accessibilityRole="radio"
              accessibilityState={{ checked: value === choice, disabled }}
              disabled={disabled}
              style={[styles.option, value === choice && styles.activeOption]}
              onPress={() => onChange(value === choice ? null : choice)}
            >
              <View style={[styles.indicator, value === choice && styles.activeIndicator]} />
              <Text style={styles.optionText}>{choice ? '正確' : '錯誤'}</Text>
            </Pressable>
          ))}
        </View>
      )}
      {(type === 'short' || type === 'essay') && (
        <TextInput
          style={[styles.answer, type === 'essay' && styles.essay]}
          value={typeof value === 'string' ? value : ''}
          editable={!disabled}
          onChangeText={(next) => onChange(next)}
          placeholder={type === 'essay' ? '輸入申論作答（交卷後由老師評閱）' : '輸入簡答'}
          accessibilityLabel={'第 ' + number + ' 題答案'}
          multiline
          maxLength={8000}
          textAlignVertical="top"
        />
      )}
      {!['single', 'multiple', 'boolean', 'short', 'essay'].includes(type) && (
        <Text style={styles.warning}>尚不支援這種題型，請聯絡老師。</Text>
      )}
      {type === 'multiple' && <Text style={styles.hint}>可複選多個選項</Text>}
      {value !== null && value !== '' && (!Array.isArray(value) || value.length > 0) && (
        <Pressable accessibilityRole="button" disabled={disabled}
          accessibilityLabel={'清除第 ' + number + ' 題答案'}
          style={styles.clear} onPress={() => onChange(null)}>
          <Text style={styles.clearText}>清除此題答案</Text>
        </Pressable>
      )}
    </View>
  );
}

const createStyles = () => StyleSheet.create({
  card: {
    padding: 16, backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.lg, borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border, gap: 12,
  },
  label: { color: theme.colors.muted, fontSize: 12, fontWeight: '600' },
  title: { color: theme.colors.text, fontSize: 16, lineHeight: 24, fontWeight: '600' },
  options: { gap: 8 },
  option: {
    minHeight: 48, flexDirection: 'row', gap: 12, alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth, borderColor: theme.colors.border,
    borderRadius: 9, paddingHorizontal: 14, paddingVertical: 10,
  },
  activeOption: { borderColor: theme.colors.accent, backgroundColor: theme.colors.accentSoft },
  indicator: { width: 15, height: 15, borderRadius: 8, borderWidth: 2, borderColor: theme.colors.muted },
  activeIndicator: { backgroundColor: theme.colors.accent, borderColor: theme.colors.accent },
  optionText: { color: theme.colors.text, fontSize: 14, flexShrink: 1, lineHeight: 21 },
  answer: {
    minHeight: 92, borderRadius: 8, borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border, backgroundColor: theme.colors.bg,
    padding: 12, color: theme.colors.text, fontSize: 14, lineHeight: 21,
  },
  essay: { minHeight: 170 },
  warning: { color: theme.colors.danger, fontSize: 13, lineHeight: 20 },
  hint: { color: theme.colors.muted, fontSize: 12 },
  clear: { paddingVertical: 8, alignSelf: 'flex-end' },
  clearText: { color: theme.colors.accent, fontSize: 12, fontWeight: '600' },
});
