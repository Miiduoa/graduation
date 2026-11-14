import React, { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
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
  const [page, setPage] = useState<ViewerPage>({ viewers: [], nextCursor: null });
  const [request, setRequest] = useState<{ cursor: Cursor }>({ cursor: null });
  const [status, setStatus] = useState<'loading' | 'ready' | 'error' | 'denied'>('loading');

  const { id, schoolId, authorUid } = story;
  useEffect(() => {
    let active = true;
    // Firestore's server read may remain pending after a network interruption.
    // Release the UI after a bounded wait. This does not cancel the SDK read:
    // the inactive guard also excludes a late denial or successful result.
    const timeout = setTimeout(() => {
      if (!active) return;
      active = false;
      setStatus('error');
    }, AUDIENCE_READ_TIMEOUT_MS);
    void listStoryViewers({ id, schoolId, authorUid }, request.cursor)
      .then((next) => {
        if (!active) return;
        clearTimeout(timeout);
        setPage((previous) => ({
          viewers: request.cursor ? [...previous.viewers, ...next.viewers] : next.viewers,
          nextCursor: next.nextCursor,
        }));
        setStatus('ready');
      })
      .catch((error: unknown) => {
        if (!active) return;
        clearTimeout(timeout);
        if ((error as { code?: string } | null)?.code === 'permission-denied') {
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
  }, [id, schoolId, authorUid, request]);

  function load(cursor: Cursor) {
    setStatus('loading');
    setRequest({ cursor });
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
          accessibilityState={{ disabled: status === 'loading' }}
          disabled={status === 'loading'}
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
            {status === 'loading' ? (
              <View style={styles.loading} accessibilityLiveRegion="polite">
                <ActivityIndicator color="#b8e7d4" />
                <Text style={styles.status}>正在載入觀看名單…</Text>
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
                <Pressable
                  accessibilityRole="button"
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
  action: {
    minHeight: 44,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 12,
    backgroundColor: '#20342d',
  },
  actionText: { color: '#d6f4e7', fontSize: 16, fontWeight: '600' },
});
