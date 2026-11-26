import {
  notificationListFilter,
  notificationTypeLabel,
  notificationCampusLabel,
  type NotificationListMode,
} from '@campus/shared/src/notificationListFilter';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { AIDetailScreen } from '../ui/aiFirst';
import { theme } from '../ui/theme';
import { useThemeStyleSheet } from '../ui/useThemeStyleSheet';
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
  const s = useThemeStyleSheet(createStyles);
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
  const scrollRef = useRef<ScrollView>(null);
  const scrollPositions = useRef({ all: 0, unread: 0 });
  const [filter, setFilter] = useState<NotificationListMode>('all');
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
  const filteredRows = notificationListFilter(
    notifications,
    filter,
    (row) => !!reads.get(row.id)?.unconfirmed,
  );
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
    setFilter('all');
    scrollPositions.current = { all: 0, unread: 0 };
    scrollRef.current?.scrollTo({ y: 0, animated: false });
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

  const selectFilter = (mode: NotificationListMode) => {
    if (mode === filter) return;
    const y = scrollPositions.current[mode];
    setFilter(mode);
    requestAnimationFrame(() => {
      if (mounted.current && currentSession.current === session) {
        scrollRef.current?.scrollTo({ y, animated: false });
      }
    });
  };

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

  const anyPending = batchPending || [...reads.values()].some((result) => result.pending);

  return (
    <AIDetailScreen
      scrollRef={scrollRef}
      onScroll={(event) => {
        scrollPositions.current[filter] = event.nativeEvent.contentOffset.y;
      }}
      title="通知"
      subtitle={
        visibleUnreadCount > 0
          ? `${visibleUnreadCount} 則未讀（${unreadScope === 'loaded' ? '已載入範圍' : '目前清單'}）`
          : `顯示這組帳號已載入的通知`
      }
      onBack={() => navigation?.goBack?.()}
    >
      <View style={s.container}>
        <View style={s.filterBar}>
          <View
            accessibilityRole="radiogroup"
            accessibilityLabel="通知篩選"
            style={s.filterTabs}
          >
            {(['all', 'unread'] as const).map((mode) => {
              const active = filter === mode;
              return (
                <Pressable
                  key={mode}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: active }}
                  accessibilityLabel={mode === 'all' ? '顯示全部通知' : '顯示未讀通知'}
                  onPress={() => selectFilter(mode)}
                  style={({ pressed }) => [
                    s.filterTab,
                    active && s.filterTabActive,
                    pressed && s.rowPressed,
                  ]}
                >
                  <Text style={[s.filterTabText, active && s.filterTabTextActive]}>
                    {mode === 'all' ? '全部' : `未讀（${visibleUnreadCount}）`}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          {visibleUnreadCount > 0 ? (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: anyPending }}
              disabled={anyPending}
              onPress={() => void markAllExplicit()}
              style={({ pressed }) => [
                s.markAllButton,
                anyPending && s.disabled,
                pressed && !anyPending && s.rowPressed,
              ]}
            >
              <Text style={s.markAllText}>全部已讀</Text>
            </Pressable>
          ) : null}
        </View>

        {hasMore ? (
          <Text style={s.scopeNote}>只含已載入的通知，可繼續載入更早的通知。</Text>
        ) : null}

        {loading ? (
          <View style={s.centerState}>
            <ActivityIndicator color={theme.colors.accent} accessibilityLabel="讀取通知" />
          </View>
        ) : error ? (
          <View style={s.stateBlock}>
            <Text accessibilityRole="header" style={s.sectionTitle}>通知資料</Text>
            <View accessibilityRole="alert" style={s.errorNotice}>
              <Text style={s.errorText}>{error}</Text>
              <Pressable
                accessibilityRole="button"
                onPress={reload}
                style={({ pressed }) => [s.primaryButton, pressed && s.primaryButtonPressed]}
              >
                <Text style={s.primaryButtonText}>重新讀取</Text>
              </Pressable>
            </View>
          </View>
        ) : notifications.length === 0 ? (
          <View style={s.emptyBlock}>
            <Text style={s.emptyTitle}>目前沒有通知</Text>
            <Text style={s.emptySubtitle}>有新的作業、成績或系統訊息時會顯示在這裡。</Text>
            <Pressable
              accessibilityRole="button"
              onPress={reload}
              style={({ pressed }) => [s.secondaryButton, pressed && s.rowPressed]}
            >
              <Text style={s.secondaryButtonText}>重新讀取通知</Text>
            </Pressable>
          </View>
        ) : (
          <View style={s.ledger}>
            <View style={s.ledgerHeader}>
              <Text accessibilityRole="header" style={s.sectionTitle}>
                {filter === 'all' ? '全部' : '未讀通知'}
              </Text>
              <Text style={s.loadedCount}>{`${notifications.length} 則已載入`}</Text>
            </View>

            {blockedNotice ? (
              <View accessibilityRole="alert" style={s.blockedNotice}>
                <Text style={s.blockedText}>{blockedNotice.reason}</Text>
                <View style={s.inlineActions}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{
                      disabled: !!reads.get(blockedNotice.id)?.pending || batchPending,
                    }}
                    disabled={!!reads.get(blockedNotice.id)?.pending || batchPending}
                    onPress={() => void markOneExplicit(blockedNotice.id)}
                    style={({ pressed }) => [
                      s.compactPrimaryButton,
                      (!!reads.get(blockedNotice.id)?.pending || batchPending) && s.disabled,
                      pressed && s.primaryButtonPressed,
                    ]}
                  >
                    <Text style={s.compactPrimaryText}>標成已讀</Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => setBlockedNotice(null)}
                    style={({ pressed }) => [s.compactGhostButton, pressed && s.rowPressed]}
                  >
                    <Text style={s.compactGhostText}>關閉說明</Text>
                  </Pressable>
                </View>
              </View>
            ) : null}

            {filteredRows.length === 0 ? (
              <View style={s.filteredEmpty}>
                <Text style={s.emptySubtitle}>
                  {hasMore ? '已載入的通知都已讀，較早的通知尚未載入。' : '目前沒有未讀通知。'}
                </Text>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => selectFilter('all')}
                  style={({ pressed }) => [s.secondaryButton, pressed && s.rowPressed]}
                >
                  <Text style={s.secondaryButtonText}>查看全部通知</Text>
                </Pressable>
              </View>
            ) : (
              <View style={s.list}>
                {filteredRows.map((row, index) => {
                  const when = createdLabel(row.createdAt);
                  const campusLabel = notificationCampusLabel({
                    schoolId: row.data?.schoolId || row.schoolId,
                  });
                  const result = reads.get(row.id);
                  const pending = !!result?.pending;
                  const isUnread = !row.read || !!result?.unconfirmed;
                  return (
                    <View
                      key={row.id}
                      accessibilityState={{ busy: pending, disabled: pending || batchPending }}
                      style={[index > 0 && s.rowDivider]}
                    >
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={[
                          row.title || '通知',
                          notificationTypeLabel(row.type),
                          campusLabel,
                          row.body,
                          when,
                          isUnread ? '未讀' : '已讀',
                        ]
                          .filter(Boolean)
                          .join('，')}
                        accessibilityState={{ disabled: pending || batchPending }}
                        disabled={pending || batchPending}
                        onPress={() => void openNotification(row.id)}
                        style={({ pressed }) => [
                          s.row,
                          (pending || batchPending) && s.rowMuted,
                          pressed && !(pending || batchPending) && s.rowPressed,
                        ]}
                      >
                        <View style={s.gutter} accessibilityElementsHidden>
                          {isUnread ? <View style={s.unreadDot} /> : null}
                        </View>
                        <View style={s.rowContent}>
                          <View style={s.metaLine}>
                            <Text style={s.metaType}>{notificationTypeLabel(row.type)}</Text>
                            <Text style={s.metaCampus}>{campusLabel}</Text>
                            {isUnread ? <Text style={s.metaUnread}>未讀</Text> : null}
                          </View>
                          <Text style={[s.rowTitle, !isUnread && s.rowTitleRead]}>
                            {row.title || '通知'}
                          </Text>
                          {row.body ? <Text style={s.rowBody}>{row.body}</Text> : null}
                          {when ? <Text style={s.rowTime}>{when}</Text> : null}
                        </View>
                      </Pressable>
                      {pending ? (
                        <View style={s.pendingRow}>
                          <ActivityIndicator
                            accessibilityLabel={`正在同步已讀：${row.title || row.id}`}
                            accessibilityState={{ busy: true, disabled: true }}
                            color={theme.colors.accent}
                          />
                        </View>
                      ) : null}
                      {focused && result?.error ? (
                        <View accessibilityRole="alert" style={s.rowError}>
                          <Text style={s.rowErrorText}>{result.error}</Text>
                          {result.unconfirmed ? (
                            <Pressable
                              accessibilityRole="button"
                              accessibilityState={{ disabled: pending || batchPending }}
                              disabled={pending || batchPending}
                              onPress={() => void markOneExplicit(row.id)}
                              style={({ pressed }) => [
                                s.secondaryButton,
                                (pending || batchPending) && s.disabled,
                                pressed && s.rowPressed,
                              ]}
                            >
                              <Text style={s.secondaryButtonText}>
                                {`重試已讀同步：${row.title || row.id}`}
                              </Text>
                            </Pressable>
                          ) : null}
                        </View>
                      ) : null}
                    </View>
                  );
                })}
              </View>
            )}

            {hasMore ? (
              <View style={s.loadMoreWrap}>
                {loadingMore ? (
                  <ActivityIndicator color={theme.colors.accent} accessibilityLabel="載入更多通知" />
                ) : (
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => void loadMore()}
                    style={({ pressed }) => [s.loadMoreButton, pressed && s.rowPressed]}
                  >
                    <Text style={s.secondaryButtonText}>載入更早的通知</Text>
                  </Pressable>
                )}
              </View>
            ) : null}
          </View>
        )}
      </View>
    </AIDetailScreen>
  );
}

const createStyles = () =>
  StyleSheet.create({
    container: {
      width: '100%',
      maxWidth: 680,
      alignSelf: 'center',
      paddingHorizontal: 22,
    },
    filterBar: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 8,
      paddingTop: 8,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.colors.border,
    },
    filterTabs: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 16,
    },
    filterTab: {
      minHeight: 44,
      justifyContent: 'center',
      paddingHorizontal: 2,
      paddingVertical: 10,
      borderBottomWidth: 2,
      borderBottomColor: 'transparent',
    },
    filterTabActive: {
      borderBottomColor: theme.colors.accent,
    },
    filterTabText: {
      color: theme.colors.muted,
      fontSize: 14,
      lineHeight: 20,
      fontWeight: '500',
      fontVariant: ['tabular-nums'],
    },
    filterTabTextActive: {
      color: theme.colors.text,
      fontWeight: '700',
    },
    markAllButton: {
      minHeight: 44,
      justifyContent: 'center',
      paddingHorizontal: 6,
    },
    markAllText: {
      color: theme.colors.accent,
      fontSize: 13,
      fontWeight: '600',
    },
    scopeNote: {
      color: theme.colors.muted,
      fontSize: 12,
      lineHeight: 19,
      paddingTop: 10,
    },
    centerState: {
      paddingVertical: 40,
      alignItems: 'center',
    },
    stateBlock: {
      paddingTop: 22,
      gap: 12,
    },
    errorNotice: {
      paddingLeft: 14,
      paddingVertical: 8,
      borderLeftWidth: 3,
      borderLeftColor: theme.colors.danger,
      gap: 12,
    },
    errorText: {
      color: theme.colors.text,
      fontSize: 14,
      lineHeight: 22,
    },
    emptyBlock: {
      paddingVertical: 40,
      alignItems: 'flex-start',
      gap: 8,
    },
    emptyTitle: {
      color: theme.colors.text,
      fontSize: 18,
      lineHeight: 26,
      fontWeight: '700',
    },
    emptySubtitle: {
      color: theme.colors.muted,
      fontSize: 14,
      lineHeight: 22,
    },
    ledger: {
      paddingTop: 18,
    },
    ledgerHeader: {
      flexDirection: 'row',
      alignItems: 'baseline',
      justifyContent: 'space-between',
      gap: 8,
      paddingBottom: 10,
    },
    sectionTitle: {
      color: theme.colors.textSecondary,
      fontSize: 13,
      lineHeight: 19,
      fontWeight: '600',
    },
    loadedCount: {
      color: theme.colors.muted,
      fontSize: 12,
      lineHeight: 18,
      fontVariant: ['tabular-nums'],
    },
    blockedNotice: {
      marginBottom: 14,
      paddingVertical: 12,
      paddingHorizontal: 14,
      borderWidth: 1,
      borderColor: theme.colors.border,
      borderLeftWidth: 3,
      borderLeftColor: theme.colors.warning,
      borderRadius: 8,
      backgroundColor: theme.colors.surface,
      gap: 10,
    },
    blockedText: {
      color: theme.colors.text,
      fontSize: 14,
      lineHeight: 21,
    },
    inlineActions: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
    },
    filteredEmpty: {
      paddingVertical: 28,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.colors.border,
      gap: 12,
      alignItems: 'flex-start',
    },
    list: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.colors.border,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.colors.border,
    },
    rowDivider: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.colors.border,
    },
    row: {
      minHeight: 68,
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 10,
      paddingVertical: 14,
      paddingHorizontal: 2,
    },
    rowMuted: {
      opacity: 0.6,
    },
    gutter: {
      width: 10,
      paddingTop: 7,
      alignItems: 'center',
    },
    unreadDot: {
      width: 6,
      height: 6,
      borderRadius: 3,
      backgroundColor: theme.colors.accent,
    },
    rowContent: {
      flex: 1,
      minWidth: 0,
      gap: 4,
    },
    metaLine: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'center',
      gap: 8,
    },
    metaType: {
      color: theme.colors.textSecondary,
      fontSize: 12,
      lineHeight: 17,
      fontWeight: '600',
      maxWidth: '100%',
    },
    metaCampus: {
      color: theme.colors.muted,
      fontSize: 12,
      lineHeight: 17,
      maxWidth: '100%',
    },
    metaUnread: {
      color: theme.colors.accent,
      fontSize: 12,
      lineHeight: 17,
      fontWeight: '600',
    },
    rowTitle: {
      color: theme.colors.text,
      fontSize: 16,
      lineHeight: 23,
      fontWeight: '600',
    },
    rowTitleRead: {
      fontWeight: '500',
    },
    rowBody: {
      color: theme.colors.textSecondary,
      fontSize: 14,
      lineHeight: 21,
    },
    rowTime: {
      color: theme.colors.muted,
      fontSize: 12,
      lineHeight: 18,
      fontVariant: ['tabular-nums'],
      marginTop: 2,
    },
    pendingRow: {
      paddingBottom: 12,
      paddingLeft: 20,
      alignItems: 'flex-start',
    },
    rowError: {
      marginLeft: 20,
      marginBottom: 14,
      paddingLeft: 12,
      paddingVertical: 6,
      borderLeftWidth: 3,
      borderLeftColor: theme.colors.danger,
      gap: 8,
      alignItems: 'flex-start',
    },
    rowErrorText: {
      color: theme.colors.danger,
      fontSize: 13,
      lineHeight: 20,
    },
    primaryButton: {
      minHeight: 44,
      alignSelf: 'flex-start',
      justifyContent: 'center',
      paddingHorizontal: 16,
      paddingVertical: 10,
      borderRadius: 8,
      backgroundColor: theme.colors.accent,
    },
    primaryButtonPressed: {
      backgroundColor: theme.colors.accentHover,
    },
    primaryButtonText: {
      color: theme.colors.onAccent,
      fontSize: 14,
      fontWeight: '600',
    },
    secondaryButton: {
      minHeight: 44,
      alignSelf: 'flex-start',
      justifyContent: 'center',
      paddingHorizontal: 14,
      paddingVertical: 10,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.surface,
    },
    secondaryButtonText: {
      color: theme.colors.accent,
      fontSize: 14,
      fontWeight: '600',
    },
    compactPrimaryButton: {
      minHeight: 44,
      justifyContent: 'center',
      paddingHorizontal: 14,
      paddingVertical: 8,
      borderRadius: 8,
      backgroundColor: theme.colors.accent,
    },
    compactPrimaryText: {
      color: theme.colors.onAccent,
      fontSize: 13,
      fontWeight: '600',
    },
    compactGhostButton: {
      minHeight: 44,
      justifyContent: 'center',
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.surface,
    },
    compactGhostText: {
      color: theme.colors.textSecondary,
      fontSize: 13,
      fontWeight: '600',
    },
    loadMoreWrap: {
      paddingVertical: 18,
      alignItems: 'center',
    },
    loadMoreButton: {
      minHeight: 46,
      alignSelf: 'stretch',
      justifyContent: 'center',
      alignItems: 'center',
      paddingHorizontal: 16,
      paddingVertical: 11,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.surface,
    },
    disabled: {
      opacity: 0.45,
    },
    rowPressed: {
      backgroundColor: theme.colors.surfaceInteractive,
    },
  });
