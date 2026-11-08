'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useId, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import { useAuth } from '@/components/AuthGuard';
import { isPermissionDeniedError } from '@campus/shared/src/signedInSocialReads';
import {
  confirmCampusPostTitleOpen, parseTitlePrefix, searchCampusPostTitles, type TitleSearchPage,
} from '@/lib/community/titleSearch';
import styles from './TitleHistorySearch.module.css';

type Props = { schoolId: string };
type Failure = { kind: 'initial' | 'more' | 'denied' | 'open'; text: string };

export function TitleHistorySearch({ schoolId }: Props) {
  const { user, loading } = useAuth();
  if (loading) return <p role="status">正在確認登入狀態…</p>;
  if (!user) return <p>請先登入以搜尋校園貼文。</p>;
  return <ScopedTitleHistorySearch key={JSON.stringify([user.uid, schoolId])} schoolId={schoolId} />;
}

function ScopedTitleHistorySearch({ schoolId }: Props) {
  const router = useRouter();
  const fieldId = useId();
  const hintId = useId();
  const [draft, setDraft] = useState('');
  const [searched, setSearched] = useState('');
  const [page, setPage] = useState<TitleSearchPage | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [notice, setNotice] = useState('輸入標題開頭，再按搜尋。');
  const version = useRef(0);
  const inFlight = useRef(false);
  const opening = useRef(false);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const more = useRef<HTMLButtonElement>(null);
  const summary = useRef<HTMLParagraphElement>(null);
  const errorRegion = useRef<HTMLDivElement>(null);
  const focusAfter = useRef<'summary' | 'error' | null>(null);
  useEffect(() => () => { version.current += 1; }, []);
  useLayoutEffect(() => {
    if (busy || !focusAfter.current) return;
    const destination = focusAfter.current === 'summary' ? summary.current : errorRegion.current;
    focusAfter.current = null;
    destination?.focus({ preventScroll: true });
    // The disappearing footer can be many screens below the summary. Keep the
    // keyboard destination visible without inheriting a long smooth-scroll animation.
    destination?.scrollIntoView?.({ block: 'center', behavior: 'instant' });
  });

  function edit(value: string) {
    // Editing cancels delivery of the previous query, not just its spinner.
    version.current += 1;
    inFlight.current = false;
    opening.current = false;
    setOpeningId(null);
    focusAfter.current = null;
    setDraft(value);
    setSearched('');
    setPage(null);
    setFailure(null);
    setBusy(false);
    setNotice('輸入標題開頭，再按搜尋。');
  }

  async function search(continuation = false) {
    if (inFlight.current || opening.current || (continuation && (!page?.hasMore || !page.nextCursor))) return;
    let prefix: string;
    try { prefix = parseTitlePrefix(draft); }
    catch {
      setFailure({ kind: 'initial', text: '請輸入 1 至 80 字的標題開頭。' });
      input.current?.focus();
      return;
    }
    const cursor = continuation ? page!.nextCursor : null;
    const request = ++version.current;
    inFlight.current = true;
    setBusy(true);
    setFailure(null);
    setNotice(continuation ? '正在搜尋下一頁…' : '正在搜尋歷史標題…');
    try {
      const result = await searchCampusPostTitles(schoolId, prefix, cursor);
      if (request !== version.current) return;
      const oldPosts = continuation ? page!.posts : [];
      const ids = new Set(oldPosts.map((post) => post.id));
      const additions = result.posts.filter((post) => {
        if (post.schoolId !== schoolId || ids.has(post.id)) return false;
        ids.add(post.id);
        return true;
      });
      const posts = [...oldPosts, ...additions];
      focusAfter.current = continuation && !result.hasMore && document.activeElement === more.current
        ? 'summary' : null;
      setPage({ ...result, posts });
      setSearched(prefix);
      setNotice(posts.length
        ? `已找到 ${posts.length} 則標題以「${prefix}」開頭的貼文。${result.hasMore ? '可繼續載入。' : '已讀到最後一頁。'}`
        : `目前沒有標題以「${prefix}」開頭的貼文。可縮短開頭文字再搜尋。`);
    } catch (cause) {
      if (request !== version.current) return;
      if (isPermissionDeniedError(cause)) {
        if (document.activeElement === more.current) focusAfter.current = 'error';
        setPage(null);
        setSearched('');
        setFailure({ kind: 'denied', text: '校籍或貼文存取權限已變更，先前結果已清除。' });
      } else {
        setFailure({
          kind: continuation ? 'more' : 'initial',
          text: continuation
            ? '下一頁讀取失敗，已保留結果與查詢位置，請確認連線後重試。'
            : '尚未取得搜尋結果，請確認連線後重試。',
        });
      }
      setNotice('搜尋未完成。');
    } finally {
      if (request === version.current) {
        inFlight.current = false;
        setBusy(false);
      }
    }
  }


  async function openResult(id: string) {
    if (opening.current || inFlight.current || !searched) return;
    // The search snapshot is historical; opening requires a new server authorization.
    const request = ++version.current;
    opening.current = true;
    setOpeningId(id);
    setFailure(null);
    setNotice('正在向伺服器確認這篇貼文…');
    let navigated = false;
    try {
      const available = await confirmCampusPostTitleOpen(schoolId, id);
      if (request !== version.current) return;
      if (!available) {
        setPage((current) => current ? {
          ...current, posts: current.posts.filter((post) => post.id !== id),
        } : null);
        setNotice('這篇貼文已刪除或不再提供，已從搜尋結果移除。');
        return;
      }
      navigated = true;
      router.push(`/community/post/${encodeURIComponent(id)}?schoolId=${encodeURIComponent(schoolId)}`);
    } catch (cause) {
      if (request !== version.current) return;
      if (isPermissionDeniedError(cause)) {
        setPage(null);
        setSearched('');
        setFailure({ kind: 'denied', text: '校籍或貼文存取權限已變更，先前結果已清除。' });
        setNotice('搜尋未完成。');
      } else {
        setFailure({ kind: 'open', text: '暫時無法向伺服器確認這篇貼文，搜尋結果已保留。連線恢復後可再次點擊。' });
        setNotice('貼文尚未通過伺服器確認。');
      }
    } finally {
      if (request === version.current && !navigated) {
        opening.current = false;
        setOpeningId(null);
      }
    }
  }

  function submit(event: FormEvent) { event.preventDefault(); void search(); }

  return (
    <section className={styles.panel} aria-label="歷史貼文標題搜尋">
      <form onSubmit={submit} className={styles.form}>
        <div className={styles.field}>
          <label htmlFor={fieldId}>標題開頭</label>
          <input id={fieldId} ref={input} type="search" value={draft}
            onChange={(event) => edit(event.target.value)} maxLength={160}
            aria-describedby={hintId} autoComplete="off" placeholder="例如：二手書、租屋"
            onKeyDown={(event) => {
              if (event.key === 'Enter' && event.nativeEvent.isComposing) event.preventDefault();
            }} />
        </div>
        <div className={styles.actions}>
          <button type="submit" aria-disabled={busy || Boolean(openingId)} aria-busy={busy || Boolean(openingId)}>搜尋歷史標題</button>
          <button type="button" onClick={() => { edit(''); input.current?.focus(); }}>清除</button>
        </div>
      </form>
      <p id={hintId} className={styles.hint}>
        直接搜尋本校可讀取的歷史貼文，不必先載入動態牆。只比對標題開頭，不搜尋內文；英文區分大小寫。結果依標題排列，每頁最多 20 則。
      </p>
      <p ref={summary} tabIndex={-1} role="status" aria-live="polite" aria-atomic="true"
        className={styles.notice}>{notice}</p>
      {failure && (
        <div ref={errorRegion} tabIndex={-1} role="alert" className={styles.error}>
          <p>{failure.text}</p>
          {failure.kind !== 'more' && failure.kind !== 'open' && (
            <button type="button" aria-disabled={busy} onClick={() => void search()}>
              {failure.kind === 'denied' ? '重新驗證並搜尋' : '重試搜尋'}
            </button>
          )}
        </div>
      )}
      {page && (
        <>
          <ol className={styles.results} aria-label={`「${searched}」歷史標題搜尋結果`}>
            {page.posts.map((post) => (
              <li key={post.id}>
                <article className={styles.card}>
                  <h3><Link href={`/community/post/${encodeURIComponent(post.id)}?schoolId=${encodeURIComponent(schoolId)}`}
                    aria-busy={openingId === post.id} aria-disabled={Boolean(openingId)}
                    onClick={(event) => {
                      // Modified clicks keep the normal browser link behavior.
                      // This guard covers ordinary same-tab navigation.
                      if (event.button !== 0 || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
                      event.preventDefault();
                      void openResult(post.id);
                    }}>
                    {post.title}
                  </Link></h3>
                  {post.excerpt && <p>{post.excerpt}</p>}
                  <small>{post.anonymous ? '匿名貼文' : '校園貼文'}</small>
                </article>
              </li>
            ))}
          </ol>
          {page.hasMore && <button ref={more} type="button" className={styles.more}
            aria-disabled={busy} aria-busy={busy} onClick={() => void search(true)}>
            {busy ? '正在搜尋下一頁…' : failure?.kind === 'more' ? '重試下一頁' : '載入更多符合的標題'}
          </button>}
        </>
      )}
    </section>
  );
}
