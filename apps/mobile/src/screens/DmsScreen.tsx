/* eslint-disable */
/**
 * DmsScreen — 商業級對話列表
 * ═══════════════════════════════════════════════
 * 功能：即時對話列表 / 在線狀態 / 未讀計數 / 搜尋
 *       最後訊息預覽 / 滑動操作 / 新對話建立
 */
import React, { useEffect, useMemo, useState, useCallback } from 'react';
import {
  FlatList,
  Text,
  View,
  Pressable,
  TextInput,
  RefreshControl,
  StyleSheet,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import {
  Screen,
  Button,
  LoadingState,
} from '../ui/components';
import { TAB_BAR_CONTENT_BOTTOM_PADDING } from '../ui/navigationTheme';
import { theme } from '../ui/theme';
import { useThemeStyleSheet } from '../ui/useThemeStyleSheet';
import { useAuth } from '../state/auth';
import { shouldBlockForNoLogin } from '../services/demoSession';
import { useSchool } from '../state/school';
import { getDb, isFirebaseMockMode } from '../firebase';
import {
  collection,
  onSnapshot,
  query,
  where,
} from 'firebase/firestore';
import { fetchSchoolDirectoryProfiles } from '../services/memberDirectory';
import {
  conversationListPreview,
  filterInbox,
  schoolConversations,
  unreadConversation,
} from './messagingInboxModel';
import {
  getPersonaConversationSummaries,
  isDemoPersonaUid,
  getPersona,
} from '../data/demoPersona';

// ═══════ Types ═══════

type Conversation = {
  id: string;
  type: 'dm' | 'group_chat';
  schoolId?: string;
  memberIds: string[];
  lastMessageText?: string;
  lastMessageAt?: any;
  lastMessageSenderId?: string;
  lastMessage?: { senderId?: string; content?: string };
  lastReadBy?: Record<string, any>;
  onlineUsers?: Record<string, any>;
  typingUsers?: Record<string, any>;
  unreadCount?: number;
};

type ConvoRow = Conversation & {
  peerName: string;
  peerOnline: boolean;
  peerTyping: boolean;
  timeLabel: string;
};

// ═══════ Helpers ═══════

function formatLastTime(ts: any): string {
  if (!ts) return '';
  const d = ts?.toDate ? ts.toDate() : new Date(ts.seconds ? ts.seconds * 1000 : ts);
  if (!Number.isFinite(d.getTime())) return '';
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  if (diff < 60000) return '剛剛';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}分鐘前`;
  if (d.toDateString() === now.toDateString()) {
    return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
  }
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return '昨天';
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

// ═══════ Main Component ═══════

export function DmsScreen(props: any) {
  const s = useThemeStyleSheet(createStyles);
  const nav = props?.navigation;
  const auth = useAuth();
  const { school } = useSchool();
  const db = getDb();

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [peerNames, setPeerNames] = useState<Record<string, string>>({});
  const [onlyUnread, setOnlyUnread] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [loadError, setLoadError] = useState('');
  const [loadedScope, setLoadedScope] = useState('');
  const [previewTick, setPreviewTick] = useState(0);

  const myUid = auth.user?.uid;

  useFocusEffect(
    useCallback(() => {
      setPreviewTick((value) => value + 1);
    }, []),
  );
  const scope = `${myUid ?? ''}:${school.id ?? ''}`;
  const demo = isFirebaseMockMode() || isDemoPersonaUid(myUid);
  const isUnread = (row: Conversation) =>
    demo ? (row.unreadCount ?? 0) > 0 : unreadConversation(row, myUid);

  // ── Demo persona 模式：嚴格按身分隔離載入對話 ──
  useEffect(() => {
    if (!(isFirebaseMockMode() || isDemoPersonaUid(myUid)) || !myUid) return;
    const summaries = getPersonaConversationSummaries(myUid);
    const rows: Conversation[] = summaries.map((s) => ({
      id: s.id,
      type: 'dm',
      schoolId: school.id,
      memberIds: [myUid, s.peerUid],
      lastMessageText: s.lastMessage,
      lastMessageAt: { seconds: Math.floor(new Date(s.lastMessageAt).getTime() / 1000) },
      unreadCount: s.unread ? 1 : 0,
    }));
    setConversations(rows);
    const names: Record<string, string> = {};
    summaries.forEach((s) => {
      const p = getPersona(s.peerUid);
      if (p) names[s.peerUid] = `${p.fullName}（${p.shortLabel}）`;
    });
    setPeerNames(names);
    setLoadedScope(scope);
    setLoadError('');
    setLoading(false);
    setRefreshing(false);
  }, [myUid, school.id, scope]);

  // Restrict a live inbox to the signed-in user's current school.
  useEffect(() => {
    if (!myUid || demo) {
      if (!demo) {
        setConversations([]);
        setLoadedScope(scope);
        setLoading(false);
      }
      return;
    }
    if (!school.id) {
      setConversations([]);
      setLoadedScope(scope);
      setLoadError('尚未確認所屬學校，無法載入私人對話。');
      setLoading(false);
      setRefreshing(false);
      return;
    }
    let active = true;
    setConversations([]);
    setPeerNames({});
    setLoadedScope('');
    setLoadError('');
    setLoading(true);
    const qy = query(
      collection(db, 'conversations'),
      where('type', '==', 'dm'),
      where('memberIds', 'array-contains', myUid),
      where('schoolId', '==', school.id),
    );
    const unsub = onSnapshot(
      qy,
      (snapshot) => {
        if (!active) return;
        const entries = snapshot.docs.map((doc) => ({
          id: doc.id,
          ...(doc.data() as Omit<Conversation, 'id'>),
        }));
        const scoped = schoolConversations(entries, myUid, school.id);
        setConversations(scoped);
        setLoadedScope(scope);
        setLoadError('');
        setLoading(false);
        setRefreshing(false);

        const peerIds = [
          ...new Set(scoped.flatMap((row) => row.memberIds.filter((id) => id !== myUid))),
        ];
        if (peerIds.length) {
          fetchSchoolDirectoryProfiles(school.id, peerIds, db)
            .then((profiles) => {
              if (!active) return;
              const names: Record<string, string> = {};
              profiles.forEach((profile) => {
                if (profile?.uid) names[profile.uid] = profile.displayName ?? profile.uid.slice(0, 8);
              });
              setPeerNames(names);
            })
            .catch(() => {
              // Directory access is optional; an inaccessible name never blocks messages.
            });
        }
      },
      (error) => {
        if (!active) return;
        setConversations([]);
        setLoadedScope(scope);
        setLoadError(
          error?.code === 'permission-denied'
            ? '目前帳號沒有讀取本校對話的權限，請重新確認登入狀態。'
            : '無法取得最新對話，請檢查網路後重試。',
        );
        setLoading(false);
        setRefreshing(false);
      },
    );
    return () => {
      active = false;
      unsub();
    };
  }, [db, myUid, school.id, scope, refreshKey, demo]);

  // ── 建構列表行 ──
  const rows: ConvoRow[] = useMemo(() => {
    return (loadedScope === scope ? conversations : [])
      .map((c) => {
        const peerId = c.memberIds.find((id) => id !== myUid) ?? '';
        const name = peerNames[peerId] ?? peerId.slice(0, 8);

        // 在線狀態
        let online = false;
        if (c.onlineUsers && peerId && c.onlineUsers[peerId]) {
          const ts = c.onlineUsers[peerId];
          const tsMs = ts?.toMillis?.() ?? (typeof ts?.seconds === 'number' ? ts.seconds * 1000 : 0);
          online = tsMs > 0 && Date.now() - tsMs < 60000;
        }

        // 打字狀態
        let typing = false;
        if (c.typingUsers && peerId && c.typingUsers[peerId]) {
          const ts = c.typingUsers[peerId];
          const tsMs = ts?.toMillis?.() ?? (typeof ts?.seconds === 'number' ? ts.seconds * 1000 : 0);
          typing = tsMs > 0 && Date.now() - tsMs < 5000;
        }

        return {
          ...c,
          peerName: name,
          peerOnline: online,
          peerTyping: typing,
          timeLabel: formatLastTime(c.lastMessageAt),
        };
      })
      .sort((a, b) => {
        const atA = (a.lastMessageAt?.seconds ?? 0) as number;
        const atB = (b.lastMessageAt?.seconds ?? 0) as number;
        return atB - atA;
      });
  }, [conversations, peerNames, myUid, loadedScope, scope, previewTick]);

  const unreadCount = rows.filter(isUnread).length;
  const filteredRows = useMemo(
    () => filterInbox(rows, myUid, searchQuery, onlyUnread, demo ? (row) => (row.unreadCount ?? 0) > 0 : undefined),
    [rows, myUid, searchQuery, onlyUnread, demo, previewTick],
  );

  // ── 未登入 ──
  if (shouldBlockForNoLogin({ uid: auth.user?.uid ?? null, hasUser: !!auth.user })) {
    return (
      <Screen>
        <View style={s.emptyContainer}>
          <Ionicons name="chatbubbles-outline" size={36} color={theme.colors.textSecondary} />
          <Text accessibilityRole="header" style={s.emptyTitle}>尚未登入</Text>
          <Text style={s.emptySubtitle}>登入後即可使用私訊功能</Text>
          <Button text="前往登入" kind="primary" onPress={() => nav?.navigate?.('我的')} />
        </View>
      </Screen>
    );
  }

  // ── 渲染對話行 ──
  const renderItem = ({ item }: { item: ConvoRow }) => {
    const peerId = item.memberIds.find((id) => id !== myUid) ?? '';
    const initials = item.peerName.slice(0, 1).toUpperCase();
    const unread = isUnread(item);
    const preview = item.peerTyping
      ? '正在輸入⋯'
      : conversationListPreview(item, myUid);

    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${item.peerName}${unread ? '，未讀訊息' : ''}${item.peerOnline ? '，在線' : ''}，${preview}`}
        onPress={() => nav?.navigate?.('Chat', { peerId, conversationId: item.id })}
        style={({ pressed }) => [s.row, pressed && s.rowPressed]}
      >
        {/* 頭像 */}
        <View style={s.avatarBox}>
          <View style={s.avatar}>
            <Text style={s.avatarText} maxFontSizeMultiplier={1.3}>{initials}</Text>
          </View>
          {item.peerOnline && <View style={s.onlineDot} />}
        </View>

        {/* 內容 */}
        <View style={s.rowContent}>
          <View style={s.rowTop}>
            <Text style={[s.rowName, unread && s.unreadName]} numberOfLines={1}>
              {item.peerName}
            </Text>
            {unread && <View style={s.unreadDot} accessibilityLabel="未讀" />}
            <Text style={s.rowTime} maxFontSizeMultiplier={1.3}>{item.timeLabel}</Text>
          </View>
          <Text
            style={[s.rowPreview, unread && s.unreadPreview, item.peerTyping && s.typingPreview]}
            numberOfLines={1}
          >
            {preview}
          </Text>
        </View>
      </Pressable>
    );
  };

  return (
    <Screen>
      <View style={{ flex: 1 }}>
        {/* 搜尋列 */}
        <View style={s.searchBar}>
          <View style={s.searchBox}>
            <Ionicons name="search" size={18} color={theme.colors.textSecondary} />
            <TextInput
              accessibilityLabel="搜尋對話"
              value={searchQuery}
              onChangeText={setSearchQuery}
              placeholder="搜尋對話（暱稱或內文）"
              placeholderTextColor={theme.colors.textSecondary}
              returnKeyType="search"
              autoCorrect={false}
              style={s.searchInput}
            />
            {searchQuery.length > 0 && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="清除搜尋"
                onPress={() => setSearchQuery('')}
                style={s.iconButton}
              >
                <Ionicons name="close-circle" size={18} color={theme.colors.textSecondary} />
              </Pressable>
            )}
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="好友與邀請"
            onPress={() => nav?.navigate?.('FriendsManage')}
            style={({ pressed }) => [s.iconButton, pressed && s.rowPressed]}
          >
            <Ionicons name="people-outline" size={22} color={theme.colors.text} />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="搜尋聯絡人並加好友"
            onPress={() => nav?.navigate?.('FriendSearch')}
            style={({ pressed }) => [s.iconButton, pressed && s.rowPressed]}
          >
            <Ionicons name="person-add-outline" size={22} color={theme.colors.accent} />
          </Pressable>
        </View>

        <View style={s.filterRow}>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ selected: !onlyUnread }}
            onPress={() => setOnlyUnread(false)}
            style={s.filterChip}
          >
            <Text
              maxFontSizeMultiplier={1.4}
              style={[s.filterText, !onlyUnread && s.filterTextActive, !onlyUnread && s.filterUnderline]}
            >
              全部 {rows.length}
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ selected: onlyUnread }}
            onPress={() => setOnlyUnread(true)}
            style={s.filterChip}
          >
            <Text
              maxFontSizeMultiplier={1.4}
              style={[s.filterText, onlyUnread && s.filterTextActive, onlyUnread && s.filterUnderline]}
            >
              未讀 {unreadCount}
            </Text>
          </Pressable>
        </View>
        {loadError && loadedScope === scope ? (
          <View style={s.emptyContainer}>
            <Ionicons name="cloud-offline-outline" size={32} color={theme.colors.textSecondary} />
            <Text accessibilityRole="header" style={s.emptyTitle}>無法載入對話</Text>
            <Text style={s.emptySubtitle}>{loadError}</Text>
            <Button text="重新連線" kind="primary" onPress={() => setRefreshKey((value) => value + 1)} />
          </View>
        ) : loading || loadedScope !== scope ? (
          <LoadingState title="對話" subtitle="正在同步本校訊息…" rows={4} />
        ) : (
          <FlatList
            data={filteredRows}
            keyExtractor={(c) => c.id}
            renderItem={renderItem}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            contentContainerStyle={{
              paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING,
            }}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={() => {
                  setRefreshing(true);
                  setRefreshKey((value) => value + 1);
                }}
                tintColor={theme.colors.accent}
              />
            }
            ItemSeparatorComponent={() => (
              <View style={s.separator} />
            )}
            ListEmptyComponent={
              <View style={s.emptyContainer}>
                <Ionicons name="chatbubble-ellipses-outline" size={36} color={theme.colors.textSecondary} />
                <Text accessibilityRole="header" style={s.emptyTitle}>
                  {searchQuery ? '找不到符合的對話' : onlyUnread ? '目前沒有未讀訊息' : '尚未開始對話'}
                </Text>
                <Text style={s.emptySubtitle}>
                  {searchQuery
                    ? '試著調整搜尋內容。'
                    : onlyUnread
                      ? '新訊息會自動出現在這裡。'
                      : '搜尋同校同學，或從群組成員開始私訊。'}
                </Text>
                {(searchQuery || onlyUnread) && (
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => {
                      setSearchQuery('');
                      setOnlyUnread(false);
                    }}
                    style={s.resetButton}
                  >
                    <Text style={s.resetText}>查看全部對話</Text>
                  </Pressable>
                )}
              </View>
            }
          />
        )}
      </View>
    </Screen>
  );
}

// ═══════ Styles ═══════

const createStyles = () => StyleSheet.create({
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingLeft: 16,
    paddingRight: 8,
    paddingTop: 4,
    backgroundColor: theme.colors.bg,
  },
  searchBox: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 44,
    gap: 8,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  searchInput: {
    flex: 1,
    minWidth: 0,
    minHeight: 44,
    color: theme.colors.text,
    fontSize: 16,
    paddingVertical: 0,
  },
  iconButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    columnGap: 20,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
  },
  filterChip: {
    minHeight: 44,
    justifyContent: 'center',
  },
  filterText: { color: theme.colors.textSecondary, fontWeight: '600', fontSize: 14, lineHeight: 20 },
  filterTextActive: { color: theme.colors.accent, fontWeight: '800' },
  filterUnderline: {
    textDecorationLine: 'underline',
    textDecorationColor: theme.colors.accent,
  },
  unreadName: { fontWeight: '800' },
  unreadPreview: { color: theme.colors.text, fontWeight: '600' },
  typingPreview: { color: theme.colors.accent, fontWeight: '600' },
  unreadDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: theme.colors.accent, marginLeft: 6 },
  resetButton: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 12, marginTop: 4 },
  resetText: {
    color: theme.colors.accent,
    fontWeight: '700',
    fontSize: 15,
    textDecorationLine: 'underline',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 64,
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 12,
  },
  rowPressed: { backgroundColor: theme.colors.surface2 },
  avatarBox: { position: 'relative' },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: theme.colors.surface2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    color: theme.colors.text,
    fontSize: 18,
    fontWeight: '700',
  },
  onlineDot: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: theme.colors.success,
    borderWidth: 2,
    borderColor: theme.colors.bg,
  },
  rowContent: { flex: 1, minWidth: 0 },
  rowTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 },
  rowName: { color: theme.colors.text, fontSize: 16, lineHeight: 22, fontWeight: '600', flex: 1 },
  rowTime: { color: theme.colors.textSecondary, fontSize: 12, lineHeight: 16, marginLeft: 8 },
  rowPreview: { color: theme.colors.textSecondary, fontSize: 14, lineHeight: 20 },
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: theme.colors.border,
    marginLeft: 72,
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    paddingTop: 56,
    gap: 10,
  },
  emptyTitle: { color: theme.colors.text, fontSize: 20, lineHeight: 26, fontWeight: '800', textAlign: 'center' },
  emptySubtitle: { color: theme.colors.textSecondary, fontSize: 14, lineHeight: 20, textAlign: 'center' },
});
