import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { AIButton, AIDetailScreen, AIEmptyState, AIRow, AISection, aiTokens } from '../ui/aiFirst';
import { useAuth } from '../state/auth';
import { useNotifications } from '../state/notifications';
import { applyNotificationDestination } from '../utils/applyNotificationDestination';
import { resolveNotificationRow } from '../utils/notificationDestination';

function createdLabel(value: unknown): string {
  if (!value) return '';
  const stamp = value as { toDate?: () => Date };
  const date = typeof stamp.toDate === 'function' ? stamp.toDate() : new Date(String(value));
  return Number.isFinite(date.getTime())
    ? date.toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' })
    : '';
}

export default function NotificationsAiFirstScreen() {
  const navigation = useNavigation<{
    navigate: (route: string, params?: unknown) => void;
    goBack?: () => void;
  }>();
  const auth = useAuth();
  const uid = auth.user?.uid ?? null;
  const schoolId = auth.profile?.schoolId ?? null;
  const {
    notifications,
    unreadCount,
    unreadScope,
    loading,
    loadingMore,
    hasMore,
    error,
    markAsRead,
    markAllAsRead,
    loadMore,
    reload,
  } = useNotifications();
  const [blockedNotice, setBlockedNotice] = useState<{ id: string; reason: string } | null>(null);
  type ReadResult = { pending: boolean; unconfirmed: boolean; error?: string };
  const ownerKey = JSON.stringify([uid, schoolId, auth.profile?.role]);
  const currentSession = useRef({
    ownerKey,
    generation: 0,
    reads: new Map<string, ReadResult>(),
    batchPending: false,
  });
  if (currentSession.current.ownerKey !== ownerKey) {
    currentSession.current = {
      ownerKey,
      generation: currentSession.current.generation + 1,
      reads: new Map(),
      batchPending: false,
    };
  }
  const session = currentSession.current;
  const { reads } = session;
  const [, refresh] = useState(0);
  const [focused, setFocused] = useState(false);
  const batchPending = session.batchPending;
  const mounted = useRef(false);
  const focusGeneration = useRef(0);
  const visibleUnreadCount =
    unreadCount + notifications.filter((row) => row.read && reads.get(row.id)?.unconfirmed).length;
  const update = useCallback((generation: number) => {
    if (mounted.current && currentSession.current.generation === generation)
      refresh((value) => value + 1);
  }, []);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    setBlockedNotice(null);
  }, [ownerKey]);
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      focusGeneration.current += 1;
      return () => {
        if (currentSession.current === session) setFocused(false);
        focusGeneration.current += 1;
      };
    }, [session]),
  );

  const syncRead = async (id: string, explicit: boolean) => {
    if (reads.get(id)?.pending || session.batchPending) return undefined;
    const row = notifications.find((item) => item.id === id);
    if (!row) return undefined;
    const result: ReadResult = {
      pending: true,
      unconfirmed: !row.read || !!reads.get(id)?.unconfirmed,
    };
    reads.set(id, result);
    update(session.generation);
    const marked = await markAsRead(id).catch(() => false);
    if (currentSession.current !== session) return undefined;
    result.pending = false;
    result.unconfirmed = !marked;
    result.error = marked
      ? undefined
      : explicit
        ? '標為已讀失敗，請檢查連線後再試。說明與未讀狀態已保留。'
        : '已讀還沒同步，這則先保留未讀。可以再試一次。';
    update(session.generation);
    return marked;
  };

  const openNotification = async (id: string) => {
    if (reads.get(id)?.pending || session.batchPending) return;
    const row = notifications.find((item) => item.id === id);
    if (!row) return;
    const generation = focusGeneration.current;
    const stillHere = () =>
      mounted.current &&
      currentSession.current === session &&
      focusGeneration.current === generation;
    const destination = resolveNotificationRow(row, { schoolId, role: auth.profile?.role });
    if (destination.ok === false) {
      setBlockedNotice({ id, reason: destination.reason });
      return;
    }
    setBlockedNotice(null);
    const marked = await syncRead(id, false);
    if (marked === undefined || !stillHere()) return;
    let opened = false;
    try {
      opened = applyNotificationDestination(destination, { navigation, role: auth.profile?.role });
    } catch {
      opened = false;
    }
    if (!opened && stillHere()) {
      reads.get(id)!.error = marked
        ? '內容暫時打不開，請稍後再試。已讀已同步。'
        : '內容暫時打不開，已讀也還沒同步。這則先保留未讀，可以再試一次。';
      update(session.generation);
    }
  };

  const markOneExplicit = async (id: string) => {
    const marked = await syncRead(id, true);
    if (marked && mounted.current && currentSession.current === session) {
      setBlockedNotice((previous) => (previous?.id === id ? null : previous));
    }
  };

  const markAllExplicit = async () => {
    if (session.batchPending || [...reads.values()].some((result) => result.pending)) return;
    const ids = notifications.filter((row) => !row.read).map((row) => row.id);
    session.batchPending = true;
    const results = ids.map((id) => {
      const result: ReadResult = { pending: true, unconfirmed: true };
      reads.set(id, result);
      return [id, result] as const;
    });
    update(session.generation);
    const marked = await markAllAsRead().catch(() => false);
    if (currentSession.current !== session) return;
    for (const [, result] of results) {
      result.pending = false;
      result.unconfirmed = !marked;
      result.error = marked ? undefined : '全部已讀同步失敗，請再試一次。';
    }
    session.batchPending = false;
    update(session.generation);
  };

  return (
    <AIDetailScreen
      title="通知"
      subtitle={
        visibleUnreadCount > 0
          ? `${visibleUnreadCount} 則未讀（${unreadScope === 'loaded' ? '已載入範圍' : '目前清單'}）`
          : `顯示這組帳號已載入的通知`
      }
      onBack={() => navigation?.goBack?.()}
      rightAction={
        visibleUnreadCount > 0 ? (
          <AIButton
            label="全部已讀"
            variant="ghost"
            size="sm"
            disabled={batchPending || [...reads.values()].some((result) => result.pending)}
            onPress={() => void markAllExplicit()}
          />
        ) : undefined
      }
    >
      {loading ? (
        <View style={{ padding: 24, alignItems: 'center' }}>
          <ActivityIndicator color={aiTokens.ai} accessibilityLabel="讀取通知" />
        </View>
      ) : error ? (
        <AISection title="通知資料">
          <View accessibilityRole="alert" style={{ padding: 16, gap: 12 }}>
            <Text style={{ color: aiTokens.text, lineHeight: 22 }}>{error}</Text>
            <AIButton label="重新讀取" onPress={reload} />
          </View>
        </AISection>
      ) : notifications.length === 0 ? (
        <AIEmptyState title="目前沒有通知" subtitle="有新的作業、成績或系統訊息時會顯示在這裡。" />
      ) : (
        <AISection title="全部" subtitle={`${notifications.length} 則已載入`}>
          {blockedNotice ? (
            <View
              accessibilityRole="alert"
              style={{
                padding: 16,
                gap: 12,
                borderBottomWidth: 1,
                borderBottomColor: aiTokens.border,
              }}
            >
              <Text style={{ color: aiTokens.text, lineHeight: 22 }}>{blockedNotice.reason}</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                <AIButton
                  label="標成已讀"
                  disabled={!!reads.get(blockedNotice.id)?.pending || batchPending}
                  size="sm"
                  onPress={() => void markOneExplicit(blockedNotice.id)}
                />
                <AIButton
                  label="關閉說明"
                  variant="ghost"
                  size="sm"
                  onPress={() => setBlockedNotice(null)}
                />
              </View>
            </View>
          ) : null}
          {notifications.map((row) => {
            const when = createdLabel(row.createdAt);
            const result = reads.get(row.id);
            const pending = !!result?.pending;
            return (
              <View
                key={row.id}
                accessibilityState={{ busy: pending, disabled: pending || batchPending }}
              >
                <AIRow
                  title={row.title || '通知'}
                  subtitle={[row.body, when].filter(Boolean).join(' · ')}
                  tag={row.read && !result?.unconfirmed ? undefined : '未讀'}
                  disabled={pending || batchPending}
                  onPress={() => void openNotification(row.id)}
                />
                {pending ? (
                  <ActivityIndicator
                    accessibilityLabel={`正在同步已讀：${row.title || row.id}`}
                    accessibilityState={{ busy: true, disabled: true }}
                    color={aiTokens.ai}
                  />
                ) : null}
                {focused && result?.error ? (
                  <View accessibilityRole="alert" style={{ padding: 16, gap: 8 }}>
                    <Text style={{ color: aiTokens.text }}>{result.error}</Text>
                    {result.unconfirmed ? (
                      <AIButton
                        label={`重試已讀同步：${row.title || row.id}`}
                        disabled={pending || batchPending}
                        onPress={() => void markOneExplicit(row.id)}
                      />
                    ) : null}
                  </View>
                ) : null}
              </View>
            );
          })}
          {hasMore ? (
            <View style={{ padding: 16 }}>
              {loadingMore ? (
                <ActivityIndicator color={aiTokens.ai} accessibilityLabel="載入更多通知" />
              ) : (
                <AIButton label="載入更早的通知" onPress={() => void loadMore()} />
              )}
            </View>
          ) : null}
        </AISection>
      )}
    </AIDetailScreen>
  );
}
