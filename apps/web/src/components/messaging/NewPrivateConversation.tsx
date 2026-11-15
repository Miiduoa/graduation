'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  findPrivateMessageRecipients,
  MessagingError,
  preparePrivateConversation,
  type MessagingSession,
  type PreparedPrivateConversation,
  type PrivateMessageRecipient,
} from '@/lib/privateMessages';
import { PrivateConversationView } from './Messaging';
import styles from './messaging.module.css';

export function NewPrivateConversation({ session, peerUid }: {
  session: MessagingSession;
  peerUid?: string;
}) {
  const scope = JSON.stringify([session.uid, session.schoolId, peerUid]);
  return peerUid
    ? <PreparedConversation key={scope} session={session} peerUid={peerUid} />
    : <RecipientSearch key={scope} session={session} />;
}

function RecipientSearch({ session }: { session: MessagingSession }) {
  const [name, setName] = useState('');
  const [state, setState] = useState<{
    status: 'idle' | 'loading' | 'ready' | 'error';
    recipients?: PrivateMessageRecipient[];
  }>({ status: 'idle' });
  const input = useRef<HTMLInputElement>(null);
  const request = useRef<AbortController | null>(null);
  useEffect(() => {
    input.current?.focus();
    return () => request.current?.abort();
  }, []);

  async function search() {
    if (!name.trim() || request.current) return;
    const controller = new AbortController();
    request.current = controller;
    input.current?.focus();
    setState({ status: 'loading' });
    try {
      const recipients = await findPrivateMessageRecipients(session, name, controller.signal);
      if (!controller.signal.aborted) setState({ status: 'ready', recipients });
    } catch {
      if (!controller.signal.aborted) setState({ status: 'error' });
    } finally {
      if (request.current === controller) request.current = null;
    }
  }

  return (
    <div className={styles.stack}>
      <div className={styles.toolbar}><Link href="/dms">返回對話列表</Link></div>
      <section className={styles.notice}>
        <h2>選擇收件人</h2>
        <p>搜尋同校同學的姓名，選好後開始聊天。</p>
        <form className={styles.recipientSearch} onSubmit={(event) => {
          event.preventDefault();
          void search();
        }}>
          <label className={styles.field}>
            同學姓名
            <input
              ref={input}
              type="search"
              autoComplete="off"
              value={name}
              maxLength={80}
              placeholder="輸入姓名開頭"
              onChange={(event) => {
                request.current?.abort();
                request.current = null;
                setName(event.target.value);
                setState({ status: 'idle' });
              }}
            />
          </label>
          <button className={styles.primary} disabled={!name.trim() || state.status === 'loading'}>
            {state.status === 'loading' ? '搜尋中…' : '搜尋同學'}
          </button>
        </form>
      </section>
      {state.status === 'loading' && <p className={styles.muted} role="status">正在搜尋同校同學…</p>}
      {state.status === 'error' && (
        <section className={styles.notice} role="alert">
          <h2>這次沒有搜尋成功</h2>
          <p>請確認網路與登入狀態後再試一次。</p>
          <button className={styles.button} type="button" onClick={() => void search()}>重新搜尋</button>
        </section>
      )}
      {state.status === 'ready' && (
        <>
          <p className={styles.resultCount} role="status">
            {state.recipients?.length
              ? `找到 ${state.recipients.length} 位同學，請選擇收件人。`
              : '沒有符合的同學，試著調整姓名開頭。'}
          </p>
          {!!state.recipients?.length && (
            <ul className={styles.recipientList} aria-label="同校收件人">
              {state.recipients.map((person) => (
                <li key={person.uid}>
                  <Link className={styles.conversation} href={`/dms/new?peer=${encodeURIComponent(person.uid)}`}>
                    <span className={styles.avatar} aria-hidden="true">{person.displayName.slice(0, 1)}</span>
                    <span className={styles.conversationBody}>
                      <strong>{person.displayName}</strong>
                      {person.department && <span className={styles.recipientDepartment}>{person.department}</span>}
                    </span>
                    <span className={styles.muted} aria-hidden="true">開始聊天 ›</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {state.recipients?.length === 20 && <p className={styles.muted}>先顯示前 20 位，輸入更多姓名文字可以縮小範圍。</p>}
        </>
      )}
    </div>
  );
}

function PreparedConversation({ session, peerUid }: { session: MessagingSession; peerUid: string }) {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{
    attempt: number;
    status: 'loading' | 'ready' | 'permission' | 'unavailable';
    prepared?: PreparedPrivateConversation;
  }>({ attempt: 0, status: 'loading' });
  useEffect(() => {
    const controller = new AbortController();
    void preparePrivateConversation(session, peerUid, controller.signal).then(
      (prepared) => {
        if (!controller.signal.aborted) setState({ attempt, status: 'ready', prepared });
      },
      (error) => {
        if (!controller.signal.aborted) setState({
          attempt,
          status: error instanceof MessagingError && error.reason === 'permission' ? 'permission' : 'unavailable',
        });
      },
    );
    return () => controller.abort();
  }, [session, peerUid, attempt]);
  const status = state.attempt === attempt ? state.status : 'loading';
  if (status === 'ready' && state.prepared) {
    return <PrivateConversationView
      session={session}
      conversationId={state.prepared.conversationId}
      prepared={state.prepared}
    />;
  }
  return (
    <div className={styles.stack}>
      <div className={styles.toolbar}>
        <Link href="/dms">返回對話列表</Link>
        <Link href="/dms/new">更換收件人</Link>
      </div>
      <section className={styles.notice} role={status === 'loading' ? 'status' : 'alert'}>
        <h2>{status === 'loading' ? '正在確認收件人' : status === 'permission' ? '目前無法與這位同學開啟對話' : '暫時無法確認收件人'}</h2>
        <p>{status === 'loading' ? '確認完成後，就能傳送文字或照片。' : '請確認網路、登入帳號與校籍後重試。'}</p>
        {status !== 'loading' && (
          <button className={styles.button} type="button" onClick={() => setAttempt((current) => current + 1)}>
            重新確認
          </button>
        )}
      </section>
    </div>
  );
}
