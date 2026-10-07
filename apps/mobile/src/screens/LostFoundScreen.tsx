import React, { useCallback, useMemo, useState } from 'react';
import { ScrollView, Text, View, TextInput, Pressable, RefreshControl, Alert } from 'react-native';
import { Screen, AnimatedCard, Button, Pill, SegmentedControl } from '../ui/components';
import { TAB_BAR_CONTENT_BOTTOM_PADDING } from '../ui/navigationTheme';
import { theme } from '../ui/theme';
import { useThemeMode } from '../state/theme';
import type { LostFoundCategory } from '../data/types';
import { formatDateTime } from '../utils/format';
import {
  LOST_FOUND_CATEGORIES,
  categoryLabel,
  statusLabel,
  isOpenItem,
  lostFoundDataSource,
  useLostFoundScope,
  useLostFoundLoad,
} from '../features/lostFound';

type Props = { navigation?: { navigate: (screen: string, params?: object) => void } };
export function LostFoundScreen({ navigation }: Props) {
  useThemeMode();
  const { uid, schoolId, scope, isCurrent } = useLostFoundScope();
  const loader = useCallback(
    () => lostFoundDataSource().listLostFoundItems(schoolId, { limit: 100 }),
    [schoolId],
  );
  const { state, refresh } = useLostFoundLoad(scope, loader, isCurrent);
  const [filters, setFilters] = useState<{
    scope: string;
    type: string;
    search: string;
    category: LostFoundCategory | null;
    open: boolean;
  }>({ scope, type: 'all', search: '', category: null, open: true });
  const current =
    filters.scope === scope
      ? filters
      : { scope, type: 'all', search: '', category: null, open: true };
  const update = (patch: Partial<typeof filters>) => setFilters({ ...current, ...patch, scope });
  const items = useMemo(
    () =>
      (state.data ?? []).filter((item) => {
        if (item.schoolId !== schoolId || (current.type !== 'all' && item.type !== current.type))
          return false;
        if (current.open && !isOpenItem(item)) return false;
        if (current.category && item.category !== current.category) return false;
        const text = current.search.trim().toLowerCase();
        return (
          !text || `${item.title} ${item.description} ${item.location}`.toLowerCase().includes(text)
        );
      }),
    [state.data, schoolId, current.type, current.open, current.category, current.search],
  );
  const post = (type: 'lost' | 'found') => {
    if (!uid) {
      Alert.alert('請先登入', '登入後即可發布失物招領資訊。');
      return;
    }
    if (isCurrent()) navigation?.navigate('LostFoundPost', { type });
  };
  return (
    <Screen>
      <ScrollView
        contentContainerStyle={{ gap: 12, paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING }}
        refreshControl={
          <RefreshControl
            refreshing={state.status === 'loading'}
            onRefresh={() => void refresh()}
            tintColor={theme.colors.accent}
          />
        }
      >
        <AnimatedCard title="失物招領" subtitle="找回遺失的物品，或替拾獲物尋找主人。">
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <View style={{ flex: 1 }}>
              <Button text="我遺失了" onPress={() => post('lost')} />
            </View>
            <View style={{ flex: 1 }}>
              <Button text="我拾獲了" onPress={() => post('found')} />
            </View>
          </View>
        </AnimatedCard>
        <AnimatedCard title="本校刊登資訊" subtitle="依發布時間顯示最近 100 筆。">
          <View style={{ gap: 12 }}>
            <SegmentedControl
              options={[
                { id: 'all', label: '全部' },
                { id: 'lost', label: '遺失' },
                { id: 'found', label: '拾獲' },
              ]}
              selected={current.type}
              onSelect={(type: string) => update({ type })}
            />
            <TextInput
              accessibilityLabel="搜尋物品"
              placeholder="搜尋名稱、描述或地點"
              value={current.search}
              onChangeText={(search) => update({ search })}
              placeholderTextColor={theme.colors.muted}
              style={{
                color: theme.colors.text,
                backgroundColor: theme.colors.surface2,
                borderColor: theme.colors.border,
                borderWidth: 1,
                borderRadius: theme.radius.md,
                padding: 12,
              }}
            />
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ gap: 8 }}
            >
              {[{ id: null, label: '所有類別' }, ...LOST_FOUND_CATEGORIES].map((category) => (
                <Pressable
                  key={category.id ?? 'all'}
                  accessibilityRole="button"
                  accessibilityState={{ selected: current.category === category.id }}
                  onPress={() => update({ category: category.id })}
                >
                  <Pill text={category.label} selected={current.category === category.id} />
                </Pressable>
              ))}
            </ScrollView>
            <Button
              text={current.open ? '只看尋找中：開啟' : '只看尋找中：關閉'}
              onPress={() => update({ open: !current.open })}
            />
          </View>
        </AnimatedCard>
        {state.status === 'loading' ? (
          <AnimatedCard title="正在讀取失物招領" />
        ) : state.status === 'error' ? (
          <AnimatedCard title="暫時無法讀取" subtitle="請確認網路與服務連線，再試一次。">
            <Button text="重新讀取" onPress={refresh} />
          </AnimatedCard>
        ) : items.length ? (
          items.map((item) => (
            <AnimatedCard key={item.id}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`查看${item.title}`}
                onPress={() => {
                  if (isCurrent()) navigation?.navigate('LostFoundDetail', { id: item.id });
                }}
                style={{ gap: 8 }}
              >
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                  <Pill text={item.type === 'lost' ? '遺失' : '拾獲'} />
                  <Pill text={categoryLabel(item.category)} />
                  <Pill text={statusLabel(item.status)} />
                </View>
                <Text style={{ fontSize: 18, fontWeight: '700', color: theme.colors.text }}>
                  {item.title}
                </Text>
                <Text style={{ color: theme.colors.muted }}>
                  {item.location} · {formatDateTime(item.date)}
                </Text>
                <Text numberOfLines={2} style={{ color: theme.colors.text, lineHeight: 21 }}>
                  {item.description}
                </Text>
              </Pressable>
            </AnimatedCard>
          ))
        ) : (
          <AnimatedCard
            title={state.data?.length ? '沒有符合條件的物品' : '目前沒有本校刊登資訊'}
            subtitle={
              state.data?.length ? '試著調整關鍵字或篩選條件。' : '可以先刊登遺失或拾獲資訊。'
            }
          />
        )}
      </ScrollView>
    </Screen>
  );
}
