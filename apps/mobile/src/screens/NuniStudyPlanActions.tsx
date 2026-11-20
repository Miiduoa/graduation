import React from 'react';
import { Text, View } from 'react-native';
import { AIButton, aiTokens } from '../ui/aiFirst';

/** Planning reads this account's sources; it does not need a downloaded AI model. */
export function NuniStudyPlanActions({ disabled, onToday, onWeek }: {
  disabled: boolean;
  onToday: () => void;
  onWeek: () => void;
}) {
  return (
    <View style={{ marginTop: 12, gap: 10 }}>
      <Text style={{ color: aiTokens.textSecondary, fontSize: 13, lineHeight: 21 }}>
        依這個帳號保存的課表安排時間，並連線核對已連結的 nuni 課堂作業。未連結或讀取不完整的部分會另外標示。
      </Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        <AIButton label="整理今日重點" variant="ghost" disabled={disabled} onPress={onToday} />
        <AIButton label="規劃未來七天" variant="ghost" disabled={disabled} onPress={onWeek} />
      </View>
    </View>
  );
}
