import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, Text, View, Alert, Share, Image } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { Screen, AnimatedCard, Button, Pill } from '../ui/components';
import { TAB_BAR_CONTENT_BOTTOM_PADDING } from '../ui/navigationTheme';
import { theme } from '../ui/theme';
import { useThemeMode } from '../state/theme';
import { formatDateTime } from '../utils/format';
import { LoginRequiredLostFoundComments } from '../components/LoginRequiredLostFoundComments';
import {
  categoryLabel,
  statusLabel,
  lostFoundDataSource,
  useLostFoundLoad,
} from '../features/lostFound';
import {
  CONTACT_VISIBILITY_NOTE,
  LEGACY_MIGRATION_NOTE,
  LostFoundConflictError,
  LostFoundError,
  LostFoundScopeChangedError,
  LostFoundWriteUnconfirmedError,
  asLostFoundViewItem,
  canManageLostFoundItem,
} from '../data/lostFoundMeta';
import {
  LostFoundStorageError,
  clearLostFoundPendingIfMatches,
  loadLostFoundPending,
  saveLostFoundPending,
  type LostFoundPendingIntent,
} from '../data/lostFoundDrafts';
import { lostFoundDateFieldValue } from '../data/lostFoundDates';
import { useLostFoundGenerationScope } from '../data/lostFoundScope';

type Props = {
  navigation?: { navigate: (screen: string, params?: object) => void; goBack?: () => void };
  route?: { params?: { id?: string } };
};

export function LostFoundDetailScreen({ navigation, route }: Props) {
  useThemeMode();
  const id = route?.params?.id ?? '';
  const { uid, schoolId, scope, focused, isCurrent, assertCurrentScope } =
    useLostFoundGenerationScope(id);
  const loader = useCallback(async () => {
    if (!id) return null;
    const item = asLostFoundViewItem(await lostFoundDataSource().getLostFoundItem(id, schoolId));
    if (item && (item.id !== id || item.schoolId !== schoolId)) throw new Error('物品範圍不符');
    return item;
  }, [id, schoolId]);
  const { state, refresh } = useLostFoundLoad(scope, loader, isCurrent, Boolean(uid));
  const lock = useRef<{ scope: string; token: symbol } | null>(null);
  const [busyScope, setBusyScope] = useState<string | null>(null);
  const [pendingResolve, setPendingResolve] = useState<LostFoundPendingIntent | null>(null);
  const [pendingLoadError, setPendingLoadError] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');

  const reloadPending = useCallback(async () => {
    if (!uid || !id || state.status !== 'ready') {
      if (isCurrent()) {
        setPendingResolve(null);
        setPendingLoadError(false);
        setStatusMessage('');
      }
      return;
    }
    const item = asLostFoundViewItem(state.data ?? null);
    if (!item || !canManageLostFoundItem(item, uid)) {
      if (isCurrent()) {
        setPendingResolve(null);
        setPendingLoadError(false);
        setStatusMessage(item?.migrationReadOnly ? LEGACY_MIGRATION_NOTE : '');
      }
      return;
    }
    try {
      const pending = await loadLostFoundPending({
        uid,
        schoolId,
        mode: 'edit',
        itemKey: id,
      });
      if (!isCurrent()) return;
      setPendingLoadError(false);
      if (pending?.action === 'resolve') {
        setPendingResolve(pending);
        setStatusMessage('偵測到尚未確認的結案，請先重試同一則操作。');
      } else {
        setPendingResolve(null);
        setStatusMessage(item.migrationReadOnly ? LEGACY_MIGRATION_NOTE : '');
      }
    } catch {
      if (!isCurrent()) return;
      // Do not silently imply there is no pending action.
      setPendingResolve(null);
      setPendingLoadError(true);
      setStatusMessage('本機待確認資料無法讀取；請先重試讀取，勿另開新的結案。');
    }
  }, [uid, id, schoolId, state.status, state.data, isCurrent]);

  useEffect(() => {
    let active = true;
    void (async () => {
      if (!active) return;
      await reloadPending();
    })();
    return () => {
      active = false;
    };
  }, [reloadPending, scope]);

  const openLogin = () => {
    if (isCurrent())
      navigation?.navigate('SSOLogin', {
        returnTo: id && !id.includes('/') ? `/lost-found/${id}` : '/lost-found',
      });
  };
  if (!uid || state.status === 'login-required') {
    return (
      <Screen>
        <AnimatedCard title="失物招領">
          <LoginRequiredLostFoundComments onLogin={openLogin} />
        </AnimatedCard>
      </Screen>
    );
  }
  const item = asLostFoundViewItem(state.data ?? null);
  const isOwner = canManageLostFoundItem(item, uid);
  const busy = busyScope === scope;
  const closedStatus = item
    ? ['resolved', 'returned', 'expired'].includes(item.status)
    : false;

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
    Alert.alert('聯絡發布者', `${item.contactInfo}\n\n${CONTACT_VISIBILITY_NOTE}`, [
      { text: '關閉', style: 'cancel' },
      { text: '複製', onPress: () => void copy() },
    ]);
  };

  const runResolve = async (intent: LostFoundPendingIntent) => {
    if (!item || !uid || !isCurrent() || lock.current?.scope === scope) return;
    const token = Symbol();
    lock.current = { scope, token };
    setBusyScope(scope);
    try {
      await saveLostFoundPending({ uid, schoolId, mode: 'edit', itemKey: item.id }, intent);
      if (!isCurrent()) return;
      setPendingResolve(intent);
      setPendingLoadError(false);
      await lostFoundDataSource().resolveLostFoundItem(item.id, schoolId, {
        expectedRevision: intent.expectedRevision,
        assertCurrentScope,
      });
      if (!isCurrent()) return;
      const updated = asLostFoundViewItem(
        await lostFoundDataSource().getLostFoundItem(item.id, schoolId),
      );
      if (!isCurrent()) return;
      if (
        !updated ||
        updated.userId !== uid ||
        updated.schoolId !== schoolId ||
        !['resolved', 'returned'].includes(updated.status)
      ) {
        throw new LostFoundWriteUnconfirmedError('結案可能已送出，但無法讀回確認。請重新整理。');
      }
      try {
        if (!isCurrent()) return;
        await clearLostFoundPendingIfMatches(
          { uid, schoolId, mode: 'edit', itemKey: item.id },
          { action: 'resolve', documentId: intent.documentId },
        );
      } catch {
        // Receipt confirmed.
      }
      if (!isCurrent()) return;
      setPendingResolve(null);
      setStatusMessage('');
      await refresh();
      if (isCurrent()) Alert.alert('已結案', '已更新這則物品的刊登狀態。');
    } catch (error) {
      if (!isCurrent()) return;
      if (error instanceof LostFoundScopeChangedError) return;
      if (error instanceof LostFoundStorageError) {
        Alert.alert('無法保存待確認操作', error.message);
        return;
      }
      if (error instanceof LostFoundConflictError) {
        Alert.alert('內容已變更', error.message);
        return;
      }
      if (
        error instanceof LostFoundWriteUnconfirmedError ||
        (error as { code?: string })?.code === 'lost-found-write-unconfirmed'
      ) {
        setPendingResolve(intent);
        setStatusMessage('結案結果未確認。請重試同一則操作，勿假設已完成。');
        Alert.alert('無法確認結案', error.message || '請重新整理確認最新狀態，再試一次。');
        return;
      }
      Alert.alert(
        '無法確認結案',
        error instanceof LostFoundError ? error.message : '請重新整理確認最新狀態，再試一次。',
      );
    } finally {
      if (lock.current?.token === token) lock.current = null;
      if (isCurrent()) setBusyScope(null);
    }
  };

  const resolve = () => {
    if (!isOwner || !item || !isCurrent() || lock.current?.scope === scope) return;
    if (pendingLoadError) {
      Alert.alert('請先重試讀取', '本機待確認資料無法確認，請先重試讀取後再操作。');
      return;
    }
    if (pendingResolve?.action === 'resolve') {
      void runResolve(pendingResolve);
      return;
    }
    if (closedStatus) return;
    Alert.alert('確認結案', '確認物品已找回或完成歸還後，再將刊登資訊結案。', [
      { text: '取消', style: 'cancel' },
      {
        text: '確認結案',
        onPress: () => {
          if (!isCurrent()) return;
          const intent: LostFoundPendingIntent = {
            version: 1,
            action: 'resolve',
            documentId: item.id,
            expectedRevision: item.updatedAtRevision,
          };
          void runResolve(intent);
        },
      },
    ]);
  };

  const share = async () => {
    if (!item || !isCurrent()) return;
    try {
      await Share.share({
        title: item.title,
        message: `【${item.type === 'lost' ? '遺失' : '拾獲'}】${item.title}\n地點：${item.location}\n日期：${lostFoundDateFieldValue(item.date)}\n\n${item.description}`,
      });
    } catch {
      if (isCurrent()) Alert.alert('無法開啟分享', '請稍後再試。');
    }
  };

  if (!focused || state.status === 'loading')
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
  const showOwnerTools = isOwner || item.migrationReadOnly;
  // Show check/retry whenever durable pending resolve exists, even if status is already closed.
  const showResolveAction = !!pendingResolve || pendingLoadError || !closedStatus;
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
            <Text style={{ color: theme.colors.text }}>
              日期：{lostFoundDateFieldValue(item.date)}
            </Text>
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
            {'\n'}
            {CONTACT_VISIBILITY_NOTE}
          </Text>
          <Button text="聯絡發布者" onPress={contact} />
        </AnimatedCard>
        {showOwnerTools && (
          <AnimatedCard title="管理刊登">
            <View style={{ gap: 10 }}>
              {!!statusMessage && (
                <Text style={{ color: theme.colors.muted, lineHeight: 21 }}>{statusMessage}</Text>
              )}
              {!item.migrationReadOnly && (
                <>
                  <Button
                    text="編輯資訊"
                    disabled={busy || !!pendingResolve || pendingLoadError}
                    onPress={() => {
                      if (isCurrent())
                        navigation?.navigate('LostFoundPost', { id: item.id, type: item.type });
                    }}
                  />
                  {pendingLoadError && (
                    <Button
                      text="重試讀取待確認資料"
                      disabled={busy}
                      onPress={() => void reloadPending()}
                    />
                  )}
                  {showResolveAction && !pendingLoadError && (
                    <Button
                      text={pendingResolve ? '重試同一則結案' : '標記為已結案'}
                      loading={busy}
                      onPress={resolve}
                    />
                  )}
                </>
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
