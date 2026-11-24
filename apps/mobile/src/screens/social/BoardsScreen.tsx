/* eslint-disable */
/** 依類型列出校園看板，並管理目前帳號的訂閱。 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  Pressable,
  RefreshControl,
  ActivityIndicator,
  StyleSheet,
  Image,
  TextInput,
  Alert,
  Modal,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Switch,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { theme } from '../../ui/theme';
import { useThemeStyleSheet } from '../../ui/useThemeStyleSheet';
import { TAB_BAR_CONTENT_BOTTOM_PADDING } from '../../ui/navigationTheme';
import { useSchool } from '../../state/school';
import { useAuth } from '../../state/auth';
import { isFirebaseMockMode } from '../../firebase';
import {
  listBoards,
  listSubscribedBoardIds,
  isSubscribedToBoard,
  subscribeToBoard,
  unsubscribeFromBoard,
  groupBoardsByType,
  createBoard,
  CAMPUS_BOARD_TYPE_LABEL,
  type CampusBoard,
  type CampusBoardType,
} from '../../services/boards';
import { useCampusSocialStackNav } from './CampusSocialNavContext';

type RowItem = { kind: 'header'; type: CampusBoardType } | { kind: 'board'; board: CampusBoard };

const TYPE_ICON: Record<CampusBoardType, keyof typeof import('@expo/vector-icons').Ionicons.glyphMap> = {
  department: 'school-outline',
  course: 'book-outline',
  topic: 'pricetag-outline',
  anon: 'eye-off-outline',
};

export function BoardsScreen() {
  const { user, loading } = useAuth();
  const { school } = useSchool();
  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 }}>
        <ActivityIndicator color={theme.colors.accent} />
        <Text style={{ color: theme.colors.textSecondary }}>正在確認登入狀態…</Text>
      </View>
    );
  }
  return <BoardsContent key={JSON.stringify([user?.uid, school?.id])} />;
}

type SubscriptionListRead = {
  subscribedIds: ReadonlySet<string>;
  writeRevisionAtRead: number;
};

function BoardsContent() {
  const styles = useThemeStyleSheet(createStyles);
  const injectedNav = useCampusSocialStackNav();
  const fb = useNavigation<any>();
  const nav = injectedNav ?? fb;
  const { school } = useSchool();
  const auth = useAuth();
  const insets = useSafeAreaInsets();
  const [boards, setBoards] = useState<CampusBoard[]>([]);
  const [subscribed, setSubscribed] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [composeOpen, setComposeOpen] = useState(false);
  const [loadError, setLoadError] = useState('');
  const loadVersion = useRef(0);
  // Order single-board queries at dispatch and list snapshots when applied.
  const serverReadRevision = useRef(0);
  // Writes still in flight per board (several may be queued while offline).
  const pendingSubscriptionCounts = useRef(new Map<string, number>());
  // Per-board write revision: only boards written after a read started keep
  // their local state; every other board still takes the server snapshot.
  const subscriptionRevision = useRef(0);
  const boardWriteRevision = useRef(new Map<string, number>());
  // Last server read that applied membership for this board.
  const boardServerAppliedRevision = useRef(new Map<string, number>());
  // A list started before this board's last successful write used keepLocal.
  // After that write settles, re-check so a later server change is not dropped.
  const keepLocalFromStaleList = useRef(new Set<string>());
  const lastSettledWriteSucceeded = useRef(new Set<string>());
  // After a failed write, keep the rollback until a from-server re-check lands.
  // A later list may still be served from cache and omit the board.
  const awaitingServerConfirm = useRef(new Set<string>());
  const pendingServerConfirmCounts = useRef(new Map<string, number>());
  // List membership skipped by keepLocal after a successful write. If the
  // follow-up from-server re-check fails, a list that already included a newer
  // subscription must still be applied.
  const deferredListMembership = useRef(new Map<string, SubscriptionListRead>());
  const lastSuccessfulUnsubscribeRevision = useRef(new Map<string, number>());
  const reconcileBoardSubscriptionRef = useRef<(boardId: string, uid: string, sid: string) => void>(() => {});
  // Latest tap per board; only its outcome may roll back or alert.
  const latestIntent = useRef(new Map<string, number>());
  const intentCounter = useRef(0);
  // Boards whose current batch of in-flight writes included a failure.
  const failedSinceIdle = useRef(new Set<string>());
  // Last server-confirmed subscription set. Optimistic taps never write this;
  // a failed latest write rolls back here instead of to the previous tap.
  const confirmedSubscribedRef = useRef<Set<string>>(new Set());
  const lastConfirmedIntent = useRef(new Map<string, number>());
  // Mirrors `subscribed` synchronously so two presses before a rerender toggle
  // from the newest optimistic state instead of a stale closure.
  const subscribedRef = useRef<Set<string>>(new Set());
  const applySubscribed = useCallback((update: (previous: Set<string>) => Set<string>) => {
    setSubscribed((previous) => {
      const next = update(previous);
      subscribedRef.current = next;
      return next;
    });
  }, []);
  const [pendingSubscriptions, setPendingSubscriptions] = useState<ReadonlySet<string>>(new Set());
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const load = useCallback(async () => {
    const version = ++loadVersion.current;
    const subscriptionRevisionAtStart = subscriptionRevision.current;
    const overlappingConfirmations = new Set([
      ...awaitingServerConfirm.current,
      ...pendingServerConfirmCounts.current.keys(),
    ]);
    setLoadError('');
    try {
      if (isFirebaseMockMode() || !school?.id || !auth.user?.uid) {
        setBoards([]);
        confirmedSubscribedRef.current = new Set();
        applySubscribed(() => new Set());
        return;
      }
      const [rows, membership] = await Promise.all([
        listBoards(school.id, 120),
        listSubscribedBoardIds(auth.user.uid, school.id, { throwOnError: true }).then(
          (subs): SubscriptionListRead => ({
            subscribedIds: new Set(subs),
            writeRevisionAtRead: subscriptionRevision.current,
          }),
        ),
      ]);
      if (loadVersion.current !== version) return;
      setBoards(rows);
      const keepLocal = new Set(pendingSubscriptionCounts.current.keys());
      for (const [id, revision] of boardWriteRevision.current) {
        if (revision > subscriptionRevisionAtStart) keepLocal.add(id);
      }
      const { subscribedIds } = membership;
      for (const id of awaitingServerConfirm.current) overlappingConfirmations.add(id);
      for (const id of pendingServerConfirmCounts.current.keys()) overlappingConfirmations.add(id);
      for (const id of overlappingConfirmations) {
        // Cache-backed membership cannot replace a rollback or a single-board
        // result that landed during this refresh. A matching omission with no
        // known subscription can still take the normal list path.
        if (confirmedSubscribedRef.current.has(id) || subscribedIds.has(id)) keepLocal.add(id);
      }
      const tracked = new Set([
        ...subscribedIds,
        ...keepLocal,
        ...subscribedRef.current,
        ...confirmedSubscribedRef.current,
        ...boardWriteRevision.current.keys(),
      ]);
      const nextConfirmed = new Set(subscribedIds);
      for (const id of keepLocal) {
        if (confirmedSubscribedRef.current.has(id)) nextConfirmed.add(id);
        else nextConfirmed.delete(id);
      }
      confirmedSubscribedRef.current = nextConfirmed;
      const applied = ++serverReadRevision.current;
      for (const id of tracked) {
        if (!keepLocal.has(id)) {
          boardServerAppliedRevision.current.set(id, applied);
          deferredListMembership.current.delete(id);
        }
      }
      applySubscribed((previous) => {
        const next = new Set(subscribedIds);
        for (const id of keepLocal) {
          if (previous.has(id)) next.add(id);
          else next.delete(id);
        }
        return next;
      });
      for (const id of keepLocal) {
        keepLocalFromStaleList.current.add(id);
        // Retain the membership captured when the subscription query resolved,
        // even if board rows or writes were still in flight at that point.
        deferredListMembership.current.set(id, membership);
        const keptRollback =
          awaitingServerConfirm.current.has(id) &&
          nextConfirmed.has(id) &&
          !subscribedIds.has(id);
        // A list that includes a subscription kept locally as unsubscribed
        // (for example after a failed write) may be newer than the rollback.
        // A list that omits a still-confirmed subscription is a cache gap and
        // must not by itself trigger another re-read after the first confirm.
        const listClaimsUnkeptSubscription = subscribedIds.has(id) && !nextConfirmed.has(id);
        const listOmitsConfirmed = !subscribedIds.has(id) && nextConfirmed.has(id);
        if (
          !pendingSubscriptionCounts.current.has(id) &&
          (keptRollback ||
            listClaimsUnkeptSubscription ||
            (lastSettledWriteSucceeded.current.has(id) && !listOmitsConfirmed)) &&
          auth.user?.uid &&
          school?.id
        ) {
          keepLocalFromStaleList.current.delete(id);
          void reconcileBoardSubscriptionRef.current(id, auth.user.uid, school.id);
        }
      }
    } catch (cause) {
      if (loadVersion.current !== version) return;
      const code = (cause as { code?: string })?.code ?? '';
      if (code.endsWith('permission-denied') || code.endsWith('unauthenticated')) {
        setBoards([]);
        confirmedSubscribedRef.current = new Set();
        applySubscribed(() => new Set());
      }
      setLoadError('暫時無法更新看板。請確認網路與登入狀態，再試一次。');
    } finally {
      if (loadVersion.current === version) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [school?.id, auth.user?.uid, applySubscribed]);

  // Re-read one board's subscription after a failed write without touching the
  // list refresh pipeline (loadVersion, error banner, spinner), so an in-flight
  // pull-to-refresh is never discarded. Best effort: errors keep the rollback.
  const reconcileBoardSubscription = useCallback(async (boardId: string, uid: string, sid: string) => {
    const revisionAtRead = subscriptionRevision.current;
    const readRevision = ++serverReadRevision.current;
    // latestIntent only moves forward and is never restored after a failed
    // write, so an older re-read cannot clobber a newer one for this board.
    const intentAtStart = latestIntent.current.get(boardId);
    const deferredMembership = deferredListMembership.current.get(boardId);
    // Only a successful confirmation occupies the sequence. A newer query that
    // fails must not discard an older successful result.
    const canApply = () =>
      mounted.current &&
      !pendingSubscriptionCounts.current.has(boardId) &&
      (boardWriteRevision.current.get(boardId) ?? -1) <= revisionAtRead &&
      (boardServerAppliedRevision.current.get(boardId) ?? 0) < readRevision &&
      latestIntent.current.get(boardId) === intentAtStart;
    const pending = pendingServerConfirmCounts.current;
    pending.set(boardId, (pending.get(boardId) ?? 0) + 1);
    try {
      // Read this board only. listSubscribedBoardIds is capped at 100 and
      // must not treat a missing id as "unsubscribed".
      const serverSubscribed = await isSubscribedToBoard(uid, sid, boardId, { fromServer: true });
      if (!canApply()) return;
      boardServerAppliedRevision.current.set(boardId, readRevision);
      const nextConfirmed = new Set(confirmedSubscribedRef.current);
      if (serverSubscribed) nextConfirmed.add(boardId);
      else nextConfirmed.delete(boardId);
      confirmedSubscribedRef.current = nextConfirmed;
      awaitingServerConfirm.current.delete(boardId);
      if (deferredListMembership.current.get(boardId) === deferredMembership) {
        deferredListMembership.current.delete(boardId);
      }
      applySubscribed((previous) => {
        if (previous.has(boardId) === serverSubscribed) return previous;
        const next = new Set(previous);
        if (serverSubscribed) next.add(boardId);
        else next.delete(boardId);
        return next;
      });
    } catch {
      if (!canApply() || deferredListMembership.current.get(boardId) !== deferredMembership) return;
      deferredListMembership.current.delete(boardId);
      if (
        deferredMembership?.subscribedIds.has(boardId) &&
        deferredMembership.writeRevisionAtRead >= (lastSuccessfulUnsubscribeRevision.current.get(boardId) ?? 0) &&
        lastSettledWriteSucceeded.current.has(boardId) &&
        !confirmedSubscribedRef.current.has(boardId)
      ) {
        const nextConfirmed = new Set(confirmedSubscribedRef.current);
        nextConfirmed.add(boardId);
        confirmedSubscribedRef.current = nextConfirmed;
        applySubscribed((previous) => {
          if (previous.has(boardId)) return previous;
          const next = new Set(previous);
          next.add(boardId);
          return next;
        });
        return;
      }
      // Keep the pre-tap rollback or confirmed write; the next refresh will reconcile.
    } finally {
      const remaining = (pending.get(boardId) ?? 1) - 1;
      if (remaining > 0) pending.set(boardId, remaining);
      else pending.delete(boardId);
    }
  }, [applySubscribed]);
  reconcileBoardSubscriptionRef.current = reconcileBoardSubscription;

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
  }, [load]);

  useEffect(() => {
    setLoading(true);
    void load();
    return () => {
      loadVersion.current += 1;
    };
  }, [load]);

  const q = filter.trim().toLowerCase();
  const visibleBoards = useMemo(
    () =>
      q
        ? boards.filter((b) =>
            `${b.name} ${b.slug ?? ''} ${b.rules ?? ''}`.toLowerCase().includes(q),
          )
        : boards,
    [boards, q],
  );

  const items = useMemo<RowItem[]>(() => {
    const grouped = groupBoardsByType(visibleBoards);
    const order: CampusBoardType[] = ['department', 'course', 'topic', 'anon'];
    const out: RowItem[] = [];
    for (const t of order) {
      const arr = grouped[t];
      if (!arr || arr.length === 0) continue;
      out.push({ kind: 'header', type: t });
      arr.forEach((b) => out.push({ kind: 'board', board: b }));
    }
    return out;
  }, [visibleBoards]);

  const onToggleSubscribe = useCallback(
    async (b: CampusBoard) => {
      const uid = auth.user?.uid;
      const sid = school?.id;
      if (!uid || !sid || isFirebaseMockMode()) {
        if (!uid) Alert.alert('請登入', '登入後即可訂閱看板');
        return;
      }
      const wasSub = subscribedRef.current.has(b.id);
      const target = !wasSub;
      const intent = ++intentCounter.current;
      latestIntent.current.set(b.id, intent);
      pendingSubscriptionCounts.current.set(b.id, (pendingSubscriptionCounts.current.get(b.id) ?? 0) + 1);
      subscriptionRevision.current += 1;
      boardWriteRevision.current.set(b.id, subscriptionRevision.current);
      setPendingSubscriptions(new Set(pendingSubscriptionCounts.current.keys()));
      const optimistic = new Set(subscribedRef.current);
      if (target) optimistic.add(b.id);
      else optimistic.delete(b.id);
      subscribedRef.current = optimistic;
      applySubscribed((previous) => {
        const next = new Set(previous);
        if (target) next.add(b.id);
        else next.delete(b.id);
        return next;
      });
      let failed = false;
      try {
        // Writes are not blocked while pending: offline Firestore queues them in
        // order, so the student can still undo a mistaken tap before reconnecting.
        if (wasSub) await unsubscribeFromBoard(uid, sid, b.id);
        else await subscribeToBoard(uid, sid, b.id);
      } catch (error: any) {
        failed = true;
        failedSinceIdle.current.add(b.id);
        const isLatest = latestIntent.current.get(b.id) === intent;
        // Do not restore boardWriteRevision on failure: a list read that
        // started during this write may still be carrying an unconfirmed
        // cache snapshot, and must not overwrite the rollback later.
        // A delayed failure from the previous user/school must not alert or
        // revert the currently mounted student's board subscriptions. An older
        // failure is superseded by the student's newer tap on the same board.
        if (mounted.current && isLatest) {
          applySubscribed((previous) => {
            const next = new Set(previous);
            if (confirmedSubscribedRef.current.has(b.id)) next.add(b.id);
            else next.delete(b.id);
            return next;
          });
          Alert.alert('訂閱失敗', error?.message ?? String(error));
        }
      } finally {
        const remaining = (pendingSubscriptionCounts.current.get(b.id) ?? 1) - 1;
        if (remaining > 0) pendingSubscriptionCounts.current.set(b.id, remaining);
        else pendingSubscriptionCounts.current.delete(b.id);
        // A list started during any pending write still needs keepLocal
        // after that write settles, including when a newer tap settled first.
        const settledRevision = ++subscriptionRevision.current;
        boardWriteRevision.current.set(b.id, settledRevision);
        if (latestIntent.current.get(b.id) === intent) {
          if (failed) {
            lastSettledWriteSucceeded.current.delete(b.id);
            awaitingServerConfirm.current.add(b.id);
          } else {
            lastSettledWriteSucceeded.current.add(b.id);
            awaitingServerConfirm.current.delete(b.id);
          }
        }
        if (!failed && (lastConfirmedIntent.current.get(b.id) ?? 0) < intent) {
          lastConfirmedIntent.current.set(b.id, intent);
          const nextConfirmed = new Set(confirmedSubscribedRef.current);
          if (target) nextConfirmed.add(b.id);
          else {
            nextConfirmed.delete(b.id);
            lastSuccessfulUnsubscribeRevision.current.set(b.id, settledRevision);
          }
          confirmedSubscribedRef.current = nextConfirmed;
        }
        if (mounted.current) setPendingSubscriptions(new Set(pendingSubscriptionCounts.current.keys()));
      }
      // The rollback above is only the pre-tap guess; a snapshot taken during
      // the write may have included the unconfirmed local change. Re-read the
      // server once this board has no writes left in flight, even if the last
      // write to settle succeeded but an earlier one in the batch failed.
      if (!pendingSubscriptionCounts.current.has(b.id) && mounted.current) {
        if (failedSinceIdle.current.delete(b.id)) {
          void reconcileBoardSubscription(b.id, uid, sid);
        } else if (!failed && keepLocalFromStaleList.current.delete(b.id)) {
          // The in-flight list kept the pre-write local state. Re-read so a
          // later server change (for example another device re-subscribing)
          // is not dropped after this successful write.
          void reconcileBoardSubscription(b.id, uid, sid);
        }
      }
    },
    [auth.user?.uid, school?.id, applySubscribed, reconcileBoardSubscription],
  );

  if (!auth.user?.uid) {
    return (
      <View style={styles.center}>
        <Text style={{ color: theme.colors.textSecondary }}>請先登入以瀏覽看板</Text>
      </View>
    );
  }

  return (
    <View style={[styles.root, { paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING + insets.bottom }]}>
      <View style={styles.searchBox}>
        <Ionicons name="search" size={16} color={theme.colors.muted} />
        <TextInput
          value={filter}
          onChangeText={setFilter}
          placeholder="搜尋看板"
          placeholderTextColor={theme.colors.muted}
          style={styles.searchInput}
        />
        {filter.length > 0 && (
          <Pressable onPress={() => setFilter('')}>
            <Ionicons name="close-circle" size={16} color={theme.colors.muted} />
          </Pressable>
        )}
      </View>

      {!!loadError && (
        <View style={{ padding: 16, gap: 8 }}>
          <Text accessibilityRole="alert" style={{ color: theme.colors.textSecondary }}>
            {loadError}
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => void onRefresh()}
            style={{ paddingVertical: 10 }}
          >
            <Text style={{ color: theme.colors.accent, fontWeight: '600' }}>重新讀取看板</Text>
          </Pressable>
        </View>
      )}
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={theme.colors.accent} />
        </View>
      ) : (
        <FlatList
          style={{ flex: 1 }}
          data={items}
          keyExtractor={(it, idx) =>
            it.kind === 'header' ? `h_${it.type}` : `b_${it.board.id}_${idx}`
          }
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          ListEmptyComponent={
            loadError ? null : (
              <View style={styles.emptyWrap}>
                <Ionicons name="layers-outline" size={36} color={theme.colors.textSecondary} />
                <Text style={styles.emptyTitle}>
                  {boards.length === 0 ? '尚無任何看板' : '沒有符合條件的看板'}
                </Text>
                <Text style={styles.emptyDesc}>
                  {boards.length === 0
                    ? '這所學校還沒有看板。你可以建立一個，邀請同學一起討論。'
                    : '試試其他關鍵字，或清除搜尋。'}
                </Text>
              </View>
            )
          }
          ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
          renderItem={({ item }) => {
            if (item.kind === 'header') {
              return (
                <View style={styles.sectionHeader}>
                  <Ionicons name={TYPE_ICON[item.type]} size={14} color={theme.colors.textSecondary} />
                  <Text style={styles.sectionHeaderTxt}>{CAMPUS_BOARD_TYPE_LABEL[item.type]}</Text>
                </View>
              );
            }
            const b = item.board;
            const isSub = subscribed.has(b.id);
            const isPending = pendingSubscriptions.has(b.id);
            return (
              <Pressable
                style={styles.row}
                onPress={() =>
                  nav?.navigate?.('BoardDetail' as never, {
                    boardId: b.id,
                    boardName: b.name,
                    defaultAnonymous: b.defaultAnonymous,
                  })
                }
              >
                {b.coverImage ? (
                  <Image source={{ uri: b.coverImage }} style={styles.cover} />
                ) : (
                  <View style={[styles.cover, styles.coverFallback]}>
                    <Ionicons name={TYPE_ICON[(b.type ?? 'topic') as CampusBoardType]} size={22} color={theme.colors.textSecondary} />
                  </View>
                )}
                <View style={{ flex: 1 }}>
                  <View style={styles.rowTitleLine}>
                    <Text style={styles.rowTitle} numberOfLines={1}>
                      {b.name}
                    </Text>
                    {b.defaultAnonymous ? (
                      <View style={styles.anonChip}>
                        <Ionicons name="eye-off" size={10} color={theme.colors.textSecondary} />
                        <Text style={styles.anonChipTxt}>匿名</Text>
                      </View>
                    ) : null}
                  </View>
                  {b.rules ? (
                    <Text numberOfLines={2} style={styles.rulePreview}>
                      {b.rules}
                    </Text>
                  ) : (
                    <Text style={styles.subtle}>{CAMPUS_BOARD_TYPE_LABEL[(b.type ?? 'topic') as CampusBoardType]}板</Text>
                  )}
                </View>
                <Pressable
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel={`${isSub ? '取消訂閱' : '訂閱'}${b.name}`}
                  accessibilityHint={isPending ? '正在同步訂閱狀態，可再點一次撤銷' : '向伺服器更新本校看板訂閱'}
                  accessibilityState={{ busy: isPending }}
                  onPress={(e) => {
                    e?.stopPropagation?.();
                    void onToggleSubscribe(b);
                  }}
                  style={[styles.subBtn, isSub && styles.subBtnOn, isPending && { opacity: 0.65 }]}
                >
                  <Ionicons
                    name={isSub ? 'notifications' : 'notifications-outline'}
                    size={14}
                    color={isSub ? theme.colors.onAccent : theme.colors.accent}
                  />
                  <Text style={[styles.subBtnTxt, isSub && { color: theme.colors.onAccent }]}>
                    {isSub ? '已訂閱' : '訂閱'}
                  </Text>
                </Pressable>
              </Pressable>
            );
          }}
        />
      )}

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="建立新看板"
        style={[styles.fab, { bottom: insets.bottom + TAB_BAR_CONTENT_BOTTOM_PADDING + 16 }]}
        onPress={() => setComposeOpen(true)}
      >
        <Ionicons name="add" size={24} color={theme.colors.onAccent} />
      </Pressable>

      <CreateBoardModal
        visible={composeOpen}
        onDismiss={() => setComposeOpen(false)}
        onCreated={async () => {
          setComposeOpen(false);
          await load();
        }}
      />
    </View>
  );
}

// ─── CreateBoardModal ──────────────────────────────────────

function CreateBoardModal(props: {
  visible: boolean;
  onDismiss: () => void;
  onCreated: () => void;
}) {
  const styles = useThemeStyleSheet(createStyles);
  const auth = useAuth();
  const { school } = useSchool();
  const [name, setName] = useState('');
  const [type, setType] = useState<CampusBoardType>('topic');
  const [rules, setRules] = useState('');
  const [anon, setAnon] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!props.visible) {
      setName('');
      setRules('');
      setType('topic');
      setAnon(false);
    }
  }, [props.visible]);

  useEffect(() => {
    setAnon(type === 'anon');
  }, [type]);

  const submit = async () => {
    const uid = auth.user?.uid;
    const sid = school?.id;
    if (!uid || !sid || isFirebaseMockMode()) {
      Alert.alert(
        '無法建立',
        isFirebaseMockMode() ? '模擬模式下無法寫入 Firestore' : '需要登入並選擇學校',
      );
      return;
    }
    if (name.trim().length < 2) {
      Alert.alert('看板名稱', '請至少 2 個字');
      return;
    }
    setBusy(true);
    try {
      await createBoard({
        schoolId: sid,
        name: name.trim(),
        type,
        rules: rules.trim(),
        defaultAnonymous: anon,
        createdBy: uid,
      });
      Alert.alert('已建立', '看板已上架，下拉重新整理即可看到。');
      props.onCreated();
    } catch (e: any) {
      Alert.alert('建立失敗', e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={props.visible} animationType="slide" presentationStyle="formSheet" onRequestClose={props.onDismiss}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: theme.colors.bg }}>
        <ScrollView contentContainerStyle={{ padding: theme.layout.screenPadding }}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>建立看板</Text>
            <Pressable hitSlop={8} onPress={props.onDismiss}>
              <Ionicons name="close" size={22} color={theme.colors.textSecondary} />
            </Pressable>
          </View>
          <Text style={styles.fieldLabel}>看板名稱</Text>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="例：資工系 / 程式甘苦談 / 校隊招新"
            placeholderTextColor={theme.colors.muted}
            style={styles.input}
            maxLength={32}
          />

          <Text style={styles.fieldLabel}>類型</Text>
          <View style={styles.typeRow}>
            {(['department', 'course', 'topic', 'anon'] as CampusBoardType[]).map((t) => {
              const on = type === t;
              return (
                <Pressable
                  key={t}
                  onPress={() => setType(t)}
                  style={[styles.typeChip, on && styles.typeChipOn]}
                >
                  <Ionicons
                    name={TYPE_ICON[t]}
                    size={14}
                    color={on ? theme.colors.onAccent : theme.colors.textSecondary}
                  />
                  <Text style={[styles.typeChipTxt, on && { color: theme.colors.onAccent }]}>
                    {CAMPUS_BOARD_TYPE_LABEL[t]}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <View style={styles.switchRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.fieldLabel}>預設匿名發文</Text>
              <Text style={styles.hintMuted}>開啟後此看板的發文預設「匿名」</Text>
            </View>
            <Switch value={anon} onValueChange={setAnon} />
          </View>

          <Text style={styles.fieldLabel}>看板規則（選填）</Text>
          <TextInput
            value={rules}
            onChangeText={setRules}
            placeholder="例：請以友善與尊重為原則，請勿張貼商業廣告。"
            placeholderTextColor={theme.colors.muted}
            multiline
            style={[styles.input, styles.inputMulti]}
            maxLength={400}
          />

          <Pressable
            style={[styles.primaryBtn, busy && { opacity: 0.6 }]}
            disabled={busy}
            onPress={submit}
          >
            {busy ? (
              <ActivityIndicator color={theme.colors.onAccent} />
            ) : (
              <Text style={styles.primaryBtnTxt}>建立看板</Text>
            )}
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const createStyles = () => StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.colors.bg, paddingHorizontal: 14 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: theme.space.md,
    marginBottom: theme.space.md,
    paddingHorizontal: 12,
    paddingVertical: 9,
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
  },
  searchInput: { flex: 1, color: theme.colors.text, fontSize: 14, paddingVertical: 0 },

  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 4,
    paddingVertical: 6,
    marginTop: theme.space.md,
  },
  sectionHeaderTxt: {
    color: theme.colors.textSecondary,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.5,
  },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.md,
    padding: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
  },
  cover: { width: 52, height: 52, borderRadius: theme.radius.sm },
  coverFallback: {
    backgroundColor: theme.colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowTitleLine: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  rowTitle: { fontSize: 15, fontWeight: '700', color: theme.colors.text },
  anonChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: theme.colors.bg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
    borderRadius: 999,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  anonChipTxt: { fontSize: 10, color: theme.colors.textSecondary, fontWeight: '700' },
  rulePreview: { fontSize: 12, color: theme.colors.textSecondary, marginTop: 4, lineHeight: 16 },
  subtle: { fontSize: 11, color: theme.colors.muted, marginTop: 4 },

  subBtn: {
    flexDirection: 'row',
    minHeight: 44,
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: theme.colors.accent,
  },
  subBtnOn: { backgroundColor: theme.colors.accent, borderColor: theme.colors.accent },
  subBtnTxt: { color: theme.colors.accent, fontSize: 11, fontWeight: '700' },

  emptyWrap: { alignItems: 'center', padding: 32, gap: 6 },
  emptyTitle: { color: theme.colors.text, fontWeight: '700', fontSize: 15, marginTop: 8 },
  emptyDesc: { color: theme.colors.textSecondary, fontSize: 12, textAlign: 'center' },

  fab: {
    position: 'absolute',
    right: 16,
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: theme.colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },

  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: theme.space.md,
  },
  modalTitle: { fontSize: 18, fontWeight: '700', color: theme.colors.text },
  fieldLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: theme.colors.text,
    marginTop: theme.space.md,
    marginBottom: 6,
  },
  hintMuted: { fontSize: 12, color: theme.colors.textSecondary, marginTop: 2 },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.sm,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: theme.colors.text,
    fontSize: 14,
  },
  inputMulti: { minHeight: 92, textAlignVertical: 'top' },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: theme.space.md,
  },
  typeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  typeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: theme.colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
  },
  typeChipOn: { backgroundColor: theme.colors.accent, borderColor: theme.colors.accent },
  typeChipTxt: { fontSize: 12, color: theme.colors.textSecondary, fontWeight: '700' },

  primaryBtn: {
    marginTop: theme.space.xl,
    backgroundColor: theme.colors.accent,
    paddingVertical: 14,
    borderRadius: theme.radius.md,
    alignItems: 'center',
  },
  primaryBtnTxt: { color: theme.colors.onAccent, fontWeight: '700', fontSize: 16 },
});

export default BoardsScreen;
