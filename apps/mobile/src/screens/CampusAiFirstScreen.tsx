/**
 * Campus AI-First — 校園 Tab Landing
 *
 * 設計：把校園當「場域」，根據時間 / 位置 / 偏好給建議
 * 設計規範：docs/design/AI_FIRST_REDESIGN.md
 */
import React from 'react';
import { Alert, View, Text } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import {
  AIScreen,
  AIHero,
  AISection,
  AICard,
  AIRow,
  AIButton,
  AIChip,
  AIMark,
  aiTokens,
} from '../ui/aiFirst';

export default function CampusAiFirstScreen() {
  const navigation = useNavigation<any>();
  const hour = new Date().getHours();
  const isLunch = hour >= 11 && hour < 14;
  const go = (screen: string, params?: Record<string, unknown>) => {
    navigation?.navigate?.(screen as never, params as never);
  };
  const openDemoOrdering = () => go('Ordering', {
    cafeteriaId: 'merchant_demo_exam_bento',
    cafeteria: '口試 Demo 便當店',
    itemName: '口試招牌雞腿便當',
    quantity: 1,
  });

  return (
    <AIScreen>
      <AIHero
        eyebrow="CAMPUS · 校園即時"
        title={isLunch ? '中午了\n要吃什麼？' : '校園資源\n一站尋找'}
        subtitle={isLunch ? 'AI 已根據你的偏好排好 3 個建議' : '地圖、餐廳、圖書館、社團、活動'}
      />

      {/* 中午吃什麼 */}
      {isLunch && (
        <AISection title="中午選擇" subtitle="AI 比較了 12 家，給你 3 個最適合">
          <AICard
            aiGenerated
            icon="🍱"
            title="主餐廳"
            badge="★ 推薦"
            badgeTone="ai"
            source="餐廳資料 + 你的偏好"
            confidence="mid"
          >
            <Text style={{ fontSize: 13, color: aiTokens.text, lineHeight: 19 }}>
              <Text style={{ fontWeight: '700' }}>$95</Text> · 步行 8 分鐘 · 你上次 ⭐4.5
              {'\n'}今日主餐：紅燒牛肉麵、糖醋排骨
            </Text>
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
              <AIButton label="🧭 導航" onPress={() => go('MapV2', { destination: '主餐廳' })} />
              <AIButton label="查看菜單" variant="ghost" onPress={() => go('MenuDetail', { name: '口試 Demo 便當店' })} />
              <AIButton label="線上點餐" variant="ghost" onPress={openDemoOrdering} />
            </View>
          </AICard>

          <View style={{ flexDirection: 'row', gap: 8, marginHorizontal: aiTokens.space.md, marginBottom: 8 }}>
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
              <Text style={{ fontSize: 13, fontWeight: '700' }}>學餐</Text>
              <Text style={{ fontSize: 16, fontWeight: '700', color: aiTokens.ai, marginTop: 4 }}>$65</Text>
              <Text style={{ fontSize: 11, color: aiTokens.muted, marginTop: 2 }}>5 min · ⭐4.2</Text>
            </View>
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
              <Text style={{ fontSize: 13, fontWeight: '700' }}>7-11</Text>
              <Text style={{ fontSize: 16, fontWeight: '700', color: aiTokens.ai, marginTop: 4 }}>$45</Text>
              <Text style={{ fontSize: 11, color: aiTokens.muted, marginTop: 2 }}>2 min · ⭐3.8</Text>
            </View>
          </View>
        </AISection>
      )}

      {/* 立即可用 */}
      <AISection title="現在可用" subtitle="即時校園資訊">
        <AIRow
          icon="🗺"
          title="校園地圖 · AR 導航"
          subtitle="找教室、廁所、會議室"
          onPress={() => go('MapV2')}
        />
        <AIRow
          icon="📚"
          title="圖書館"
          subtitle="3F 自習區 · 剩 23 個座位"
          tag="63% 滿"
          tagTone="warning"
          onPress={() => go('Library')}
        />
        <AIRow
          icon="🚌"
          title="校車"
          subtitle="下班 14:20 · 還有 32 分鐘"
          tag="14:20"
          tagTone="ai"
          onPress={() => go('BusV2')}
        />
        <AIRow
          icon="🍱"
          title="餐廳"
          subtitle={isLunch ? '正午尖峰 · 主餐廳 8 min' : '4 家現營業'}
          tag={isLunch ? '尖峰' : '營業中'}
          tagTone={isLunch ? 'warning' : 'success'}
          onPress={() => go('餐廳總覽')}
        />
      </AISection>

      {/* 社團 & 活動 */}
      <AISection title="社團與活動" subtitle="本週 5 場活動 + 3 個社團招新">
        <AICard icon="🎉" title="黑客松報名中" source="程式設計社" badge="社團活動" badgeTone="ai">
          <Text style={{ fontSize: 13, color: aiTokens.text }}>
            5/23 09:00 工程館 B101 · 已 32/50 報名
          </Text>
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
            <AIButton label="立即報名" onPress={() => Alert.alert('已報名', '黑客松報名資料已送出，活動會出現在通知中。')} />
            <AIButton label="查看詳情" variant="ghost" onPress={() => Alert.alert('黑客松 2026', '5/23 09:00 工程館 B101，已 32/50 報名。')} />
          </View>
        </AICard>

        <AIRow
          icon="🎸"
          title="吉他社 — 招新講座"
          subtitle="5/19 19:00 學生活動中心 201"
          tag="本週"
          tagTone="ai"
          onPress={() => Alert.alert('吉他社招新講座', '已加入你的活動提醒。')}
        />
        <AIRow
          icon="📷"
          title="攝影社 — 校園走拍"
          subtitle="5/20 16:00 集合點：行政大樓前"
          onPress={() => Alert.alert('攝影社校園走拍', '集合點：行政大樓前，已開啟活動資訊。')}
        />
      </AISection>

      {/* Quick filters */}
      <AISection title="探索校園">
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: aiTokens.space.md }}>
          <AIChip label="找教室" onPress={() => go('MapV2', { query: '教室' })} />
          <AIChip label="找廁所" onPress={() => go('MapV2', { query: '廁所' })} />
          <AIChip label="找充電插座" onPress={() => go('MapV2', { query: '充電插座' })} />
          <AIChip label="無障礙路線" onPress={() => go('AccessibleRoute')} />
          <AIChip label="場地預約" onPress={() => Alert.alert('場地預約', '已開啟可預約場地清單。')} />
          <AIChip label="校園活動" onPress={() => Alert.alert('校園活動', '已整理本週活動與報名狀態。')} />
        </View>
      </AISection>

      <View
        style={{
          marginHorizontal: aiTokens.space.md,
          marginTop: aiTokens.space.lg,
          padding: aiTokens.space.md,
          backgroundColor: aiTokens.aiSurface,
          borderRadius: aiTokens.radius.md,
          borderWidth: 1,
          borderColor: aiTokens.aiSoft,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
        }}
      >
        <AIMark size={32} />
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 13, fontWeight: '700' }}>找不到？問 AI</Text>
          <Text style={{ fontSize: 12, color: aiTokens.muted, marginTop: 2 }}>
            「最近的飲水機」「下次校車幾點」「圖書館還有位子嗎」
          </Text>
        </View>
      </View>
    </AIScreen>
  );
}
