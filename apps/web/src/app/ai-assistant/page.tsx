'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useRef, useState, type FormEvent } from 'react';
import { SiteShell } from '@/components/SiteShell';
import { useAuth } from '@/components/AuthGuard';
import { resolveSchoolPageContext } from '@/lib/pageContext';
import { callCampusAssistant, CampusAssistantError, type CampusAssistantEnvelope } from '@/lib/campusAssistantClient';
import { assistantSources, assistantSuggestions, hasOrderProposal, readOnlyAssistantCards } from '@/lib/assistantPresentation';
import { AgentCardList } from './AgentCards';
import home from '../home.module.css';
import styles from './assistant.module.css';

type Message = { role: 'user'; content: string } | { role: 'assistant'; content: string; response: CampusAssistantEnvelope };
const school = resolveSchoolPageContext();

function requestError(error: unknown): string {
  if (error instanceof CampusAssistantError && error.code === 'session-changed') return '登入狀態已變更，請重新登入後再試。';
  const code = (error as { code?: string } | null)?.code;
  if (code === 'functions/unauthenticated') return '登入已逾時，請重新登入後再試。';
  if (code === 'functions/permission-denied') return '目前帳號無法查詢這項資料。你可以修改問題後再試。';
  if (code === 'functions/resource-exhausted') return '目前詢問較頻繁，請稍候再試。你的問題已保留。';
  return '這次未能取得回覆。你的問題已保留，請稍後重試。';
}

function AssistantConversation({ userId, groupId, initialDraft }: { userId: string; groupId: string; initialDraft: string }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState(initialDraft);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const sessionId = useRef<string | null>(null);
  const request = useRef<AbortController | null>(null);
  const composer = useRef<HTMLTextAreaElement>(null);

  useEffect(() => () => { request.current?.abort(); request.current = null; }, []);

  async function send(event: FormEvent) {
    event.preventDefault();
    const content = draft.trim();
    if (!content || request.current) return;
    const controller = new AbortController();
    request.current = controller;
    sessionId.current ??= crypto.randomUUID();
    setPending(true);
    setError('');
    try {
      const response = await callCampusAssistant({ userId, schoolId: school.schoolId, groupId: groupId || undefined,
        sessionId: sessionId.current, messages: [...messages.map(({ role, content: text }) => ({ role, content: text })), { role: 'user', content }] }, controller.signal);
      if (controller.signal.aborted || request.current !== controller) return;
      setMessages(previous => [...previous, { role: 'user', content }, { role: 'assistant', content: response.content, response }]);
      setDraft('');
    } catch (failure) {
      if (!controller.signal.aborted && request.current === controller) setError(requestError(failure));
    } finally {
      if (!controller.signal.aborted && request.current === controller) {
        request.current = null;
        setPending(false);
        composer.current?.focus();
      }
    }
  }

  function clearConversation() {
    request.current?.abort();
    request.current = null;
    sessionId.current = null;
    setMessages([]);
    setDraft('');
    setError('');
    setPending(false);
    composer.current?.focus();
  }

  return <section className={styles.conversation} aria-label="校園助理對話">
    <div className={styles.toolbar}>
      <p className={home.intro}>{groupId ? '正在這門課的範圍內詢問。' : '查詢課務、校園地點或服務資訊。'}</p>
      {(messages.length > 0 || pending) && <button type="button" className={home.secondary} onClick={clearConversation}>清除對話</button>}
    </div>
    {messages.length === 0 && !pending && <div className={styles.empty}>
      <h2>今天需要什麼幫忙？</h2>
      <p>寫下問題，可以補充課程名稱、日期或地點，讓查詢更明確。</p>
      <nav aria-label="直接開啟服務" className={styles.serviceLinks}>
        <Link href="/#courses">課程</Link><Link href="/map">校園地圖</Link><Link href="/cafeteria">餐廳</Link>
      </nav>
    </div>}
    <div role="log" aria-label="對話紀錄" aria-live="polite" aria-relevant="additions" className={styles.messages}>
      {messages.map((message, index) => <article key={index} className={message.role === 'user' ? styles.question : styles.answer}>
        <p className={styles.author}>{message.role === 'user' ? '你' : '校園助理'}</p>
        <p className={styles.content}>{message.content}</p>
        {message.role === 'assistant' && <>
          <div className={styles.cards}><AgentCardList cards={readOnlyAssistantCards(message.response.cards, school.schoolId)} schoolId={school.schoolId} /></div>
          {hasOrderProposal(message.response) && <p className={styles.note}>這段對話不會送出訂單。餐點與訂單狀態請在<Link href="/cafeteria">餐廳服務</Link>確認。</p>}
          {assistantSources(message.response.citations).length > 0 && <ul className={styles.sources} aria-label="參考來源">
            {assistantSources(message.response.citations).map(source => <li key={source.url}><a href={source.url} target="_blank" rel="noopener noreferrer">{source.label}</a></li>)}
          </ul>}
          {index === messages.length - 1 && assistantSuggestions(message.response).length > 0 && <div className={styles.suggestions} aria-label="接續詢問">
            {assistantSuggestions(message.response).map((suggestion, suggestionIndex) => <button type="button" key={suggestionIndex} disabled={pending} onClick={() => { setDraft(suggestion); setError(''); composer.current?.focus(); }}>{suggestion}</button>)}
          </div>}
        </>}
      </article>)}
    </div>
    {pending && <p role="status" className={styles.note}>正在查詢，請稍候…</p>}
    <form onSubmit={send} className={styles.composer} aria-label="傳送問題">
      <label htmlFor="assistant-question">你的問題</label>
      <textarea ref={composer} id="assistant-question" value={draft} maxLength={4000} rows={3} readOnly={pending}
        placeholder="例如：圖書館怎麼走？" onChange={event => { setDraft(event.target.value); setError(''); }} aria-describedby={error ? 'assistant-error' : 'assistant-note'} />
      {error && <p id="assistant-error" role="alert" className={styles.error}>{error}</p>}
      <div className={styles.submitRow}>
        <p id="assistant-note" className={styles.note}>回覆可能有誤；申請、繳費與訂單請以服務頁面的紀錄為準。</p>
        <button type="submit" className={home.primary} disabled={pending || !draft.trim()}>{pending ? '查詢中…' : error ? '重試' : '送出'}</button>
      </div>
    </form>
  </section>;
}

function AssistantRoute() {
  const { user, loading, error } = useAuth();
  const search = useSearchParams();
  const groupId = search.get('courseId') || search.get('groupId') || '';
  const initialDraft = (search.get('q') || '').slice(0, 4000);
  if (loading) return <p role="status">正在確認登入狀態…</p>;
  if (error) return <p role="alert">無法確認登入狀態，請重新整理後再試。</p>;
  if (!user) return <div className={styles.empty}><h2>登入後開始詢問</h2><p>查詢課務與個人服務需要先確認你的帳號。</p>
    <Link className={home.primary} href={`/login?returnUrl=${encodeURIComponent(`/ai-assistant${search.size ? `?${search.toString()}` : ''}`)}`}>登入</Link></div>;
  return <AssistantConversation key={JSON.stringify([user.uid, school.schoolId, groupId, initialDraft])} userId={user.uid} groupId={groupId} initialDraft={initialDraft} />;
}

export default function AssistantPage() {
  return <SiteShell title="校園助理" subtitle="從一個問題開始，找到需要的資訊。" schoolName={school.schoolName} schoolCode={school.schoolCode}>
    <Suspense fallback={<p role="status">載入中…</p>}><AssistantRoute /></Suspense>
  </SiteShell>;
}
