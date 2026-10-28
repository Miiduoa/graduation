import React from 'react';
import { Text, View } from 'react-native';
import { AICard, AIButton, aiTokens } from '../ui/aiFirst';
import type { CampusSenseProgress } from '../services/campusSenseSnapshot';

export function CampusSenseSyncProgress({ progress, onCancel }: {
  progress: CampusSenseProgress | null;
  onCancel: () => void;
}) {
  const known = progress?.total !== null && progress?.total !== undefined;
  const loaded = progress?.loaded ?? 0;
  const total = progress?.total ?? 0;
  const label = known ? `已核對 ${loaded} / ${total} 筆作業` : '正在確認校園資料來源…';
  return (
    <AICard title="正在同步" badge="尚未套用">
      <View style={{ gap: 10 }}>
        <Text accessibilityLiveRegion="polite" style={{ color: aiTokens.text, fontSize: 14, fontWeight: '600' }}>
          {label}
        </Text>
        <View accessibilityRole="progressbar" accessibilityLabel="校園資料同步進度"
          accessibilityValue={known
            ? { min: 0, max: Math.max(1, total), now: total === 0 ? 1 : Math.min(loaded, total), text: label }
            : { text: label }}
          style={{ height: 5, borderRadius: 3, backgroundColor: aiTokens.border, overflow: 'hidden' }}>
          {known ? <View style={{ height: 5, width: `${total === 0 ? 100 : Math.min(100, loaded / total * 100)}%`, backgroundColor: aiTokens.ai }} /> : null}
        </View>
        <Text style={{ color: aiTokens.muted, fontSize: 12, lineHeight: 20 }}>
          分頁資料全部核對後才更新摘要。取消後不再讀下一頁；已送出的唯讀請求可能仍在伺服器完成。
        </Text>
        <AIButton label="停止同步" variant="ghost" size="sm" onPress={onCancel} />
      </View>
    </AICard>
  );
}
