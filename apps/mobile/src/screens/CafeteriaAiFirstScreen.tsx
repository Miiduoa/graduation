/**
 * Campus AI-First — 餐廳列表 V2
 *
 * 接 demoStore：點餐按鈕 → placeOrder（寫 orders + 通知學生 + 通知商家收件匣）
 * → 切換到「餐廳」角色可在「訊息」收件匣看到 + 推進訂單狀態；
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
  aiTokens,
} from '../ui/aiFirst';
import { useDemoRole } from '../state/demoRole';
import { useDemoStore } from '../state/demoStore';
import { useAuth } from '../state/auth';
import { createDemoDiningOrder, type DemoPaymentMethod } from '../services/demoOrdering';
import { resolveEffectiveDemoAIUser } from '../services/demoAiContext';

export default function CafeteriaAiFirstScreen(props: any) {
  const navigation = props?.navigation;
  const [filter, setFilter] = useState<string>('all');
  const { role, definition } = useDemoRole();
  const auth = useAuth();
  const store = useDemoStore();
  const effectiveUser = resolveEffectiveDemoAIUser({
    profile: auth.profile as any,
    user: auth.user,
    demoRole: role,
  });
  const myUid = effectiveUser.uid ?? 'demo_guest';
  const myName = effectiveUser.displayName ?? definition.label;
  const mySchoolId = effectiveUser.schoolId ?? auth.profile?.schoolId ?? 'pu';
  const myRole = effectiveUser.role ?? role;
  const myOrderCount = store.orders.filter((o) => o.studentId === myUid).length;

  // 訂餐開放給所有 demo 角色 — 教師、系主任、管理員、商家、校友、訪客都會吃午餐。
  async function handleOrder(vendor: string, item: string, price: number, paymentMethod: DemoPaymentMethod) {
    let orderId = '';
    let merchantLabel = vendor;
    let itemLabel = item;
    let total = price;
    const paymentLabel = paymentMethod === 'onsite' ? '到店付款' : '線上付款';
    try {
      const result = await createDemoDiningOrder({
        userId: myUid,
        userName: myName,
        role: myRole,
        schoolId: mySchoolId,
        merchantName: vendor,
        itemName: item,
        quantity: 1,
        price,
        paymentMethod,
        source: 'cafeteria_ai_first',
      });
      orderId = result.order.id;
      merchantLabel = result.merchant.name;
      itemLabel = result.item.name;
      total = result.total;
    } catch (error: any) {
      Alert.alert('訂餐失敗', error?.message ?? 'demo 訂餐流程暫時無法建立訂單。');
      return;
    }
    Alert.alert(
      '訂單已成立',
      `${merchantLabel} 已收到 ${definition.icon} ${myName} 的訂單《${itemLabel}》NT$${total}。\n付款方式：${paymentLabel}\n訂單編號：${orderId}\n切到「餐廳 阿英」可看到訂單；目前角色的訊息 / 訂單頁也會看到紀錄。`,
    );
  }
  function choosePaymentAndOrder(vendor: string, item: string, price: number) {
    Alert.alert('選擇付款方式', `${item} · NT$${price}`, [
      { text: '取消', style: 'cancel' },
      { text: '到店付款', onPress: () => void handleOrder(vendor, item, price, 'onsite') },
      { text: '線上付款', onPress: () => void handleOrder(vendor, item, price, 'online') },
    ]);
  }
  const hour = new Date().getHours();
  const isLunch = hour >= 11 && hour < 14;
  const isDinner = hour >= 17 && hour < 21;
  const period = isLunch ? '中餐' : isDinner ? '晚餐' : '時段';

  return (
    <AIDetailScreen
      title="校園餐廳"
      subtitle={`現營業 8 家 · ${period}尖峰`}
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
          title="口試 Demo 便當店 · 口試招牌雞腿便當"
          badge="保證可訂"
          badgeTone="ai"
          source="demo ordering · 餐廳員工可接單"
          confidence="high"
        >
          <Text style={{ fontSize: 13, color: aiTokens.text, lineHeight: 19 }}>
            <Text style={{ fontWeight: '700' }}>$95</Text> · 口試展示專用 · AI 助理與所有角色都能下單{'\n'}
            切到「餐廳 阿英」即可看到新訂單並推進狀態。
          </Text>
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
            <AIButton label="線上付款" onPress={() => handleOrder('口試 Demo 便當店', '口試招牌雞腿便當', 95, 'online')} />
            <AIButton label="到店付款" variant="ghost" onPress={() => handleOrder('口試 Demo 便當店', '口試招牌雞腿便當', 95, 'onsite')} />
          </View>
        </AICard>

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
            <AIButton label="立即點餐" onPress={() => choosePaymentAndOrder('主餐廳', '紅燒牛肉麵', 95)} />
            <AIButton label="🧭 導航" variant="ghost" onPress={() => navigation?.navigate?.('MapV2' as never, { destination: '主餐廳' } as never)} />
            <AIButton label="查看菜單" variant="ghost" onPress={() => navigation?.navigate?.('MenuDetail' as never, { name: '主餐廳' } as never)} />
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
      <AISection title="所有餐廳" subtitle="9 家 · 8 家現營業">
        <AIRow
          icon="🍱"
          title="口試 Demo 便當店"
          subtitle="口試展示 / AI 可代理下單 / 餐廳員工可接單"
          tag="保證可訂"
          tagTone="ai"
          onPress={() => choosePaymentAndOrder('口試 Demo 便當店', '口試招牌雞腿便當', 95)}
        />
        <AIRow
          icon="🍜"
          title="主餐廳"
          subtitle="麵點 / 便當 / 飲料 · 步行 8 min"
          tag="尖峰"
          tagTone="warning"
          onPress={() => choosePaymentAndOrder('主餐廳', '招牌麵點便當', 90)}
        />
        <AIRow
          icon="🍱"
          title="學生餐廳"
          subtitle="便當 / 自助餐 · 步行 5 min"
          tag="營業中"
          tagTone="success"
          onPress={() => choosePaymentAndOrder('學生餐廳', '雞腿便當', 65)}
        />
        <AIRow
          icon="🥗"
          title="輕食吧"
          subtitle="沙拉 / 三明治 · 步行 6 min"
          tag="營業中"
          tagTone="success"
          onPress={() => choosePaymentAndOrder('輕食吧', '凱薩沙拉', 75)}
        />
        <AIRow
          icon="☕"
          title="咖啡角落"
          subtitle="飲料 / 點心 · 步行 3 min"
          tag="營業中"
          tagTone="success"
          onPress={() => choosePaymentAndOrder('咖啡角落', '拿鐵 + 司康', 110)}
        />
        <AIRow icon="🍔" title="速食吧" subtitle="漢堡 / 薯條 · 步行 10 min" tag="休息" tagTone="muted" disabled />
        <AIRow icon="🍕" title="義式廚房" subtitle="披薩 / 義大利麵 · 步行 12 min" tag="休息" tagTone="muted" disabled />
        <AIRow icon="🏪" title="7-11 校區店" subtitle="便利商店 · 步行 2 min" tag="24h" tagTone="ai" onPress={() => choosePaymentAndOrder('7-11 校區店', '御飯糰套餐', 45)} />
      </AISection>
    </AIDetailScreen>
  );
}
