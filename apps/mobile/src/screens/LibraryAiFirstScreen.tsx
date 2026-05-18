/**
 * Campus AI-First — 圖書館 V2
 */
import React, { useCallback } from 'react';
import { Alert, View, Text } from 'react-native';
import {
  AIDetailScreen,
  AIInsightBanner,
  AISection,
  AICard,
  AIRow,
  AIButton,
  AILegacyLink,
  aiTokens,
} from '../ui/aiFirst';

export default function LibraryAiFirstScreen(props: any) {
  const navigation = props?.navigation;
  const go = useCallback(
    (screen: string) => () => {
      try {
        navigation?.navigate?.(screen as never);
      } catch {}
    },
    [navigation],
  );

  return (
    <AIDetailScreen
      title="圖書館"
      subtitle="開放至 22:00"
      onBack={() => navigation?.goBack?.()}
    >
      <AIInsightBanner
        text="3F 自習區剩 23 座位（63% 滿）· 你借的《演算法導論》5/22 到期 · 期末讀書區延長到 23:00"
        source="即時館內 + 你的借閱"
        confidence="high"
      />

      <AISection title="即時館內狀況">
        <View
          style={{
            marginHorizontal: aiTokens.space.md,
            padding: aiTokens.space.lg,
            backgroundColor: aiTokens.surface,
            borderRadius: aiTokens.radius.lg,
            borderWidth: 1,
            borderColor: aiTokens.border,
          }}
        >
          <FloorStat name="1F · 大廳" total={80} used={32} />
          <FloorStat name="2F · 期刊區" total={120} used={45} />
          <FloorStat name="3F · 自習區" total={150} used={94} highlight />
          <FloorStat name="4F · 研究小間" total={20} used={18} warn />
        </View>
      </AISection>

      <AISection title="我的借閱">
        <AICard
          icon="📖"
          title="演算法導論（第 4 版）"
          badge="5 天後到期"
          badgeTone="warning"
          source="借閱紀錄"
        >
          <Text style={{ fontSize: 13, color: aiTokens.text, lineHeight: 19 }}>
            借閱日：5/01 · 到期：5/22 · 可續借 1 次
          </Text>
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
            <AIButton label="續借" onPress={() => Alert.alert('已續借', '到期日延至 6/05')} />
            <AIButton label="導航到書架" variant="ghost" />
          </View>
        </AICard>

        <AIRow icon="📚" title="作業系統概念" subtitle="到期：6/01" tag="正常" tagTone="success" />
      </AISection>

      <AISection title="AI 為你推薦">
        <AICard
          aiGenerated
          icon="💡"
          title="《Designing Data-Intensive Applications》"
          source="AI · 你選了資料庫系統"
          confidence="mid"
        >
          <Text style={{ fontSize: 13, color: aiTokens.text, lineHeight: 19 }}>
            與你目前修的「資料庫系統」高度相關，3F 索取號 QA76.9.D32 · 在架
          </Text>
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
            <AIButton label="預約" onPress={() => Alert.alert('已預約', '可到 1F 自助借書機取書')} />
            <AIButton label="找位置" variant="ghost" />
          </View>
        </AICard>
      </AISection>

      <AISection title="服務">
        <AIRow icon="🔍" title="館藏查詢 OPAC" onPress={go('LibrarySearch')} />
        <AIRow icon="📅" title="研究小間預約" subtitle="4F 1 間可預約" onPress={go('RoomReserve')} />
        <AIRow icon="🎓" title="畢業書單建議" subtitle="AI 整理 32 本" tag="AI" tagTone="ai" onPress={go('LibraryAI')} />
        <AIRow icon="💾" title="電子資源" subtitle="期刊、論文、影音" onPress={go('LibraryDigital')} />
      </AISection>

      <AILegacyLink label="完整圖書館系統" onPress={() => navigation?.navigate?.('LibraryLegacy' as never)} />
    </AIDetailScreen>
  );
}

function FloorStat({
  name,
  total,
  used,
  highlight,
  warn,
}: {
  name: string;
  total: number;
  used: number;
  highlight?: boolean;
  warn?: boolean;
}) {
  const pct = Math.round((used / total) * 100);
  const color = warn ? aiTokens.danger : highlight ? aiTokens.ai : aiTokens.muted;
  return (
    <View style={{ marginBottom: 12 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Text style={{ fontSize: 13, fontWeight: '600', color: aiTokens.text }}>{name}</Text>
        <Text style={{ fontSize: 12, color }}>
          {used} / {total}（{pct}%）
        </Text>
      </View>
      <View
        style={{
          marginTop: 6,
          height: 6,
          borderRadius: 3,
          backgroundColor: aiTokens.panel,
          overflow: 'hidden',
        }}
      >
        <View
          style={{
            width: `${pct}%`,
            height: '100%',
            backgroundColor: color,
          }}
        />
      </View>
    </View>
  );
}
