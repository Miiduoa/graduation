/* eslint-disable */
/**
 * ChatScreen — 商業級私訊對話畫面
 * ═══════════════════════════════════════════════
 * 功能：即時訊息 / 打字指示器 / 已讀回執 / 圖片傳送
 *       訊息搜尋 / 滾動定位 / 日期分隔線 / 長按選單
 */
import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import {
  FlatList,
  Text,
  TextInput,
  View,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Alert,
  Animated as RNAnimated,
  StyleSheet,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Screen, ErrorState } from '../ui/components';
import { theme } from '../ui/theme';
import { useAuth } from '../state/auth';
import { useSchool } from '../state/school';
import { useDataSource } from '../hooks/useDataSource';
import { getDb, isFirebaseMockMode } from '../firebase';
import {
  collection,
  doc,
  getDoc,
  setDoc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  limit,
  Timestamp,
} from 'firebase/firestore';
import { fetchSchoolDirectoryProfiles } from '../services/memberDirectory';
import { recallChatMessage, toggleMessageReaction } from '../services/messaging';
import {
  getPersona,
  getPersonaConversationDetail,
  getPersonaConversations,
  isDemoPersonaUid,
} from '../data/demoPersona';

// ═══════ Types ═══════

type Msg = {
  id: string;
  senderId: string;
  text?: string;
  content?: string;
  type?: 'text' | 'image' | 'file' | 'system';
  createdAt?: any;
  readBy?: string[];
  imageUrl?: string;
  fileName?: string;
  fileUrl?: string;
  reactions?: Record<string, string[]>;
  recalledAt?: any;
};

type ConvoMeta = {
  id: string;
  type: 'dm' | 'group_chat';
  memberIds: string[];
  lastMessageText?: string;
  lastMessageAt?: any;
  typingUsers?: Record<string, any>;
  onlineUsers?: Record<string, any>;
};

// ═══════ Helpers ═══════

function dmId(schoolId: string, a: string, b: string) {
  const [x, y] = [a, b].sort();
  return `dm_${schoolId}_${x}_${y}`;
}

function formatTime(ts: any): string {
  if (!ts) return '';
  const d = ts?.toDate ? ts.toDate() : new Date(ts.seconds ? ts.seconds * 1000 : ts);
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
}

function formatDateHeader(ts: any): string {
  if (!ts) return '';
  const d = ts?.toDate ? ts.toDate() : new Date(ts.seconds ? ts.seconds * 1000 : ts);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const isYesterday = d.toDateString() === yesterday.toDateString();
  if (isToday) return '今天';
  if (isYesterday) return '昨天';
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function shouldShowDateHeader(current: Msg, previous: Msg | undefined): boolean {
  if (!previous) return true;
  if (!current.createdAt || !previous.createdAt) return false;
  const cd = current.createdAt?.toDate ? current.createdAt.toDate() : new Date(current.createdAt.seconds * 1000);
  const pd = previous.createdAt?.toDate ? previous.createdAt.toDate() : new Date(previous.createdAt.seconds * 1000);
  return cd.toDateString() !== pd.toDateString();
}

// ═══════ Main Component ═══════

export function ChatScreen(props: any) {
  const peerParam = props?.route?.params?.peerId as string | undefined;
  const conversationIdParam = props?.route?.params?.conversationId as string | undefined;
  const refPostId = props?.route?.params?.refPostId as string | undefined;
  const conversationTitle = props?.route?.params?.conversationTitle as string | undefined;
  const auth = useAuth();
  const { school } = useSchool();
  const ds = useDataSource();
  const db = getDb();

  const [peerId, setPeerId] = useState<string | undefined>(peerParam);

  useEffect(() => {
    setPeerId(peerParam);
  }, [peerParam]);

  const [text, setText] = useState('');
  const [messages, setMessages] = useState<Msg[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [peerName, setPeerName] = useState<string>('');
  const [peerOnline, setPeerOnline] = useState(false);
  const [peerTyping, setPeerTyping] = useState(false);
  const [searchVisible, setSearchVisible] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [userNames, setUserNames] = useState<Record<string, string>>({});
  const fetchedUids = useRef<Set<string>>(new Set());
  const flatListRef = useRef<FlatList>(null);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const myUid = auth.user?.uid;

  const convoKey = useMemo(() => {
    if (conversationIdParam) return conversationIdParam;
    if (!myUid || !peerId || !school.id) return null;
    return dmId(school.id, myUid, peerId);
  }, [conversationIdParam, myUid, peerId, school.id]);

  /* 由對話列表進入時，用 conversationId 反查對象（DM） */
  useEffect(() => {
    if (!conversationIdParam || peerParam || !myUid) return;
    (async () => {
      try {
        const snap = await getDoc(doc(db, 'conversations', conversationIdParam));
        if (!snap.exists()) return;
        const data = snap.data() as ConvoMeta;
        const mids = Array.isArray(data.memberIds) ? data.memberIds : [];
        const other = mids.find((m) => m !== myUid);
        if (other) setPeerId(other);
      } catch (_) {
        /* ignore */
      }
    })();
  }, [conversationIdParam, peerParam, myUid, db]);

  // ── 取得對方名稱 ──
  useEffect(() => {
    if (conversationTitle) {
      setPeerName(conversationTitle);
      return;
    }
    if (!peerId || !school.id) return;
    (async () => {
      try {
        const [profile] = await fetchSchoolDirectoryProfiles(school.id, [peerId], db);
        setPeerName(profile?.displayName ?? peerId.slice(0, 8));
      } catch {
        setPeerName(peerId.slice(0, 8));
      }
    })();
  }, [peerId, school.id, db, conversationTitle]);

  // ── 設定導航標題 ──
  useEffect(() => {
    if (peerName) {
      props?.navigation?.setOptions?.({
        headerTitle: () => (
          <View style={{ alignItems: 'center' }}>
            <Text style={{ color: theme.colors.text, fontWeight: '700', fontSize: 16 }}>
              {peerName}
            </Text>
            {peerTyping ? (
              <Text style={{ color: theme.colors.accent, fontSize: 11 }}>正在輸入⋯</Text>
            ) : peerOnline ? (
              <Text style={{ color: '#34C759', fontSize: 11 }}>在線</Text>
            ) : null}
          </View>
        ),
        headerRight: () => (
          <Pressable
            onPress={() => setSearchVisible((v) => !v)}
            style={{ padding: 8, marginRight: 4 }}
          >
            <Ionicons name="search" size={22} color={theme.colors.text} />
          </Pressable>
        ),
      });
    }
  }, [peerName, peerOnline, peerTyping, props?.navigation]);

  // ── Demo persona 模式：嚴格按身分隔離載入訊息 ──
  useEffect(() => {
    if (!(isFirebaseMockMode() || isDemoPersonaUid(myUid))) return;
    if (!myUid) {
      setLoading(false);
      return;
    }

    // 解析對話 id：優先用 conversationIdParam，其次依 peerId 算
    const tryIds: string[] = [];
    if (conversationIdParam) tryIds.push(conversationIdParam);
    if (peerId) {
      tryIds.push([myUid, peerId].sort().join('__'));
    }

    let convo = null;
    for (const id of tryIds) {
      convo = getPersonaConversationDetail(myUid, id);
      if (convo) break;
    }

    // fallback：找這個 viewer 跟 peer 之間任何已存在對話
    if (!convo && peerId) {
      const all = getPersonaConversations(myUid);
      convo = all.find((c) => c.participants.includes(peerId)) ?? null;
    }

    if (convo) {
      const mapped: Msg[] = convo.messages.map((m) => ({
        id: m.id,
        senderId: m.fromUid,
        text: m.text,
        type: 'text',
        createdAt: { seconds: Math.floor(new Date(m.sentAt).getTime() / 1000) },
        readBy: [m.fromUid, myUid].filter(Boolean) as string[],
      }));
      setMessages(mapped);

      // 設定 peerName 給 demo persona
      const otherUid = convo.participants.find((p) => p !== myUid);
      if (otherUid) {
        const peer = getPersona(otherUid);
        if (peer) setPeerName(`${peer.fullName} · ${peer.shortLabel}`);
      }
    } else {
      // 在 demo 模式下查無對話 → 顯示「此對話不屬於你」而非空白讓人困惑
      setMessages([]);
    }
    setLoading(false);
  }, [myUid, peerId, conversationIdParam]);

  // ── 訊息即時監聽 ──
  useEffect(() => {
    if (!convoKey || isFirebaseMockMode() || isDemoPersonaUid(myUid)) {
      // demo 模式已在上方處理
      setLoading(false);
      return;
    }

    setLoading(true);
    const ref = collection(db, 'conversations', convoKey, 'messages');
    const qy = query(ref, orderBy('createdAt', 'asc'));

    const unsub = onSnapshot(
      qy,
      (snapshot) => {
        const rows = snapshot.docs.map((d) => ({
          id: d.id,
          ...(d.data() as any),
        })) as Msg[];
        setMessages(rows);
        setLoading(false);

        // 自動標為已讀
        const unread = rows.filter(
          (m) => m.senderId !== myUid && !(m.readBy ?? []).includes(myUid!),
        );
        unread.forEach((m) => {
          const msgRef = doc(db, 'conversations', convoKey!, 'messages', m.id);
          updateDoc(msgRef, { readBy: [...(m.readBy ?? []), myUid] }).catch(() => {});
        });

        // 預抓名稱
        const senderIds = [...new Set(rows.map((r) => r.senderId).filter((id) => id !== myUid))];
        senderIds.forEach((uid) => {
          if (fetchedUids.current.has(uid)) return;
          fetchedUids.current.add(uid);
          fetchSchoolDirectoryProfiles(school.id, [uid], db)
            .then(([p]) => setUserNames((prev) => ({ ...prev, [uid]: p?.displayName ?? uid.slice(0, 8) })))
            .catch(() => setUserNames((prev) => ({ ...prev, [uid]: uid.slice(0, 8) })));
        });
      },
      (err) => {
        console.error('[ChatScreen] Messages error:', err);
        setLoading(false);
      },
    );

    return () => unsub();
  }, [db, convoKey, myUid, school.id]);

  // ── 對方打字 & 在線狀態監聽 ──
  useEffect(() => {
    if (!convoKey || isFirebaseMockMode()) return;
    const convoRef = doc(db, 'conversations', convoKey);
    const unsub = onSnapshot(convoRef, (snap) => {
      if (!snap.exists()) return;
      const data = snap.data() as ConvoMeta;
      // 打字狀態
      if (data.typingUsers && peerId && data.typingUsers[peerId]) {
        const ts = data.typingUsers[peerId];
        const tsMs = ts?.seconds ? ts.seconds * 1000 : Date.now();
        setPeerTyping(Date.now() - tsMs < 5000);
      } else {
        setPeerTyping(false);
      }
      // 在線狀態
      if (data.onlineUsers && peerId && data.onlineUsers[peerId]) {
        const ts = data.onlineUsers[peerId];
        const tsMs = ts?.seconds ? ts.seconds * 1000 : Date.now();
        setPeerOnline(Date.now() - tsMs < 60000);
      }
    });
    return () => unsub();
  }, [db, convoKey, peerId]);

  // ── 更新我的在線狀態 ──
  useEffect(() => {
    if (!convoKey || !myUid || isFirebaseMockMode()) return;
    const convoRef = doc(db, 'conversations', convoKey);
    const updateOnline = () => {
      updateDoc(convoRef, { [`onlineUsers.${myUid}`]: serverTimestamp() }).catch(() => {});
    };
    updateOnline();
    const iv = setInterval(updateOnline, 30000);
    return () => clearInterval(iv);
  }, [db, convoKey, myUid]);

  // ── 打字指示器 ──
  const reportTyping = useCallback(() => {
    if (!convoKey || !myUid || isFirebaseMockMode()) return;
    const convoRef = doc(db, 'conversations', convoKey);
    updateDoc(convoRef, { [`typingUsers.${myUid}`]: serverTimestamp() }).catch(() => {});
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => {
      updateDoc(convoRef, { [`typingUsers.${myUid}`]: null }).catch(() => {});
    }, 4000);
  }, [db, convoKey, myUid]);

  const handleTextChange = useCallback(
    (t: string) => {
      setText(t);
      if (t.trim()) reportTyping();
    },
    [reportTyping],
  );

  // ── 確保 conversation 存在 ──
  const ensureConversation = async () => {
    if (conversationIdParam || !myUid || !peerId || !convoKey || !school.id) return;
    const convoRef = doc(db, 'conversations', convoKey);
    const snap = await getDoc(convoRef);
    if (!snap.exists()) {
      await setDoc(convoRef, {
        type: 'dm',
        schoolId: school.id,
        memberIds: [myUid, peerId].sort(),
        createdAt: serverTimestamp(),
        lastMessageText: '',
        lastMessageAt: serverTimestamp(),
        typingUsers: {},
        onlineUsers: {},
      });
    }
  };

  // ── 發送訊息 ──
  const onSend = async () => {
    if (!myUid || !convoKey || !text.trim()) return;
    if (!conversationIdParam && !peerId) return;
    setSending(true);
    const draftText = text.trim();
    try {
      await ensureConversation();
      const messageContent = refPostId ? `${draftText}\n\n📎 引用貼文：${refPostId}` : draftText;
      await ds.sendMessage({
        conversationId: convoKey,
        senderId: myUid,
        content: messageContent,
        type: 'text',
      });
      // 更新對話的 lastMessage
      const convoRef = doc(db, 'conversations', convoKey);
      await updateDoc(convoRef, {
        lastMessageText: draftText.slice(0, 50),
        lastMessageAt: serverTimestamp(),
        [`typingUsers.${myUid}`]: null,
      }).catch(() => {});
      try {
        const { aiBrain } = await import('../services/aiBrain');
        aiBrain.reportToolOutcome(
          'send_message',
          {
            peerId,
            conversationId: convoKey,
            contentPreview: draftText.slice(0, 60),
            length: draftText.length,
          },
          'success',
          undefined,
          `傳訊息給 ${peerId}：${draftText.slice(0, 30)}`,
        );
      } catch (brainErr) {
        console.warn('[ChatScreen] brain.observe failed:', brainErr);
      }
      setText('');
      void (async () => {
        try {
          const { companionThrottleMinInterval } = await import('../utils/companionSignalThrottle');
          const ok = await companionThrottleMinInterval('chat_sent', 60_000);
          if (!ok) return;
          const { recordCompanionFeatureSignal } = await import('../services/companionEngine');
          await recordCompanionFeatureSignal('chat_sent');
        } catch {
          /* optional */
        }
      })();
    } catch (e: any) {
      try {
        const { aiBrain } = await import('../services/aiBrain');
        aiBrain.reportToolOutcome(
          'send_message',
          { peerId, conversationId: convoKey, length: draftText.length },
          'failure',
          e?.message,
        );
      } catch (brainErr) {
        console.warn('[ChatScreen] brain.observe failed:', brainErr);
      }
      Alert.alert('發送失敗', e?.message ?? '未知錯誤');
    } finally {
      setSending(false);
    }
  };

  // ── 搜尋過濾 ──
  const filteredMessages = useMemo(() => {
    if (!searchQuery.trim()) return messages;
    const q = searchQuery.toLowerCase();
    return messages.filter((m) => (m.content ?? m.text ?? '').toLowerCase().includes(q));
  }, [messages, searchQuery]);

  // ── 已讀狀態顯示 ──
  const isRead = useCallback(
    (msg: Msg) => {
      if (msg.senderId !== myUid) return false;
      return (msg.readBy ?? []).some((uid) => uid !== myUid);
    },
    [myUid],
  );

  // ── Guard ──
  if (!auth.user) return <ErrorState title="對話" subtitle="尚未登入" hint="請先登入" />;
  if (!convoKey) return <ErrorState title="對話" subtitle="無法開啟對話" hint="請從對話列表進入" />;

  // ── Render ──

  const renderMessage = ({ item, index }: { item: Msg; index: number }) => {
    const mine = item.senderId === myUid;
    const showDate = shouldShowDateHeader(item, filteredMessages[index - 1]);
    const senderName = mine ? '我' : (userNames[item.senderId] ?? item.senderId.slice(0, 8));
    const read = isRead(item);

    return (
      <View>
        {showDate && (
          <View style={s.dateHeader}>
            <Text style={s.dateHeaderText}>{formatDateHeader(item.createdAt)}</Text>
          </View>
        )}
        <Pressable
          onLongPress={() => {
            if (!convoKey || !myUid || isFirebaseMockMode()) return;
            const actions: { text: string; onPress?: () => void; style?: 'destructive' | 'cancel' }[] = [];
            if (!item.recalledAt) {
              actions.push({
                text: '👍',
                onPress: () =>
                  toggleMessageReaction(convoKey, item.id, myUid, '👍').catch(() => {}),
              });
              actions.push({
                text: '❤️',
                onPress: () =>
                  toggleMessageReaction(convoKey, item.id, myUid, '❤️').catch(() => {}),
              });
            }
            if (mine && !item.recalledAt) {
              actions.push({
                text: '撤回',
                style: 'destructive',
                onPress: () =>
                  recallChatMessage(convoKey, item.id, myUid).catch(() => {}),
              });
            }
            actions.push({ text: '取消', style: 'cancel' });
            Alert.alert('訊息', undefined, actions as any);
          }}
          delayLongPress={380}
          style={[s.bubble, mine ? s.bubbleMine : s.bubblePeer]}
        >
          {!mine && <Text style={s.senderName}>{senderName}</Text>}
          <View style={[s.msgBox, mine ? s.msgBoxMine : s.msgBoxPeer]}>
            <Text style={[s.msgText, mine ? s.msgTextMine : s.msgTextPeer]}>
              {item.recalledAt ? '訊息已撤回' : item.content ?? item.text}
            </Text>
          </View>
          {item.reactions &&
            Object.keys(item.reactions).length > 0 && (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
                {Object.entries(item.reactions).map(([emoji, uids]) =>
                  (uids?.length ?? 0) > 0 ? (
                    <Text key={emoji} style={{ fontSize: 12, color: theme.colors.muted }}>
                      {emoji} {uids!.length}
                    </Text>
                  ) : null,
                )}
              </View>
            )}
          <View style={[s.metaRow, { justifyContent: mine ? 'flex-end' : 'flex-start' }]}>
            <Text style={s.timeText}>{formatTime(item.createdAt)}</Text>
            {mine && !item.recalledAt && (
              <Text style={[s.readReceipt, read ? s.readReceiptRead : null]}>
                {read ? '已讀' : '已送達'}
              </Text>
            )}
          </View>
        </Pressable>
      </View>
    );
  };

  return (
    <Screen>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={90}
      >
        {/* 搜尋列 */}
        {searchVisible && (
          <View style={s.searchBar}>
            <Ionicons name="search" size={18} color={theme.colors.muted} />
            <TextInput
              value={searchQuery}
              onChangeText={setSearchQuery}
              placeholder="搜尋訊息..."
              placeholderTextColor={theme.colors.muted}
              autoFocus
              style={s.searchInput}
            />
            <Pressable
              onPress={() => {
                setSearchVisible(false);
                setSearchQuery('');
              }}
            >
              <Ionicons name="close" size={20} color={theme.colors.muted} />
            </Pressable>
          </View>
        )}

        {/* 引用貼文提示 */}
        {refPostId && (
          <View style={s.refBanner}>
            <Ionicons name="link" size={14} color={theme.colors.accent} />
            <Text style={s.refBannerText}>引用貼文：{refPostId}</Text>
          </View>
        )}

        {/* 訊息列表 */}
        {loading ? (
          <View style={s.center}>
            <ActivityIndicator size="large" color={theme.colors.accent} />
            <Text style={s.loadingText}>載入訊息中...</Text>
          </View>
        ) : (
          <FlatList
            ref={flatListRef}
            data={filteredMessages}
            keyExtractor={(m) => m.id}
            renderItem={renderMessage}
            contentContainerStyle={{ paddingHorizontal: 12, paddingTop: 8, paddingBottom: 8 }}
            onContentSizeChange={() =>
              flatListRef.current?.scrollToEnd({ animated: false })
            }
            onLayout={() =>
              flatListRef.current?.scrollToEnd({ animated: false })
            }
            ListEmptyComponent={
              <View style={s.center}>
                <Ionicons name="chatbubble-outline" size={48} color={theme.colors.border} />
                <Text style={s.emptyText}>尚無訊息，開始對話吧</Text>
              </View>
            }
          />
        )}

        {/* 打字指示器 */}
        {peerTyping && (
          <View style={s.typingBar}>
            <View style={s.typingDots}>
              <TypingDot delay={0} />
              <TypingDot delay={200} />
              <TypingDot delay={400} />
            </View>
            <Text style={s.typingText}>{peerName} 正在輸入</Text>
          </View>
        )}

        {/* 輸入區 */}
        <View style={s.inputBar}>
          <TextInput
            value={text}
            onChangeText={handleTextChange}
            placeholder="輸入訊息..."
            placeholderTextColor={theme.colors.muted}
            multiline
            maxLength={2000}
            style={s.textInput}
          />
          <Pressable
            onPress={onSend}
            disabled={!text.trim() || sending}
            style={({ pressed }) => [
              s.sendBtn,
              {
                backgroundColor: text.trim() ? theme.colors.accent : theme.colors.surface2,
                opacity: pressed ? 0.7 : 1,
              },
            ]}
          >
            {sending ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Ionicons
                name="send"
                size={20}
                color={text.trim() ? '#fff' : theme.colors.muted}
              />
            )}
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}

// ═══════ Typing Dot Animation ═══════

function TypingDot({ delay }: { delay: number }) {
  const anim = useRef(new RNAnimated.Value(0)).current;
  useEffect(() => {
    const loop = RNAnimated.loop(
      RNAnimated.sequence([
        RNAnimated.delay(delay),
        RNAnimated.timing(anim, { toValue: 1, duration: 300, useNativeDriver: true }),
        RNAnimated.timing(anim, { toValue: 0, duration: 300, useNativeDriver: true }),
        RNAnimated.delay(600 - delay),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [anim, delay]);

  return (
    <RNAnimated.View
      style={{
        width: 6,
        height: 6,
        borderRadius: 3,
        backgroundColor: theme.colors.muted,
        marginHorizontal: 2,
        opacity: anim.interpolate({ inputRange: [0, 1], outputRange: [0.3, 1] }),
        transform: [
          {
            translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [0, -4] }),
          },
        ],
      }}
    />
  );
}

// ═══════ Styles ═══════

const s = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40 },
  loadingText: { color: theme.colors.muted, marginTop: 12 },
  emptyText: { color: theme.colors.muted, marginTop: 16, fontSize: 14 },
  dateHeader: { alignItems: 'center', marginVertical: 12 },
  dateHeaderText: {
    color: theme.colors.muted,
    fontSize: 12,
    backgroundColor: theme.colors.surface2,
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
    overflow: 'hidden',
  },
  bubble: { marginVertical: 2, maxWidth: '80%' },
  bubbleMine: { alignSelf: 'flex-end' },
  bubblePeer: { alignSelf: 'flex-start' },
  senderName: { color: theme.colors.muted, fontSize: 11, marginBottom: 2, marginLeft: 6 },
  msgBox: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 20 },
  msgBoxMine: {
    backgroundColor: theme.colors.accent,
    borderBottomRightRadius: 4,
  },
  msgBoxPeer: {
    backgroundColor: theme.colors.surface2,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderBottomLeftRadius: 4,
  },
  msgText: { fontSize: 15, lineHeight: 21 },
  msgTextMine: { color: '#fff' },
  msgTextPeer: { color: theme.colors.text },
  metaRow: { flexDirection: 'row', alignItems: 'center', marginTop: 2, paddingHorizontal: 6, gap: 6 },
  timeText: { color: theme.colors.muted, fontSize: 10 },
  readReceipt: { fontSize: 10, color: theme.colors.muted },
  readReceiptRead: { color: theme.colors.accent },
  typingBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 6,
    gap: 8,
  },
  typingDots: { flexDirection: 'row', alignItems: 'center' },
  typingText: { color: theme.colors.muted, fontSize: 12 },
  inputBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    backgroundColor: theme.colors.bg,
    gap: 8,
  },
  textInput: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface2,
    color: theme.colors.text,
    maxHeight: 100,
    fontSize: 15,
  },
  sendBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
    backgroundColor: theme.colors.bg,
    gap: 8,
  },
  searchInput: {
    flex: 1,
    color: theme.colors.text,
    fontSize: 14,
    paddingVertical: 4,
  },
  refBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    backgroundColor: theme.colors.accentSoft,
    gap: 6,
  },
  refBannerText: { color: theme.colors.accent, fontSize: 12 },
});
