/**
 * Campus AI-First — 活動列表 V2
 */
import React, { useCallback, useState } from 'react';
import { View, Text } from 'react-native';
import {
  AIDetailScreen,
  AIInsightBanner,
  AISection,
  AIRow,
  AIChip,
  AILegacyLink,
  aiTokens,
} from '../ui/aiFirst';

export default function EventsListAiFirstScreen(props: any) {
  const navigation = props?.navigation;
  const [cat, setCat] = useState<'all' | 'today' | 'week' | 'mine'>('all');

  const go = useCallback(
    (id: string) => () => {
      try {
        navigation?.navigate?.('EventDetail' as never, { id } as never);
      } catch {}
    },
    [navigation],
  );

  return (
    <AIDetailScreen
      title="活動"
      subtitle="本週 8 場 · 你符合 5 場"
      onBack={() => navigation?.goBack?.()}
    >
      <AIInsightBanner
        text="AI 從 24 場活動挑出你最可能參加的 3 場：黑客松、攝影走拍、英文角"
        source="AI · 你的興趣 + 行事曆"
        confidence="mid"
      />

      <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: aiTokens.space.md, marginTop: aiTokens.space.sm }}>
        <AIChip label="全部" active={cat === 'all'} onPress={() => setCat('all')} />
        <AIChip label="今日" active={cat === 'today'} onPress={() => setCat('today')} />
        <AIChip label="本週" active={cat === 'week'} onPress={() => setCat('week')} />
        <AIChip label="我報名的" active={cat === 'mine'} onPress={() => setCat('mine')} />
      </View>

      <AISection title="🔥 AI 為你推薦" subtitle="3 場高相關">
        <AIRow icon="🎉" title="黑客松 2026" subtitle="5/23 09:00 · 工程館 B101" tag="32/50 報" tagTone="ai" onPress={go('E001')} />
        <AIRow icon="📷" title="攝影社校園走拍" subtitle="5/20 16:00 · 行政大樓前" tag="你社團" tagTone="success" onPress={go('E002')} />
        <AIRow icon="🗣" title="英文角 — 國際生交流" subtitle="5/22 18:00 · 圖書館 3F" tag="符合興趣" tagTone="ai" onPress={go('E003')} />
      </AISection>

      <AISection title="本週活動" subtitle="共 8 場">
        <AIRow icon="🎤" title="新詩朗誦比賽" subtitle="5/19 14:00 · 文學院 201" onPress={go('E004')} />
        <AIRow icon="🏀" title="班際盃預賽" subtitle="5/19 18:30 · 體育館" onPress={go('E005')} />
        <AIRow icon="🎭" title="戲劇社公演" subtitle="5/21 19:00 · 學生活動中心" tag="報名爆滿" tagTone="warning" onPress={go('E006')} />
        <AIRow icon="🎬" title="電影欣賞會" subtitle="5/22 19:00 · 視聽教室" onPress={go('E007')} />
        <AIRow icon="🍵" title="台灣茶文化講座" subtitle="5/24 14:00 · 中文系" onPress={go('E008')} />
      </AISection>

      <AISection title="下週起">
        <AIRow icon="🎓" title="畢業典禮" subtitle="6/8 09:00 · 體育館" tag="重要" tagTone="warning" onPress={go('E009')} />
        <AIRow icon="🎪" title="校慶系列活動" subtitle="6/15–17" onPress={go('E010')} />
      </AISection>

      <AILegacyLink label="完整活動系統（含票券、報名表單）" onPress={() => navigation?.navigate?.('EventsLegacy' as never)} />
    </AIDetailScreen>
  );
}
