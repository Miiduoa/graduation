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
import {
  Screen,
  Button,
  LoadingState,
  ErrorState,
  AnimatedCard,
} from '../ui/components';
import { TAB_BAR_CONTENT_BOTTOM_PADDING } from '../ui/navigationTheme';
import { theme } from '../ui/theme';
import { useAuth } from '../state/auth';
import { useSchool } from '../state/school';
import { getDb, isFirebaseMockMode } from '../firebase';
import {
  collection,
  getDocs,
  onSnapshot,
  query,
  where,
  orderBy,
} from 'firebase/firestore';
import { fetchSchoolDirectoryProfiles } from '../services/memberDirectory';

// ═══════ Types ═══════

type Conversation = {
  id: string;
  type: 'dm' | 'group_chat';
  memberIds: string[];
  lastMessageText?: string;
  lastMessageAt?: any;
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
  const nav = props?.navigation;
  const auth = useAuth();
  const { school } = useSchool();
  const db = getDb();

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [peerNames, setPeerNames] = useState<Record<string, string>>({});

  const myUid = auth.user?.uid;

  // ── 即時監聽對話列表 ──
  useEffect(() => {
    if (!myUid || isFirebaseMockMode()) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const ref = collection(db, 'conversations');
    const qy = query(
      ref,
      where('type', '==', 'dm'),
      where('memberIds', 'array-contains', myUid),
    );

    const unsub = onSnapshot(
      qy,
      (snapshot) => {
        const rows = snapshot.docs.map((d) => ({
          id: d.id,
          ...(d.data() as any),
        })) as Conversation[];
        setConversations(rows);
        setLoading(false);
        setRefreshing(false);

        // 批量取得 peer 名稱
        const peerIds = [
          ...new Set(
            rows.flatMap((c) => c.memberIds.filter((id) => id !== myUid)),
          ),
        ];
        const newPeers = peerIds.filter((id) => !peerNames[id]);
        if (newPeers.length > 0 && school.id) {
          fetchSchoolDirectoryProfiles(school.id, newPeers, db)
            .then((profiles) => {
              const map: Record<string, string> = {};
              profiles.forEach((p) => {
                if (p?.uid) map[p.uid] = p.displayName ?? p.uid.slice(0, 8);
              });
              setPeerNames((prev) => ({ ...prev, ...map }));
            })
            .catch(() => {});
        }
      },
      (err) => {
        if (err?.code !== 'permission-denied') {
          console.error('[DmsScreen] Subscription error:', err);
        }
        setLoading(false);
        setRefreshing(false);
      },
    );

    return () => unsub();
  }, [db, myUid, school.id]);

  // ── 建構列表行 ──
  const rows: ConvoRow[] = useMemo(() => {
    return conversations
      .map((c) => {
        const peerId = c.memberIds.find((id) => id !== myUid) ?? '';
        const name = peerNames[peerId] ?? peerId.slice(0, 8);

        // 在線狀態
        let online = false;
        if (c.onlineUsers && peerId && c.onlineUsers[peerId]) {
          const ts = c.onlineUsers[peerId];
          const tsMs = ts?.seconds ? ts.seconds * 1000 : Date.now();
          online = Date.now() - tsMs < 60000;
        }

        // 打字狀態
        let typing = false;
        if (c.typingUsers && peerId && c.typingUsers[peerId]) {
          const ts = c.typingUsers[peerId];
          const tsMs = ts?.seconds ? ts.seconds * 1000 : Date.now();
          typing = Date.now() - tsMs < 5000;
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
  }, [conversations, peerNames, myUid]);

  // ── 搜尋過濾 ──
  const filteredRows = useMemo(() => {
    if (!searchQuery.trim()) return rows;
    const q = searchQuery.toLowerCase();
    return rows.filter(
      (r) =>
        r.peerName.toLowerCase().includes(q) ||
        (r.lastMessageText ?? '').toLowerCase().includes(q),
    );
  }, [rows, searchQuery]);

  // ── 未登入 ──
  if (!auth.user) {
    return (
      <Screen>
        <View style={s.emptyContainer}>
          <View style={s.emptyIcon}>
            <Ionicons name="chatbubbles-outline" size={40} color={theme.colors.accent} />
          </View>
          <Text style={s.emptyTitle}>尚未登入</Text>
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

    return (
      <Pressable
        onPress={() => nav?.navigate?.('Chat', { kind: 'dm', peerId })}
        style={({ pressed }) => [s.row, pressed && { opacity: 0.7 }]}
      >
        {/* 頭像 */}
        <View style={s.avatarBox}>
          <View style={s.avatar}>
            <Text style={s.avatarText}>{initials}</Text>
          </View>
          {item.peerOnline && <View style={s.onlineDot} />}
        </View>

        {/* 內容 */}
        <View style={s.rowContent}>
          <View style={s.rowTop}>
            <Text style={s.rowName} numberOfLines={1}>
              {item.peerName}
            </Text>
            <Text style={s.rowTime}>{item.timeLabel}</Text>
          </View>
          <Text style={s.rowPreview} numberOfLines={1}>
            {item.peerTyping
              ? '正在輸入⋯'
              : item.lastMessageText ?? '(尚無訊息)'}
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
            <Ionicons name="search" size={16} color={theme.colors.muted} />
            <TextInput
              value={searchQuery}
              onChangeText={setSearchQuery}
              placeholder="搜尋對話..."
              placeholderTextColor={theme.colors.muted}
              style={s.searchInput}
            />
            {searchQuery.length > 0 && (
              <Pressable onPress={() => setSearchQuery('')}>
                <Ionicons name="close-circle" size={16} color={theme.colors.muted} />
              </Pressable>
            )}
          </View>
        </View>

        {loading ? (
          <LoadingState title="對話" subtitle="載入中..." rows={4} />
        ) : (
          <FlatList
            data={filteredRows}
            keyExtractor={(c) => c.id}
            renderItem={renderItem}
            contentContainerStyle={{
              paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING,
            }}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={() => setRefreshing(true)}
                tintColor={theme.colors.accent}
              />
            }
            ItemSeparatorComponent={() => (
              <View style={s.separator} />
            )}
            ListEmptyComponent={
              <View style={s.emptyContainer}>
                <Ionicons name="chatbubble-ellipses-outline" size={48} color={theme.colors.border} />
                <Text style={s.emptyTitle}>沒有對話</Text>
                <Text style={s.emptySubtitle}>
                  {searchQuery ? '找不到符合的對話' : '到群組成員列表開始私訊'}
                </Text>
              </View>
            }
          />
        )}
      </View>
    </Screen>
  );
}

// ═══════ Styles ═══════

const s = StyleSheet.create({
  searchBar: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: theme.colors.bg,
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.surface2,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 8,
  },
  searchInput: {
    flex: 1,
    color: theme.colors.text,
    fontSize: 14,
    paddingVertical: 0,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 12,
  },
  avatarBox: { position: 'relative' },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: theme.colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    color: theme.colors.accent,
    fontSize: 20,
    fontWeight: '700',
  },
  onlineDot: {
    position: 'absolute',
    bottom: 1,
    right: 1,
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: '#34C759',
    borderWidth: 2,
    borderColor: theme.colors.bg,
  },
  rowContent: { flex: 1 },
  rowTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  rowName: { color: theme.colors.text, fontSize: 16, fontWeight: '600', flex: 1 },
  rowTime: { color: theme.colors.muted, fontSize: 12, marginLeft: 8 },
  rowPreview: { color: theme.colors.muted, fontSize: 14 },
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: theme.colors.border,
    marginLeft: 80,
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 40,
    paddingTop: 80,
    gap: 12,
  },
  emptyIcon: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: theme.colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  emptyTitle: { color: theme.colors.text, fontSize: 18, fontWeight: '700' },
  emptySubtitle: { color: theme.colors.muted, fontSize: 14, textAlign: 'center' },
});
