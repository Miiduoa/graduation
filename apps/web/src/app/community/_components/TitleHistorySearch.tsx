'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useId, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import { useAuth } from '@/components/AuthGuard';
import { isPermissionDeniedError } from '@campus/shared/src/signedInSocialReads';
import {
  confirmCampusPostTitleOpen, parseTitlePrefix, resumeCampusPostTitles, searchCampusPostTitles, type TitleSearchPage,
} from '@/lib/community/titleSearch';
import styles from './TitleHistorySearch.module.css';

type Props = { schoolId: string };
type Failure = { kind: 'initial' | 'more' | 'denied' | 'open' | 'position'; text: string };

const OPEN_CONFIRM_TIMEOUT_MS = 7000;
const SEARCH_TIMEOUT_MS = 15_000;
const POSITION_STORAGE_KEY = 'nuni:community-history-reading-position:v1';
const POSITION_AGE_MS = 10 * 60 * 1000;
type ReadingPosition = { uid: string; schoolId: string; query: string; postId: string; savedAt: number };

function clearReadingPosition() {
  if (typeof window === 'undefined') return;
  try { window.sessionStorage.removeItem(POSITION_STORAGE_KEY); } catch { /* Storage can be disabled. */ }
}
function saveReadingPosition(value: Omit<ReadingPosition, 'savedAt'>) {
  if (typeof window === 'undefined') return;
  try { window.sessionStorage.setItem(POSITION_STORAGE_KEY, JSON.stringify({ ...value, savedAt: Date.now() })); }
  catch { /* Navigation still works without browser storage. */ }
}
function readReadingPosition(uid: string, schoolId: string): ReadingPosition | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(POSITION_STORAGE_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as ReadingPosition;
    if (value.uid !== uid || value.schoolId !== schoolId ||
        typeof value.postId !== 'string' || !value.postId || value.postId.includes('/') ||
        typeof value.query !== 'string' || parseTitlePrefix(value.query) !== value.query ||
        !Number.isFinite(value.savedAt) || value.savedAt > Date.now() ||
        Date.now() - value.savedAt > POSITION_AGE_MS) {
      clearReadingPosition();
      return null;
    }
    return value;
  } catch {
    clearReadingPosition();
    return null;
  }
}


/** Do not leave a student's result link permanently locked if a server read stalls. */
async function confirmWithinDeadline(schoolId: string, postId: string): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      confirmCampusPostTitleOpen(schoolId, postId),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(
          Object.assign(new Error('貼文確認逾時。'), { code: 'deadline-exceeded' }),
        ), OPEN_CONFIRM_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** A hung Firestore server read must not hold the history form or cursor indefinitely.
 * The late SDK promise is not cancelled, but its result never reaches this component.
 */
async function searchWithinDeadline<T>(operation: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(
          Object.assign(new Error('歷史搜尋伺服器讀取逾時。'), { code: 'deadline-exceeded' }),
        ), SEARCH_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export function TitleHistorySearch({ schoolId }: Props) {
  const { user, loading } = useAuth();
  useEffect(() => {
    if (!loading && !user) clearReadingPosition();
  }, [loading, user]);
  if (loading) return <p role="status">正在確認登入狀態…</p>;
  if (!user) return <p>請先登入以搜尋校園貼文。</p>;
  return <ScopedTitleHistorySearch key={JSON.stringify([user.uid, schoolId])}
    accountId={user.uid} schoolId={schoolId} />;
}

function ScopedTitleHistorySearch({ schoolId, accountId }: Props & { accountId: string }) {
  const router = useRouter();
  const fieldId = useId();
  const hintId = useId();
  const limitId = useId();
  const [draft, setDraft] = useState('');
  // The shared search parser counts Unicode code points after trimming.
  // Keep maxLength=160 UTF-16 units so 80 emoji remain searchable.
  const titleTooLong = Array.from(draft.trim()).length > 80;
  const [resumePosition, setResumePosition] = useState<ReadingPosition | null>(null);
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
  // IME candidate Enter can report isComposing=false before compositionend.
  const composing = useRef(false);
  const more = useRef<HTMLButtonElement>(null);
  const resumeControl = useRef<HTMLButtonElement>(null);
  const summary = useRef<HTMLParagraphElement>(null);
  const errorRegion = useRef<HTMLDivElement>(null);
  const focusAfter = useRef<'summary' | 'error' | null>(null);
  useEffect(() => () => { version.current += 1; }, []);
  useEffect(() => {
    // Browser session state is read only after hydration, never during server rendering.
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      const remembered = readReadingPosition(accountId, schoolId);
      if (remembered) {
        setResumePosition(remembered);
        setDraft(remembered.query);
        setNotice('已保留上次搜尋文字，請重新搜尋或重新確認閱讀位置。');
      }
    });
    return () => { active = false; };
  }, [accountId, schoolId]);
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
    setResumePosition(null);
    clearReadingPosition();
    setSearched('');
    setPage(null);
    setFailure(null);
    setBusy(false);
    setNotice('輸入標題開頭，再按搜尋。');
  }

  async function search(continuation = false, fromPostId?: string) {
    if (inFlight.current || opening.current || (continuation && (!page?.hasMore || !page.nextCursor))) return;
    let prefix: string;
    try { prefix = parseTitlePrefix(draft); }
    catch {
      setFailure({ kind: 'initial', text: '請輸入 1 至 80 字的標題開頭。' });
      input.current?.focus();
      return;
    }
    const cursor = continuation ? page!.nextCursor : null;
    // Capture focus before the resume control is disabled or removed by a response.
    const focusWasOnResume = Boolean(fromPostId) && document.activeElement === resumeControl.current;
    // Do not move focus if the student selected another control during the server read.
    const restoreResumeFocus = () => focusWasOnResume &&
      (document.activeElement === resumeControl.current || document.activeElement === document.body);
    const request = ++version.current;
    if (!continuation && !fromPostId) {
      setResumePosition(null);
      clearReadingPosition();
    }
    inFlight.current = true;
    setBusy(true);
    setFailure(null);
    setNotice(continuation ? '正在搜尋下一頁…' : '正在搜尋歷史標題…');
    try {
      const result = await searchWithinDeadline(fromPostId
        ? resumeCampusPostTitles(schoolId, prefix, fromPostId)
        : searchCampusPostTitles(schoolId, prefix, cursor));
      if (request !== version.current) return;
      const oldPosts = continuation ? page!.posts : [];
      const ids = new Set(oldPosts.map((post) => post.id));
      const additions = result.posts.filter((post) => {
        if (post.schoolId !== schoolId || ids.has(post.id)) return false;
        ids.add(post.id);
        return true;
      });
      const posts = [...oldPosts, ...additions];
      if (fromPostId) {
        clearReadingPosition();
        setResumePosition(null);
      }
      focusAfter.current = restoreResumeFocus() ||
        (continuation && !result.hasMore && document.activeElement === more.current)
        ? 'summary' : null;
      setPage({ ...result, posts });
      setSearched(prefix);
      setNotice(posts.length
        ? `${fromPostId ? '已重新驗證上次閱讀的貼文，從這篇接續。' : ''}已找到 ${posts.length} 則標題以「${prefix}」開頭的貼文。${result.hasMore ? '可繼續載入。' : '已讀到最後一頁。'}`
        : `目前沒有標題以「${prefix}」開頭的貼文。可縮短開頭文字再搜尋。`);
    } catch (cause) {
      if (request !== version.current) return;
      if (isPermissionDeniedError(cause)) {
        clearReadingPosition();
        setResumePosition(null);
        if (document.activeElement === more.current || restoreResumeFocus()) focusAfter.current = 'error';
        setPage(null);
        setSearched('');
        setFailure({ kind: 'denied', text: '校籍或貼文存取權限已變更，先前結果已清除。' });
      } else if ((cause as { code?: string } | null)?.code === 'history-position-unavailable') {
        if (restoreResumeFocus()) focusAfter.current = 'error';
        clearReadingPosition();
        setResumePosition(null);
        setPage(null);
        setSearched('');
        setFailure({ kind: 'initial', text: '上次閱讀的貼文可能已刪除或標題變更，無法定位；請從頭搜尋。' });
      } else {
        setFailure({
          kind: fromPostId ? 'position' : continuation ? 'more' : 'initial',
          text: fromPostId
            ? '重新確認閱讀位置失敗；原內容未恢復，請確認連線後重試同一篇。'
            : continuation
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
    if (opening.current || !searched) return;
    // An older result remains usable while the next page loads. Cancel only the
    // pending delivery; the last confirmed cursor stays available for retry.
    const request = ++version.current;
    if (inFlight.current) {
      inFlight.current = false;
      setBusy(false);
      focusAfter.current = null;
    }
    // The search snapshot is historical; opening requires a new server authorization.
    opening.current = true;
    setOpeningId(id);
    setFailure(null);
    setNotice('正在向伺服器確認這篇貼文…');
    let navigated = false;
    let confirmed = false;
    try {
      const available = await confirmWithinDeadline(schoolId, id);
      if (request !== version.current) return;
      if (!available) {
        focusAfter.current = 'summary';
        setPage((current) => current ? {
          ...current, posts: current.posts.filter((post) => post.id !== id),
        } : null);
        setNotice('這篇貼文已刪除或不再提供，已從搜尋結果移除。');
        return;
      }
      confirmed = true;
      // A failed client transition must not persist a reading position or lock the link.
      router.push(`/community/post/${encodeURIComponent(id)}?schoolId=${encodeURIComponent(schoolId)}`);
      saveReadingPosition({ uid: accountId, schoolId, query: searched, postId: id });
      navigated = true;
    } catch (cause) {
      if (request !== version.current) return;
      if (isPermissionDeniedError(cause)) {
        focusAfter.current = 'error';
        setPage(null);
        setSearched('');
        setFailure({ kind: 'denied', text: '校籍或貼文存取權限已變更，先前結果已清除。' });
        setNotice('搜尋未完成。');
      } else {
        setFailure({ kind: 'open', text: confirmed
          ? '貼文已通過伺服器確認，但頁面開啟失敗。搜尋結果已保留，請再次點擊重試。'
          : '暫時無法向伺服器確認這篇貼文，搜尋結果已保留。連線恢復後可再次點擊。' });
        setNotice(confirmed
          ? '伺服器已確認貼文可閱讀，但網頁尚未開啟。請再次點擊。'
          : '貼文尚未通過伺服器確認。');
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
          {/* Avoid a UTF-16 maxlength: pasting 81 emoji would silently become 80 before validation. */}
          <input id={fieldId} ref={input} type="search" value={draft}
            onChange={(event) => edit(event.target.value)}
            aria-invalid={titleTooLong} aria-describedby={titleTooLong ? `${hintId} ${limitId}` : hintId}
            autoComplete="off" placeholder="例如：二手書、租屋"
            onCompositionStart={() => { composing.current = true; }}
            onCompositionEnd={() => { composing.current = false; }}
            onBlur={() => { composing.current = false; }}
            onKeyDown={(event) => {
              // Safari/WebKit may report isComposing=false for the Enter used to
              // accept a Chinese IME candidate. Never submit its partial draft.
              if (event.key === 'Enter' &&
                  (composing.current || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229)) {
                event.preventDefault();
              }
            }} />
        </div>
        <div className={styles.actions}>
          <button type="submit" aria-disabled={busy || Boolean(openingId)} aria-busy={busy || Boolean(openingId)}>搜尋歷史標題</button>
          <button type="button" onClick={() => { edit(''); input.current?.focus(); }}>清除</button>
          {resumePosition && draft === resumePosition.query && (
            <button ref={resumeControl} type="button" aria-label="回到上次閱讀位置"
              aria-describedby={hintId} aria-busy={busy} disabled={busy || Boolean(openingId)}
              onClick={() => void search(false, resumePosition.postId)}>
              回到上次閱讀位置
            </button>
          )}
        </div>
      </form>
      {titleTooLong && <p id={limitId} aria-live="polite" className={styles.error}>
        標題開頭最多 80 字，請刪減後搜尋。
      </p>}
      <p id={hintId} className={styles.hint}>
        直接搜尋本校可讀取的歷史貼文，不必先載入動態牆。只比對標題開頭，不搜尋內文；英文區分大小寫。結果依標題排列，每頁最多 20 則。
      </p>
      <p ref={summary} tabIndex={-1} role="status" aria-live="polite" aria-atomic="true"
        className={styles.notice}>{notice}</p>
      {failure && (
        <div ref={errorRegion} tabIndex={-1} role="alert" className={styles.error}>
          <p>{failure.text}</p>
          {failure.kind !== 'more' && failure.kind !== 'open' && (
            <button type="button" aria-disabled={busy}
              onClick={() => void search(false, failure.kind === 'position' ? resumePosition?.postId : undefined)}>
              {failure.kind === 'denied' ? '重新驗證並搜尋'
                : failure.kind === 'position' ? '重試上次閱讀位置' : '重試搜尋'}
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
            aria-disabled={busy || Boolean(openingId)} aria-busy={busy || Boolean(openingId)}
            onClick={() => void search(true)}>
            {busy ? '正在搜尋下一頁…' : failure?.kind === 'more' ? '重試下一頁' : '載入更多符合的標題'}
          </button>}
        </>
      )}
    </section>
  );
}
