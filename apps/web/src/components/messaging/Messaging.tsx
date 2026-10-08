'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { findSchoolById } from '@campus/shared/src/schools';
import { useAuth } from '@/components/AuthGuard';
import { SiteShell } from '@/components/SiteShell';
import { getAuth } from '@/lib/firebase';
import {
  watchMessagingSession,
  watchPrivateConversations,
  watchConversationContents,
  watchAccountNotifications,
  sendPrivateMessage,
  newPrivateMessageId,
  markConversationRead,
  markAccountNotificationRead,
  notificationDestination,
  type MessagingSession,
  type MessagingFailure,
  type AccountNotification,
} from '@/lib/privateMessages';
import { isConversationUnread } from '@/lib/conversationAccess';
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
  section = 'conversations',
  children,
}: {
  title: string;
  section?: 'conversations' | 'notifications';
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
        section === 'notifications'
          ? '課程、活動與服務的新消息，都在這裡。'
          : '接著上次的話題，與校園裡的人保持聯繫。'
      }
      schoolName={session ? findSchoolById(session.schoolId)?.name : undefined}
    >
      <div className={styles.stack}>
        <nav className={styles.tabs} aria-label="訊息導覽">
          <Link href="/dms" aria-current={section === 'conversations' ? 'page' : undefined}>
            私人對話
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
            <p>登入校園帳號後，就能查看你的對話與通知。</p>
            <Link
              className={styles.primary}
              href={`/login?returnUrl=${section === 'notifications' ? '%2Fmessages' : '%2Fdms'}`}
            >
              前往登入
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
  const rows = (state.data ?? []).filter((row) =>
    `${row.peerName ?? ''} ${row.preview}`.toLowerCase().includes(search.trim().toLowerCase()),
  );
  return (
    <div className={styles.stack}>
      <div className={styles.toolbar}>
        <label className={styles.field}>
          搜尋對話
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="搜尋姓名或最近訊息"
          />
        </label>
        <button className={styles.button} type="button" onClick={retry}>
          更新對話
        </button>
      </div>
      <p className={styles.muted}>最近更新的 100 個校內對話會顯示在這裡。</p>
      <StateNotice status={state.status} retry={retry} />
      {state.status === 'ready' &&
        (rows.length ? (
          <div className={styles.list}>
            {rows.map((row) => {
              const unread = isConversationUnread({
                uid: session.uid,
                lastMessageAt: row.lastMessageAt,
                lastReadAt: row.lastReadAt,
                lastMessageSenderId: row.lastSenderId,
              });
              return (
                <Link
                  className={styles.conversation}
                  key={row.id}
                  href={`/dms/${encodeURIComponent(row.id)}`}
                >
                  <div className={styles.avatar} aria-hidden="true">
                    {row.peerName?.slice(0, 1) || '對'}
                  </div>
                  <div className={styles.conversationBody}>
                    <div className={styles.row}>
                      <strong>{row.peerName || '私人對話'}</strong>
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
            <h2>{search.trim() ? '沒有符合的對話' : '目前沒有私人對話'}</h2>
            <p>{search.trim() ? '試著調整搜尋文字。' : '已有的本校私人對話會顯示在這裡。'}</p>
            {search.trim() && (
              <button className={styles.button} type="button" onClick={() => setSearch('')}>
                清除搜尋
              </button>
            )}
          </section>
        ))}
    </div>
  );
}
export function PrivateConversationView({
  session,
  conversationId,
}: {
  session: MessagingSession;
  conversationId: string;
}) {
  const subscribe = useCallback(
    (
      receive: Parameters<typeof watchConversationContents>[2],
      fail: Parameters<typeof watchConversationContents>[3],
    ) => watchConversationContents(session, conversationId, receive, fail),
    [session, conversationId],
  );
  const { state, retry } = useFeed(
    `${session.uid}:${session.schoolId}:${conversationId}`,
    subscribe,
  );
  const isCurrent = useCurrent(session);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [reading, setReading] = useState(false);
  const sendLock = useRef(false);
  const readLock = useRef(false);
  const attempt = useRef<{ id: string; body: string } | null>(null);
  const currentConversation = useRef(conversationId);
  useLayoutEffect(() => {
    currentConversation.current = conversationId;
  }, [conversationId]);
  const active = () => isCurrent() && currentConversation.current === conversationId;
  const send = async () => {
    const body = draft.trim();
    if (!body || body.length > 4000 || sendLock.current || state.status !== 'ready' || !active())
      return;
    sendLock.current = true;
    setSending(true);
    setFeedback('');
    try {
      if (!attempt.current || attempt.current.body !== body)
        attempt.current = { id: newPrivateMessageId(conversationId), body };
      await sendPrivateMessage(session, conversationId, attempt.current.id, body);
      if (!active()) return;
      setDraft('');
      attempt.current = null;
    } catch {
      if (active()) setFeedback('尚未確認送出，內容已保留。請重新連線後再試。');
    } finally {
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
  return (
    <div className={styles.stack}>
      <div className={styles.toolbar}>
        <Link href="/dms">返回對話列表</Link>
        <button className={styles.button} type="button" onClick={retry} disabled={sending}>
          重新連線
        </button>
      </div>
      <StateNotice status={state.status} retry={retry} />
      {state.status === 'ready' && state.data && (
        <>
          <div className={styles.row}>
            <h2>{state.data.conversation.peerName || '私人對話'}</h2>
            <button className={styles.button} type="button" onClick={read} disabled={reading}>
              {reading ? '更新中…' : '標記已讀'}
            </button>
          </div>
          <p className={styles.muted}>顯示最近 100 則訊息。</p>
          <ol className={styles.messages} aria-label="對話內容">
            {state.data.messages.length ? (
              state.data.messages.map((row) => (
                <li
                  key={row.id}
                  className={row.senderId === session.uid ? styles.mine : styles.theirs}
                >
                  <p>
                    {row.recalled
                      ? '訊息已收回'
                      : row.type === 'text' || row.type === 'reply'
                        ? row.content
                        : '此類型訊息請在 App 中查看。'}
                  </p>
                  <time dateTime={row.createdAt ?? undefined}>{time(row.createdAt)}</time>
                </li>
              ))
            ) : (
              <li className={styles.empty}>目前還沒有訊息。</li>
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
            value={draft}
            maxLength={4000}
            rows={3}
            disabled={sending || state.status !== 'ready'}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="輸入訊息"
          />
        </label>
        <div className={styles.row}>
          <small className={styles.muted}>{draft.length} / 4000</small>
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
  const [onlyUnread, setOnlyUnread] = useState(false);
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
  const rows = (state.data?.notifications ?? []).filter(
    (notification) => !onlyUnread || !notification.read,
  );
  return (
    <div className={styles.stack}>
      <div className={styles.toolbar}>
        <label className={styles.checkbox}>
          <input
            type="checkbox"
            checked={onlyUnread}
            onChange={(event) => setOnlyUnread(event.target.checked)}
          />
          只看未讀
        </label>
        <button className={styles.button} type="button" onClick={retry}>
          更新通知
        </button>
      </div>
      <p className={styles.muted}>
        查看目前學校與你的帳號收到的近期通知。開啟通知中的連結，可以前往處理。
      </p>
      <StateNotice status={state.status} retry={retry} />
      {error && (
        <p role="alert" className={styles.feedback}>
          {error}
        </p>
      )}
      {state.status === 'ready' && (
        <>
          {!!state.data?.unscopedCount && (
            <p className={styles.muted}>部分通知尚未標示學校，未列入本頁。</p>
          )}
          {rows.length ? (
            <div className={styles.list}>
              {rows.map((notification) => {
                const target = notificationDestination(notification);
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
                    <p>{notification.body}</p>
                    <time className={styles.muted} dateTime={notification.createdAt ?? undefined}>
                      {time(notification.createdAt)}
                    </time>
                    <div className={styles.actions}>
                      {target && (
                        <Link className={styles.button} href={target.href}>
                          {target.label}
                        </Link>
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
              <h2>{onlyUnread ? '目前沒有未讀通知' : '目前沒有本校通知'}</h2>
              <p>
                {onlyUnread
                  ? '你可以切回全部通知，查看之前收到的消息。'
                  : '收到課程、活動或服務的新消息時，會顯示在這裡。'}
              </p>
              {onlyUnread && (
                <button
                  className={styles.button}
                  type="button"
                  onClick={() => setOnlyUnread(false)}
                >
                  查看全部通知
                </button>
              )}
            </section>
          )}
        </>
      )}
    </div>
  );
}
