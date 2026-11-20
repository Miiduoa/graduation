import React from 'react';
import { Text, View } from 'react-native';
import type { CampusSenseSnapshot } from '../services/campusSenseSnapshot';
import { aiTokens } from '../ui/aiFirst';

export function CampusAssignmentCoverage({ assignments }: {
  assignments: CampusSenseSnapshot['assignments'];
}) {
  if (assignments.status !== 'available' || assignments.count === null) {
    return (
      <Text style={{ color: aiTokens.muted, fontSize: 12, lineHeight: 20 }}>
        作業來源未取得，不能當作待交作業為 0。
      </Text>
    );
  }
  const loaded = assignments.items.length;
  const total = assignments.count;
  const complete = loaded === total;
  const fraction = total > 0 ? Math.min(1, loaded / total) : 1;
  const explanation = complete
    ? total === 0
      ? '本次已接通來源未列出待交作業，不代表其他學校系統也沒有作業。'
      : '已接通來源的作業已全部取得；規劃可使用完整清單，不代表所有校方系統皆已串接。'
    : assignments.coverage?.reason === 'read-budget'
      ? '已達本次同步讀取上限，其餘 ' + Math.max(0, total - loaded) + ' 筆尚未載入。請到課程頁核對，規劃不是完整清單。'
      : '目前服務只回傳部分作業，其餘項目未納入規劃。請到課程頁核對，不能把已載入筆數當作全部。';
  return (
    <View style={{ gap: 7, paddingVertical: 4 }}>
      <Text style={{ color: complete ? aiTokens.text : aiTokens.warning, fontSize: 13, fontWeight: '600' }}>
        作業已取得 {loaded} / {total} 筆{complete ? ' · 來源內完整' : ' · 部分資料'}
      </Text>
      <View accessible accessibilityRole="progressbar"
        accessibilityLabel="已接通作業資料完整度"
        accessibilityValue={{ min: 0, max: Math.max(total, 1), now: total === 0 ? 1 : Math.min(loaded, total), text: loaded + ' / ' + total + ' 筆' }}
        style={{ height: 4, borderRadius: 2, overflow: 'hidden', backgroundColor: aiTokens.border }}>
        <View style={{ height: 4, width: `${fraction * 100}%`, backgroundColor: complete ? aiTokens.ai : aiTokens.warning }} />
      </View>
      <Text style={{ color: aiTokens.muted, fontSize: 12, lineHeight: 20 }}>{explanation}</Text>
    </View>
  );
}
