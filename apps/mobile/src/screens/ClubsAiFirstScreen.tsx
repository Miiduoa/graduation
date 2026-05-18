/**
 * Campus AI-First — 社團頁 V2
 */
import React, { useCallback, useState } from 'react';
import { Alert, View, Text } from 'react-native';
import {
  AIDetailScreen,
  AIInsightBanner,
  AISection,
  AICard,
  AIRow,
  AIChip,
  AIButton,
  AILegacyLink,
  aiTokens,
} from '../ui/aiFirst';

export default function ClubsAiFirstScreen(props: any) {
  const navigation = props?.navigation;
  const [filter, setFilter] = useState<'all' | 'mine' | 'recruit'>('all');

  const go = useCallback(
    (screen: string, params?: any) => () => {
      try {
        navigation?.navigate?.(screen as never, params as never);
      } catch {}
    },
    [navigation],
  );

  return (
    <AIDetailScreen
      title="社團"
      subtitle="加入 2 個 · 8 個招新"
      onBack={() => navigation?.goBack?.()}
    >
      <AIInsightBanner
        text="你已加入 2 個社團（程式設計社 + 攝影社）· AI 看到 3 個社團跟你興趣高度相符"
        source="AI · 你的活動偏好"
        confidence="mid"
      />

      <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: aiTokens.space.md, marginTop: aiTokens.space.sm }}>
        <AIChip label="全部 28" active={filter === 'all'} onPress={() => setFilter('all')} />
        <AIChip label="我的 2" active={filter === 'mine'} onPress={() => setFilter('mine')} />
        <AIChip label="招新中 8" active={filter === 'recruit'} onPress={() => setFilter('recruit')} />
      </View>

      {(filter === 'all' || filter === 'mine') && (
        <AISection title="我的社團">
          <AICard
            icon="💻"
            title="程式設計社"
            badge="幹部"
            badgeTone="ai"
            onPress={go('ClubDetail', { id: 'C001' })}
          >
            <Text style={{ fontSize: 13, color: aiTokens.text, lineHeight: 19 }}>
              <Text style={{ fontWeight: '700' }}>120 位成員</Text> · 你是技術組副組長{'\n'}
              下次活動：黑客松 5/23 · 報名 32/50
            </Text>
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
              <AIButton label="社團管理" onPress={go('ClubManagement', { id: 'C001' })} />
              <AIButton label="活動排程" variant="ghost" onPress={go('Calendar')} />
            </View>
          </AICard>

          <AIRow
            icon="📷"
            title="攝影社"
            subtitle="46 位成員 · 5/20 校園走拍"
            tag="本週活動"
            tagTone="ai"
            onPress={go('ClubDetail', { id: 'C002' })}
          />
        </AISection>
      )}

      {(filter === 'all' || filter === 'recruit') && (
        <AISection title="AI 為你推薦" subtitle="基於你的興趣 + 課程">
          <AICard
            aiGenerated
            icon="🎸"
            title="吉他社"
            badge="高相關"
            badgeTone="ai"
            source="AI · 你 5/15 對 Live 表演按過讚"
            confidence="mid"
          >
            <Text style={{ fontSize: 13, color: aiTokens.text, lineHeight: 19 }}>
              5/19 19:00 招新講座 · 學生活動中心 201
            </Text>
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
              <AIButton label="加入講座" onPress={() => Alert.alert('已報名', '吉他社招新講座')} />
              <AIButton label="查看社團" variant="ghost" onPress={go('ClubDetail', { id: 'C003' })} />
            </View>
          </AICard>

          <AIRow icon="🎨" title="美術社" subtitle="32 人 · 油畫 / 水彩" tag="招新" tagTone="ai" onPress={go('ClubDetail', { id: 'C004' })} />
          <AIRow icon="⚽" title="足球社" subtitle="58 人 · 週六晨練" tag="招新" tagTone="ai" onPress={go('ClubDetail', { id: 'C005' })} />
        </AISection>
      )}

      {filter === 'all' && (
        <AISection title="所有社團" subtitle="28 個">
          <AIRow icon="🎭" title="戲劇社" subtitle="42 人" onPress={go('ClubDetail', { id: 'C006' })} />
          <AIRow icon="🎤" title="熱音社" subtitle="60 人" onPress={go('ClubDetail', { id: 'C007' })} />
          <AIRow icon="🏀" title="籃球社" subtitle="88 人" onPress={go('ClubDetail', { id: 'C008' })} />
          <AIRow icon="📖" title="讀書會" subtitle="24 人" onPress={go('ClubDetail', { id: 'C009' })} />
        </AISection>
      )}

      <AILegacyLink label="完整社團系統（含財務、活動排程、表單）" onPress={() => navigation?.navigate?.('ClubsLegacy' as never)} />
    </AIDetailScreen>
  );
}
