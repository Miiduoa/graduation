/**
 * Campus AI-First — 餐廳菜單詳情 V2
 */
import React from 'react';
import { View, Text } from 'react-native';
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

export default function MenuDetailAiFirstScreen(props: any) {
  const navigation = props?.navigation;
  const params = props?.route?.params ?? {};
  const restaurantName = params.name || '主餐廳';

  return (
    <AIDetailScreen
      title={restaurantName}
      subtitle="今日 12 個品項"
      onBack={() => navigation?.goBack?.()}
    >
      {/* 餐廳 hero */}
      <View
        style={{
          marginHorizontal: aiTokens.space.md,
          marginTop: aiTokens.space.md,
          height: 140,
          borderRadius: aiTokens.radius.lg,
          backgroundColor: aiTokens.aiGradientStart,
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
          position: 'relative',
        }}
      >
        <Text style={{ fontSize: 80 }}>🍱</Text>
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
            ⭐ 4.5 · 350 評論 · 11:00–14:00 / 17:00–21:00
          </Text>
        </View>
      </View>

      <AIInsightBanner
        text="AI 從 12 項主餐挑出 3 個符合你的飲食偏好（$60–100、不辣、日式優先）"
        source="AI · 你的偏好 + 營養資料"
        confidence="mid"
      />

      {/* 主推三選一 */}
      <AISection title="AI 為你推薦" subtitle="3 個最適合你">
        <AICard
          aiGenerated
          icon="🍜"
          title="紅燒牛肉麵"
          badge="★ 最推薦"
          badgeTone="ai"
          source="你上次給 ⭐4.8"
          confidence="mid"
        >
          <Text style={{ fontSize: 13, color: aiTokens.text, lineHeight: 19 }}>
            <Text style={{ fontWeight: '700' }}>$95</Text> · 650 kcal · 蛋白質 32g{'\n'}
            湯頭濃郁、牛肉軟嫩。你週三常點。
          </Text>
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
            <AIButton label="加入訂單" icon="🛒" />
            <AIButton label="今日預訂" variant="ghost" />
          </View>
        </AICard>

        <View
          style={{
            flexDirection: 'row',
            gap: 8,
            marginHorizontal: aiTokens.space.md,
            marginBottom: 8,
          }}
        >
          <Pick name="鮭魚定食" price="$120" kcal="580" />
          <Pick name="日式咖哩飯" price="$85" kcal="720" />
        </View>
      </AISection>

      {/* 完整菜單 */}
      <AISection title="完整菜單" subtitle="12 個品項">
        <AIRow icon="🍜" title="紅燒牛肉麵" subtitle="650 kcal" tag="$95" tagTone="ai" />
        <AIRow icon="🍱" title="日式咖哩飯" subtitle="720 kcal" tag="$85" tagTone="ai" />
        <AIRow icon="🐟" title="鮭魚定食" subtitle="580 kcal" tag="$120" tagTone="ai" />
        <AIRow icon="🍝" title="奶油義大利麵" subtitle="780 kcal" tag="$100" tagTone="ai" />
        <AIRow icon="🥗" title="凱薩沙拉" subtitle="280 kcal" tag="$75" tagTone="ai" />
        <AIRow icon="🍛" title="豬排咖哩" subtitle="850 kcal" tag="$110" tagTone="ai" />
        <AIRow icon="🍤" title="海鮮炒飯" subtitle="690 kcal" tag="$95" tagTone="ai" />
      </AISection>

      {/* 評論 */}
      <AISection title="近期評論">
        <Review name="陳同學" stars="⭐⭐⭐⭐⭐" body="牛肉麵真的很好吃，份量很多" />
        <Review name="林同學" stars="⭐⭐⭐⭐" body="鮭魚很新鮮，但飯有點冷" />
      </AISection>

      <AILegacyLink
        label="完整餐廳資訊（含庫存、預訂、評論完整）"
        onPress={() => navigation?.navigate?.('MenuDetailLegacy' as never, params as never)}
      />
    </AIDetailScreen>
  );
}

function Pick({ name, price, kcal }: { name: string; price: string; kcal: string }) {
  return (
    <View
      style={{
        flex: 1,
        padding: 12,
        backgroundColor: aiTokens.surface,
        borderRadius: aiTokens.radius.md,
        borderWidth: 1,
        borderColor: aiTokens.border,
      }}
    >
      <Text style={{ fontSize: 13, fontWeight: '700' }}>{name}</Text>
      <Text style={{ fontSize: 16, fontWeight: '700', color: aiTokens.ai, marginTop: 4 }}>
        {price}
      </Text>
      <Text style={{ fontSize: 11, color: aiTokens.muted, marginTop: 2 }}>{kcal} kcal</Text>
    </View>
  );
}

function Review({ name, stars, body }: { name: string; stars: string; body: string }) {
  return (
    <View
      style={{
        marginHorizontal: aiTokens.space.md,
        padding: aiTokens.space.md,
        backgroundColor: aiTokens.surface,
        borderRadius: aiTokens.radius.md,
        borderWidth: 1,
        borderColor: aiTokens.border,
        marginBottom: 8,
      }}
    >
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Text style={{ fontSize: 13, fontWeight: '600', color: aiTokens.text }}>{name}</Text>
        <Text style={{ fontSize: 12 }}>{stars}</Text>
      </View>
      <Text style={{ fontSize: 12, color: aiTokens.muted, marginTop: 4 }}>{body}</Text>
    </View>
  );
}
