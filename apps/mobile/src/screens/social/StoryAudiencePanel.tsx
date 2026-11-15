import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { listStoryViewers, type CampusStoryDoc } from '../../services/stories';

type ViewerPage = Awaited<ReturnType<typeof listStoryViewers>>;
type Cursor = ViewerPage['nextCursor'];
const AUDIENCE_READ_TIMEOUT_MS = 15_000;

type StoryAudiencePanelProps = {
  story: CampusStoryDoc;
  onBack: () => void;
};

/**
 * The viewer list is private to a story, school, and author. Keep its
 * pagination cursor and pending SDK reads inside that exact scope.
 * A new scope remounts the list before stale viewers can be painted.
 */
export function StoryAudiencePanel(props: StoryAudiencePanelProps) {
  const { id, schoolId, authorUid } = props.story;
  return (
    <StoryAudienceContents
      key={JSON.stringify([schoolId, authorUid, id])}
      {...props}
    />
  );
}

function StoryAudienceContents({ story, onBack }: StoryAudiencePanelProps) {
  const expiresAt = typeof story.expiresAt === 'number' && Number.isFinite(story.expiresAt)
    ? story.expiresAt : null;
  const initiallyExpired = expiresAt !== null && Date.now() >= expiresAt;
  const [page, setPage] = useState<ViewerPage>({ viewers: [], nextCursor: null });
  const [request, setRequest] = useState<{ cursor: Cursor }>({ cursor: null });
  const [status, setStatus] = useState<'loading' | 'ready' | 'error' | 'denied' | 'expired'>(
    initiallyExpired ? 'expired' : 'loading',
  );
  const [inForeground, setInForeground] = useState(
    () => AppState.currentState !== 'background' && AppState.currentState !== 'inactive',
  );
  const foregroundRef = useRef(inForeground);
  const readEpoch = useRef(0);
  const cancelledPageEpoch = useRef<number | null>(null);
  const expiredRef = useRef(initiallyExpired);

  const expireAudience = useCallback(() => {
    if (expiredRef.current) return;
    expiredRef.current = true;
    readEpoch.current += 1;
    cancelledPageEpoch.current = null;
    setPage({ viewers: [], nextCursor: null });
    setStatus('expired');
  }, []);

  // The service/rules remain authoritative. This local deadline also closes
  // an already-open list when no further server request is made.
  useEffect(() => {
    if (expiresAt === null || expiredRef.current) return;
    const remaining = expiresAt - Date.now();
    if (remaining <= 0) {
      expireAudience();
      return;
    }
    const timer = setTimeout(() => {
      if (Date.now() >= expiresAt) expireAudience();
    }, remaining);
    return () => clearTimeout(timer);
  }, [expiresAt, expireAudience]);

  // Returning from the app switcher cannot replay private viewer names from
  // a prior authorization. Stop reads while backgrounded and start at page one.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      // OS timers may be suspended in the background; recheck on every event.
      if (expiresAt !== null && Date.now() >= expiresAt) expireAudience();
      const foreground = state === 'active';
      if (foreground === foregroundRef.current) return;
      foregroundRef.current = foreground;
      readEpoch.current += 1; // Invalidate promises before their effect cleanup.
      cancelledPageEpoch.current = null;
      setPage({ viewers: [], nextCursor: null });
      setStatus(expiredRef.current ? 'expired' : 'loading');
      setRequest({ cursor: null });
      setInForeground(foreground);
    });
    return () => subscription.remove();
  }, [expiresAt, expireAudience]);

  const { id, schoolId, authorUid } = story;
  useEffect(() => {
    if (!inForeground || expiredRef.current) return;
    if (expiresAt !== null && Date.now() >= expiresAt) {
      expireAudience();
      return;
    }
    const epoch = readEpoch.current;
    let active = true;
    let timedOut = false;
    // Firestore's server read may remain pending after a network interruption.
    // Release the UI after a bounded wait without canceling the SDK read.
    // Ignore late success, but keep a late server permission denial authoritative
    // until another request or AppState/scope transition supersedes this read.
    const timeout = setTimeout(() => {
      if (!active || !foregroundRef.current || readEpoch.current !== epoch) return;
      timedOut = true;
      setStatus('error');
    }, AUDIENCE_READ_TIMEOUT_MS);
    void listStoryViewers({ id, schoolId, authorUid }, request.cursor)
      .then((next) => {
        // AppState events invalidate reads before React runs passive cleanup.
        if (!active || !foregroundRef.current || readEpoch.current !== epoch || expiredRef.current) return;
        if (expiresAt !== null && Date.now() >= expiresAt) {
          expireAudience();
          return;
        }
        if (timedOut) return;
        clearTimeout(timeout);
        setPage((previous) => {
          // A live audience can change between cursor reads. Keep one visible
          // row per viewer even if a later server page overlaps an earlier one.
          const candidates = request.cursor
            ? [...previous.viewers, ...next.viewers]
            : next.viewers;
          const seen = new Set<string>();
          const viewers = candidates.filter((viewer) => {
            if (seen.has(viewer.uid)) return false;
            seen.add(viewer.uid);
            return true;
          });
          return { viewers, nextCursor: next.nextCursor };
        });
        setStatus('ready');
      })
      .catch((error: unknown) => {
        // Cancellation discards late success, but a server permission denial
        // still clears private names unless another read supersedes it.
        if (!active || !foregroundRef.current || expiredRef.current) return;
        if (expiresAt !== null && Date.now() >= expiresAt) {
          expireAudience();
          return;
        }
        const denied = (error as { code?: string } | null)?.code === 'permission-denied';
        if (readEpoch.current !== epoch) {
          if (denied && cancelledPageEpoch.current === epoch && readEpoch.current === epoch + 1) {
            cancelledPageEpoch.current = null;
            setPage({ viewers: [], nextCursor: null });
            setStatus('denied');
          }
          return;
        }
        // After a UI timeout, a late denial must still hide already-rendered
        // names; a late transient error must not override the retry affordance.
        if (timedOut && !denied) return;
        clearTimeout(timeout);
        if (denied) {
          setPage({ viewers: [], nextCursor: null });
          setStatus('denied');
        } else {
          setStatus('error');
        }
      });
    return () => {
      active = false;
      clearTimeout(timeout);
    };
  }, [id, schoolId, authorUid, request, inForeground, expiresAt, expireAudience]);

  function load(cursor: Cursor) {
    if (expiresAt !== null && Date.now() >= expiresAt) {
      expireAudience();
      return;
    }
    if (!foregroundRef.current || expiredRef.current) return;
    readEpoch.current += 1;
    cancelledPageEpoch.current = null;
    setStatus('loading');
    setRequest({ cursor });
  }

  function stopWaitingForNextPage() {
    if (expiresAt !== null && Date.now() >= expiresAt) {
      expireAudience();
      return;
    }
    if (!foregroundRef.current || expiredRef.current || status !== 'loading' || request.cursor === null) return;
    // Stop this UI wait without claiming to cancel Firestore's transport.
    // Ignore late success, but still honor a late server permission denial
    // for this read until a newer request or scope transition supersedes it.
    cancelledPageEpoch.current = readEpoch.current;
    readEpoch.current += 1;
    setStatus('ready');
  }

  function refresh() {
    // A fresh server read must not paint previously fetched private names
    // while membership or story visibility may have changed.
    setPage({ viewers: [], nextCursor: null });
    load(null);
  }

  const count = page.viewers.length;
  return (
    <View style={styles.panel}>
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="返回限時動態"
          onPress={onBack}
          style={styles.back}
        >
          <Ionicons name="arrow-back" color="#fff" size={22} />
        </Pressable>
        <View style={styles.titleBlock}>
          <Text accessibilityRole="header" style={styles.title}>
            誰看過
          </Text>
          <Text style={styles.subtitle}>只有你可以查看這份名單</Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="重新整理觀看名單"
          accessibilityHint="重新向伺服器確認觀看者及目前權限"
          accessibilityState={{ disabled: status === 'loading' || status === 'expired' }}
          disabled={status === 'loading' || status === 'expired'}
          onPress={refresh}
          style={styles.refresh}
        >
          <Ionicons name="refresh" color="#d6f4e7" size={20} />
        </Pressable>
      </View>
      {count > 0 && (
        <Text accessibilityLiveRegion="polite" style={styles.summary}>
          已顯示 {count} 位 · 最近觀看優先
        </Text>
      )}
      <FlatList
        data={page.viewers}
        keyExtractor={(viewer) => viewer.uid}
        renderItem={({ item }) => (
          <View style={styles.row}>
            <View
              style={styles.avatar}
              importantForAccessibility="no-hide-descendants"
              accessibilityElementsHidden
            >
              <Ionicons name="person-outline" color="#cce6da" size={19} />
            </View>
            <Text style={styles.name}>{item.displayName}</Text>
          </View>
        )}
        ListEmptyComponent={
          status === 'ready' ? <Text style={styles.status}>目前還沒有觀看紀錄</Text> : null
        }
        ListFooterComponent={
          <View style={styles.footer}>
            {status === 'expired' ? (
              <Text accessibilityLiveRegion="polite" style={styles.status}>
                限時動態已到期，觀看名單已關閉
              </Text>
            ) : status === 'loading' ? (
              <View style={styles.loading} accessibilityLiveRegion="polite">
                <ActivityIndicator color="#b8e7d4" />
                <Text style={styles.status}>
                  {request.cursor ? '正在載入更多觀看者…' : '正在載入觀看名單…'}
                </Text>
                {request.cursor && (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="停止等待下一頁"
                    accessibilityHint="保留已顯示的觀看者，可稍後重新載入下一頁"
                    style={styles.action}
                    onPress={stopWaitingForNextPage}
                  >
                    <Text style={styles.actionText}>停止等待</Text>
                  </Pressable>
                )}
              </View>
            ) : status === 'denied' ? (
              <>
                <Text accessibilityLiveRegion="polite" style={styles.status}>
                  目前無法存取這則限時動態的觀看名單
                </Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="重新檢查存取權限"
                  accessibilityHint="校籍資格恢復後，重新從第一頁向伺服器確認"
                  style={styles.action}
                  onPress={refresh}
                >
                  <Text style={styles.actionText}>重新檢查權限</Text>
                </Pressable>
              </>
            ) : status === 'error' ? (
              <>
                <Text accessibilityLiveRegion="polite" style={styles.status}>
                  暫時無法載入觀看名單
                </Text>
                {request.cursor !== null && page.viewers.length > 0 && (
                  <Text style={styles.retryScope}>
                    下一頁讀取失敗，已顯示的觀看者會保留
                  </Text>
                )}
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={request.cursor !== null ? '重試載入下一頁觀看者' : '重新載入觀看名單'}
                  accessibilityHint={request.cursor !== null
                    ? '從原本的分頁位置向伺服器重試，保留已顯示的觀看者'
                    : '從第一頁重新向伺服器查詢觀看名單'}
                  style={styles.action}
                  onPress={() => load(request.cursor)}
                >
                  <Text style={styles.actionText}>再試一次</Text>
                </Pressable>
              </>
            ) : (
              page.nextCursor && (
                <Pressable
                  accessibilityRole="button"
                  style={styles.action}
                  onPress={() => load(page.nextCursor)}
                >
                  <Text style={styles.actionText}>載入更多觀看者</Text>
                </Pressable>
              )
            )}
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { flex: 1, paddingHorizontal: 4 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
  back: {
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 22,
    backgroundColor: '#242928',
  },
  titleBlock: { flex: 1, gap: 3 },
  refresh: {
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 22,
    backgroundColor: '#20342d',
  },
  title: { fontSize: 23, fontWeight: '700', color: '#fff' },
  subtitle: { fontSize: 14, color: '#c2cbc8' },
  summary: { fontSize: 14, color: '#c2cbc8', marginVertical: 10 },
  row: {
    paddingVertical: 10,
    flexDirection: 'row',
    gap: 12,
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#3a403e',
  },
  avatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#25372f',
  },
  name: { flex: 1, fontSize: 16, color: '#fff' },
  footer: { gap: 12, paddingVertical: 18 },
  loading: { alignItems: 'center', gap: 8 },
  status: { color: '#c2cbc8', fontSize: 16, textAlign: 'center', paddingVertical: 8 },
  retryScope: { color: '#d6f4e7', fontSize: 14, textAlign: 'center' },
  action: {
    minHeight: 44,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 12,
    backgroundColor: '#20342d',
  },
  actionText: { color: '#d6f4e7', fontSize: 16, fontWeight: '600' },
});
