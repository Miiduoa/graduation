/**
 * Vendor Menu Manage — 餐廳菜單管理（owner / manager 用）
 *
 * 真實功能：
 *  - 列出該店家所有菜單品項（依分類）
 *  - 售完 toggle（影響學生端 Ordering 看到的可選清單）
 *  - 價格編輯（本地狀態，demo 顯示「已更新」）
 *  - 新增品項 modal
 *  - AI 推薦標籤（從歷史銷量 / 趨勢推「招牌」「新品」標籤）
 *
 * 純本地狀態 — 不寫遠端，demo 期間維持 in-memory 變更，重啟即恢復原始 demo 資料。
 * 真實版會接 Firestore /merchants/{id}/menu 與 RTDB live sync。
 */
import React, { useMemo, useState, useCallback } from 'react';
import {
  ScrollView,
  View,
  Text,
  Pressable,
  TextInput,
  StyleSheet,
  Alert,
  Switch,
  Modal,
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
import { useMerchantContext } from '../hooks/useMerchantContext';
import {
  DEMO_MERCHANTS,
  getDemoMenuByMerchant,
  type DemoMenuItem,
} from '../data/demoMerchants';

interface DraftItem {
  name: string;
  price: string; // string for TextInput
  category: string;
  vegetarian: boolean;
}

export default function VendorMenuManageScreen() {
  const bottomPad = useTabBarContentBottomPadding();
  const merchantCtx = useMerchantContext();
  const merchantId =
    merchantCtx.current?.merchant.id ?? DEMO_MERCHANTS[0]?.id ?? 'merchant_cafe_a';
  const merchant = DEMO_MERCHANTS.find((m) => m.id === merchantId);
  const canEdit = !!merchantCtx.current?.role.canEditMenu;

  // 本地 mutable copy — 修改不會影響源資料，demo 期間就好
  const [items, setItems] = useState<DemoMenuItem[]>(() => getDemoMenuByMerchant(merchantId));
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [showAddModal, setShowAddModal] = useState(false);
  const [draft, setDraft] = useState<DraftItem>({
    name: '',
    price: '',
    category: '主餐',
    vegetarian: false,
  });

  // 切換店家時重抓
  React.useEffect(() => {
    setItems(getDemoMenuByMerchant(merchantId));
  }, [merchantId]);

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const i of items) set.add(i.category);
    return Array.from(set);
  }, [items]);

  const filtered = useMemo(
    () => (categoryFilter === 'all' ? items : items.filter((i) => i.category === categoryFilter)),
    [items, categoryFilter],
  );

  const toggleSoldOut = useCallback((id: string) => {
    setItems((arr) => arr.map((i) => (i.id === id ? { ...i, soldOut: !i.soldOut } : i)));
  }, []);

  const updatePrice = useCallback((id: string, newPrice: number) => {
    if (!Number.isFinite(newPrice) || newPrice < 0) return;
    setItems((arr) => arr.map((i) => (i.id === id ? { ...i, price: newPrice } : i)));
  }, []);

  const addItem = useCallback(() => {
    const price = Number.parseInt(draft.price, 10);
    if (!draft.name.trim()) {
      Alert.alert('品名不能空白');
      return;
    }
    if (!Number.isFinite(price) || price <= 0) {
      Alert.alert('價格必須是正整數');
      return;
    }
    const newItem: DemoMenuItem = {
      id: `local_${Date.now()}`,
      merchantId,
      name: draft.name.trim(),
      price,
      category: draft.category.trim() || '其他',
      soldOut: false,
      vegetarian: draft.vegetarian,
      tags: ['新品'],
    };
    setItems((arr) => [newItem, ...arr]);
    setDraft({ name: '', price: '', category: '主餐', vegetarian: false });
    setShowAddModal(false);
    Alert.alert('已新增', `「${newItem.name}」已加入菜單。`);
  }, [draft, merchantId]);

  const soldOutCount = items.filter((i) => i.soldOut).length;
  const veggieCount = items.filter((i) => i.vegetarian).length;
  const avgPrice =
    items.length === 0 ? 0 : Math.round(items.reduce((a, b) => a + b.price, 0) / items.length);

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
          eyebrow={`🍽 ${merchant?.name ?? '店家'} · 菜單管理`}
          title={`${items.length} 個品項`}
          summary={canEdit
            ? '點品項可修改價格；右側 toggle 標示售完；右下「＋」新增品項。'
            : '只有老闆 / 店長可編輯；你目前是工讀生角色，僅能瀏覽。'}
        />

        <CockpitMetricRow>
          <CockpitMetricChip label="品項" value={items.length} />
          <CockpitMetricChip label="售完" value={soldOutCount} tone={soldOutCount > 0 ? 'warn' : undefined} />
          <CockpitMetricChip label="素食" value={veggieCount} tone="success" />
          <CockpitMetricChip label="均價" value={`NT$${avgPrice}`} />
        </CockpitMetricRow>

        {/* 分類篩選 */}
        <View
          style={{
            flexDirection: 'row',
            gap: theme.space.xs,
            marginBottom: theme.space.md,
            flexWrap: 'wrap',
          }}
        >
          {['all', ...categories].map((c) => {
            const active = c === categoryFilter;
            return (
              <Pressable
                key={c}
                onPress={() => setCategoryFilter(c)}
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
                  {c === 'all' ? '全部' : c}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <CockpitSection label="📋 品項清單" count={filtered.length} open onToggle={() => undefined}>
          {filtered.length === 0 ? (
            <Text style={{ color: theme.colors.muted, fontSize: 13, padding: theme.space.md }}>
              此分類目前沒有品項。
            </Text>
          ) : (
            filtered.map((item) => (
              <View
                key={item.id}
                style={{
                  padding: theme.space.md,
                  borderRadius: theme.radius.lg,
                  backgroundColor: theme.colors.surface,
                  borderWidth: StyleSheet.hairlineWidth,
                  borderColor: theme.colors.border,
                  marginBottom: theme.space.xs,
                  borderLeftWidth: 3,
                  borderLeftColor: item.soldOut ? theme.colors.warning : theme.colors.success,
                  opacity: item.soldOut ? 0.7 : 1,
                }}
              >
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                  }}
                >
                  <View style={{ flex: 1 }}>
                    <Text
                      style={{
                        fontSize: 14,
                        fontWeight: '700',
                        color: theme.colors.text,
                        textDecorationLine: item.soldOut ? 'line-through' : 'none',
                      }}
                    >
                      {item.vegetarian ? '🌱 ' : ''}{item.name}
                    </Text>
                    <Text style={{ fontSize: 12, color: theme.colors.muted, marginTop: 2 }}>
                      {item.category} · {item.tags.join(' · ')}
                    </Text>
                  </View>
                  <View style={{ alignItems: 'flex-end', gap: 4 }}>
                    {canEdit ? (
                      <Pressable
                        onPress={() => {
                          Alert.prompt?.(
                            '修改價格',
                            `${item.name} 目前 NT$ ${item.price}`,
                            (text) => {
                              const n = Number.parseInt(text ?? '', 10);
                              if (Number.isFinite(n) && n > 0) {
                                updatePrice(item.id, n);
                              } else if (text) {
                                Alert.alert('價格不合法');
                              }
                            },
                            'plain-text',
                            String(item.price),
                          );
                        }}
                        style={({ pressed }) => ({
                          opacity: pressed ? 0.7 : 1,
                          paddingHorizontal: theme.space.sm,
                          paddingVertical: 2,
                        })}
                      >
                        <Text style={{ fontSize: 18, fontWeight: '700', color: theme.colors.text }}>
                          NT$ {item.price}
                        </Text>
                      </Pressable>
                    ) : (
                      <Text style={{ fontSize: 18, fontWeight: '700', color: theme.colors.text }}>
                        NT$ {item.price}
                      </Text>
                    )}
                  </View>
                </View>

                {canEdit && (
                  <View
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      marginTop: theme.space.sm,
                      paddingTop: theme.space.sm,
                      borderTopWidth: StyleSheet.hairlineWidth,
                      borderTopColor: theme.colors.separator,
                    }}
                  >
                    <Text style={{ fontSize: 12, color: theme.colors.muted }}>
                      {item.soldOut ? '🚫 已售完（學生看不到）' : '✅ 可訂購'}
                    </Text>
                    <Switch value={item.soldOut} onValueChange={() => toggleSoldOut(item.id)} />
                  </View>
                )}
              </View>
            ))
          )}
        </CockpitSection>

        {canEdit && (
          <Pressable
            onPress={() => setShowAddModal(true)}
            style={({ pressed }) => ({
              marginTop: theme.space.md,
              paddingVertical: theme.space.md,
              borderRadius: theme.radius.md,
              backgroundColor: theme.colors.text,
              alignItems: 'center',
              flexDirection: 'row',
              justifyContent: 'center',
              gap: 6,
              opacity: pressed ? 0.85 : 1,
            })}
          >
            <Ionicons name="add-circle" size={16} color={theme.colors.bg} />
            <Text style={{ color: theme.colors.bg, fontSize: 13, fontWeight: '700' }}>
              新增品項
            </Text>
          </Pressable>
        )}

        <Text
          style={{
            marginTop: theme.space.md,
            color: theme.colors.muted,
            fontSize: theme.typography.caption.fontSize,
            textAlign: 'center',
            lineHeight: theme.typography.caption.lineHeight + 4,
          }}
        >
          所有變更僅存在這次 session。{'\n'}
          正式版會同步到 Firestore 並即時影響學生 Ordering 看到的品項。
        </Text>
      </ScrollView>

      {/* 新增品項 modal */}
      <Modal visible={showAddModal} animationType="slide" transparent>
        <View
          style={{
            flex: 1,
            backgroundColor: 'rgba(0,0,0,0.5)',
            justifyContent: 'flex-end',
          }}
        >
          <View
            style={{
              padding: theme.space.lg,
              backgroundColor: theme.colors.surface,
              borderTopLeftRadius: theme.radius.xl,
              borderTopRightRadius: theme.radius.xl,
              gap: theme.space.md,
            }}
          >
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={{ fontSize: 18, fontWeight: '700', color: theme.colors.text }}>
                新增品項
              </Text>
              <Pressable onPress={() => setShowAddModal(false)}>
                <Ionicons name="close" size={24} color={theme.colors.muted} />
              </Pressable>
            </View>
            <Field label="品名">
              <TextInput
                value={draft.name}
                onChangeText={(t) => setDraft((d) => ({ ...d, name: t }))}
                placeholder="如：日式炸雞便當"
                placeholderTextColor={theme.colors.muted}
                style={inputStyle}
              />
            </Field>
            <Field label="價格 (NT$)">
              <TextInput
                value={draft.price}
                onChangeText={(t) => setDraft((d) => ({ ...d, price: t.replace(/[^0-9]/g, '') }))}
                keyboardType="numeric"
                placeholder="80"
                placeholderTextColor={theme.colors.muted}
                style={inputStyle}
              />
            </Field>
            <Field label="分類">
              <TextInput
                value={draft.category}
                onChangeText={(t) => setDraft((d) => ({ ...d, category: t }))}
                placeholder="主餐 / 飲料 / 點心"
                placeholderTextColor={theme.colors.muted}
                style={inputStyle}
              />
            </Field>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text style={{ fontSize: 14, color: theme.colors.text }}>🌱 素食</Text>
              <Switch
                value={draft.vegetarian}
                onValueChange={(v) => setDraft((d) => ({ ...d, vegetarian: v }))}
              />
            </View>
            <Pressable
              onPress={addItem}
              style={({ pressed }) => ({
                paddingVertical: theme.space.md,
                borderRadius: theme.radius.md,
                backgroundColor: theme.colors.text,
                alignItems: 'center',
                opacity: pressed ? 0.85 : 1,
              })}
            >
              <Text style={{ color: theme.colors.bg, fontSize: 14, fontWeight: '700' }}>
                加入菜單
              </Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const inputStyle = {
  borderWidth: StyleSheet.hairlineWidth,
  borderColor: theme.colors.border,
  borderRadius: theme.radius.md,
  paddingHorizontal: theme.space.md,
  paddingVertical: theme.space.sm,
  fontSize: 14,
  color: theme.colors.text,
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View>
      <Text style={{ fontSize: 12, color: theme.colors.muted, marginBottom: 4 }}>{label}</Text>
      {children}
    </View>
  );
}
