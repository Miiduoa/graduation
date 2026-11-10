'use client';

import {
  notificationListFilter,
  notificationTypeLabel,
  notificationCampusLabel,
} from '@campus/shared/src/notificationListFilter';


import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import Link from 'next/link';
import { findSchoolById } from '@campus/shared/src/schools';
import { useAuth } from '@/components/AuthGuard';
import { SiteShell } from '@/components/SiteShell';
import { getAuth } from '@/lib/firebase';
import {
  DEFAULT_NOTIFICATION_FILTERS,
  NOTIFICATION_CATEGORIES,
  filterNotifications,
  readNotificationListFilters,
  type NotificationListFilters,
} from '@/lib/notificationListState';
import {
  watchMessagingSession,
  watchPrivateConversations,
  watchConversationContents,
  watchNewPrivateConversation,
  watchAccountNotifications,
  sendPrivateMessage,
  sendPreparedPrivateMessage,
  newPrivateMessageId,
  markConversationRead,
  togglePrivateMessageReaction,
  markAccountNotificationRead,
  notificationDestination,
  type MessagingSession,
  type MessagingFailure,
  type AccountNotification,
  type PreparedPrivateConversation,
} from '@/lib/privateMessages';
import { isConversationUnread } from '@/lib/conversationAccess';
import { DmPhotoComposer, DmPhotoMessage } from './DmPhotos';
import styles from './messaging.module.css';

type FeedState<T> = {
  scope: string;
  attempt: number;
  status: 'loading' | 'ready' | MessagingFailure;
  data?: T;
};
function useFeed<T>(
  scope: string,
  subscribe: (receive: (value: T) => void, fail: (reason: MessagingFailure) => void) => () => void,
) {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<FeedState<T>>({ scope, attempt, status: 'loading' });
  useEffect(() => {
    let active = true;
    let stop: (() => void) | undefined;
    try {
      stop = subscribe(
        (data) => {
          if (active) setState({ scope, attempt, status: 'ready', data });
        },
        (status) => {
          if (active) setState({ scope, attempt, status });
        },
      );
    } catch {
      queueMicrotask(() => {
        if (active) setState({ scope, attempt, status: 'unavailable' });
      });
    }
    return () => {
      active = false;
      stop?.();
    };
  }, [scope, attempt, subscribe]);
  return {
    state:
      state.scope === scope && state.attempt === attempt
        ? state
        : { scope, attempt, status: 'loading' as const },
    retry: () => setAttempt((value) => value + 1),
  };
}
function StateNotice({ status, retry }: { status: string; retry: () => void }) {
  if (status === 'ready') return null;
  return (
    <section
      className={styles.notice}
      role={status === 'loading' || status === 'stale' ? 'status' : 'alert'}
    >
      <h2>
        {status === 'loading'
          ? '正在讀取'
          : status === 'permission'
            ? '目前無法開啟這些資料'
            : status === 'stale'
              ? '正在確認最新資料'
              : '暫時無法連線'}
      </h2>
      <p>
        {status === 'permission'
          ? '請確認登入帳號、所屬學校與對話權限。'
          : status === 'stale'
            ? '尚未取得伺服器確認，請檢查網路後重試。'
            : status === 'loading'
              ? '正在向校園服務取得資料。'
              : '資料沒有成功載入，請稍後重試。'}
      </p>
      {status !== 'loading' && (
        <button className={styles.button} type="button" onClick={retry}>
          重新連線
        </button>
      )}
    </section>
  );
}
export function MessagingShell({
  title,
  subtitle,
  section = 'conversations',
  returnUrl,
  children,
}: {
  title: string;
  subtitle?: string;
  section?: 'conversations' | 'notifications';
  returnUrl?: string;
  children: (session: MessagingSession) => ReactNode;
}) {
  const { user, loading } = useAuth();
  const uid = !loading ? (user?.uid ?? '') : '';
  const subscribe = useCallback(
    (receive: (session: MessagingSession) => void, fail: (reason: MessagingFailure) => void) => {
      if (!uid) return () => {};
      return watchMessagingSession(uid, receive, fail);
    },
    [uid],
  );
  const { state, retry } = useFeed(uid, subscribe);
  const session = uid && state.status === 'ready' ? state.data : undefined;
  return (
    <SiteShell
      title={title}
      subtitle={
        subtitle ?? (section === 'notifications'
          ? '課程、活動與服務的新消息，都在這裡。'
          : '接著上次的話題，與校園裡的人保持聯繫。')
      }
      schoolName={session ? findSchoolById(session.schoolId)?.name : undefined}
    >
      <div className={styles.stack}>
        <nav className={styles.tabs} aria-label="訊息導覽">
          <Link href="/dms" aria-current={section === 'conversations' ? 'page' : undefined}>
            訊息
          </Link>
          <Link href="/messages" aria-current={section === 'notifications' ? 'page' : undefined}>
            通知
          </Link>
        </nav>
        {loading ? (
          <StateNotice status="loading" retry={retry} />
        ) : !uid ? (
          <section className={styles.notice}>
            <h2>登入後查看訊息</h2>
            <p>校內訊息只提供已確認學校身分、且具備對話或通知存取資格的成員。Google 平台登入不會自動連結校內帳號或讀取私人對話。</p>
            <Link
              className={styles.primary}
              href={`/login?reconnect=school&returnUrl=${encodeURIComponent(returnUrl ?? (section === 'notifications' ? '/messages' : '/dms'))}`}
            >
              連結學校帳號
            </Link>
          </section>
        ) : session ? (
          <div key={`${session.uid}:${session.schoolId}`}>{children(session)}</div>
        ) : (
          <StateNotice status={state.status} retry={retry} />
        )}
      </div>
    </SiteShell>
  );
}
function time(value: string | null) {
  return value
    ? new Intl.DateTimeFormat('zh-TW', {
        month: 'numeric',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      }).format(new Date(value))
    : '時間未提供';
}
function useCurrent(session: MessagingSession) {
  const active = useRef(true);
  const scope = `${session.uid}:${session.schoolId}`;
  const currentScope = useRef(scope);
  useLayoutEffect(() => {
    currentScope.current = scope;
    active.current = true;
    return () => {
      active.current = false;
    };
  }, [scope]);
  return () =>
    active.current && currentScope.current === scope && getAuth()?.currentUser?.uid === session.uid;
}
export function PrivateConversationList({ session }: { session: MessagingSession }) {
  const subscribe = useCallback(
    (
      receive: Parameters<typeof watchPrivateConversations>[1],
      fail: Parameters<typeof watchPrivateConversations>[2],
    ) => watchPrivateConversations(session, receive, fail),
    [session],
  );
  const { state, retry } = useFeed(`${session.uid}:${session.schoolId}`, subscribe);
  const [search, setSearch] = useState('');
  const [onlyUnread, setOnlyUnread] = useState(false);
  const conversations = state.status === 'ready' ? (state.data ?? []) : [];
  const isUnread = (row: (typeof conversations)[number]) =>
    isConversationUnread({
      uid: session.uid,
      lastMessageAt: row.lastMessageAt,
      lastReadAt: row.lastReadAt,
      lastMessageSenderId: row.lastSenderId,
    });
  const unreadCount = conversations.filter(isUnread).length;
  const query = search.trim().toLocaleLowerCase();
  const rows = conversations.filter(
    (row) =>
      (!onlyUnread || isUnread(row)) &&
      (!query || `${row.peerName ?? ''} ${row.preview}`.toLocaleLowerCase().includes(query)),
  );

  return (
    <div className={styles.stack}>
      <div className={styles.inboxHeading}>
        <div>
          <p className={styles.overline}>校內私訊</p>
          <h2>我的對話</h2>
          <p className={styles.muted}>只有目前帳號所屬學校、且你是成員的對話會出現在這裡。</p>
        </div>
        <div className={styles.inboxActions}>
          <Link className={styles.primary} href="/dms/new">
            新增訊息
          </Link>
          <Link className={styles.button} href="/friends">
            尋找同學
          </Link>
          <Link className={styles.button} href="/groups">
            我的群組
          </Link>
        </div>
      </div>
      <div className={styles.inboxToolbar}>
        <label className={styles.field}>
          搜尋對話
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="姓名、最近訊息"
          />
        </label>
        <div className={styles.filterRow} role="group" aria-label="對話篩選">
          <button
            type="button"
            className={styles.filterButton}
            aria-pressed={!onlyUnread}
            onClick={() => setOnlyUnread(false)}
          >
            全部 <span>{conversations.length}</span>
          </button>
          <button
            type="button"
            className={styles.filterButton}
            aria-pressed={onlyUnread}
            onClick={() => setOnlyUnread(true)}
          >
            未讀 <span>{unreadCount}</span>
          </button>
        </div>
        <button className={styles.button} type="button" onClick={retry}>
          更新對話
        </button>
      </div>
      <StateNotice status={state.status} retry={retry} />
      {state.status === 'ready' &&
        (rows.length ? (
          <div className={styles.list} aria-label="對話列表">
            <p className={styles.resultCount} role="status">
              {onlyUnread ? `尚未讀取的 ${rows.length} 個對話` : `顯示 ${rows.length} 個對話`}
            </p>
            {rows.map((row) => {
              const unread = isUnread(row);
              return (
                <Link
                  className={styles.conversation}
                  data-unread={unread}
                  key={row.id}
                  href={`/dms/${encodeURIComponent(row.id)}`}
                >
                  <div className={styles.avatar} aria-hidden="true">
                    {row.peerName?.slice(0, 1) || '訊'}
                  </div>
                  <div className={styles.conversationBody}>
                    <div className={styles.row}>
                      <strong>{row.peerName || '對話'}</strong>
                      {unread && <span className={styles.badge}>未讀</span>}
                    </div>
                    <p>{row.preview || '尚無訊息內容'}</p>
                  </div>
                  <time className={styles.muted} dateTime={row.lastMessageAt ?? undefined}>
                    {time(row.lastMessageAt)}
                  </time>
                </Link>
              );
            })}
          </div>
        ) : (
          <section className={styles.notice}>
            <h2>
              {search.trim()
                ? '沒有符合的對話'
                : onlyUnread
                  ? '所有對話都已讀'
                  : '目前沒有訊息'}
            </h2>
            <p>
              {search.trim()
                ? '可以試著改用對方姓名，或清除搜尋重新查看。'
                : onlyUnread
                  ? '有新訊息時會出現在這個分類。'
                  : '選一位同校同學，傳送文字或照片開始聊天。'}
            </p>
            <div className={styles.actions}>
              {search.trim() && (
                <button className={styles.button} type="button" onClick={() => setSearch('')}>
                  清除搜尋
                </button>
              )}
              {onlyUnread && (
                <button className={styles.button} type="button" onClick={() => setOnlyUnread(false)}>
                  查看全部對話
                </button>
              )}
              {!search.trim() && !onlyUnread && (
                <Link className={styles.primary} href="/dms/new">
                  新增訊息
                </Link>
              )}
            </div>
          </section>
        ))}
    </div>
  );
}
export function PrivateConversationView({
  session,
  conversationId,
  prepared,
}: {
  session: MessagingSession;
  conversationId: string;
  prepared?: PreparedPrivateConversation;
}) {
  const viewScope = JSON.stringify([session.uid, session.schoolId, conversationId, prepared?.peerUid]);
  const attempt = useRef<{ scope: string; id: string; body: string; confirmed: boolean } | null>(null);
  const [acknowledgedScope, setAcknowledgedScope] = useState<string | null>(null);
  const established = !prepared || prepared.exists || acknowledgedScope === viewScope;
  const subscribe = useCallback(
    (
      receive: Parameters<typeof watchConversationContents>[2],
      fail: Parameters<typeof watchConversationContents>[3],
    ) => {
      const received: typeof receive = (contents) => {
        const pending = attempt.current;
        if (pending?.scope === viewScope && contents.messages.some((message) =>
          message.id === pending.id && message.senderId === session.uid &&
          message.type === 'text' && message.content === pending.body,
        )) pending.confirmed = true;
        receive(contents);
      };
      return established
        ? watchConversationContents(session, conversationId, received, fail)
        : watchNewPrivateConversation(session, prepared!, received, fail);
    },
    [session, conversationId, prepared, established, viewScope],
  );
  const { state, retry } = useFeed(
    viewScope,
    subscribe,
  );
  const isCurrent = useCurrent(session);
  const [draftState, setDraftState] = useState<{ scope: string; text: string }>({ scope: '', text: '' });
  const [messageSearch, setMessageSearch] = useState('');
  const [sending, setSending] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [reading, setReading] = useState(false);
  const [reacting, setReacting] = useState<string | null>(null);
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);
  const messageListRef = useRef<HTMLOListElement>(null);
  const textInput = useRef<HTMLTextAreaElement>(null);
  const followsLatestRef = useRef(true);
  const lastVisibleRef = useRef<{ scope: string; messageId: string } | null>(null);
  const sendLock = useRef(false);
  const readLock = useRef(false);
  const reactionLock = useRef(false);
  const sendRequest = useRef<AbortController | null>(null);
  const currentConversation = useRef(viewScope);
  useLayoutEffect(() => {
    currentConversation.current = viewScope;
    return () => sendRequest.current?.abort();
  }, [viewScope]);
  const active = () => isCurrent() && currentConversation.current === viewScope;
  const photoScope = { viewerUid: session.uid, schoolId: session.schoolId, conversationId };
  useEffect(() => {
    if (prepared && state.status === 'ready') textInput.current?.focus();
  }, [prepared, state.status]);
  const lastMessageId =
    state.status === 'ready' ? state.data?.messages.at(-1)?.id ?? '' : '';
  useLayoutEffect(() => {
    const list = messageListRef.current;
    if (!list || state.status !== 'ready' || !state.data) return;
    const scope = `${session.uid}:${session.schoolId}:${conversationId}`;
    const previous = lastVisibleRef.current;
    const firstLoad = previous?.scope !== scope;
    const newMessage = !firstLoad && previous?.messageId !== lastMessageId;
    lastVisibleRef.current = { scope, messageId: lastMessageId };
    // New conversations start at the latest message. Incoming messages only
    // move the viewport if the reader was already following the bottom.
    if (firstLoad || (newMessage && followsLatestRef.current && !messageSearch.trim())) {
      list.scrollTop = list.scrollHeight;
      followsLatestRef.current = true;
      setShowJumpToLatest(false);
    } else if (newMessage && !messageSearch.trim()) {
      setShowJumpToLatest(true);
    }
  }, [
    session.uid,
    session.schoolId,
    conversationId,
    state.status,
    state.data,
    lastMessageId,
    messageSearch,
  ]);
  const jumpToLatest = () => {
    const list = messageListRef.current;
    if (!list) return;
    list.scrollTop = list.scrollHeight;
    followsLatestRef.current = true;
    setShowJumpToLatest(false);
  };
  const confirmedDelivery = () => {
    if (!active()) return;
    if (prepared) setAcknowledgedScope(viewScope);
    jumpToLatest();
  };
  const draftKey = `campus-one:dm-draft:${session.uid}:${session.schoolId}:${conversationId}`;
  // Keep draft state bound to its conversation: effects for a newly selected
  // conversation must never persist text from the previous account or thread.
  const draft = draftState.scope === draftKey ? draftState.text : '';
  const setDraft = (value: string) => setDraftState({ scope: draftKey, text: value });
  useEffect(() => {
    let saved = '';
    try {
      saved = sessionStorage.getItem(draftKey)?.slice(0, 4000) ?? '';
    } catch {
      // Session storage is unavailable in some private browsing contexts.
    }
    setDraftState({ scope: draftKey, text: saved });
  }, [draftKey]);
  useEffect(() => {
    if (draftState.scope !== draftKey) return;
    try {
      if (draftState.text) sessionStorage.setItem(draftKey, draftState.text);
      else sessionStorage.removeItem(draftKey);
    } catch {
      // Private browsing can block storage; the live draft remains editable.
    }
  }, [draftKey, draftState.scope, draftState.text]);
  useLayoutEffect(() => {
    const submission = attempt.current;
    if (
      sending || state.status !== 'ready' || submission?.scope !== viewScope ||
      !submission.confirmed || getAuth()?.currentUser?.uid !== session.uid
    ) return;
    setDraftState((current) => current.scope === draftKey && current.text.trim() === submission.body
      ? { scope: draftKey, text: '' } : current);
    setFeedback('');
    attempt.current = null;
    if (prepared) setAcknowledgedScope(viewScope);
  }, [draftKey, prepared, sending, session.uid, state, viewScope]);
  const send = async () => {
    const body = draft.trim();
    if (!body || body.length > 4000 || sendLock.current || state.status !== 'ready' || !active())
      return;
    sendLock.current = true;
    const controller = new AbortController();
    sendRequest.current = controller;
    setSending(true);
    setFeedback('');
    try {
      if (!attempt.current || attempt.current.scope !== viewScope || attempt.current.body !== body)
        attempt.current = { scope: viewScope, id: newPrivateMessageId(conversationId), body, confirmed: false };
      const submission = attempt.current;
      await (prepared
        ? sendPreparedPrivateMessage(session, prepared, submission.id, body, controller.signal)
        : sendPrivateMessage(session, conversationId, submission.id, body)
      ).catch((error) => {
        if (!submission.confirmed) throw error;
      });
      if (!active() || controller.signal.aborted) return;
      setDraft('');
      attempt.current = null;
      confirmedDelivery();
    } catch {
      if (active()) setFeedback('尚未確認送出，內容已保留。請重新連線後再試。');
    } finally {
      if (sendRequest.current === controller) sendRequest.current = null;
      sendLock.current = false;
      if (active()) setSending(false);
    }
  };
  const read = async () => {
    if (state.status !== 'ready' || !state.data || readLock.current || !active()) return;
    readLock.current = true;
    setReading(true);
    setFeedback('');
    try {
      await markConversationRead(
        session,
        conversationId,
        state.data.messages.map((row) => row.id),
      );
    } catch {
      if (active()) setFeedback('未能更新已讀狀態，請稍後再試。');
    } finally {
      readLock.current = false;
      if (active()) setReading(false);
    }
  };
  const react = async (messageId: string, emoji: '👍' | '❤️') => {
    if (reactionLock.current || state.status !== 'ready' || !active()) return;
    reactionLock.current = true;
    setReacting(`${messageId}:${emoji}`);
    setFeedback('');
    try {
      await togglePrivateMessageReaction(session, conversationId, messageId, emoji);
    } catch {
      if (active()) setFeedback('無法更新表情回應，請確認網路後重試。');
    } finally {
      reactionLock.current = false;
      if (active()) setReacting(null);
    }
  };
  const copyMessage = async (messageId: string, content: string) => {
    if (!active()) return;
    setFeedback('');
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(content);
      if (active()) setCopiedMessageId(messageId);
    } catch {
      if (active()) setFeedback('無法自動複製訊息，請選取文字後手動複製。');
    }
  };
  const visibleMessages = (state.data?.messages ?? []).filter(
    (row) =>
      !messageSearch.trim() ||
      (!row.recalled &&
        row.content.toLocaleLowerCase().includes(messageSearch.trim().toLocaleLowerCase())),
  );
  return (
    <div className={styles.stack}>
      <div className={styles.toolbar}>
        <Link href="/dms">返回對話列表</Link>
        {prepared && <Link href="/dms/new">更換收件人</Link>}
        <button className={styles.button} type="button" onClick={retry} disabled={sending}>
          重新連線
        </button>
      </div>
      <StateNotice status={state.status} retry={retry} />
      {state.status === 'ready' && state.data && (
        <>
          <div className={styles.chatHeader}>
            <div>
              <p className={styles.overline}>{state.data.exists === false ? '開始對話' : '對話內容'}</p>
              <h2>{state.data.conversation.peerName || '同學'}</h2>
              <p className={styles.muted}>
                {state.data.exists === false
                  ? '傳送第一則訊息，向同學打聲招呼。'
                  : '顯示最近 100 則訊息；搜尋僅查詢目前載入的內容。'}
              </p>
            </div>
            {state.data.exists !== false && (isConversationUnread({
              uid: session.uid,
              lastMessageAt: state.data.conversation.lastMessageAt,
              lastReadAt: state.data.conversation.lastReadAt,
              lastMessageSenderId: state.data.conversation.lastSenderId,
            }) ? (
              <button className={styles.button} type="button" onClick={read} disabled={reading}>
                {reading ? '更新中…' : '標記已讀'}
              </button>
            ) : (
              <span className={styles.readIndicator}>對話已讀</span>
            ))}
          </div>
          {state.data.exists !== false && <div className={styles.toolbar}>
            <label className={styles.field}>
              搜尋此對話
              <input
                type="search"
                value={messageSearch}
                onChange={(event) => setMessageSearch(event.target.value)}
                placeholder="搜尋最近 100 則訊息"
              />
            </label>
            {messageSearch && (
              <button className={styles.button} type="button" onClick={() => setMessageSearch('')}>
                清除搜尋
              </button>
            )}
          </div>}
          {showJumpToLatest && !messageSearch.trim() && (
            <div className={styles.jumpRow}>
              <button className={styles.jumpButton} type="button" onClick={jumpToLatest}>
                跳到最新訊息
              </button>
            </div>
          )}
          <ol
            ref={messageListRef}
            className={styles.messages}
            role="log"
            aria-label="對話內容"
            aria-live="polite"
            aria-relevant="additions"
            onScroll={(event) => {
              const list = event.currentTarget;
              const following = list.scrollHeight - list.scrollTop - list.clientHeight < 96;
              followsLatestRef.current = following;
              setShowJumpToLatest(!following);
            }}
          >
            {visibleMessages.length ? (
              visibleMessages.map((row) => (
                <li
                  key={row.id}
                  className={row.senderId === session.uid ? styles.mine : styles.theirs}
                >
                  {!row.recalled && row.isStoryReply && (
                    <small className={styles.messageMeta}>回覆了限時動態</small>
                  )}
                  {!row.recalled && row.type === 'image' && row.attachmentPath ? (
                    <DmPhotoMessage
                      key={JSON.stringify([session.uid, session.schoolId, conversationId, row.id, row.attachmentPath])}
                      scope={{ ...photoScope, messageId: row.id }}
                      path={row.attachmentPath}
                    />
                  ) : (
                    <p>
                      {row.recalled
                        ? '訊息已收回'
                        : row.type === 'text' || row.type === 'reply'
                          ? row.content
                          : '此類型訊息請在 App 中查看。'}
                    </p>
                  )}
                  <div className={styles.messageMeta}>
                    <time dateTime={row.createdAt ?? undefined}>{time(row.createdAt)}</time>
                    {!row.recalled && (row.type === 'text' || row.type === 'reply') && (
                      <button
                        className={styles.copyMessage}
                        type="button"
                        onClick={() => void copyMessage(row.id, row.content)}
                      >
                        {copiedMessageId === row.id ? '已複製' : '複製'}
                      </button>
                    )}
                  </div>
                  {!row.recalled && (row.type === 'text' || row.type === 'reply') && (
                    <div className={styles.messageReactions} aria-label="訊息表情回應">
                      {(['👍', '❤️'] as const).map((emoji) => {
                        const members = row.reactions?.[emoji] ?? [];
                        const mine = members.includes(session.uid);
                        return (
                          <button
                            key={emoji}
                            type="button"
                            aria-label={`${emoji === '👍' ? '讚' : '愛心'}，目前 ${members.length} 人回應`}
                            aria-pressed={mine}
                            className={styles.reactionButton}
                            disabled={reacting !== null}
                            onClick={() => void react(row.id, emoji)}
                          >
                            {emoji}{members.length ? ` ${members.length}` : ''}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </li>
              ))
            ) : (
              <li className={styles.empty}>
                {messageSearch.trim()
                  ? '找不到符合的訊息，試著調整關鍵字。'
                  : state.data.exists === false
                    ? '傳送文字或照片，開始這段對話。'
                    : '目前還沒有訊息。'}
              </li>
            )}
          </ol>
        </>
      )}
      {feedback && (
        <p className={styles.feedback} role="alert">
          {feedback}
        </p>
      )}
      <form
        className={styles.composer}
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
      >
        <label className={styles.field}>
          訊息內容
          <textarea
            ref={textInput}
            value={draft}
            maxLength={4000}
            rows={3}
            disabled={sending || state.status !== 'ready'}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (!event.nativeEvent.isComposing && (event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                event.preventDefault();
                void send();
              }
            }}
            placeholder="輸入訊息，按 Cmd / Ctrl + Enter 傳送"
          />
        </label>
        {state.status !== 'permission' && (
          <DmPhotoComposer
            key={draftKey}
            scope={prepared ? { ...photoScope, peerUid: prepared.peerUid } : photoScope}
            ready={state.status === 'ready'}
            confirmedPhotos={state.status === 'ready' ? state.data?.messages.filter((message) =>
              message.senderId === session.uid && message.type === 'image',
            ) : undefined}
            onSent={confirmedDelivery}
          />
        )}
        <div className={styles.row}>
          <small className={styles.muted}>
            {draft.length} / 4000 · 草稿保留在目前瀏覽器分頁
          </small>
          <button
            className={styles.primary}
            type="submit"
            disabled={sending || state.status !== 'ready' || !draft.trim()}
          >
            {sending ? '傳送中…' : '傳送訊息'}
          </button>
        </div>
      </form>
    </div>
  );
}
export function PrivateNotifications({ session }: { session: MessagingSession }) {
  const subscribe = useCallback(
    (
      receive: Parameters<typeof watchAccountNotifications>[1],
      fail: Parameters<typeof watchAccountNotifications>[2],
    ) => watchAccountNotifications(session, receive, fail),
    [session],
  );
  const { state, retry } = useFeed(`${session.uid}:${session.schoolId}`, subscribe);
  const isCurrent = useCurrent(session);
  const filterKey = `campus-one:notification-filters:${encodeURIComponent(session.uid)}:${encodeURIComponent(session.schoolId)}`;
  const [filterState, setFilterState] = useState({
    scope: '',
    filters: DEFAULT_NOTIFICATION_FILTERS,
  });
  const savedFilters = useSyncExternalStore(
    useCallback((onChange: () => void) => {
      window.addEventListener('storage', onChange);
      return () => window.removeEventListener('storage', onChange);
    }, []),
    useCallback(() => {
      try {
        return sessionStorage.getItem(filterKey) ?? '';
      } catch {
        return '';
      }
    }, [filterKey]),
    () => '',
  );
  let filters = DEFAULT_NOTIFICATION_FILTERS;
  if (filterState.scope === filterKey) {
    filters = filterState.filters;
  } else {
    try {
      filters = readNotificationListFilters(JSON.parse(savedFilters || 'null'));
    } catch {
      // Ignore malformed saved filters.
    }
  }
  const setFilters = (value: NotificationListFilters) => {
    setFilterState({ scope: filterKey, filters: value });
    try {
      sessionStorage.setItem(filterKey, JSON.stringify(value));
    } catch {
      // Keep the current controls usable without browser storage.
    }
  };
  const searchRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState('');
  const lock = useRef(false);
  const mark = async (notification: AccountNotification) => {
    if (!isCurrent() || lock.current || state.status !== 'ready') return;
    lock.current = true;
    setPending(`${notification.source}:${notification.id}`);
    setError('');
    try {
      await markAccountNotificationRead(session, notification);
    } catch {
      if (isCurrent()) setError('未能更新已讀狀態，請稍後再試。');
    } finally {
      lock.current = false;
      if (isCurrent()) setPending(null);
    }
  };
  const rows = filterNotifications(state.data?.notifications ?? [], filters);
  const hasSearchFilters = !!filters.q.trim() || filters.category !== 'all';
  const unreadCount = notificationListFilter(state.data?.notifications ?? [], 'unread').length;
  return (
    <div className={styles.stack}>
      <div className={styles.inboxToolbar}>
        <label className={styles.field}>
          搜尋通知
          <input
            ref={searchRef}
            type="search"
            value={filters.q}
            maxLength={200}
            placeholder="搜尋標題、內容或通知類型"
            onChange={(event) => setFilters({ ...filters, q: event.target.value })}
          />
        </label>
        <label className={styles.field}>
          通知類型
          <select
            value={filters.category}
            onChange={(event) =>
              setFilters(readNotificationListFilters({ ...filters, category: event.target.value }))
            }
          >
            {NOTIFICATION_CATEGORIES.map((category) => (
              <option key={category.value} value={category.value}>
                {category.label}
              </option>
            ))}
          </select>
        </label>
        {filters.q && (
          <button
            className={styles.button}
            type="button"
            onClick={() => {
              setFilters({ ...filters, q: '' });
              searchRef.current?.focus();
            }}
          >
            清除搜尋
          </button>
        )}
      </div>
      <div className={styles.toolbar}>
        <label className={styles.checkbox}>
          <input
            type="checkbox"
            checked={filters.onlyUnread}
            onChange={(event) => setFilters({ ...filters, onlyUnread: event.target.checked })}
          />
          只看未讀
        </label>
        <button className={styles.button} type="button" onClick={retry}>
          更新通知
        </button>
      </div>
      <p className={styles.muted}>
        搜尋與篩選涵蓋已載入的近期通知，每個來源最多 50 則。開啟連結後，請在對應服務確認處理結果。
      </p>
      <StateNotice status={state.status} retry={retry} />
      {error && (
        <p role="alert" className={styles.feedback}>
          {error}
        </p>
      )}
      {state.status === 'ready' && (
        <>
          <p role="status" className={styles.muted}>
            顯示 {rows.length} / {state.data?.notifications.length ?? 0} 則通知
            {' · '}
            <span>{unreadCount} 則未讀（只含已載入）</span>
          </p>
          {!!state.data?.unscopedCount && (
            <p className={styles.muted}>部分通知尚未標示學校，未列入本頁。</p>
          )}
          {rows.length ? (
            <div className={styles.list}>
              {rows.map((notification) => {
                const target = notificationDestination(notification);
                const DestinationLink = notification.type === 'live_session' ? 'a' : Link;
                const id = `${notification.source}:${notification.id}`;
                return (
                  <article
                    key={id}
                    className={styles.notification}
                    data-unread={!notification.read}
                  >
                    <div className={styles.row}>
                      <h2>{notification.title || '通知'}</h2>
                      {!notification.read && <span className={styles.badge}>未讀</span>}
                    </div>
                    <p className={styles.muted}>
                      {notificationTypeLabel(notification.type)} ·{' '}
                      {notificationCampusLabel(notification.data)}
                    </p>
                    <p>{notification.body}</p>
                    <time className={styles.muted} dateTime={notification.createdAt ?? undefined}>
                      {time(notification.createdAt)}
                    </time>
                    <div className={styles.actions}>
                      {target && (
                        <DestinationLink className={styles.button} href={target.href}>
                          {target.label}
                        </DestinationLink>
                      )}
                      {!target && (
                        <p className={styles.muted}>這則通知目前沒有可開啟的服務連結。</p>
                      )}
                      {!notification.read && (
                        <button
                          className={styles.button}
                          type="button"
                          disabled={pending !== null}
                          onClick={() => void mark(notification)}
                        >
                          {pending === id ? '更新中…' : '標記已讀'}
                        </button>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <section className={styles.notice}>
              <h2>
                {hasSearchFilters
                  ? '找不到符合的通知'
                  : filters.onlyUnread
                    ? '目前沒有未讀通知'
                    : '目前沒有本校通知'}
              </h2>
              <p>
                {hasSearchFilters
                  ? '試著調整關鍵字或通知類型，也可以清除篩選查看已載入的通知。'
                  : filters.onlyUnread
                    ? '你可以切回全部通知，查看之前收到的消息。'
                    : '收到課程、活動或服務的新消息時，會顯示在這裡。'}
              </p>
              {(hasSearchFilters || filters.onlyUnread) && (
                <button
                  className={styles.button}
                  type="button"
                  onClick={() => {
                    setFilters(DEFAULT_NOTIFICATION_FILTERS);
                    searchRef.current?.focus();
                  }}
                >
                  {hasSearchFilters ? '清除篩選' : '查看全部通知'}
                </button>
              )}
            </section>
          )}
        </>
      )}
    </div>
  );
}
