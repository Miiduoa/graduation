import React, { useLayoutEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, FlatList, Keyboard, KeyboardAvoidingView, Modal,
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
  parseTitlePrefix, searchCampusPostTitles,
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
  useLayoutEffect(() => {
    live.current = true;
    return () => { live.current = false; };
  }, []);
  return (
    <View style={styles.entry}>
      <Pressable accessibilityRole="button" accessibilityLabel="找舊貼文"
        accessibilityHint="依標題開頭搜尋尚未載入的本校文章"
        onPress={() => setOpen(true)} style={styles.entryButton}>
        <Text style={styles.actionText}>找舊貼文</Text>
        <Text style={styles.muted}>依標題開頭，不限目前載入範圍</Text>
      </Pressable>
      {open && (
        <Modal visible presentationStyle="fullScreen" animationType="none" onRequestClose={() => setOpen(false)}>
          <TitleHistorySearch schoolId={schoolId} onClose={() => setOpen(false)} onOpenPost={(post) => {
            if (!live.current || post.schoolId !== schoolId) return;
            setOpen(false);
            onOpenPost(post);
          }} />
        </Modal>
      )}
    </View>
  );
}

export function TitleHistorySearch({ schoolId, onClose, onOpenPost }: {
  schoolId: string;
  onClose: () => void;
  onOpenPost: OpenPost;
}) {
  // The launcher remounts this panel when account/school changes or it is reopened.
  const styles = useThemeStyleSheet(createStyles);
  const insets = useSafeAreaInsets();
  const input = useRef<TextInput>(null);
  const [text, setText] = useState('');
  const [posts, setPosts] = useState<TitleSearchPost[]>([]);
  const [busy, setBusy] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const cursor = useRef<TitleSearchCursor | null>(null);
  const retry = useRef<{ cursor: TitleSearchCursor | null; append: boolean } | null>(null);
  const inFlight = useRef(false);
  const version = useRef(0);
  const live = useRef(true);
  useLayoutEffect(() => {
    live.current = true;
    return () => { live.current = false; version.current += 1; };
  }, []);

  const change = (value: string) => {
    version.current += 1;
    inFlight.current = false;
    cursor.current = null;
    retry.current = null;
    setText(value); setPosts([]); setHasMore(false); setBusy(false); setError(''); setNotice('');
  };
  const close = () => {
    version.current += 1;
    inFlight.current = false;
    onClose();
  };
  const request = async (boundary: TitleSearchCursor | null, append: boolean) => {
    if (inFlight.current || !live.current) return;
    let prefix: string;
    try { prefix = parseTitlePrefix(text); } catch {
      setError('請輸入 1 至 80 字的標題開頭。');
      input.current?.focus();
      return;
    }
    const attempt = ++version.current;
    inFlight.current = true;
    retry.current = null;
    setBusy(true); setError(''); setNotice('');
    Keyboard.dismiss();
    try {
      const page = await searchCampusPostTitles(schoolId, prefix, boundary);
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
      setNotice(page.hasMore ? '已載入一頁符合標題的貼文，可繼續載入。' : '已讀到本次搜尋的最後一頁。');
    } catch (cause) {
      if (!live.current || attempt !== version.current) return;
      if (denied(cause)) {
        cursor.current = null;
        setPosts([]); setHasMore(false);
        retry.current = { cursor: null, append: false };
        setError('校籍或存取權限已變更，搜尋結果已清除。確認校籍後可重試搜尋。');
      } else {
        // A retry uses the same boundary; it must not skip a failed page.
        retry.current = { cursor: boundary, append };
        setError('搜尋暫時失敗，已保留目前結果。確認連線後可原地重試。');
      }
    } finally {
      if (live.current && attempt === version.current) {
        inFlight.current = false;
        setBusy(false);
      }
    }
  };
  return (
    <KeyboardAvoidingView style={styles.panel} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={[styles.panel, { paddingTop: insets.top, paddingBottom: insets.bottom }]} accessibilityViewIsModal>
        <View style={styles.header}>
          <Text accessibilityRole="header" style={styles.title}>找舊貼文</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="關閉歷史搜尋" onPress={close} style={styles.button}>
            <Text style={styles.actionText}>關閉</Text>
          </Pressable>
        </View>
        <View style={styles.controls}>
          <Text style={styles.muted}>搜尋本校歷史文章的標題開頭，英文區分大小寫；不搜尋內文。</Text>
          <Text style={styles.label}>記得的標題開頭</Text>
          <TextInput ref={input} value={text} onChangeText={change} style={styles.input}
            accessibilityLabel="記得的標題開頭" placeholder="例如：二手書" placeholderTextColor={theme.colors.textSecondary}
            autoCapitalize="none" autoCorrect={false} returnKeyType="search"
            onSubmitEditing={() => { void request(null, false); }} />
          <View style={styles.actions}>
            <Pressable accessibilityRole="button" accessibilityLabel="搜尋歷史標題"
              accessibilityState={{ disabled: busy, busy }} disabled={busy}
              onPress={() => { void request(null, false); }} style={[styles.button, styles.primary]}>
              <Text style={styles.primaryText}>{busy ? '搜尋中…' : '搜尋'}</Text>
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="清除歷史搜尋"
              onPress={() => { change(''); input.current?.focus(); }} style={styles.button}>
              <Text style={styles.actionText}>清除</Text>
            </Pressable>
          </View>
          {busy && <ActivityIndicator accessibilityLabel="正在讀取歷史標題" color={theme.colors.accent} />}
          {!!error && <Text accessibilityRole="alert" style={styles.message}>{error}</Text>}
          {!!error && retry.current && !busy && (
            <Pressable accessibilityRole="button" accessibilityLabel="重試歷史搜尋" style={styles.button}
              onPress={() => { const previous = retry.current; if (previous) void request(previous.cursor, previous.append); }}>
              <Text style={styles.actionText}>原地重試</Text>
            </Pressable>
          )}
          <Text accessibilityLiveRegion="polite" style={styles.message}>
            {notice ? `${notice} 目前顯示 ${posts.length} 篇。` : '輸入標題後按搜尋，不必先載入動態牆。'}
          </Text>
        </View>
        <FlatList data={posts} keyExtractor={(post) => post.id} keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.results} initialNumToRender={10}
          renderItem={({ item }) => (
            <Pressable accessibilityRole="button" accessibilityLabel={`開啟貼文：${item.title}`}
              style={styles.card} onPress={() => {
                if (!live.current || item.schoolId !== schoolId) return;
                version.current += 1;
                onOpenPost({ id: item.id, schoolId });
              }}>
              <Text style={styles.postTitle}>{item.title}</Text>
              <Text style={styles.muted}>{item.anonymous ? '匿名貼文' : '校園貼文'}</Text>
              {!!item.excerpt && <Text numberOfLines={3} style={styles.excerpt}>{item.excerpt}</Text>}
            </Pressable>
          )}
          ListEmptyComponent={!busy && notice && !error ? <Text style={styles.message}>沒有符合這個標題開頭的貼文。</Text> : null}
          ListFooterComponent={hasMore && !error ? (
            <Pressable accessibilityRole="button" accessibilityLabel="載入更多歷史貼文"
              accessibilityState={{ disabled: busy, busy }} disabled={busy} style={styles.button}
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
  entry: { paddingHorizontal: 14, paddingBottom: 8 },
  entryButton: { minHeight: 44, padding: 10, borderRadius: 12, backgroundColor: theme.colors.surface },
  header: { padding: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  title: { flex: 1, fontSize: 22, fontWeight: '700', color: theme.colors.text },
  controls: { paddingHorizontal: 16, gap: 8 },
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
