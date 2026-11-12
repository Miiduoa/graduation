import React, { useLayoutEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo, ActivityIndicator, FlatList, Keyboard, KeyboardAvoidingView, Modal,
  Platform, Pressable, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../../state/auth';
import { useSchool } from '../../state/school';
import { isFirebaseMockMode } from '../../firebase';
import { isDemoUid } from '../../services/demoSession';
import { theme } from '../../ui/theme';
import { useThemeStyleSheet } from '../../ui/useThemeStyleSheet';
import {
  confirmCampusPostTitleOpen, parseTitlePrefix, resumeCampusPostTitles, searchCampusPostTitles,
  type TitleSearchCursor, type TitleSearchPost,
} from '../../services/titleSearch';

type OpenPost = (post: Pick<TitleSearchPost, 'id' | 'schoolId'>) => void;
const denied = (cause: unknown) => {
  const code = (cause as { code?: string } | null)?.code ?? '';
  return code.endsWith('permission-denied') || code.endsWith('unauthenticated');
};

/** Keep the timeline mounted under a separate, account-scoped native modal. */
export function TitleHistoryLauncher({ onOpenPost }: { onOpenPost: OpenPost }) {
  const { user, loading } = useAuth();
  const { school } = useSchool();
  if (loading || !user?.uid || !school?.id || isDemoUid(user.uid) || isFirebaseMockMode()) return null;
  return <ScopedLauncher key={JSON.stringify([user.uid, school.id])} schoolId={school.id} onOpenPost={onOpenPost} />;
}

function ScopedLauncher({ schoolId, onOpenPost }: { schoolId: string; onOpenPost: OpenPost }) {
  const styles = useThemeStyleSheet(createStyles);
  const [open, setOpen] = useState(false);
  const live = useRef(true);
  const modalActive = useRef(false);
  // Keep only the typed query and a document ID while the detail is on top.
  // Never retain private results or Firestore cursors across navigation.
  const resumeQuery = useRef('');
  const resumePostId = useRef<string | undefined>(undefined);
  const dismiss = () => {
    modalActive.current = false;
    resumeQuery.current = '';
    resumePostId.current = undefined;
    setOpen(false);
  };
  useLayoutEffect(() => {
    live.current = true;
    return () => { live.current = false; };
  }, []);
  return (
    <View style={styles.entry}>
      <Pressable accessibilityRole="button" accessibilityLabel="找舊貼文"
        accessibilityHint="依標題開頭搜尋尚未載入的本校文章"
        onPress={() => { modalActive.current = true; setOpen(true); }} style={styles.entryButton}>
        <Text style={styles.actionText}>找舊貼文</Text>
        <Text style={styles.muted}>依標題開頭，不限目前載入範圍</Text>
      </Pressable>
      {open && (
        <Modal visible presentationStyle="fullScreen" animationType="none" onRequestClose={dismiss}>
          <TitleHistorySearch
            schoolId={schoolId}
            initialQuery={resumeQuery.current}
            initialPostId={resumePostId.current}
            onRememberQuery={(query, postId) => {
              if (!modalActive.current) return;
              // Commit the reading location and dismiss only AFTER navigation
              // has accepted the target; a throwing navigator leaves the modal.
              resumeQuery.current = query;
              resumePostId.current = postId;
              modalActive.current = false;
              setOpen(false);
            }}
            onClose={dismiss}
            onOpenPost={(post) => {
              if (!live.current || !modalActive.current || post.schoolId !== schoolId) return;
              onOpenPost(post);
            }}
          />
        </Modal>
      )}
    </View>
  );
}

export function TitleHistorySearch({ schoolId, onClose, onOpenPost, initialQuery = '', initialPostId, onRememberQuery }: {
  schoolId: string;
  onClose: () => void;
  onOpenPost: OpenPost;
  initialQuery?: string;
  initialPostId?: string;
  onRememberQuery?: (query: string, postId: string) => void;
}) {
  // The launcher remounts this panel when account/school changes or it is reopened.
  const styles = useThemeStyleSheet(createStyles);
  const insets = useSafeAreaInsets();
  const input = useRef<TextInput>(null);
  const [text, setText] = useState(initialQuery);
  // Match the shared parser: count Unicode code points after trimming, not UTF-16 units.
  const titleTooLong = Array.from(text.trim()).length > 80;
  const [resumeHint, setResumeHint] = useState(Boolean(initialQuery));
  const [resumePostId, setResumePostId] = useState(initialPostId);
  const [posts, setPosts] = useState<TitleSearchPost[]>([]);
  const [busy, setBusy] = useState(false);
  const [opening, setOpening] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  // Android's live region reads the rendered status; iOS VoiceOver needs an
  // explicit announcement. This only speaks generic counts/errors, never a
  // post title or content. Version-fenced requests cannot announce late data.
  React.useEffect(() => {
    if (Platform.OS !== 'ios') return;
    const message = error || (notice ? `${notice} 目前顯示 ${posts.length} 篇。` : '');
    if (message) AccessibilityInfo.announceForAccessibility(message);
  }, [error, notice, posts.length]);
  // On iOS, live regions do not automatically announce text changes. Announce
  // only when the draft first crosses the limit, not on each additional keystroke.
  // The spoken message is generic and never exposes the entered title.
  React.useEffect(() => {
    if (Platform.OS === 'ios' && titleTooLong) {
      AccessibilityInfo.announceForAccessibility('標題開頭最多 80 字，請刪減後搜尋。');
    }
  }, [titleTooLong]);

  const cursor = useRef<TitleSearchCursor | null>(null);
  const retry = useRef<{ cursor: TitleSearchCursor | null; append: boolean; fromPostId?: string } | null>(null);
  const activeRequest = useRef<{ cursor: TitleSearchCursor | null; append: boolean; fromPostId?: string } | null>(null);
  const inFlight = useRef(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const confirmTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stopConfirmTimer = () => {
    if (confirmTimer.current !== null) {
      clearTimeout(confirmTimer.current);
      confirmTimer.current = null;
    }
  };
  const stopSearchTimer = () => {
    if (searchTimer.current !== null) {
      clearTimeout(searchTimer.current);
      searchTimer.current = null;
    }
  };
  const openingPost = useRef(false);
  const version = useRef(0);
  const live = useRef(true);
  useLayoutEffect(() => {
    live.current = true;
    return () => { live.current = false; version.current += 1; stopSearchTimer(); stopConfirmTimer(); };
  }, []);

  const change = (value: string) => {
    stopSearchTimer();
    stopConfirmTimer();
    version.current += 1;
    inFlight.current = false;
    openingPost.current = false;
    setOpening(false);
    setResumeHint(false);
    setResumePostId(undefined);
    cursor.current = null;
    retry.current = null;
    activeRequest.current = null;
    setText(value); setPosts([]); setHasMore(false); setBusy(false); setError(''); setNotice('');
  };
  const close = () => {
    stopSearchTimer();
    stopConfirmTimer();
    openingPost.current = true;
    version.current += 1;
    inFlight.current = false;
    activeRequest.current = null;
    onClose();
  };
  const request = async (boundary: TitleSearchCursor | null, append: boolean, fromPostId?: string) => {
    if (inFlight.current || openingPost.current || !live.current) return;
    let prefix: string;
    try { prefix = parseTitlePrefix(text); } catch {
      setError('請輸入 1 至 80 字的標題開頭。');
      input.current?.focus();
      return;
    }
    const attempt = ++version.current;
    activeRequest.current = { cursor: boundary, append, ...(fromPostId ? { fromPostId } : {}) };
    setResumeHint(false);
    if (!fromPostId) setResumePostId(undefined);
    inFlight.current = true;
    retry.current = null;
    setBusy(true); setError(''); setNotice('');
    Keyboard.dismiss();
    // Stop waiting for a server-only SDK read without treating its unresolved
    // Promise as a cancellation. A later result/rejection is version-isolated.
    stopSearchTimer();
    searchTimer.current = setTimeout(() => {
      searchTimer.current = null;
      if (!live.current || attempt !== version.current) return;
      version.current += 1;
      inFlight.current = false;
      activeRequest.current = null;
      retry.current = { cursor: boundary, append, ...(fromPostId ? { fromPostId } : {}) };
      setBusy(false);
      setError('伺服器回應時間較長，已停止等待。先前結果已保留，可原地重試。');
    }, 15_000);
    try {
      const page = fromPostId
        ? await resumeCampusPostTitles(schoolId, prefix, fromPostId)
        : await searchCampusPostTitles(schoolId, prefix, boundary);
      if (!live.current || attempt !== version.current) return;
      const valid = page.posts.filter((post) => post.schoolId === schoolId && post.title.startsWith(prefix));
      setPosts((current) => {
        const previous = append ? current : [];
        const ids = new Set(previous.map((post) => post.id));
        return [...previous, ...valid.filter((post) => {
          if (ids.has(post.id)) return false;
          ids.add(post.id);
          return true;
        })];
      });
      cursor.current = page.nextCursor;
      setHasMore(page.hasMore);
      setResumePostId(undefined);
      const pageNotice = page.hasMore ? '已載入一頁符合標題的貼文，可繼續載入。' : '已讀到本次搜尋的最後一頁。';
      setNotice(fromPostId ? `已重新確認上次閱讀的貼文，從這篇接續。${pageNotice}` : pageNotice);
    } catch (cause) {
      if (!live.current || attempt !== version.current) return;
      if (denied(cause)) {
        setResumePostId(undefined);
        cursor.current = null;
        setPosts([]); setHasMore(false);
        retry.current = { cursor: null, append: false };
        setError('校籍或存取權限已變更，搜尋結果已清除。確認校籍後可重試搜尋。');
      } else if ((cause as { code?: string } | null)?.code === 'history-position-unavailable') {
        setResumePostId(undefined);
        cursor.current = null;
        retry.current = null;
        setPosts([]); setHasMore(false);
        setError('目前無法定位上次閱讀的貼文，可能已刪除或標題變更；請從頭搜尋。');
      } else {
        // A retry uses the same boundary; it must not skip a failed page.
        retry.current = { cursor: boundary, append, ...(fromPostId ? { fromPostId } : {}) };
        setError('搜尋暫時失敗，已保留目前結果。確認連線後可原地重試。');
      }
    } finally {
      if (live.current && attempt === version.current) {
        stopSearchTimer();
        activeRequest.current = null;
        inFlight.current = false;
        setBusy(false);
      }
    }
  };
  const openResult = async (item: TitleSearchPost) => {
    if (!live.current || openingPost.current || item.schoolId !== schoolId) return;
    // A student can select an already loaded card while the next page is pending.
    // Cancel that delivery and release its spinner before revalidating the post.
    const interrupted = inFlight.current ? activeRequest.current : null;
    stopSearchTimer();
    stopConfirmTimer();
    const attempt = ++version.current;
    openingPost.current = true;
    inFlight.current = false;
    activeRequest.current = null;
    setBusy(false);
    setOpening(true);
    setError('');
    let navigated = false;
    let verified = false;
    // A stalled server verification must not lock every card indefinitely.
    // The SDK Promise may still settle later; the version fence rejects it.
    confirmTimer.current = setTimeout(() => {
      confirmTimer.current = null;
      if (!live.current || attempt !== version.current) return;
      version.current += 1;
      openingPost.current = false;
      setOpening(false);
      if (interrupted) retry.current = interrupted;
      setError(interrupted
        ? '伺服器確認貼文逾時，已保留搜尋結果。可再次點擊貼文，或原地重試未完成的搜尋。'
        : '伺服器確認貼文逾時，已保留搜尋結果。請確認連線後再次點擊貼文。');
    }, 7_000);
    try {
      const stillReadable = await confirmCampusPostTitleOpen(schoolId, item.id, text);
      if (!live.current || attempt !== version.current) return;
      if (!stillReadable) {
        setPosts((current) => current.filter((row) => row.id !== item.id));
        if (interrupted) {
          // The card is gone, but the paused server page is still unread.
          // Preserve that exact cursor so a student never silently skips it.
          retry.current = interrupted;
          setNotice('');
          setError('這篇貼文已刪除或不再提供（也可能是標題已變更），已從搜尋結果移除。未完成的下一頁已保留，可原地重試。');
        } else {
          setNotice('這篇貼文已刪除或不再提供（也可能是標題已變更），已從搜尋結果移除。');
        }
        return;
      }
      verified = true;
      onOpenPost({ id: item.id, schoolId });
      navigated = true;
      onRememberQuery?.(text, item.id);
    } catch (cause) {
      if (!live.current || attempt !== version.current) return;
      if (denied(cause) && !verified) {
        setResumePostId(undefined);
        cursor.current = null;
        retry.current = { cursor: null, append: false };
        setPosts([]);
        setHasMore(false);
        setNotice('');
        setError('校籍或存取權限已變更，搜尋結果已清除。確認校籍後可重試搜尋。');
      } else {
        // The canceled page retains its exact boundary, even if the navigator
        // throws after successful server authorization. No false reading marker.
        if (interrupted) retry.current = interrupted;
        if (verified) {
          setNotice('');
          setError(interrupted
            ? '貼文已通過伺服器確認，但頁面開啟失敗。未完成的下一頁已保留，可原地重試或再次點擊貼文。'
            : '貼文已通過伺服器確認，但頁面開啟失敗。搜尋結果已保留，請再次點擊貼文。');
        } else {
          setError(interrupted
            ? '暫時無法向伺服器確認這篇貼文，已保留搜尋結果。可再點一次貼文，或原地重試未完成的搜尋。'
            : '暫時無法向伺服器確認這篇貼文，已保留搜尋結果。確認連線後可再點一次。');
        }
      }
    } finally {
      if (live.current && attempt === version.current) {
        stopConfirmTimer();
        if (!navigated) openingPost.current = false;
        setOpening(false);
      }
    }
  };
  return (
    <KeyboardAvoidingView style={styles.panel} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={[styles.panel, { paddingTop: insets.top }]} accessibilityViewIsModal>
        <View style={styles.header}>
          <Text accessibilityRole="header" style={styles.title}>找舊貼文</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="關閉歷史搜尋" onPress={close} style={styles.button}>
            <Text style={styles.actionText}>關閉</Text>
          </Pressable>
        </View>
        {/* Keep the close action fixed, but scroll input, retry, announcements
            and results together when Dynamic Type or the keyboard shrinks the view. */}
        <FlatList style={styles.scroll} data={posts} keyExtractor={(post) => post.id} keyboardShouldPersistTaps="handled"
          contentContainerStyle={[styles.results, { paddingBottom: 16 + insets.bottom }]} initialNumToRender={10}
          ListHeaderComponent={(
          <View style={styles.controls}>
            <Text style={styles.muted}>搜尋本校歷史文章的標題開頭，英文區分大小寫；不搜尋內文。</Text>
            {resumeHint && <Text accessibilityLiveRegion="polite" style={styles.message}>已保留上次的搜尋文字；請重新搜尋以確認最新結果與校籍權限。</Text>}
            <Text style={styles.label}>記得的標題開頭</Text>
            <TextInput ref={input} value={text} onChangeText={change} style={styles.input}
              accessibilityLabel="記得的標題開頭"
              accessibilityHint={titleTooLong ? "標題開頭超過 80 字，請刪減後搜尋。" : "最多 80 字的標題開頭"}
              placeholder="例如：二手書" placeholderTextColor={theme.colors.textSecondary}
              autoCapitalize="none" autoCorrect={false} returnKeyType="search"
              onSubmitEditing={() => { void request(null, false); }} />
            {titleTooLong && <Text accessibilityLiveRegion="polite" style={styles.message}>
              標題開頭最多 80 字，請刪減後搜尋。
            </Text>}
            <View style={styles.actions}>
              <Pressable accessibilityRole="button" accessibilityLabel="搜尋歷史標題"
                accessibilityState={{ disabled: busy || opening, busy: busy || opening }} disabled={busy || opening}
                onPress={() => { void request(null, false); }} style={[styles.button, styles.primary]}>
                <Text style={styles.primaryText}>{busy ? '搜尋中…' : '搜尋'}</Text>
              </Pressable>
              <Pressable accessibilityRole="button" accessibilityLabel="清除歷史搜尋"
                onPress={() => { change(''); input.current?.focus(); }} style={styles.button}>
                <Text style={styles.actionText}>清除</Text>
              </Pressable>
            </View>
            {resumePostId && (
              <Pressable accessibilityRole="button" accessibilityLabel="回到上次閱讀位置"
                accessibilityHint="重新確認權限，從上次開啟的貼文接續，不還原舊結果"
                accessibilityState={{ disabled: busy || opening, busy }} disabled={busy || opening}
                style={styles.button} onPress={() => { void request(null, false, resumePostId); }}>
                <Text style={styles.actionText}>回到上次閱讀位置</Text>
              </Pressable>
            )}
            {busy && <ActivityIndicator accessibilityLabel="正在讀取歷史標題" color={theme.colors.accent} />}
            {opening && <ActivityIndicator accessibilityLabel="正在確認貼文仍可閱讀" color={theme.colors.accent} />}
            {!!error && <Text accessibilityRole="alert" style={styles.message}>{error}</Text>}
            {!!error && retry.current && !busy && (
              <Pressable accessibilityRole="button" accessibilityLabel="重試歷史搜尋" style={styles.button}
                onPress={() => { const previous = retry.current; if (previous) void request(previous.cursor, previous.append, previous.fromPostId); }}>
                <Text style={styles.actionText}>原地重試</Text>
              </Pressable>
            )}
            <Text accessibilityLiveRegion="polite" style={styles.message}>
              {notice ? `${notice} 目前顯示 ${posts.length} 篇。` : '輸入標題後按搜尋，不必先載入動態牆。'}
            </Text>
          </View>
          )}
          renderItem={({ item }) => (
            <Pressable accessibilityRole="button" accessibilityLabel={`開啟貼文：${item.title}`}
              accessibilityState={{ busy: opening, disabled: opening }} disabled={opening}
              style={styles.card} onPress={() => { void openResult(item); }}>
              <Text style={styles.postTitle}>{item.title}</Text>
              <Text style={styles.muted}>{item.anonymous ? '匿名貼文' : '校園貼文'}</Text>
              {!!item.excerpt && <Text numberOfLines={3} style={styles.excerpt}>{item.excerpt}</Text>}
            </Pressable>
          )}
          ListEmptyComponent={!busy && notice && !notice.startsWith('這篇貼文') && !error ? <Text style={styles.message}>沒有符合這個標題開頭的貼文。</Text> : null}
          // An offline post-open check is not a failed page fetch. Keep the
          // next-page action available unless the exact page needs retrying.
          ListFooterComponent={hasMore && (!error || !retry.current) ? (
            <Pressable accessibilityRole="button" accessibilityLabel="載入更多歷史貼文"
              accessibilityState={{ disabled: busy || opening, busy: busy || opening }} disabled={busy || opening} style={styles.button}
              onPress={() => { if (cursor.current) void request(cursor.current, true); }}>
              <Text style={styles.actionText}>{busy ? '搜尋中…' : '載入更多歷史貼文'}</Text>
            </Pressable>
          ) : null}
        />
      </View>
    </KeyboardAvoidingView>
  );
}

const createStyles = () => StyleSheet.create({
  panel: { flex: 1, backgroundColor: theme.colors.bg },
  scroll: { flex: 1 },
  entry: { paddingHorizontal: 14, paddingBottom: 8 },
  entryButton: { minHeight: 44, padding: 10, borderRadius: 12, backgroundColor: theme.colors.surface },
  header: { padding: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  title: { flex: 1, fontSize: 22, fontWeight: '700', color: theme.colors.text },
  controls: { gap: 8, paddingBottom: 8 },
  label: { color: theme.colors.text, fontSize: 16, fontWeight: '600' },
  input: { minHeight: 48, padding: 12, borderWidth: 1, borderColor: theme.colors.border, borderRadius: 10, color: theme.colors.text, fontSize: 16 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  button: { minHeight: 44, minWidth: 44, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10, borderRadius: 10, backgroundColor: theme.colors.surface },
  primary: { backgroundColor: theme.colors.accent },
  primaryText: { color: theme.colors.onAccent, fontSize: 16, fontWeight: '600' },
  actionText: { color: theme.colors.accent, fontSize: 16, fontWeight: '600' },
  muted: { color: theme.colors.textSecondary, fontSize: 13, lineHeight: 20 },
  message: { color: theme.colors.text, fontSize: 14, lineHeight: 22 },
  results: { padding: 16, gap: 12 },
  card: { minHeight: 44, padding: 16, gap: 8, borderRadius: 12, backgroundColor: theme.colors.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: theme.colors.border },
  postTitle: { color: theme.colors.text, fontSize: 17, fontWeight: '600' },
  excerpt: { color: theme.colors.textSecondary, fontSize: 14, lineHeight: 22 },
});
