import React, { useState } from 'react';
import { Text, View } from 'react-native';
import type { AssistantCalendarContext, AssistantCalendarTask } from '../services/assistantCalendarExecution';
import { AICard, AIButton, aiTokens } from '../ui/aiFirst';
import { AssistantCalendarAction } from './AssistantCalendarAction';
import type { ServiceScreenProps } from './UnavailableFeatureScreen';

const PAGE_SIZE = 16;

export function AssistantCalendarRecovery({ tasks, loading, error, context, navigation, disabled, onRetry, onChange }: {
  tasks: AssistantCalendarTask[];
  loading: boolean;
  error: string;
  context: AssistantCalendarContext;
  navigation: ServiceScreenProps['navigation'];
  disabled: boolean;
  onRetry: () => void;
  onChange: (task: AssistantCalendarTask, originalId: string) => void;
}) {
  const [visible, setVisible] = useState(PAGE_SIZE);
  if (!loading && !error && !tasks.length) return null;
  const ordered = [...tasks].sort((left, right) => right.proposal.createdAt.localeCompare(left.proposal.createdAt));
  return <AICard title="找回的行程紀錄">
    {loading ? <Text accessibilityLiveRegion="polite" style={{ color: aiTokens.textSecondary, lineHeight: 23 }}>
      正在找回並核對先前的行程操作…
    </Text> : error ? <>
      <Text accessibilityRole="alert" style={{ color: aiTokens.textSecondary, lineHeight: 23 }}>{error}</Text>
      <AIButton label="重新載入行程紀錄" variant="ghost" disabled={disabled} onPress={onRetry} />
    </> : <>
      <Text style={{ color: aiTokens.textSecondary, lineHeight: 23 }}>
        這些是先前已確認的操作。每筆都沿用原本的行程紀錄重新核對，結果顯示在下方。
      </Text>
      {ordered.slice(0, visible).map((task) => <View key={task.proposal.mutationId}
        style={{ borderTopWidth: 1, borderTopColor: aiTokens.border, marginTop: 14, paddingTop: 4 }}>
        <AssistantCalendarAction task={task} context={context} navigation={navigation}
          disabled={disabled} onChange={(next) => onChange(next, task.proposal.mutationId)} />
      </View>)}
      {ordered.length > visible ? <AIButton label={`顯示更多行程紀錄（${ordered.length - visible}）`}
        variant="ghost" disabled={disabled} onPress={() => setVisible((count) => count + PAGE_SIZE)} /> : null}
    </>}
  </AICard>;
}
