import React, { useState } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { AIButton, aiTokens } from '../ui/aiFirst';
import { LOCAL_READ_LIMIT, type LocalCampusReadResult } from '../services/localCampusToolProtocol';

const SOURCE = {
  'saved-timetable': '手機已保存課表',
  'synced-summary': '先前主動同步摘要',
  combined: '手機課表與授權摘要',
};
const ROUTES: Record<LocalCampusReadResult['route'], string> = {
  '/timetable': '個人課表', '/classroom': '課程與作業', '/announcements': '校園公告',
};

export function CampusLocalReadResults({ results, disabled, onOpenRoute }: {
  results: readonly LocalCampusReadResult[];
  disabled: boolean;
  onOpenRoute?: (route: LocalCampusReadResult['route']) => void;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(results.slice(0, 1).map((item) => item.id)));
  return (
    <View style={{ gap: 10 }}>
      <Text style={{ color: aiTokens.muted, fontSize: 12, lineHeight: 20 }}>
        手機模型選擇查詢項目，結果由本機資料工具產生。沒有即時上網，也沒有執行提交、通知或其他變更。
      </Text>
      {results.slice(0, LOCAL_READ_LIMIT).map((item) => {
        const open = expanded.has(item.id);
        const routeLabel = Object.prototype.hasOwnProperty.call(ROUTES, item.route) ? ROUTES[item.route] : null;
        return (
          <View key={item.id} style={{ borderWidth: 1, borderColor: aiTokens.border, borderRadius: 12, overflow: 'hidden' }}>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel={item.label + '查詢結果'}
              accessibilityState={{ expanded: open, disabled }}
              disabled={disabled}
              onPress={() => setExpanded((previous) => {
                const next = new Set(previous);
                if (next.has(item.id)) next.delete(item.id); else next.add(item.id);
                return next;
              })}
              style={{ padding: 13, gap: 6, minHeight: 56, backgroundColor: aiTokens.panel }}
            >
              <Text style={{ color: aiTokens.text, fontWeight: '700', fontSize: 14 }}>{item.label} {open ? '−' : '+'}</Text>
              <Text style={{ color: item.status === 'available' ? aiTokens.muted : aiTokens.warning, fontSize: 12 }}>
                {item.status === 'available' ? '已核對可用資料' : '資料不足，需確認來源'} · {SOURCE[item.source]}
              </Text>
            </TouchableOpacity>
            {open ? (
              <View style={{ padding: 13, gap: 12 }}>
                <Text selectable style={{ color: aiTokens.text, fontSize: 13, lineHeight: 23 }}>{item.content}</Text>
                {routeLabel && onOpenRoute ? (
                  <AIButton label={'開啟' + routeLabel + '核對'} size="sm" variant="ghost" disabled={disabled}
                    onPress={() => onOpenRoute(item.route)} />
                ) : null}
              </View>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}
