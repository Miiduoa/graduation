'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import type { CampusPostDoc } from '@/lib/community/firestore';
import {
  featureCreatorPost,
  readCreatorHighlight,
  removeCreatorHighlight,
  type CreatorHighlight as Highlight,
} from '@/lib/community/creatorHighlight';
import styles from './CreatorHighlight.module.css';

type State =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; value: Highlight | null };

export function CreatorHighlight({
  schoolId, memberUid, own, candidates,
}: {
  schoolId: string;
  memberUid: string;
  own: boolean;
  candidates: CampusPostDoc[];
}) {
  const [state, setState] = useState<State>({ status: 'loading' });
  const [revision, setRevision] = useState(0);
  const [choice, setChoice] = useState('');
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState('');
  const mounted = useRef(false);
  const locked = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    let live = true;
    setState({ status: 'loading' });
    setFeedback('');
    void readCreatorHighlight(schoolId, memberUid).then(
      (result) => { if (live) setState({ status: 'ready', value: result }); },
      () => { if (live) setState({ status: 'error' }); },
    );
    return () => { live = false; };
  }, [schoolId, memberUid, revision]);

  const eligible = candidates.filter((post) =>
    post.schoolId === schoolId &&
    post.authorUid === memberUid &&
    post.anonymous === false,
  );
  const selected = eligible.find((post) => post.id === choice);
  const current = state.status === 'ready' ? state.value : null;

  async function update(postId: string | null) {
    if (!own || locked.current || state.status !== 'ready') return;
    if (postId && !eligible.some((post) => post.id === postId)) return;
    locked.current = true;
    setBusy(true);
    setFeedback('');
    try {
      if (postId) {
        const confirmed = await featureCreatorPost(schoolId, memberUid, postId);
        if (mounted.current) {
          setState({ status: 'ready', value: confirmed });
          setChoice('');
          setFeedback('精選作品已更新。');
        }
      } else {
        await removeCreatorHighlight(schoolId, memberUid);
        if (mounted.current) {
          setState({ status: 'ready', value: null });
          setFeedback('已取消精選。');
        }
      }
    } catch {
      if (mounted.current) {
        setFeedback('尚未確認變更結果，請重新讀取後再操作。');
        setState({ status: 'error' });
      }
    } finally {
      locked.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  if (state.status === 'loading') {
    return own ? <section className={styles.panel} role="status">正在確認精選作品…</section> : null;
  }
  if (state.status === 'error') {
    return (
      <section className={styles.panel} role="alert" aria-label="精選作品">
        <p>精選作品暫時無法確認。</p>
        <button type="button" className={styles.secondary} onClick={() => setRevision((n) => n + 1)}>
          重新讀取
        </button>
      </section>
    );
  }
  if (!own && !current?.post) return null;
  const postHref = current?.post
    ? '/community/post/' + encodeURIComponent(current.post.id) + '?schoolId=' + encodeURIComponent(schoolId)
    : '';

  return (
    <section className={styles.panel} aria-label="精選作品">
      <div className={styles.heading}>
        <h2>精選作品</h2>
        <span>由作者挑選</span>
      </div>
      {current?.post ? (
        <Link className={styles.featured} href={postHref}>
          <span className={styles.featuredLabel}>精選貼文</span>
          <strong>{current.post.title || '未命名貼文'}</strong>
          <p>{current.post.content || '查看作者的作品'}</p>
          <span className={styles.open}>閱讀作品 <span aria-hidden="true">↗</span></span>
        </Link>
      ) : (
        <p className={styles.note}>
          {current ? '先前精選的貼文已刪除、改為匿名，或目前無法顯示。'
            : '從已發表的署名貼文選一篇，讓來訪的同學先看見你的代表作。'}
        </p>
      )}
      {own && (
        <div className={styles.editor}>
          <label htmlFor="creator-featured-post">挑選一篇署名貼文</label>
          <div className={styles.controls}>
            <select
              id="creator-featured-post"
              value={selected?.id ?? ''}
              disabled={busy || eligible.length === 0}
              onChange={(event) => setChoice(event.target.value)}
            >
              <option value="">選擇作品</option>
              {eligible.map((post) => (
                <option key={post.id} value={post.id}>{post.title || '未命名貼文'}</option>
              ))}
            </select>
            <button type="button" className={styles.primary} disabled={busy || !selected}
              onClick={() => void update(selected?.id ?? null)}>設為精選</button>
            {current && <button type="button" className={styles.secondary} disabled={busy}
              onClick={() => void update(null)}>取消精選</button>}
          </div>
          <p className={styles.help}>只會顯示目前載入的署名貼文；可繼續載入舊文後再挑選。匿名內容不會被公開。</p>
        </div>
      )}
      {feedback && <p role="status" className={styles.feedback}>{feedback}</p>}
    </section>
  );
}
