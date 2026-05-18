/**
 * Campus AI-First — 地圖 POI 詳情 V2
 * route.params: { poiId, name?, category? }
 */
import React from 'react';
import { View, Text } from 'react-native';
import {
  AIDetailScreen,
  AIInsightBanner,
  AISection,
  AICard,
  AIButton,
  AIRow,
  AILegacyLink,
  aiTokens,
} from '../ui/aiFirst';

export default function PoiDetailAiFirstScreen(props: any) {
  const navigation = props?.navigation;
  const params = props?.route?.params ?? {};
  const poiId: string = params.poiId || 'P001';
  const name = params.name || '工程館';

  return (
    <AIDetailScreen
      title={name}
      subtitle="教學大樓"
      onBack={() => navigation?.goBack?.()}
    >
      {/* 假圖位置 */}
      <View
        style={{
          marginHorizontal: aiTokens.space.md,
          marginTop: aiTokens.space.md,
          height: 180,
          borderRadius: aiTokens.radius.lg,
          backgroundColor: aiTokens.aiGradientStart,
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
        }}
      >
        <Text style={{ fontSize: 72 }}>🏢</Text>
        <View
          style={{
            position: 'absolute',
            bottom: 12,
            left: 12,
            backgroundColor: 'rgba(255,255,255,0.9)',
            paddingHorizontal: 10,
            paddingVertical: 4,
            borderRadius: aiTokens.radius.pill,
          }}
        >
          <Text style={{ fontSize: 11, color: aiTokens.text, fontWeight: '600' }}>
            🎯 步行 4 分鐘 · 從你目前位置
          </Text>
        </View>
      </View>

      <AIInsightBanner
        text={`現在 ${new Date().getHours()}:${String(new Date().getMinutes()).padStart(2, '0')} · 3F 自習區人不多 · 你下節課（資料結構）就在 302`}
        source="AI · 即時人流 + 你的課表"
        confidence="high"
      />

      {/* 主要動作 */}
      <View
        style={{
          flexDirection: 'row',
          gap: 8,
          marginHorizontal: aiTokens.space.md,
          marginTop: aiTokens.space.sm,
        }}
      >
        <AIButton label="🧭 開始導航" style={{ flex: 1, justifyContent: 'center' }} />
        <AIButton label="📷 AR 模式" variant="ghost" style={{ flex: 1, justifyContent: 'center' }} />
      </View>

      {/* 概要 */}
      <AISection title="場所概要">
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
          <Text style={{ fontSize: 13, color: aiTokens.text, lineHeight: 20 }}>
            <Text style={{ fontWeight: '700' }}>樓層：</Text>1F – 5F{'\n'}
            <Text style={{ fontWeight: '700' }}>開放：</Text>07:00 – 22:00{'\n'}
            <Text style={{ fontWeight: '700' }}>無障礙：</Text>東側電梯 ✓{'\n'}
            <Text style={{ fontWeight: '700' }}>飲水機：</Text>1F / 3F / 5F
          </Text>
        </View>
      </AISection>

      {/* 樓層 */}
      <AISection title="樓層導覽">
        <AIRow icon="5️⃣" title="5F · 教師研究室" subtitle="王老師 502、陳老師 506" />
        <AIRow icon="4️⃣" title="4F · 多媒體實驗室" subtitle="401 – 405 · 需借用" />
        <AIRow icon="3️⃣" title="3F · 自習區" subtitle="開放 7:00–22:00" tag="63% 滿" tagTone="warning" />
        <AIRow
          icon="2️⃣"
          title="2F · 教室"
          subtitle="201 – 210"
          tag="現有 3 堂課"
          tagTone="ai"
        />
        <AIRow icon="1️⃣" title="1F · 大廳 / 系辦" subtitle="開放至 17:30" />
      </AISection>

      {/* AI 相關建議 */}
      <AISection title="AI 為你建議">
        <AICard aiGenerated icon="💡" title="去 3F 自習比 K 書中心好" confidence="mid" source="人流 + 你的偏好">
          <Text style={{ fontSize: 13, color: aiTokens.text, lineHeight: 19 }}>
            K 書中心現在 87% 滿，3F 還有 23 個座位。{'\n'}下節課在 302，自習完直接走過去。
          </Text>
        </AICard>
      </AISection>

      <AILegacyLink
        label="完整地圖 / 室內路徑"
        onPress={() => navigation?.navigate?.('PoiDetailLegacy' as never, params as never)}
      />
    </AIDetailScreen>
  );
}
