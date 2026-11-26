'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { openModalSession } from '@/components/ui/modalSession';
import {
  listStoryViewersPage,
  type AudienceStory,
  type StoryAudiencePage,
} from '@/lib/community/storyViewers';
import styles from './StoryAudience.module.css';

export function StoryAudience({ story, onClose }: { story: AudienceStory; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const [request, setRequest] = useState<{ after: StoryAudiencePage['nextCursor'] }>({
    after: null,
  });
  const [viewers, setViewers] = useState<StoryAudiencePage['viewers']>([]);
  const [nextCursor, setNextCursor] = useState<StoryAudiencePage['nextCursor']>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error' | 'denied'>('loading');
  const { id, authorUid, schoolId } = story;

  useEffect(() => {
    if (dialog.current) return openModalSession(dialog.current, close.current);
  }, []);
  useEffect(() => {
    let active = true;
    void listStoryViewersPage({ id, authorUid, schoolId }, request.after)
      .then((page) => {
        if (!active) return;
        setViewers((previous) => [...previous, ...page.viewers]);
        setNextCursor(page.nextCursor);
        setState('ready');
      })
      .catch((error: unknown) => {
        if (!active) return;
        if ((error as { code?: string } | null)?.code === 'permission-denied') {
          setViewers([]);
          setNextCursor(null);
          setState('denied');
        } else {
          setState('error');
        }
      });
    return () => {
      active = false;
    };
  }, [id, authorUid, schoolId, request]);

  function load(after: StoryAudiencePage['nextCursor']) {
    setState('loading');
    setRequest({ after });
  }

  return (
    <dialog
      ref={dialog}
      className={styles.panel}
      aria-labelledby={titleId}
      aria-modal="true"
      onCancel={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }}
    >
      <header className={styles.heading}>
        <div>
          <h2 id={titleId}>誰看過</h2>
          <p>只有你能查看這則限動的觀看名單。</p>
        </div>
        <button type="button" ref={close} aria-label="返回限時動態" onClick={onClose}>
          ×
        </button>
      </header>
      <div className={styles.body}>
        {viewers.length > 0 && <p role="status">已顯示 {viewers.length} 位</p>}
        {viewers.length > 0 && (
          <ul aria-label="觀看者">
            {viewers.map(({ uid, displayName }) => (
              <li key={uid}>
                <span className={styles.avatar} aria-hidden="true">
                  {Array.from(displayName)[0]}
                </span>
                <span>{displayName}</span>
              </li>
            ))}
          </ul>
        )}
        {state === 'loading' && <p role="status">正在載入觀看名單…</p>}
        {state === 'ready' && viewers.length === 0 && !nextCursor && (
          <p role="status">目前還沒有觀看紀錄。</p>
        )}
        {state === 'denied' && <p role="alert">目前無法存取這則限動的觀看名單。</p>}
        {state === 'error' && (
          <div role="alert">
            <p>觀看名單暫時無法載入。</p>
            <button type="button" onClick={() => load(request.after)}>
              再試一次
            </button>
          </div>
        )}
        {nextCursor && state !== 'error' && (
          <button type="button" disabled={state === 'loading'} onClick={() => load(nextCursor)}>
            顯示更多觀看者
          </button>
        )}
      </div>
    </dialog>
  );
}
