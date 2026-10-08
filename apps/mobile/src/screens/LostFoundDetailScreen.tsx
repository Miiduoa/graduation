import React, { useCallback, useRef, useState } from 'react';
import { ScrollView, Text, View, Alert, Share, Image } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { Screen, AnimatedCard, Button, Pill } from '../ui/components';
import { TAB_BAR_CONTENT_BOTTOM_PADDING } from '../ui/navigationTheme';
import { theme } from '../ui/theme';
import { useThemeMode } from '../state/theme';
import { formatDateTime } from '../utils/format';
import {
  categoryLabel,
  statusLabel,
  lostFoundDataSource,
  useLostFoundScope,
  useLostFoundLoad,
} from '../features/lostFound';

type Props = {
  navigation?: { navigate: (screen: string, params?: object) => void; goBack?: () => void };
  route?: { params?: { id?: string } };
};
export function LostFoundDetailScreen({ navigation, route }: Props) {
  useThemeMode();
  const id = route?.params?.id ?? '';
  const { uid, schoolId, scope, isCurrent } = useLostFoundScope(id);
  const loader = useCallback(async () => {
    if (!id) return null;
    const item = await lostFoundDataSource().getLostFoundItem(id, schoolId);
    if (item && (item.id !== id || item.schoolId !== schoolId)) throw new Error('物品範圍不符');
    return item;
  }, [id, schoolId]);
  const { state, refresh } = useLostFoundLoad(scope, loader, isCurrent);
  const item = state.data;
  const isOwner = !!uid && uid === item?.reporterId;
  const lock = useRef<{ scope: string; token: symbol } | null>(null);
  const [busyScope, setBusyScope] = useState<string | null>(null);
  const busy = busyScope === scope;
  const copy = async () => {
    if (!uid || !item?.contactInfo || !isCurrent() || lock.current?.scope === scope) return;
    const token = Symbol();
    lock.current = { scope, token };
    try {
      const copied = await Clipboard.setStringAsync(item.contactInfo);
      if (isCurrent())
        Alert.alert(
          copied ? '已複製' : '無法複製',
          copied ? '聯絡資訊已複製到剪貼簿。' : '請自行選用發布者提供的聯絡方式。',
        );
    } catch {
      if (isCurrent()) Alert.alert('無法複製', '請稍後再試。');
    } finally {
      if (lock.current?.token === token) lock.current = null;
    }
  };
  const contact = () => {
    if (!isCurrent()) return;
    if (!uid) {
      Alert.alert('請先登入', '登入後才能查看聯絡資訊。');
      return;
    }
    if (!item?.contactInfo) {
      Alert.alert('未提供聯絡資訊', '發布者尚未填寫聯絡方式。');
      return;
    }
    Alert.alert('聯絡發布者', item.contactInfo, [
      { text: '關閉', style: 'cancel' },
      { text: '複製', onPress: () => void copy() },
    ]);
  };
  const resolve = () => {
    if (!isOwner || !item || !isCurrent() || lock.current?.scope === scope) return;
    Alert.alert('確認結案', '確認物品已找回或完成歸還後，再將刊登資訊結案。', [
      { text: '取消', style: 'cancel' },
      {
        text: '確認結案',
        onPress: async () => {
          if (!isCurrent() || lock.current?.scope === scope) return;
          const token = Symbol();
          lock.current = { scope, token };
          setBusyScope(scope);
          try {
            await lostFoundDataSource().resolveLostFoundItem(item.id, schoolId);
            if (!isCurrent()) return;
            const updated = await lostFoundDataSource().getLostFoundItem(item.id, schoolId);
            if (!isCurrent()) return;
            if (
              !updated ||
              updated.reporterId !== uid ||
              updated.schoolId !== schoolId ||
              !['resolved', 'returned'].includes(updated.status)
            )
              throw new Error('未確認結案');
            await refresh();
            if (isCurrent()) Alert.alert('已結案', '已更新這則物品的刊登狀態。');
          } catch {
            if (isCurrent()) Alert.alert('無法確認結案', '請重新整理確認最新狀態，再試一次。');
          } finally {
            if (lock.current?.token === token) lock.current = null;
            if (isCurrent()) setBusyScope(null);
          }
        },
      },
    ]);
  };
  const share = async () => {
    if (!item || !isCurrent()) return;
    try {
      await Share.share({
        title: item.title,
        message: `【${item.type === 'lost' ? '遺失' : '拾獲'}】${item.title}\n地點：${item.location}\n日期：${formatDateTime(item.date)}\n\n${item.description}`,
      });
    } catch {
      if (isCurrent()) Alert.alert('無法開啟分享', '請稍後再試。');
    }
  };
  if (state.status === 'loading')
    return (
      <Screen>
        <AnimatedCard title="正在讀取物品資訊" />
      </Screen>
    );
  if (state.status === 'error')
    return (
      <Screen>
        <AnimatedCard title="暫時無法讀取物品" subtitle="請確認網路與服務連線，再試一次。">
          <Button text="重新讀取" onPress={refresh} />
        </AnimatedCard>
      </Screen>
    );
  if (!item)
    return (
      <Screen>
        <AnimatedCard title="找不到物品" subtitle="這則刊登可能已移除，或不屬於目前學校。">
          <Button text="返回列表" onPress={() => navigation?.goBack?.()} />
        </AnimatedCard>
      </Screen>
    );
  const imageUrl = item.imageUrls?.[0] ?? item.imageUrl;
  return (
    <Screen>
      <ScrollView
        contentContainerStyle={{ gap: 12, paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING }}
      >
        <AnimatedCard title={item.title}>
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
            <Pill text={item.type === 'lost' ? '遺失' : '拾獲'} />
            <Pill text={categoryLabel(item.category)} />
            <Pill text={statusLabel(item.status)} />
          </View>
          {imageUrl?.startsWith('https://') && (
            <Image
              source={{ uri: imageUrl }}
              accessibilityLabel="發布者提供的物品照片"
              style={{ height: 220, borderRadius: theme.radius.md, marginTop: 12 }}
              resizeMode="contain"
            />
          )}
        </AnimatedCard>
        <AnimatedCard title="物品資訊">
          <View style={{ gap: 10 }}>
            <Text style={{ color: theme.colors.text }}>地點：{item.location}</Text>
            <Text style={{ color: theme.colors.text }}>日期：{formatDateTime(item.date)}</Text>
            <Text style={{ color: theme.colors.muted }}>
              發布：{formatDateTime(item.createdAt)}
            </Text>
            <Text style={{ color: theme.colors.text, lineHeight: 23 }}>{item.description}</Text>
          </View>
        </AnimatedCard>
        <AnimatedCard
          title="聯絡與交接"
          subtitle={
            item.reporter?.displayName
              ? `發布者：${item.reporter.displayName}`
              : '發布者未提供顯示名稱。'
          }
        >
          <Text style={{ color: theme.colors.muted, marginBottom: 12 }}>
            請先聯絡發布者核對物品特徵，再約定於公共場所交接。刊登狀態由發布者更新。
          </Text>
          <Button text="聯絡發布者" onPress={contact} />
        </AnimatedCard>
        {isOwner && (
          <AnimatedCard title="管理刊登">
            <View style={{ gap: 10 }}>
              <Button
                text="編輯資訊"
                disabled={busy}
                onPress={() => {
                  if (isCurrent())
                    navigation?.navigate('LostFoundPost', { id: item.id, type: item.type });
                }}
              />
              {!['resolved', 'returned', 'expired'].includes(item.status) && (
                <Button text="標記為已結案" loading={busy} onPress={resolve} />
              )}
            </View>
          </AnimatedCard>
        )}
        <Button text="分享物品資訊" onPress={share} />
        <Button text="重新整理" disabled={busy} onPress={refresh} />
      </ScrollView>
    </Screen>
  );
}
