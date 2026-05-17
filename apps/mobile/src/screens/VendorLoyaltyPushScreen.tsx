/**
 * Vendor Loyalty Push — 餐廳推播給回頭客
 *
 * 從訂單歷史聚合「回頭客」（同 studentUid 訂過 ≥ 2 次）→ 列名單 → 選範本 → 送出
 * 實際送出：emit `announcement_posted`（小範圍 targetUids = 選中的學生 uid）
 *
 * UX：
 *   - 自動標出 VIP（≥ 5 次）
 *   - 全選 / 取消全選 / 個別勾選
 *   - 3 個範本（限時優惠 / 新品上架 / 感謝惠顧）
 *   - 自訂訊息（< 100 字）
 */
import React, { useMemo, useState } from 'react';
import {
  ScrollView,
  View,
  Text,
  Pressable,
  TextInput,
  StyleSheet,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { theme } from '../ui/theme';
import { useTabBarContentBottomPadding } from '../ui/navigationTheme';
import {
  CockpitHero,
  CockpitMetricRow,
  CockpitMetricChip,
  CockpitSection,
} from '../ui/cockpitShell';
import { useAuth } from '../state/auth';
import { useMerchantContext } from '../hooks/useMerchantContext';
import {
  DEMO_MERCHANT_ORDERS,
  DEMO_MERCHANTS,
  getDemoOrdersByMerchant,
} from '../data/demoMerchants';
import { emitAnnouncementPosted } from '../services/roleEventBus';

const TEMPLATES = [
  {
    key: 'discount',
    label: '🎁 限時 9 折',
    body: '感謝您常常光顧！這週六前點購任何品項皆 9 折。',
  },
  {
    key: 'newitem',
    label: '🆕 新品上架',
    body: '我們上架了新菜單！想知道嗎？回頭再來看看吧。',
  },
  {
    key: 'thanks',
    label: '🙏 感謝惠顧',
    body: '謝謝您一直支持小店。期待再次見到您。',
  },
];

interface RepeatCustomer {
  uid: string;
  name: string;
  orderCount: number;
  totalSpent: number;
  lastOrderAt: string;
  isVip: boolean; // ≥ 5 次
}

function aggregateRepeatCustomers(merchantId: string): RepeatCustomer[] {
  const orders = getDemoOrdersByMerchant(merchantId);
  const map = new Map<string, RepeatCustomer>();
  for (const o of orders) {
    if (!o.studentUid) continue;
    const existing = map.get(o.studentUid);
    if (existing) {
      existing.orderCount += 1;
      existing.totalSpent += o.total;
      if (new Date(o.orderedAt) > new Date(existing.lastOrderAt)) {
        existing.lastOrderAt = o.orderedAt;
      }
    } else {
      map.set(o.studentUid, {
        uid: o.studentUid,
        name: o.studentName,
        orderCount: 1,
        totalSpent: o.total,
        lastOrderAt: o.orderedAt,
        isVip: false,
      });
    }
  }
  // demo: 把已有 ≥ 1 次的也當回頭客（資料少）
  return Array.from(map.values())
    .map((c) => ({ ...c, isVip: c.orderCount >= 3 }))
    .sort((a, b) => b.orderCount - a.orderCount);
}

export default function VendorLoyaltyPushScreen() {
  const auth = useAuth();
  const bottomPad = useTabBarContentBottomPadding();
  const merchantCtx = useMerchantContext();
  const merchantId = merchantCtx.current?.merchant.id ?? DEMO_MERCHANTS[0]?.id ?? 'merchant_cafe_a';
  const merchant = DEMO_MERCHANTS.find((m) => m.id === merchantId);

  const customers = useMemo(() => aggregateRepeatCustomers(merchantId), [merchantId]);
  const vips = customers.filter((c) => c.isVip);

  const [selectedSet, setSelectedSet] = useState<Set<string>>(new Set(vips.map((v) => v.uid)));
  const [templateKey, setTemplateKey] = useState<string>('discount');
  const [customMessage, setCustomMessage] = useState<string>('');
  const [sending, setSending] = useState(false);

  const toggle = (uid: string) => {
    setSelectedSet((s) => {
      const next = new Set(s);
      if (next.has(uid)) next.delete(uid);
      else next.add(uid);
      return next;
    });
  };
  const selectAll = () => setSelectedSet(new Set(customers.map((c) => c.uid)));
  const selectVipsOnly = () => setSelectedSet(new Set(vips.map((c) => c.uid)));
  const clearAll = () => setSelectedSet(new Set());

  const messageToSend = customMessage.trim()
    ? customMessage.trim()
    : TEMPLATES.find((t) => t.key === templateKey)?.body ?? '';

  const send = async () => {
    if (selectedSet.size === 0) {
      Alert.alert('沒有選擇對象', '請先勾選要推播的回頭客。');
      return;
    }
    if (!messageToSend) {
      Alert.alert('沒有訊息內容', '請選範本或自訂訊息。');
      return;
    }
    setSending(true);
    try {
      await emitAnnouncementPosted({
        actorUid: auth.user?.uid ?? 'demo_cafeteria',
        actorName: merchant?.name ?? '店家',
        targetUids: Array.from(selectedSet),
        courseId: merchantId, // 借用 courseId 欄位放 merchantId
        courseName: merchant?.name ?? '店家',
        payload: {
          title: `${merchant?.name ?? '店家'} · 來自店家的訊息`,
          content: messageToSend,
        },
      });
      Alert.alert(
        '推播已送出',
        `已推送給 ${selectedSet.size} 位回頭客。\n\n（demo：對方 inbox 會立即收到）`,
        [{ text: '了解' }],
      );
      setCustomMessage('');
    } catch (e) {
      Alert.alert('送出失敗', String((e as Error)?.message ?? e));
    } finally {
      setSending(false);
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.bg }} edges={['top']}>
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: theme.layout.screenHorizontalPadding,
          paddingTop: theme.space.md,
          paddingBottom: bottomPad,
        }}
        showsVerticalScrollIndicator={false}
      >
        <CockpitHero
          eyebrow={`📣 ${merchant?.name ?? '店家'} · Loyalty 推播`}
          title="留住回頭客的下一張單"
          summary="從訂單歷史找出回頭客，一鍵推播限時優惠 / 新品 / 感謝訊息。"
        />

        <CockpitMetricRow>
          <CockpitMetricChip label="回頭客" value={customers.length} />
          <CockpitMetricChip label="VIP" value={vips.length} tone="success" />
          <CockpitMetricChip label="已勾選" value={selectedSet.size} tone={selectedSet.size > 0 ? 'success' : undefined} />
          <CockpitMetricChip label="範本" value={TEMPLATES.length} />
        </CockpitMetricRow>

        {/* 快速勾選 */}
        <View style={{ flexDirection: 'row', gap: theme.space.xs, marginBottom: theme.space.md }}>
          <Pressable
            onPress={selectAll}
            style={({ pressed }) => ({
              flex: 1,
              paddingVertical: theme.space.sm,
              borderRadius: theme.radius.md,
              backgroundColor: theme.colors.surface,
              borderWidth: StyleSheet.hairlineWidth,
              borderColor: theme.colors.border,
              alignItems: 'center',
              opacity: pressed ? 0.85 : 1,
            })}
          >
            <Text style={{ color: theme.colors.text, fontSize: 12, fontWeight: '600' }}>全選</Text>
          </Pressable>
          <Pressable
            onPress={selectVipsOnly}
            style={({ pressed }) => ({
              flex: 1,
              paddingVertical: theme.space.sm,
              borderRadius: theme.radius.md,
              backgroundColor: theme.colors.surface,
              borderWidth: StyleSheet.hairlineWidth,
              borderColor: theme.colors.border,
              alignItems: 'center',
              opacity: pressed ? 0.85 : 1,
            })}
          >
            <Text style={{ color: theme.colors.text, fontSize: 12, fontWeight: '600' }}>僅 VIP</Text>
          </Pressable>
          <Pressable
            onPress={clearAll}
            style={({ pressed }) => ({
              flex: 1,
              paddingVertical: theme.space.sm,
              borderRadius: theme.radius.md,
              backgroundColor: theme.colors.surface,
              borderWidth: StyleSheet.hairlineWidth,
              borderColor: theme.colors.border,
              alignItems: 'center',
              opacity: pressed ? 0.85 : 1,
            })}
          >
            <Text style={{ color: theme.colors.muted, fontSize: 12, fontWeight: '600' }}>清空</Text>
          </Pressable>
        </View>

        {/* 模板選擇 */}
        <View style={{ marginBottom: theme.space.md }}>
          <Text style={{ fontSize: 12, color: theme.colors.muted, marginBottom: theme.space.xs }}>
            訊息範本
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space.xs }}>
            {TEMPLATES.map((t) => {
              const active = t.key === templateKey;
              return (
                <Pressable
                  key={t.key}
                  onPress={() => setTemplateKey(t.key)}
                  style={({ pressed }) => ({
                    paddingHorizontal: theme.space.sm + 2,
                    paddingVertical: theme.space.xs + 2,
                    borderRadius: theme.radius.full,
                    backgroundColor: active ? theme.colors.text : theme.colors.surface,
                    borderWidth: StyleSheet.hairlineWidth,
                    borderColor: active ? theme.colors.text : theme.colors.border,
                    opacity: pressed ? 0.85 : 1,
                  })}
                >
                  <Text
                    style={{
                      color: active ? theme.colors.bg : theme.colors.text,
                      fontSize: 12,
                      fontWeight: '600',
                    }}
                  >
                    {t.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        {/* 自訂訊息（覆寫範本） */}
        <View
          style={{
            marginBottom: theme.space.md,
            padding: theme.space.md,
            borderRadius: theme.radius.lg,
            backgroundColor: theme.colors.surface,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: theme.colors.border,
          }}
        >
          <Text style={{ fontSize: 12, color: theme.colors.muted, marginBottom: theme.space.xs }}>
            自訂訊息（覆寫上方範本）
          </Text>
          <TextInput
            value={customMessage}
            onChangeText={(t) => setCustomMessage(t.slice(0, 100))}
            placeholder={TEMPLATES.find((t) => t.key === templateKey)?.body ?? ''}
            placeholderTextColor={theme.colors.muted}
            multiline
            style={{
              fontSize: 14,
              color: theme.colors.text,
              minHeight: 60,
              padding: 0,
            }}
          />
          <Text style={{ fontSize: 11, color: theme.colors.muted, marginTop: 4, textAlign: 'right' }}>
            {customMessage.length} / 100
          </Text>
        </View>

        {/* 回頭客清單 */}
        <CockpitSection
          label="🎯 推播對象"
          count={customers.length}
          open
          onToggle={() => undefined}
        >
          {customers.length === 0 ? (
            <Text style={{ color: theme.colors.muted, fontSize: 13, padding: theme.space.md }}>
              本店家還沒有累積的回頭客資料。
            </Text>
          ) : (
            customers.map((c) => {
              const checked = selectedSet.has(c.uid);
              return (
                <Pressable
                  key={c.uid}
                  onPress={() => toggle(c.uid)}
                  style={({ pressed }) => ({
                    flexDirection: 'row',
                    alignItems: 'center',
                    padding: theme.space.md,
                    borderRadius: theme.radius.md,
                    backgroundColor: checked ? theme.colors.accentSoft : theme.colors.surface,
                    borderWidth: StyleSheet.hairlineWidth,
                    borderColor: theme.colors.border,
                    marginBottom: theme.space.xs,
                    gap: theme.space.sm,
                    opacity: pressed ? 0.85 : 1,
                  })}
                >
                  <Ionicons
                    name={checked ? 'checkmark-circle' : 'ellipse-outline'}
                    size={22}
                    color={checked ? theme.colors.accent : theme.colors.muted}
                  />
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 14, fontWeight: '700', color: theme.colors.text }}>
                      {c.name}{c.isVip ? ' ⭐ VIP' : ''}
                    </Text>
                    <Text style={{ fontSize: 12, color: theme.colors.muted, marginTop: 2 }}>
                      訂過 {c.orderCount} 次 · 累計 NT$ {c.totalSpent}
                    </Text>
                  </View>
                </Pressable>
              );
            })
          )}
        </CockpitSection>

        {/* 送出按鈕 */}
        <Pressable
          onPress={send}
          disabled={sending || selectedSet.size === 0}
          style={({ pressed }) => ({
            marginTop: theme.space.md,
            paddingVertical: theme.space.md,
            borderRadius: theme.radius.md,
            backgroundColor: selectedSet.size === 0 ? theme.colors.surfaceMuted : theme.colors.text,
            alignItems: 'center',
            flexDirection: 'row',
            justifyContent: 'center',
            gap: 6,
            opacity: pressed || sending ? 0.7 : 1,
          })}
        >
          <Ionicons
            name="paper-plane"
            size={16}
            color={selectedSet.size === 0 ? theme.colors.muted : theme.colors.bg}
          />
          <Text
            style={{
              color: selectedSet.size === 0 ? theme.colors.muted : theme.colors.bg,
              fontSize: 14,
              fontWeight: '700',
            }}
          >
            送出推播給 {selectedSet.size} 位 · {sending ? '送出中...' : ''}
          </Text>
        </Pressable>

        <Text
          style={{
            marginTop: theme.space.md,
            textAlign: 'center',
            color: theme.colors.muted,
            fontSize: theme.typography.caption.fontSize,
            lineHeight: theme.typography.caption.lineHeight + 4,
          }}
        >
          推播後對方 inbox 即時收到。{'\n'}
          每位學生最多收到 1 次（同訊息內 dedupe）。
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}
