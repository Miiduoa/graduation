/* eslint-disable */
/**
 * ChatScreen — 商業級私訊對話畫面
 * ═══════════════════════════════════════════════
 * 功能：即時訊息 / 打字指示器 / 已讀回執 / 圖片傳送
 *       訊息搜尋 / 滾動定位 / 日期分隔線 / 長按選單
 */
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState, useCallback } from 'react';
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
import { DmPhotoComposer, DmPhotoMessage } from './DmPhotos';
import { photoParts, type PhotoScope } from '../services/dmPhotos';
import { prepareDmConversation, sendDmText, watchNewDm } from '../services/dmConversations';
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
  attachmentPath?: string;
  fileName?: string;
  fileUrl?: string;
  reactions?: Record<string, string[]>;
  recalledAt?: any;
  storyReplyTo?: { storyId: string; authorUid: string };
  cacheOnly?: boolean;
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

type PeerPreparation = {
  scope: string;
  status: 'loading' | 'ready' | 'error';
  exists?: boolean;
  serverConfirmed?: boolean;
  error?: string;
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

function matchesOutboundText(message: Msg, draft: DmOutboundDraft) {
  return message.id === draft.id && message.senderId === draft.senderId &&
    message.type === 'text' && message.content === draft.content;
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
   * 綁定帳號、學校與對話，撤銷權限後也拒絕遲到的訊息 callback。
   */
  const activeConversationScopeRef = useRef<string | null>(null);
  const activeTextAttempts = useRef(new Map<string, { draft: DmOutboundDraft; confirmed: boolean }>());
  const textEditRevision = useRef(0);
  const restoredTextDraft = useRef<{ scope: string; draft: DmOutboundDraft } | null>(null);
  const confirmedPhotos = useRef<{ scope: string; rows: Msg[] } | null>(null);

  useEffect(() => {
    screenAliveRef.current = true;
    return () => {
      screenAliveRef.current = false;
    };
  }, []);

  const myUid = auth.user?.uid;
  const peerRoute = !conversationIdParam && !!peerParam &&
    !isFirebaseMockMode() && !isDemoPersonaUid(myUid) && !isDemoUid(myUid);

  const convoKey = useMemo(() => {
    if (conversationIdParam) return conversationIdParam;
    if (!myUid || !peerParam || !school.id) return null;
    return dmId(school.id, myUid, peerParam);
  }, [conversationIdParam, myUid, peerParam, school.id]);

  const readableTextScopeRef = useRef<string | null>(null);
  const [readableTextThread, setReadableTextThread] = useState<string | null>(null);
  const [verifiedPhotoThread, setVerifiedPhotoThread] = useState<string | null>(null);
  const [focused, setFocused] = useState(() => props?.navigation?.isFocused?.() ?? true);
  useEffect(() => {
    const nav = props?.navigation;
    const focus = nav?.addListener?.('focus', () => setFocused(true));
    const blur = nav?.addListener?.('blur', () => setFocused(false));
    return () => { focus?.(); blur?.(); };
  }, [props?.navigation]);

  const sendScope = `${myUid ?? ''}:${school.id ?? ''}:${convoKey ?? ''}`;
  const [displayScope, setDisplayScope] = useState(sendScope);
  const displayCurrentScope = displayScope === sendScope;
  const [preparation, setPreparation] = useState<PeerPreparation | null>(null);
  const [prepareAttempt, setPrepareAttempt] = useState(0);
  const peerTextRequests = useRef(new Set<AbortController>());
  const peerPrepared = preparation?.scope === sendScope && preparation.status === 'ready';
  const canSend = displayCurrentScope && (!peerRoute || peerPrepared);
  const liveThread = !peerRoute || (peerPrepared && preparation.exists === true);
  const messageReadAllowed = liveThread &&
    (readableTextThread === sendScope || verifiedPhotoThread === sendScope);
  const prepareError = preparation?.scope === sendScope ? preparation.error : '';

  useLayoutEffect(() => {
    scopeRef.current = sendScope;
    textEditRevision.current += 1;
    restoredTextDraft.current = null;
    confirmedPhotos.current = null;
    return () => {
      for (const request of peerTextRequests.current) request.abort();
      peerTextRequests.current.clear();
    };
  }, [sendScope]);

  const failPreparation = useCallback((error: any) => {
    if (!screenAliveRef.current || scopeRef.current !== sendScope) return;
    const denied = String(error?.code ?? '').endsWith('permission-denied');
    setPreparation({
      scope: sendScope,
      status: 'error',
      error: denied
        ? '目前無法與此對象開啟私訊，請確認登入帳號與所屬學校。'
        : '暫時無法確認這段對話，請檢查網路後重試。',
    });
    setVerifiedPhotoThread(null);
  }, [sendScope]);

  const markPeerThreadExists = useCallback(() => {
    if (!peerRoute || !screenAliveRef.current || scopeRef.current !== sendScope) return;
    setPreparation((current) => current?.scope === sendScope && current.status === 'ready' && !current.exists
      ? { ...current, exists: true } : current);
  }, [peerRoute, sendScope]);

  useEffect(() => {
    if (!peerRoute || !myUid || !peerParam || !school.id || !convoKey) return;
    const controller = new AbortController();
    setPreparation({ scope: sendScope, status: 'loading' });
    setVerifiedPhotoThread(null);
    void prepareDmConversation({ viewerUid: myUid, schoolId: school.id, peerUid: peerParam }, controller.signal)
      .then((result) => {
        if (controller.signal.aborted || scopeRef.current !== sendScope) return;
        setPreparation({ scope: sendScope, status: 'ready', exists: result.exists, serverConfirmed: true });
        setVerifiedPhotoThread(sendScope);
      })
      .catch(async (error) => {
        if (controller.signal.aborted || scopeRef.current !== sendScope) return;
        // 準備新對話的校籍檢查失敗，不代表既有成員失去舊對話存取權。
        // 合格的本校雙人成員快取可開啟文字監聽；照片仍須伺服器確認。
        try {
          const snap = await getDoc(doc(db, 'conversations', convoKey));
          if (controller.signal.aborted || scopeRef.current !== sendScope) return;
          const data = snap.exists() ? snap.data() as ConvoMeta : null;
          if (
            data?.type === 'dm' && data.schoolId === school.id &&
            Array.isArray(data.memberIds) && data.memberIds.length === 2 &&
            new Set(data.memberIds).size === 2 &&
            data.memberIds.includes(myUid) && data.memberIds.includes(peerParam)
          ) {
            const serverConfirmed = snap.metadata.fromCache === false && !snap.metadata.hasPendingWrites;
            setPreparation({ scope: sendScope, status: 'ready', exists: true, serverConfirmed });
            if (serverConfirmed) setVerifiedPhotoThread(sendScope);
            return;
          }
        } catch {
          // 無法確認成員權限時保留原本可重試的失敗狀態。
        }
        if (!controller.signal.aborted && scopeRef.current === sendScope) failPreparation(error);
      });
    return () => controller.abort();
  }, [peerRoute, myUid, peerParam, school.id, sendScope, prepareAttempt, failPreparation, db, convoKey]);

  useEffect(() => {
    if (!peerRoute || !peerPrepared || preparation.exists || !myUid || !peerParam || !convoKey) return;
    try {
      return watchNewDm(
        { viewerUid: myUid, schoolId: school.id, peerUid: peerParam, conversationId: convoKey },
        markPeerThreadExists,
        failPreparation,
      );
    } catch (error) {
      failPreparation(error);
    }
  }, [peerRoute, peerPrepared, preparation?.exists, myUid, peerParam, school.id, convoKey, markPeerThreadExists, failPreparation]);

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
    setMessages([]);
    setUserNames({});
    setAccessError(null);
    setText('');
    setDisplayScope(sendScope);
    if (!convoKey || !myUid) {
      setOutbound([]);
      return;
    }
    const restored = readOutboundDrafts(convoKey, myUid);
    setOutbound(restored);
    const latest = latestOutboundDraft(restored, convoKey);
    if (latest && (latest.status === 'failed' || latest.status === 'unconfirmed')) {
      restoredTextDraft.current = { scope: sendScope, draft: latest };
      setText(latest.content);
    } else {
      setText('');
    }
  }, [convoKey, myUid, sendScope]);

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
          activeConversationScopeRef.current = null;
          setMessages([]);
          setAccessError('找不到此對話。');
          return;
        }
        const data = snap.data() as ConvoMeta;
        const mids = Array.isArray(data.memberIds) ? data.memberIds : [];
        if (
          data.schoolId !== school.id ||
          data.type !== 'dm' ||
          mids.length !== 2 ||
          mids.some((uid) => typeof uid !== 'string' || !uid.trim()) ||
          new Set(mids).size !== 2 ||
          !mids.includes(myUid)
        ) {
          activeConversationScopeRef.current = null;
          setAccessError('這不是目前帳號可存取的本校私訊。');
          setMessages([]);
          return;
        }
        const other = mids.find((m) => m !== myUid);
        if (other) setPeerId(other);
      } catch (e: any) {
        if (cancelled) return;
        if (e?.code === 'permission-denied') {
          activeConversationScopeRef.current = null;
          setMessages([]);
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

    if (!convoKey || !messageReadAllowed || isFirebaseMockMode() || isDemoPersonaUid(myUid)) {
      // demo 模式已在上方處理
      setLoading(false);
      activeConversationScopeRef.current = null;
      return;
    }

    activeConversationScopeRef.current = sendScope;
    let listening = true;
    let receivedServerMessages = false;
    setLoading(true);
    const ref = collection(db, 'conversations', convoKey, 'messages');
    const qy = query(ref, orderBy('createdAt', 'asc'));

    const unsub = onSnapshot(
      qy,
      { includeMetadataChanges: true },
      (snapshot) => {
        if (!listening || scopeRef.current !== sendScope || activeConversationScopeRef.current !== sendScope) return;
        if (snapshot.metadata.fromCache) {
          // Cache can restore historical text, but cannot acknowledge sends or
          // replace already loaded rows (including with an empty cache result).
          // A pending row must not suppress other confirmed cached history.
          if (readableTextScopeRef.current === sendScope && !receivedServerMessages) {
            const cachedRows = snapshot.docs
              .filter((entry) => !entry.metadata.hasPendingWrites)
              .map((entry) => ({ ...(entry.data() as any), id: entry.id, cacheOnly: true }) as Msg)
              .filter((row) => !row.type || row.type === 'text');
            setMessages((current) => {
              const existingIds = new Set(current.map((row) => row.id));
              return [...current, ...cachedRows.filter((row) => !existingIds.has(row.id))];
            });
          }
          setLoading(false);
          return;
        }
        if (snapshot.metadata.hasPendingWrites) return;
        receivedServerMessages = true;
        const confirmedDocs = snapshot.docs.filter((entry) => !entry.metadata.hasPendingWrites);

        const rows = confirmedDocs.map((d) => ({
          ...(d.data() as any),
          id: d.id,
        })) as Msg[];
        // 僅 !hasPendingWrites（server 確認）才 prune／視為已送達；pending 維持送出中／未確認。
        const confirmedIds = confirmedServerMessageIds(confirmedDocs);
        for (const row of rows) {
          const attempt = activeTextAttempts.current.get(`${sendScope}:${row.id}`);
          if (attempt) {
            if (matchesOutboundText(row, attempt.draft)) attempt.confirmed = true;
            else confirmedIds.delete(row.id);
          }
        }
        if (myUid) {
          for (const draft of readOutboundDrafts(convoKey, myUid)) {
            if (!rows.some((row) => matchesOutboundText(row, draft))) confirmedIds.delete(draft.id);
          }
        }
        const restored = restoredTextDraft.current;
        if (restored?.scope === sendScope && rows.some((row) => matchesOutboundText(row, restored.draft))) {
          restoredTextDraft.current = null;
          setText('');
        }
        confirmedPhotos.current = {
          scope: sendScope,
          rows: rows.filter((row) => row.type === 'image' && row.senderId === myUid),
        };
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
              if (!listening || scopeRef.current !== sendScope || activeConversationScopeRef.current !== sendScope) return;
              setUserNames((prev) => ({ ...prev, [uid]: p?.displayName ?? uid.slice(0, 8) }));
            })
            .catch(() => {
              if (!listening || scopeRef.current !== sendScope || activeConversationScopeRef.current !== sendScope) return;
              setUserNames((prev) => ({ ...prev, [uid]: uid.slice(0, 8) }));
            });
        });
      },
      (err: any) => {
        if (!listening || scopeRef.current !== sendScope || activeConversationScopeRef.current !== sendScope) return;
        if (err?.code === 'permission-denied') {
          activeConversationScopeRef.current = null;
          setMessages([]);
          setUserNames({});
          fetchedUids.current = new Set();
          setAccessError('你不是此對話的成員，無法檢視訊息。');
        } else {
          console.error('[ChatScreen] Messages error:', err);
        }
        setLoading(false);
      },
    );

    return () => {
      listening = false;
      if (activeConversationScopeRef.current === sendScope) {
        activeConversationScopeRef.current = null;
      }
      unsub();
    };
  }, [db, convoKey, myUid, school.id, messageReadAllowed, sendScope]);

  // ── 對方打字 & 在線狀態監聽 ──
  useEffect(() => {
    // 切換對話／對方時，先清掉上一個對象的打字／在線狀態
    setVerifiedPhotoThread((current) => peerRoute && peerPrepared && current === sendScope ? current : null);
    readableTextScopeRef.current = null;
    setReadableTextThread(null);
    setPeerTyping(false);
    setPeerOnline(false);
    if (!convoKey || !liveThread || isFirebaseMockMode()) return;
    let listening = true;
    let serverRejected = false;
    let readableTextMembers: string | null = null;
    let verifiedPhotoMembers: string | null = peerRoute && peerPrepared && preparation?.serverConfirmed
      ? JSON.stringify([myUid, peerParam].sort()) : null;
    const convoRef = doc(db, 'conversations', convoKey);
    const unsub = onSnapshot(
      convoRef,
      { includeMetadataChanges: true },
      (snap) => {
        if (!listening || scopeRef.current !== sendScope) return;
        // A valid cached roster permits text reading only. Cache cannot revoke
        // an existing session or grant photo access. Presence/read-marker writes
        // may be pending while the roster still matches this DM.
        const fromCache = snap.metadata.fromCache;
        if (fromCache && (serverRejected || !snap.exists())) return;
        if (!snap.exists()) {
          serverRejected = true;
          readableTextScopeRef.current = null;
          setReadableTextThread(null);
          verifiedPhotoMembers = null;
          setVerifiedPhotoThread(null);
          activeConversationScopeRef.current = null;
          setMessages([]);
          setUserNames({});
          fetchedUids.current = new Set();
          return;
        }
        const data = snap.data() as ConvoMeta;
        if (
          !myUid ||
          !school.id ||
          data.schoolId !== school.id ||
          data.type !== 'dm' ||
          !Array.isArray(data.memberIds) ||
          data.memberIds.length !== 2 ||
          data.memberIds.some((uid) => typeof uid !== 'string' || !uid.trim()) ||
          new Set(data.memberIds).size !== 2 ||
          !data.memberIds.includes(myUid) ||
          (peerRoute && !data.memberIds.includes(peerParam))
        ) {
          if (fromCache) return;
          serverRejected = true;
          readableTextScopeRef.current = null;
          setReadableTextThread(null);
          verifiedPhotoMembers = null;
          setVerifiedPhotoThread(null);
          activeConversationScopeRef.current = null;
          setMessages([]);
          setUserNames({});
          fetchedUids.current = new Set();
          setAccessError('這不是目前帳號可存取的本校私訊。');
          return;
        }
        const textMembers = JSON.stringify([...data.memberIds].sort());
        const expectedMembers = peerId ? JSON.stringify([myUid, peerId].sort()) : null;
        const trustedMembers = readableTextMembers ?? expectedMembers;
        if (!snap.metadata.hasPendingWrites || (
          trustedMembers === null || textMembers === trustedMembers
        )) {
          readableTextMembers = textMembers;
          readableTextScopeRef.current = sendScope;
          setReadableTextThread(sendScope);
        }
        if (fromCache) return;
        serverRejected = false;
        const members = JSON.stringify([...data.memberIds].sort());
        if (!snap.metadata.hasPendingWrites) {
          verifiedPhotoMembers = members;
        } else if (verifiedPhotoMembers !== members) {
          verifiedPhotoMembers = null;
        }
        // Local typing and presence writes keep the same server-confirmed photo session.
        setVerifiedPhotoThread(verifiedPhotoMembers ? sendScope : null);
        if (!verifiedPhotoMembers && snap.metadata.hasPendingWrites && readableTextMembers !== members) {
          readableTextScopeRef.current = null;
          setReadableTextThread(null);
          activeConversationScopeRef.current = null;
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
        if (!listening || scopeRef.current !== sendScope) return;
        // A listener failure cannot grant photo access, but only an explicit
        // permission denial revokes the already readable text session.
        verifiedPhotoMembers = null;
        setVerifiedPhotoThread(null);
        if (err?.code === 'permission-denied') {
          serverRejected = true;
          readableTextScopeRef.current = null;
          setReadableTextThread(null);
          activeConversationScopeRef.current = null;
          setMessages([]);
          setUserNames({});
          fetchedUids.current = new Set();
          setAccessError('你不是此對話的成員，無法檢視訊息。');
        } else {
          console.error('[ChatScreen] Conversation error:', err);
        }
        setLoading(false);
      },
    );
    return () => {
      listening = false;
      unsub();
    };
  }, [db, convoKey, peerId, peerParam, myUid, school.id, sendScope, liveThread, peerRoute, peerPrepared, preparation?.serverConfirmed]);

  // ── 更新我的在線狀態 + 進入即更新 lastReadBy（讓對話列表的未讀立刻歸零） ──
  useEffect(() => {
    if (!convoKey || !liveThread || !myUid || isFirebaseMockMode()) return;
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
  }, [db, convoKey, myUid, liveThread]);

  // ── 打字指示器 ──
  const reportTyping = useCallback(() => {
    if (!convoKey || !liveThread || !myUid || isFirebaseMockMode()) return;
    const convoRef = doc(db, 'conversations', convoKey);
    updateDoc(convoRef, { [`typingUsers.${myUid}`]: serverTimestamp() }).catch(() => {});
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => {
      if (scopeRef.current !== sendScope) return;
      updateDoc(convoRef, { [`typingUsers.${myUid}`]: null }).catch(() => {});
    }, 4000);
  }, [db, convoKey, myUid, liveThread, sendScope]);

  useEffect(() => () => {
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = null;
  }, [sendScope]);

  const handleTextChange = useCallback(
    (t: string) => {
      textEditRevision.current += 1;
      restoredTextDraft.current = null;
      setText(t);
      if (t.trim()) reportTyping();
    },
    [reportTyping],
  );

  const dispatchOutbound = useCallback(
    async (draft: DmOutboundDraft) => {
      const scopeAtStart = `${myUid ?? ''}:${school.id ?? ''}:${draft.conversationId}`;
      const stillHere = () => screenAliveRef.current && scopeRef.current === scopeAtStart;
      const editRevisionAtStart = textEditRevision.current;
      const attemptKey = `${scopeAtStart}:${draft.id}`;
      const attempt = { draft, confirmed: false };
      activeTextAttempts.current.set(attemptKey, attempt);
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
        } else if (peerRoute && peerParam && !liveThread) {
          const controller = new AbortController();
          peerTextRequests.current.add(controller);
          try {
            await sendDmText({
              viewerUid: draft.senderId,
              schoolId: school.id,
              peerUid: peerParam,
              conversationId: draft.conversationId,
              messageId: draft.id,
              content: draft.content,
            }, controller.signal);
            if (!stillHere()) return;
            markPeerThreadExists();
          } finally {
            peerTextRequests.current.delete(controller);
          }
        } else {
          // 既有對話沿用成員寫入流程；封鎖與帳號狀態仍由 Firestore 規則檢查。
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
        if (attempt.confirmed || accountUidRef.current !== draft.senderId) return;
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
        // 還原本次失敗原稿，並保留送出後繼續輸入的新內容。
        if (textEditRevision.current === editRevisionAtStart) {
          restoredTextDraft.current = { scope: scopeAtStart, draft };
          setText(draft.content);
        }
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
      } finally {
        if (activeTextAttempts.current.get(attemptKey) === attempt) {
          activeTextAttempts.current.delete(attemptKey);
        }
      }
    },
    [myUid, peerId, peerParam, peerRoute, liveThread, school.id, markPeerThreadExists],
  );

  const onRetryOutbound = useCallback(
    async (messageId: string) => {
      if (!myUid || !convoKey || !canSend) return;
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
        await dispatchOutbound(draft);
      } finally {
        retryLockRef.current.delete(messageId);
      }
    },
    [convoKey, dispatchOutbound, myUid, outbound, persistOutbound, canSend],
  );

  // ── 發送訊息 ──
  const onSend = async () => {
    if (!myUid || !convoKey || !canSend || !text.trim()) return;
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
      restoredTextDraft.current = null;
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
    restoredTextDraft.current = null;
    setText('');
    setOutbound((prev) => {
      const next = [...prev, draft];
      persistOutbound(next);
      return next;
    });
    try {
      await dispatchOutbound(draft);
    } finally {
      if (screenAliveRef.current && scopeRef.current === sendScope) {
        sendLockRef.current = false;
        setSending(false);
      }
    }
  };

  // ── 搜尋過濾 ──
  const filteredMessages = useMemo(() => {
    if (!displayCurrentScope) return [];
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
  }, [messages, outbound, searchQuery, convoKey, displayCurrentScope]);

  // ── 已讀狀態顯示 ──
  const isRead = useCallback(
    (msg: Msg) => {
      if (msg.senderId !== myUid) return false;
      return (msg.readBy ?? []).some((uid) => uid !== myUid);
    },
    [myUid],
  );

  const hasConfirmedPhoto = (scope: PhotoScope, stagedPath: string) => {
    if (
      scopeRef.current !== sendScope || activeConversationScopeRef.current !== sendScope ||
      confirmedPhotos.current?.scope !== sendScope ||
      scope.viewerUid !== myUid || scope.schoolId !== school.id || scope.conversationId !== convoKey ||
      !photoParts(stagedPath, scope.conversationId, false)
    ) return false;
    const publishedPath = stagedPath.replace(/\/photo\.(jpg|png|webp)$/, '/sent.$1');
    return confirmedPhotos.current.rows.some((row) =>
      row.id === scope.messageId && row.senderId === scope.viewerUid && row.type === 'image' &&
      row.attachmentPath === publishedPath,
    );
  };

  // ── Guard ──
  if (shouldBlockForNoLogin({ uid: auth.user?.uid ?? null, hasUser: !!auth.user })) return <ErrorState title="對話" subtitle="尚未登入" hint="請先登入" />;
  if (!convoKey) return <ErrorState title="對話" subtitle="無法開啟對話" hint="請從對話列表進入" />;
  if (displayCurrentScope && accessError) return <ErrorState title="對話" subtitle={accessError} hint="請從你的對話列表開啟對話" />;

  // ── Render ──

  const photoThread = focused && verifiedPhotoThread === sendScope && canSend && (!peerParam || peerId === peerParam) &&
    myUid && school.id && !isFirebaseMockMode() && !isDemoPersonaUid(myUid) && !isDemoUid(myUid)
    ? { viewerUid: myUid, schoolId: school.id, conversationId: convoKey, ...(peerRoute ? { peerUid: peerParam } : {}) } : null;
  const photoKey = JSON.stringify(photoThread);
  const renderMessage = ({ item, index }: { item: Msg; index: number }) => {
    const mine = item.senderId === myUid;
    const showDate = shouldShowDateHeader(item, filteredMessages[index - 1]);
    const senderName = mine ? '我' : (userNames[item.senderId] ?? item.senderId.slice(0, 8));
    const read = isRead(item);
    const canOpenPhoto = photoThread && !item.recalledAt && item.type === 'image' &&
      /^[A-Za-z0-9_-]{20,64}$/.test(item.id) && photoParts(item.attachmentPath, convoKey);

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
          accessible={canOpenPhoto ? false : undefined}
          delayLongPress={380}
          style={[s.bubble, mine ? s.bubbleMine : s.bubblePeer]}
        >
          {!mine && <Text style={s.senderName}>{senderName}</Text>}
          <View style={[s.msgBox, mine ? s.msgBoxMine : s.msgBoxPeer]}>
            {!item.recalledAt && !!item.storyReplyTo?.storyId && !!item.storyReplyTo.authorUid && (
              <Text style={[s.storyReplyLabel, mine ? s.msgTextMine : s.msgTextPeer]}>
                回覆了限時動態
              </Text>
            )}
            {canOpenPhoto ? <DmPhotoMessage key={JSON.stringify([photoKey, item.id, item.attachmentPath])}
              scope={{ ...photoThread!, messageId: item.id }} path={item.attachmentPath!} /> :
              <Text style={[s.msgText, mine ? s.msgTextMine : s.msgTextPeer]}>
                {item.recalledAt ? '訊息已撤回' : item.content ?? item.text}
              </Text>}
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
            {mine && !item.recalledAt && !item.cacheOnly && (
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
        {peerRoute && !peerPrepared ? (
          <View style={s.center}>
            {prepareError ? (
              <>
                <Text accessibilityRole="alert" style={s.emptyText}>{prepareError}</Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="重新確認對話"
                  style={[s.retryBtn, { marginTop: 16 }]}
                  onPress={() => setPrepareAttempt((value) => value + 1)}
                >
                  <Text style={s.retryBtnText}>重新確認對話</Text>
                </Pressable>
              </>
            ) : (
              <>
                <ActivityIndicator size="large" color={theme.colors.accent} />
                <Text accessibilityLiveRegion="polite" style={s.loadingText}>正在確認對話…</Text>
              </>
            )}
          </View>
        ) : loading ? (
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
                <Text style={s.emptyText}>{peerRoute && !liveThread ? '傳送第一則訊息，或分享一張照片。' : '尚無訊息，開始對話吧'}</Text>
              </View>
            }
          />
        )}

        {/* 打字指示器 */}
        {displayCurrentScope && peerTyping && (
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
        <DmPhotoComposer key={photoKey} thread={photoThread} barStyle={s.inputBar} onSent={peerRoute ? markPeerThreadExists : undefined} hasConfirmedPhoto={hasConfirmedPhoto}>
          <TextInput
            value={displayCurrentScope ? text : ''}
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
            disabled={!text.trim() || sending || !canSend}
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
        </DmPhotoComposer>
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
  storyReplyLabel: { fontSize: 12, fontWeight: '600', marginBottom: 4 },
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
