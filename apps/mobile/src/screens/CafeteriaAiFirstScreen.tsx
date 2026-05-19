/**
 * Campus AI-First — 餐廳列表 V2
 *
 * 接 demoStore：點餐按鈕 → placeOrder（寫 orders + 通知學生 + 通知商家收件匣）
 * → 切換到「餐廳 / admin」角色可在「訊息」收件匣看到 + 推進訂單狀態；
 *   VendorManagement 後台則由 cafeteriaData.getOrders 提供（非 demoStore 路徑）。
 */
import React, { useState } from 'react';
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
import { useDemoRole } from '../state/demoRole';
import { useDemoStore } from '../state/demoStore';
import { placeOrder } from '../services/demoStore';

export default function CafeteriaAiFirstScreen(props: any) {
  const navigation = props?.navigation;
  const [filter, setFilter] = useState<string>('all');
  const { role, definition } = useDemoRole();
  const store = useDemoStore();
  const myOrderCount = store.orders.filter((o) => o.studentId === 'stu-001').length;

  function handleOrder(vendor: string, item: string, price: number) {
    if (role !== 'student') {
      Alert.alert(
        '需切換成學生角色',
        `目前是「${definition.label}」，請至「我的 → 切換角色」改成學生再點餐。`,
      );
      return;
    }
    placeOrder({
      studentId: 'stu-001',
      studentName: '王小明',
      vendorName: vendor,
      items: [{ name: item, qty: 1, price }],
    });
    Alert.alert(
      '訂單已成立',
      `${vendor} 已收到你的訂單《${item}》NT$${price}。\n切換成「餐廳 / 系統管理員」角色 → 訊息收件匣可推進訂單狀態。`,
    );
  }
  const hour = new Date().getHours();
  const isLunch = hour >= 11 && hour < 14;
  const isDinner = hour >= 17 && hour < 21;
  const period = isLunch ? '中餐' : isDinner ? '晚餐' : '時段';

  return (
    <AIDetailScreen
      title="校園餐廳"
      subtitle={`現營業 4 家 · ${period}尖峰`}
      onBack={() => navigation?.goBack?.()}
    >
      <AIInsightBanner
        text={
          role === 'student' && myOrderCount > 0
            ? `你已下 ${myOrderCount} 筆訂單，可至訊息收件匣追蹤備餐進度`
            : `現在 ${hour}:00${
                isLunch ? '，主餐廳人多但便宜實惠' : isDinner ? '，學餐熱炒推薦' : '，仍有 4 家營業中'
              } · 你最近 7 天平均花費 $82 · AI 給你 3 個建議`
        }
        source={role === 'student' && myOrderCount > 0 ? '訂單紀錄' : 'AI · 餐廳人潮 + 你的偏好'}
        confidence="mid"
      />

      {/* AI 推薦 */}
      <AISection title="AI 為你推薦" subtitle="基於時間、預算、營養">
        <AICard
          aiGenerated
          icon="🍱"
          title="主餐廳 · 紅燒牛肉麵"
          badge="★ 最推薦"
          badgeTone="ai"
          source="餐廳人潮 + 你上次給 ⭐4.5"
          confidence="mid"
        >
          <Text style={{ fontSize: 13, color: aiTokens.text, lineHeight: 19 }}>
            <Text style={{ fontWeight: '700' }}>$95</Text> · 步行 8 分 · 等位約 5 分{'\n'}
            營養：650 kcal · 蛋白質 32g
          </Text>
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
            <AIButton label="線上點餐" onPress={() => handleOrder('主餐廳', '紅燒牛肉麵', 95)} />
            <AIButton label="🧭 導航" variant="ghost" />
            <AIButton label="查看菜單" variant="ghost" />
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
            <Text style={{ fontSize: 13, fontWeight: '700' }}>學餐 · 雞腿便當</Text>
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
            <Text style={{ fontSize: 13, fontWeight: '700' }}>7-11 · 御飯糰套餐</Text>
            <Text style={{ fontSize: 16, fontWeight: '700', color: aiTokens.ai, marginTop: 4 }}>$45</Text>
            <Text style={{ fontSize: 11, color: aiTokens.muted, marginTop: 2 }}>2 min · ⭐3.8</Text>
          </View>
        </View>
      </AISection>

      {/* 篩選 */}
      <View
        style={{
          flexDirection: 'row',
          flexWrap: 'wrap',
          gap: 8,
          paddingHorizontal: aiTokens.space.md,
          marginTop: aiTokens.space.md,
        }}
      >
        <AIChip label="全部" active={filter === 'all'} onPress={() => setFilter('all')} />
        <AIChip label="便宜 $50↓" active={filter === 'cheap'} onPress={() => setFilter('cheap')} />
        <AIChip label="快速 5min↓" active={filter === 'fast'} onPress={() => setFilter('fast')} />
        <AIChip label="健康輕食" active={filter === 'healthy'} onPress={() => setFilter('healthy')} />
        <AIChip label="素食友善" active={filter === 'veg'} onPress={() => setFilter('veg')} />
      </View>

      {/* 餐廳列表 */}
      <AISection title="所有餐廳" subtitle="12 家 · 4 家現營業">
        <AIRow
          icon="🍜"
          title="主餐廳"
          subtitle="麵點 / 便當 / 飲料 · 步行 8 min"
          tag="尖峰"
          tagTone="warning"
          onPress={() => handleOrder('主餐廳', '招牌麵點便當', 90)}
        />
        <AIRow
          icon="🍱"
          title="學生餐廳"
          subtitle="便當 / 自助餐 · 步行 5 min"
          tag="營業中"
          tagTone="success"
          onPress={() => handleOrder('學生餐廳', '雞腿便當', 65)}
        />
        <AIRow
          icon="🥗"
          title="輕食吧"
          subtitle="沙拉 / 三明治 · 步行 6 min"
          tag="營業中"
          tagTone="success"
          onPress={() => handleOrder('輕食吧', '凱薩沙拉', 75)}
        />
        <AIRow
          icon="☕"
          title="咖啡角落"
          subtitle="飲料 / 點心 · 步行 3 min"
          tag="營業中"
          tagTone="success"
          onPress={() => handleOrder('咖啡角落', '拿鐵 + 司康', 110)}
        />
        <AIRow icon="🍔" title="速食吧" subtitle="漢堡 / 薯條 · 步行 10 min" tag="休息" tagTone="muted" />
        <AIRow icon="🍕" title="義式廚房" subtitle="披薩 / 義大利麵 · 步行 12 min" tag="休息" tagTone="muted" />
        <AIRow icon="🏪" title="7-11 校區店" subtitle="便利商店 · 步行 2 min" tag="24h" tagTone="ai" />
      </AISection>

      <AILegacyLink
        label="完整餐廳資訊 / 預訂 / 排隊狀態"
        onPress={() => navigation?.navigate?.('CafeteriaLegacy' as never)}
      />
    </AIDetailScreen>
  );
}
