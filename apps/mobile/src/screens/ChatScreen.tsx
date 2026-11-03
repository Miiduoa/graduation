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
  AppState,
  StyleSheet,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Screen, ErrorState } from '../ui/components';
import { theme } from '../ui/theme';
import { useThemeStyleSheet } from '../ui/useThemeStyleSheet';
import { useAuth } from '../state/auth';
import { shouldBlockForNoLogin, isDemoUid } from '../services/demoSession';
import { useSchool } from '../state/school';
import { getDb, isFirebaseMockMode } from '../firebase';
import {
  arrayUnion,
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
import {
  newChatMessageId,
  recallChatMessage,
  sendChatMessageIdempotent,
  toggleMessageReaction,
} from '../services/messaging';
import { deriveDmConversationId } from '../utils/conversationAccess';
import {
  getPersona,
  getPersonaConversationDetail,
  getPersonaConversations,
  isDemoPersonaUid,
} from '../data/demoPersona';
import {
  canRetryDmSend,
  classifyDmSendFailure,
  clearOutboundDraftsForUser,
  clearOutboundPreview,
  clearOutboundPreviewsForUser,
  confirmedServerMessageIds,
  dmSendStatusLabel,
  DM_SEND_CONTENT_MAX,
  DM_SEND_RETRY_A11Y,
  DM_SEND_RETRY_LABEL,
  DM_SEND_STATUS_A11Y,
  latestOutboundDraft,
  mergeOutboundWithServerMessages,
  nextDmSendStatus,
  pruneConfirmedOutbound,
  readOutboundDrafts,
  setOutboundPreview,
  writeOutboundDrafts,
  type DmOutboundDraft,
} from './messagingInboxModel';

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
  localStatus?: DmOutboundDraft['status'];
  local?: boolean;
};

type ConvoMeta = {
  id: string;
  type: 'dm' | 'group_chat';
  schoolId?: string;
  memberIds: string[];
  lastMessageText?: string;
  lastMessageAt?: any;
  typingUsers?: Record<string, any>;
  onlineUsers?: Record<string, any>;
};

// ═══════ Helpers ═══════

const dmId = deriveDmConversationId;

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
  const s = useThemeStyleSheet(createStyles);
  const peerParam = props?.route?.params?.peerId as string | undefined;
  const conversationIdParam = props?.route?.params?.conversationId as string | undefined;
  const refPostId = props?.route?.params?.refPostId as string | undefined;
  const conversationTitle = props?.route?.params?.conversationTitle as string | undefined;
  const auth = useAuth();
  const { school } = useSchool();
  const db = getDb();

  const [peerId, setPeerId] = useState<string | undefined>(peerParam);

  useEffect(() => {
    setPeerId(peerParam);
  }, [peerParam]);

  const [text, setText] = useState('');
  const [messages, setMessages] = useState<Msg[]>([]);
  const [outbound, setOutbound] = useState<DmOutboundDraft[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [accessError, setAccessError] = useState<string | null>(null);
  const [peerName, setPeerName] = useState<string>('');
  const [peerOnline, setPeerOnline] = useState(false);
  const [peerTyping, setPeerTyping] = useState(false);
  const [searchVisible, setSearchVisible] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [userNames, setUserNames] = useState<Record<string, string>>({});
  const fetchedUids = useRef<Set<string>>(new Set());
  const flatListRef = useRef<FlatList>(null);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sendLockRef = useRef(false);
  const retryLockRef = useRef<Set<string>>(new Set());
  const scopeRef = useRef<string>('');
  /** 畫面仍掛載時才更新 UI；失敗狀態落盤不依賴此旗標。 */
  const screenAliveRef = useRef(true);
  /**
   * 跨對話切換的隔離鍵：每次 convoKey 變化都記錄目前生效的對話，
   * 防止上一個對話遲到回來的 snapshot 把訊息塞回 state，導致看到別人的對話。
   */
  const activeConvoKeyRef = useRef<string | null>(null);

  useEffect(() => {
    screenAliveRef.current = true;
    return () => {
      screenAliveRef.current = false;
    };
  }, []);

  const myUid = auth.user?.uid;

  const convoKey = useMemo(() => {
    if (conversationIdParam) return conversationIdParam;
    if (!myUid || !peerId || !school.id) return null;
    return dmId(school.id, myUid, peerId);
  }, [conversationIdParam, myUid, peerId, school.id]);

  const sendScope = `${myUid ?? ''}:${school.id ?? ''}:${convoKey ?? ''}`;

  useEffect(() => {
    scopeRef.current = sendScope;
  }, [sendScope]);

  // 切帳號時清掉未確認草稿，避免把別人的未確認氣泡當成已送達。
  // 僅在 uid 真的變更時清進程內草稿；首次 mount 需保留以便離開再進房還原。
  const accountUidRef = useRef<string | undefined>(myUid);
  useEffect(() => {
    if (accountUidRef.current === myUid) return;
    accountUidRef.current = myUid;
    clearOutboundPreviewsForUser(null);
    clearOutboundDraftsForUser(null);
    setOutbound([]);
    setSending(false);
    sendLockRef.current = false;
    retryLockRef.current.clear();
  }, [myUid]);

  // 進程內依 conversationId 還原 outbound（離開再進房仍可重試）；失敗原文一併填回輸入框。
  useEffect(() => {
    setSending(false);
    sendLockRef.current = false;
    if (!convoKey || !myUid) {
      setOutbound([]);
      return;
    }
    const restored = readOutboundDrafts(convoKey, myUid);
    setOutbound(restored);
    const latest = latestOutboundDraft(restored, convoKey);
    if (latest && (latest.status === 'failed' || latest.status === 'unconfirmed')) {
      setText(latest.content);
    } else {
      setText('');
    }
  }, [convoKey, myUid]);

  const persistOutbound = useCallback(
    (rows: DmOutboundDraft[]) => {
      if (!convoKey || !myUid) return;
      writeOutboundDrafts(convoKey, rows);
      const mine = latestOutboundDraft(rows, convoKey);
      if (mine) {
        setOutboundPreview(convoKey, { uid: myUid, status: mine.status, text: mine.content });
      } else {
        clearOutboundPreview(convoKey, myUid);
      }
    },
    [convoKey, myUid],
  );

  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') return;
      setOutbound((prev) => {
        const next = prev.map((row) => {
          const status = nextDmSendStatus(row.status, 'background');
          if (!status || status === 'delivered' || status === row.status) return row;
          return { ...row, status };
        });
        if (convoKey) {
          writeOutboundDrafts(convoKey, next);
          const mine = latestOutboundDraft(next, convoKey);
          if (mine && myUid) {
            setOutboundPreview(convoKey, { uid: myUid, status: mine.status, text: mine.content });
          }
        }
        return next;
      });
    });
    return () => sub.remove();
  }, [convoKey, myUid]);

  /* 由對話列表進入時，用 conversationId 反查對象（DM）。
   * 若使用者不是成員，Firestore 規則會回傳 permission-denied，
   * 我們在此明確切到拒絕狀態，避免後面其他 useEffect 繼續對該 conversation 做事。
   */
  useEffect(() => {
    if (!conversationIdParam || peerParam || !myUid) return;
    let cancelled = false;
    (async () => {
      try {
        const snap = await getDoc(doc(db, 'conversations', conversationIdParam));
        if (cancelled) return;
        if (!snap.exists()) {
          setAccessError('找不到此對話。');
          return;
        }
        const data = snap.data() as ConvoMeta;
        const mids = Array.isArray(data.memberIds) ? data.memberIds : [];
        if (
          data.schoolId !== school.id ||
          data.type !== 'dm' ||
          mids.length !== 2 ||
          new Set(mids).size !== 2 ||
          !mids.includes(myUid)
        ) {
          setAccessError('這不是目前帳號可存取的本校私訊。');
          setMessages([]);
          return;
        }
        const other = mids.find((m) => m !== myUid);
        if (other) setPeerId(other);
      } catch (e: any) {
        if (cancelled) return;
        if (e?.code === 'permission-denied') {
          setAccessError('你不是此對話的成員，無法檢視訊息。');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [conversationIdParam, peerParam, myUid, db, school.id]);

  // ── 取得對方名稱（切人時先清空，避免顯示上一個對象的名稱） ──
  useEffect(() => {
    setPeerName('');
    setPeerOnline(false);
    setPeerTyping(false);
    if (conversationTitle) {
      setPeerName(conversationTitle);
      return;
    }
    if (!peerId || !school.id) return;
    let cancelled = false;
    (async () => {
      try {
        const [profile] = await fetchSchoolDirectoryProfiles(school.id, [peerId], db);
        if (cancelled) return;
        setPeerName(profile?.displayName ?? peerId.slice(0, 8));
      } catch {
        if (cancelled) return;
        setPeerName(peerId.slice(0, 8));
      }
    })();
    return () => {
      cancelled = true;
    };
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
  }, [peerName, peerOnline, peerTyping, props?.navigation, s]);

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
    // 切換對話時，先把上一個對話的視覺狀態清空，避免在新對話 snapshot 抵達前
    // 看到上一段對話的訊息（資安/隱私感受層級）。
    setMessages([]);
    setUserNames({});
    fetchedUids.current = new Set();
    setAccessError(null);

    if (!convoKey || isFirebaseMockMode() || isDemoPersonaUid(myUid)) {
      // demo 模式已在上方處理
      setLoading(false);
      activeConvoKeyRef.current = null;
      return;
    }

    activeConvoKeyRef.current = convoKey;
    setLoading(true);
    const ref = collection(db, 'conversations', convoKey, 'messages');
    const qy = query(ref, orderBy('createdAt', 'asc'));

    const unsub = onSnapshot(
      qy,
      { includeMetadataChanges: true },
      (snapshot) => {
        // 防呆：若 callback 抵達時 convoKey 已切換，直接丟棄，不把舊對話的訊息塞回 state。
        if (activeConvoKeyRef.current !== convoKey) return;

        const rows = snapshot.docs.map((d) => ({
          id: d.id,
          ...(d.data() as any),
        })) as Msg[];
        // 僅 !hasPendingWrites（server 確認）才 prune／視為已送達；pending 維持送出中／未確認。
        const confirmedIds = confirmedServerMessageIds(snapshot.docs);
        setMessages(rows);
        setOutbound((prev) => {
          const next = pruneConfirmedOutbound(prev, confirmedIds);
          if (convoKey && myUid) {
            writeOutboundDrafts(convoKey, next);
            const stillMine = latestOutboundDraft(next, convoKey);
            if (stillMine) {
              setOutboundPreview(convoKey, {
                uid: myUid,
                status: stillMine.status,
                text: stillMine.content,
              });
            } else {
              clearOutboundPreview(convoKey, myUid);
            }
          }
          return next.length === prev.length ? prev : next;
        });
        setLoading(false);

        // 自動標為已讀（用 arrayUnion 避免覆寫他人 readBy）
        const unread = rows.filter(
          (m) => m.senderId !== myUid && !(m.readBy ?? []).includes(myUid!),
        );
        unread.forEach((m) => {
          if (!myUid) return;
          const msgRef = doc(db, 'conversations', convoKey!, 'messages', m.id);
          updateDoc(msgRef, { readBy: arrayUnion(myUid) }).catch(() => {});
        });

        // 預抓名稱
        const senderIds = [...new Set(rows.map((r) => r.senderId).filter((id) => id !== myUid))];
        senderIds.forEach((uid) => {
          if (fetchedUids.current.has(uid)) return;
          fetchedUids.current.add(uid);
          fetchSchoolDirectoryProfiles(school.id, [uid], db)
            .then(([p]) => {
              if (activeConvoKeyRef.current !== convoKey) return;
              setUserNames((prev) => ({ ...prev, [uid]: p?.displayName ?? uid.slice(0, 8) }));
            })
            .catch(() => {
              if (activeConvoKeyRef.current !== convoKey) return;
              setUserNames((prev) => ({ ...prev, [uid]: uid.slice(0, 8) }));
            });
        });
      },
      (err: any) => {
        if (activeConvoKeyRef.current !== convoKey) return;
        if (err?.code === 'permission-denied') {
          setAccessError('你不是此對話的成員，無法檢視訊息。');
        } else {
          console.error('[ChatScreen] Messages error:', err);
        }
        setLoading(false);
      },
    );

    return () => {
      if (activeConvoKeyRef.current === convoKey) {
        activeConvoKeyRef.current = null;
      }
      unsub();
    };
  }, [db, convoKey, myUid, school.id]);

  // ── 對方打字 & 在線狀態監聽 ──
  useEffect(() => {
    // 切換對話／對方時，先清掉上一個對象的打字／在線狀態
    setPeerTyping(false);
    setPeerOnline(false);
    if (!convoKey || isFirebaseMockMode()) return;
    const convoRef = doc(db, 'conversations', convoKey);
    const unsub = onSnapshot(
      convoRef,
      (snap) => {
        if (!snap.exists()) return;
        const data = snap.data() as ConvoMeta;
        if (
          !myUid ||
          !school.id ||
          data.schoolId !== school.id ||
          data.type !== 'dm' ||
          !Array.isArray(data.memberIds) ||
          data.memberIds.length !== 2 ||
          new Set(data.memberIds).size !== 2 ||
          !data.memberIds.includes(myUid)
        ) {
          setMessages([]);
          setAccessError('這不是目前帳號可存取的本校私訊。');
          return;
        }
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
      },
      (err: any) => {
        if (err?.code === 'permission-denied') {
          setAccessError('你不是此對話的成員，無法檢視訊息。');
        }
      },
    );
    return () => unsub();
  }, [db, convoKey, peerId, myUid, school.id]);

  // ── 更新我的在線狀態 + 進入即更新 lastReadBy（讓對話列表的未讀立刻歸零） ──
  useEffect(() => {
    if (!convoKey || !myUid || isFirebaseMockMode()) return;
    const convoRef = doc(db, 'conversations', convoKey);
    const updateOnline = () => {
      updateDoc(convoRef, {
        [`onlineUsers.${myUid}`]: serverTimestamp(),
        [`lastReadBy.${myUid}`]: serverTimestamp(),
      }).catch(() => {});
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

  const dispatchOutbound = useCallback(
    async (draft: DmOutboundDraft) => {
      const scopeAtStart = `${myUid ?? ''}:${school.id ?? ''}:${draft.conversationId}`;
      const stillHere = () => screenAliveRef.current && scopeRef.current === scopeAtStart;
      try {
        if (isFirebaseMockMode() || isDemoPersonaUid(myUid)) {
          // Demo／mock：沿用固定 draft.id，重試不另建；不走會自產新 id 的 ds.sendMessage。
          const existing = readOutboundDrafts(draft.conversationId, draft.senderId);
          const next = existing.filter((row) => row.id !== draft.id);
          writeOutboundDrafts(draft.conversationId, next);
          const mine = latestOutboundDraft(next, draft.conversationId);
          if (mine) {
            setOutboundPreview(draft.conversationId, {
              uid: draft.senderId,
              status: mine.status,
              text: mine.content,
            });
          } else {
            clearOutboundPreview(draft.conversationId, draft.senderId);
          }
          if (!stillHere()) return;
          setMessages((prev) =>
            prev.some((row) => row.id === draft.id)
              ? prev
              : [
                  ...prev,
                  {
                    id: draft.id,
                    senderId: draft.senderId,
                    content: draft.content,
                    type: 'text',
                    createdAt: { seconds: Math.floor(draft.createdAtMs / 1000) },
                    readBy: [draft.senderId],
                  },
                ],
          );
          setOutbound(next);
        } else {
          await sendChatMessageIdempotent({
            conversationId: draft.conversationId,
            messageId: draft.id,
            senderId: draft.senderId,
            content: draft.content,
            type: 'text',
          });
          if (!stillHere()) return;
          // 真實寫入成功後仍保留 outbound，直到 snapshot 以 !hasPendingWrites 確認同 id，
          // 避免短暫消失，也避免尚未確認時顯示「已送達」。
        }
        if (!stillHere()) return;
        try {
          const { aiBrain } = await import('../services/aiBrain');
          aiBrain.reportToolOutcome(
            'send_message',
            {
              peerId,
              conversationId: draft.conversationId,
              contentPreview: draft.content.slice(0, 60),
              length: draft.content.length,
            },
            'success',
            undefined,
            `傳訊息給 ${peerId}：${draft.content.slice(0, 30)}`,
          );
        } catch (brainErr) {
          console.warn('[ChatScreen] brain.observe failed:', brainErr);
        }
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
        const kind = classifyDmSendFailure(e);
        const status = nextDmSendStatus(draft.status, kind === 'failed' ? 'known_failure' : 'uncertain');
        if (!status || status === 'delivered') return;
        // 先依 conversationId 落盤，避免送出中離房後失敗回呼無法 setState、草稿停在 sending。
        const existing = readOutboundDrafts(draft.conversationId, draft.senderId);
        const next = existing.some((row) => row.id === draft.id)
          ? existing.map((row) => (row.id === draft.id ? { ...row, status } : row))
          : [...existing, { ...draft, status }];
        writeOutboundDrafts(draft.conversationId, next);
        setOutboundPreview(draft.conversationId, {
          uid: draft.senderId,
          status,
          text: draft.content,
        });
        if (!stillHere()) return;
        // 對齊網頁：失敗／未確認時把原文放回輸入框，保留同一則可重試。
        setText(draft.content);
        setOutbound(next);
        try {
          const { aiBrain } = await import('../services/aiBrain');
          aiBrain.reportToolOutcome(
            'send_message',
            { peerId, conversationId: draft.conversationId, length: draft.content.length },
            'failure',
            e?.message,
          );
        } catch (brainErr) {
          console.warn('[ChatScreen] brain.observe failed:', brainErr);
        }
      }
    },
    [myUid, peerId, school.id],
  );

  const onRetryOutbound = useCallback(
    async (messageId: string) => {
      if (!myUid || !convoKey) return;
      const target = outbound.find((row) => row.id === messageId);
      if (!target || !canRetryDmSend(target.status)) return;
      if (retryLockRef.current.has(messageId)) return;
      retryLockRef.current.add(messageId);
      const nextStatus = nextDmSendStatus(target.status, 'retry');
      if (nextStatus !== 'sending') {
        retryLockRef.current.delete(messageId);
        return;
      }
      const draft: DmOutboundDraft = { ...target, status: 'sending' };
      setOutbound((prev) => {
        const next = prev.map((row) => (row.id === messageId ? draft : row));
        persistOutbound(next);
        return next;
      });
      try {
        await ensureConversation();
        await dispatchOutbound(draft);
      } finally {
        retryLockRef.current.delete(messageId);
      }
    },
    [convoKey, dispatchOutbound, myUid, outbound, persistOutbound],
  );

  // ── 發送訊息 ──
  const onSend = async () => {
    if (!myUid || !convoKey || !text.trim()) return;
    if (!conversationIdParam && !peerId) return;
    if (sendLockRef.current || sending) return;
    const draftText = text.trim();
    const messageContent = refPostId ? `${draftText}\n\n📎 引用貼文：${refPostId}` : draftText;
    if (messageContent.length > DM_SEND_CONTENT_MAX) {
      Alert.alert('無法送出', `訊息不可超過 ${DM_SEND_CONTENT_MAX} 字`);
      return;
    }
    // 可重試 outbound 且內容相同時，主傳送改走既有 draft id，避免另建一則雙發。
    const retryable = outbound.find(
      (row) =>
        row.conversationId === convoKey &&
        canRetryDmSend(row.status) &&
        row.content === messageContent,
    );
    if (retryable) {
      setText('');
      await onRetryOutbound(retryable.id);
      return;
    }
    sendLockRef.current = true;
    setSending(true);
    // Demo／mock 也固定 draft.id 供重試重放；真實路徑用 Firestore 預產 id。
    const messageId =
      isFirebaseMockMode() || isDemoPersonaUid(myUid)
        ? `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
        : newChatMessageId(convoKey);
    const draft: DmOutboundDraft = {
      id: messageId,
      conversationId: convoKey,
      senderId: myUid,
      content: messageContent,
      status: 'sending',
      createdAtMs: Date.now(),
    };
    setText('');
    setOutbound((prev) => {
      const next = [...prev, draft];
      persistOutbound(next);
      return next;
    });
    try {
      await ensureConversation();
      await dispatchOutbound(draft);
    } finally {
      sendLockRef.current = false;
      if (screenAliveRef.current && scopeRef.current.endsWith(`:${convoKey}`)) setSending(false);
    }
  };

  // ── 搜尋過濾 ──
  const filteredMessages = useMemo(() => {
    const merged = mergeOutboundWithServerMessages(messages, outbound, convoKey ?? '').map((row) => {
      if ('local' in row && row.local) {
        const draft = row as DmOutboundDraft & { local: true };
        return {
          id: draft.id,
          senderId: draft.senderId,
          content: draft.content,
          type: 'text' as const,
          createdAt: { seconds: Math.floor(draft.createdAtMs / 1000) },
          readBy: [draft.senderId],
          localStatus: draft.status,
          local: true,
        } satisfies Msg;
      }
      return row as Msg;
    });
    if (!searchQuery.trim()) return merged;
    const q = searchQuery.toLowerCase();
    return merged.filter((m) => (m.content ?? m.text ?? '').toLowerCase().includes(q));
  }, [messages, outbound, searchQuery, convoKey]);

  // ── 已讀狀態顯示 ──
  const isRead = useCallback(
    (msg: Msg) => {
      if (msg.senderId !== myUid) return false;
      return (msg.readBy ?? []).some((uid) => uid !== myUid);
    },
    [myUid],
  );

  // ── Guard ──
  if (shouldBlockForNoLogin({ uid: auth.user?.uid ?? null, hasUser: !!auth.user })) return <ErrorState title="對話" subtitle="尚未登入" hint="請先登入" />;
  if (!convoKey) return <ErrorState title="對話" subtitle="無法開啟對話" hint="請從對話列表進入" />;
  if (accessError) return <ErrorState title="對話" subtitle={accessError} hint="請從你的對話列表開啟對話" />;

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
              <Text
                accessibilityLabel={
                  item.localStatus
                    ? DM_SEND_STATUS_A11Y[item.localStatus]
                    : read
                      ? '已讀'
                      : '已送達'
                }
                style={[
                  s.readReceipt,
                  item.localStatus === 'failed'
                    ? s.sendStatusFailed
                    : item.localStatus === 'unconfirmed'
                      ? s.sendStatusUnconfirmed
                      : read
                        ? s.readReceiptRead
                        : null,
                ]}
              >
                {item.localStatus
                  ? dmSendStatusLabel(item.localStatus)
                  : dmSendStatusLabel('delivered', read)}
              </Text>
            )}
            {mine && item.localStatus && canRetryDmSend(item.localStatus) && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={DM_SEND_RETRY_A11Y}
                hitSlop={8}
                onPress={() => onRetryOutbound(item.id)}
                style={({ pressed }) => [s.retryBtn, pressed && { opacity: 0.7 }]}
              >
                <Text style={s.retryBtnText}>{DM_SEND_RETRY_LABEL}</Text>
              </Pressable>
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
            maxLength={DM_SEND_CONTENT_MAX}
            style={s.textInput}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={sending ? '訊息送出中' : '傳送訊息'}
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
              <ActivityIndicator size="small" color={theme.colors.onAccent} />
            ) : (
              <Ionicons
                name="send"
                size={20}
                color={text.trim() ? theme.colors.onAccent : theme.colors.muted}
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

const createStyles = () => StyleSheet.create({
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
  msgTextMine: { color: theme.colors.onAccent },
  msgTextPeer: { color: theme.colors.text },
  metaRow: { flexDirection: 'row', alignItems: 'center', marginTop: 2, paddingHorizontal: 6, gap: 6 },
  timeText: { color: theme.colors.muted, fontSize: 10 },
  readReceipt: { fontSize: 10, color: theme.colors.muted },
  readReceiptRead: { color: theme.colors.accent },
  sendStatusFailed: { color: theme.colors.danger, fontWeight: '700' },
  sendStatusUnconfirmed: { color: theme.colors.warning, fontWeight: '600' },
  retryBtn: {
    minWidth: 44,
    minHeight: 44,
    paddingHorizontal: 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
    backgroundColor: theme.colors.accentSoft,
  },
  retryBtnText: { color: theme.colors.accent, fontSize: 12, fontWeight: '700' },
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
