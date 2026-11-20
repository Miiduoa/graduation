import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { formatTaipeiDateTime, parseTaipeiInstant } from '@campus/shared/src/taipeiTime';
import { reminderOptions, type ReminderChoice } from '../features/nuniCourseworkReminder';
import type { CourseworkView } from '../features/nuniCourseworkSnapshot';
import { AIButton, aiTokens } from '../ui/aiFirst';

type Props = {
  view: Extract<CourseworkView, { kind: 'reminder' }>;
  assignment: { id: string; title: string; dueAt: string | null };
  course: string;
  busy: boolean;
  latest: boolean;
  onSelect: (choice: ReminderChoice, label: string) => void;
  onAsk: (question: string) => void;
};

export function NuniCourseworkReminderCard({ view, assignment, course, busy, latest, onSelect, onAsk }: Props) {
  const { id, title, dueAt } = assignment;
  const options = reminderOptions(dueAt);
  const due = dueAt && parseTaipeiInstant(dueAt);
  const minutes = view.step === 'review' || (view.step === 'result' && view.next === 'remove' && view.action === 'set') ? view.minutes : undefined;
  const trigger = typeof due === 'number' && minutes !== undefined ? due - 60000 * minutes : null;
  const deadlineText = dueAt && formatTaipeiDateTime(dueAt, { seconds: false });
  const triggerText = trigger !== null && formatTaipeiDateTime(trigger, { seconds: false });
  const label = { color: aiTokens.textSecondary, fontSize: 14 };
  const body = { color: aiTokens.text, fontSize: 16, lineHeight: 24 };
  return (
    <View style={{ gap: 10 }}>
      <Text style={label}>{course} · 這台裝置</Text>
      <Text style={{ color: aiTokens.text, fontWeight: '700', fontSize: 19 }}>{title}</Text>
      <Text style={body}>{view.message}</Text>
      {!!deadlineText && <View style={{ gap: 4, paddingLeft: 10, borderLeftWidth: 2, borderColor: aiTokens.border }}>
        <Text style={label}>台灣時間</Text>
        <Text style={body} accessibilityLabel={`截止時間，${deadlineText}，台灣時間`}>截止時間 · {deadlineText}</Text>
        {!!triggerText && <Text accessibilityLabel={`提醒時間，${triggerText}，台灣時間`}
          style={{ color: aiTokens.aiStrong, fontWeight: '700', fontSize: 16 }}>提醒時間 · {triggerText}</Text>}
      </View>}
      {latest && view.step === 'review' && <>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {options.map((option) => {
            const selected = option.minutes === view.minutes;
            return <Pressable key={option.minutes} accessibilityRole="radio" accessibilityLabel={option.label}
              accessibilityState={{ checked: selected, disabled: busy }} disabled={busy}
              onPress={() => onSelect({ reminder: 'lead', id, minutes: option.minutes }, option.label)}
              style={{ borderWidth: 1, borderColor: selected ? aiTokens.ai : aiTokens.border,
                backgroundColor: selected ? aiTokens.aiSoft : aiTokens.panel, paddingHorizontal: 12, borderRadius: 10,
                minHeight: 44, justifyContent: 'center' }}>
              <Text style={{ color: selected ? aiTokens.aiStrong : aiTokens.text }}>{selected ? '✓ ' : ''}{option.label}</Text>
            </Pressable>;
          })}
        </View>
        <AIButton label="確認設定提醒" disabled={busy}
          onPress={() => onSelect({ reminder: 'confirm', id }, '確認設定提醒')} />
        <AIButton label="放棄設定" variant="ghost" disabled={busy} onPress={() => onAsk('放棄設定')} />
      </>}
      {latest && view.step === 'cancel-review' && <>
        <AIButton label="確認取消提醒" variant="danger" disabled={busy}
          onPress={() => onSelect({ reminder: 'remove', id }, '確認取消提醒')} />
        <AIButton label="保留提醒" variant="ghost" disabled={busy} onPress={() => onAsk('保留提醒')} />
      </>}
      {latest && view.step === 'result' && <>
        {view.next === 'retry' && <AIButton label="重新設定提醒" disabled={busy} onPress={() => onAsk('提醒我交這份')} />}
        {view.next === 'remove' && <AIButton label="取消這份作業的提醒" variant="ghost" disabled={busy}
          onPress={() => onAsk('取消這份作業的提醒')} />}
        <AIButton label="回到這門課的作業" variant="ghost" disabled={busy} onPress={() => onAsk('回到這門課的作業')} />
      </>}
    </View>
  );
}
