import React, { useState } from 'react';
import { Text, View } from 'react-native';
import type { AssistantCalendarBatchView } from '../services/assistantCalendarBatchExecution';
import type { AssistantCalendarContext } from '../services/assistantCalendarExecution';
import { AICard, AIButton, aiTokens } from '../ui/aiFirst';
import { AssistantCalendarBatchAction } from './AssistantCalendarBatchAction';
import type { ServiceScreenProps } from './UnavailableFeatureScreen';

export function AssistantCalendarBatchRecovery({ batches, error, context, navigation, disabled, onRetry, onChange }: {
  batches: AssistantCalendarBatchView[];
  error: string;
  context: AssistantCalendarContext;
  navigation: ServiceScreenProps['navigation'];
  disabled: boolean;
  onRetry: () => void;
  onChange: (batch: AssistantCalendarBatchView, originalId: string) => void;
}) {
  const [visible, setVisible] = useState(8);
  if (!error && !batches.length) return null;
  const ordered = [...batches].sort((left, right) => right.plan.createdAt.localeCompare(left.plan.createdAt));
  return <AICard title="找回的多筆行程">
    {error ? <>
      <Text accessibilityRole="alert" style={{ color: aiTokens.textSecondary, lineHeight: 23 }}>{error}</Text>
      <AIButton label="重新載入多筆行程" variant="ghost" disabled={disabled} onPress={onRetry} />
    </> : <>
      <Text style={{ color: aiTokens.textSecondary, lineHeight: 23 }}>
        已找回完整安排與各筆操作結果。核對下方進度後，可以確認接續尚未開始的行程。
      </Text>
      {ordered.slice(0, visible).map((batch) => <View key={batch.plan.id}
        style={{ marginTop: 16, paddingTop: 8, borderTopWidth: 1, borderTopColor: aiTokens.border }}>
        <AssistantCalendarBatchAction batch={batch} context={context} navigation={navigation}
          disabled={disabled} onChange={(next) => onChange(next, batch.plan.id)} />
      </View>)}
      {ordered.length > visible ? <AIButton label={`顯示更多行程安排（${ordered.length - visible}）`}
        variant="ghost" disabled={disabled} onPress={() => setVisible((count) => count + 8)} /> : null}
    </>}
  </AICard>;
}
