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
  const [actionError, setActionError] = useState<string | null>(null);
  const [retryReadId, setRetryReadId] = useState<string | null>(null);
  const [unconfirmedReads, setUnconfirmedReads] = useState<Set<string>>(new Set());
  const visibleUnreadCount =
    unreadCount + notifications.filter((row) => row.read && unconfirmedReads.has(row.id)).length;
  const mounted = useRef(false);
  const sessionGeneration = useRef(0);
  const pendingReads = useRef(new Set<string>());

  useEffect(() => {
    setActionError(null);
    setBlockedNotice(null);
    setRetryReadId(null);
    setUnconfirmedReads(new Set());
  }, [uid, schoolId, auth.profile?.role]);

  useFocusEffect(
    useCallback(() => {
      mounted.current = true;
      sessionGeneration.current += 1;
      return () => {
        mounted.current = false;
        sessionGeneration.current += 1;
      };
    }, [uid, schoolId, auth.profile?.role]),
  );

  const openNotification = useCallback(
    async (id: string) => {
      const row = notifications.find((item) => item.id === id);
      if (!row) return;
      const openUid = uid;
      const openSchool = schoolId;
      const openRole = auth.profile?.role;
      const openGen = sessionGeneration.current;
      const requestKey = `${openGen}:${id}`;
      if (pendingReads.current.has(requestKey)) return;
      const stillHere = () =>
        mounted.current &&
        sessionGeneration.current === openGen &&
        (auth.user?.uid ?? null) === openUid &&
        (auth.profile?.schoolId ?? null) === openSchool;

      setActionError(null);
      const destination = resolveNotificationRow(row, {
        schoolId: openSchool,
        role: openRole,
      });
      if (destination.ok === false) {
        if (!stillHere()) return;
        setBlockedNotice({ id, reason: destination.reason });
        return;
      }
      if (!stillHere()) return;
      setBlockedNotice(null);

      setRetryReadId(null);
      if (!notifications.find((item) => item.id === id)?.read) {
        setUnconfirmedReads((previous) => new Set(previous).add(id));
      }
      pendingReads.current.add(requestKey);
      const marked = await markAsRead(id).catch(() => false);
      pendingReads.current.delete(requestKey);
      if (!stillHere()) return;
      if (marked) {
        setUnconfirmedReads((previous) => {
          const next = new Set(previous);
          next.delete(id);
          return next;
        });
      }
      if (!marked) {
        setRetryReadId(id);
        setActionError('已讀還沒同步，這則先保留未讀。可以再試一次。');
      }

      let opened = false;
      try {
        opened = applyNotificationDestination(destination, {
          navigation,
          role: openRole,
        });
      } catch {
        opened = false;
      }
      if (!stillHere()) return;
      if (!opened) {
        setActionError(
          marked
            ? '內容暫時打不開，請稍後再試。已讀已同步。'
            : '內容暫時打不開，已讀也還沒同步。這則先保留未讀，可以再試一次。',
        );
      }
    },
    [
      auth.profile?.role,
      auth.profile?.schoolId,
      auth.user?.uid,
      markAsRead,
      navigation,
      notifications,
      schoolId,
      uid,
    ],
  );

  const markOneExplicit = useCallback(
    async (id: string) => {
      const openUid = uid;
      const openSchool = schoolId;
      const openGen = sessionGeneration.current;
      const requestKey = `${openGen}:${id}`;
      if (pendingReads.current.has(requestKey)) return;
      const stillHere = () =>
        mounted.current &&
        sessionGeneration.current === openGen &&
        (auth.user?.uid ?? null) === openUid &&
        (auth.profile?.schoolId ?? null) === openSchool;
      const previousBlocked = blockedNotice;

      setActionError(null);
      if (!notifications.find((item) => item.id === id)?.read) {
        setUnconfirmedReads((previous) => new Set(previous).add(id));
      }
      pendingReads.current.add(requestKey);
      const marked = await markAsRead(id).catch(() => false);
      pendingReads.current.delete(requestKey);
      if (!stillHere()) return;
      if (marked) {
        setUnconfirmedReads((previous) => {
          const next = new Set(previous);
          next.delete(id);
          return next;
        });
      }
      if (!marked) {
        // 保留說明與未讀；不關閉 blockedNotice。
        if (previousBlocked) setBlockedNotice(previousBlocked);
        setActionError('標為已讀失敗，請檢查連線後再試。說明與未讀狀態已保留。');
        return;
      }
      setRetryReadId(null);
      if (blockedNotice?.id === id) setBlockedNotice(null);
    },
    [
      auth.profile?.schoolId,
      auth.user?.uid,
      blockedNotice,
      markAsRead,
      notifications,
      schoolId,
      uid,
    ],
  );

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
            onPress={() => void markAllAsRead()}
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
          {actionError ? (
            <View accessibilityRole="alert" style={{ paddingHorizontal: 16, paddingBottom: 8 }}>
              <Text style={{ color: aiTokens.text, lineHeight: 22 }}>{actionError}</Text>
              {retryReadId ? (
                <AIButton
                  label="重試已讀同步"
                  size="sm"
                  onPress={() => void markOneExplicit(retryReadId)}
                />
              ) : null}
            </View>
          ) : null}
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
            return (
              <AIRow
                key={row.id}
                title={row.title || '通知'}
                subtitle={[row.body, when].filter(Boolean).join(' · ')}
                tag={row.read && !unconfirmedReads.has(row.id) ? undefined : '未讀'}
                onPress={() => void openNotification(row.id)}
              />
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
