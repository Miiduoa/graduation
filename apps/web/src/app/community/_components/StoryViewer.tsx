'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { usePrivateMedia } from '@/lib/usePrivateMedia';
import { openModalSession } from '@/components/ui/modalSession';
import type { useStoryShelf } from './useStoryShelf';
import styles from './StoryViewer.module.css';

type StoryPosition = NonNullable<ReturnType<typeof useStoryShelf>['viewer']>;
const DWELL_MS = 7000;

export function StoryViewer({
  viewer,
  author,
  avatar,
}: {
  viewer: StoryPosition;
  author: string;
  avatar?: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const gesture = useRef<{ x: number; y: number; pointerId: number } | null>(null);
  const [auto, setAuto] = useState(false);
  const [hidden, setHidden] = useState(() => document.hidden);
  const [loadedId, setLoadedId] = useState<string | null>(null);
  const [failedId, setFailedId] = useState<string | null>(null);
  const story = viewer.group.stories[viewer.index]!;
  const onMediaFailure = useCallback(() => setFailedId(story.id), [story.id]);
  const mediaUrl = usePrivateMedia(story.mediaUrl, onMediaFailure);
  const photo = (story.kind === 'image' || story.kind === 'video') && !!story.mediaUrl;
  const running = auto && !hidden && (!photo || loadedId === story.id || failedId === story.id);
  const onNext = useRef(viewer.next);
  useEffect(() => {
    onNext.current = viewer.next;
  }, [viewer.next]);
  const remaining = useRef(DWELL_MS);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    return openModalSession(element, closeButton.current);
  }, []);
  useEffect(() => {
    const sync = () => setHidden(document.hidden);
    document.addEventListener('visibilitychange', sync);
    return () => document.removeEventListener('visibilitychange', sync);
  }, []);
  useEffect(() => {
    remaining.current = DWELL_MS;
  }, [story.id]);
  useEffect(() => {
    if (!running) return;
    const start = performance.now();
    const timer = window.setTimeout(() => onNext.current(), remaining.current);
    return () => {
      window.clearTimeout(timer);
      remaining.current = Math.max(0, remaining.current - (performance.now() - start));
    };
  }, [story.id, running]);

  return (
    <dialog
      ref={dialog}
      className={styles.dialog}
      aria-label="限時動態"
      aria-modal="true"
      onCancel={(e) => {
        e.preventDefault();
        viewer.close();
      }}
      onKeyDown={(e) => {
        if (e.altKey || e.metaKey || e.ctrlKey || e.shiftKey) return;
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          e.preventDefault();
          if (e.key === 'ArrowLeft') viewer.previous();
          else viewer.next();
        }
      }}
    >
      <div
        className={styles.frame}
        style={{ backgroundColor: photo ? '#121212' : story.bgColor || '#243b35' }}
      >
        <header className={styles.header}>
          <div className={styles.segments} aria-hidden="true" key={story.id}>
            {viewer.group.stories.map((s, i) => (
              <span key={s.id} data-past={i < viewer.index}>
                {i === viewer.index && (
                  <i
                    style={{
                      animationDuration: DWELL_MS + 'ms',
                      animationPlayState: running ? 'running' : 'paused',
                    }}
                  />
                )}
              </span>
            ))}
          </div>
          <div className={styles.byline}>
            <span className={styles.avatar} aria-hidden="true">
              {avatar ? ( <Image src={avatar} alt="" unoptimized width={38} height={38} />
              ) : ( author.slice(0, 1)
              )}
            </span>
            <div className={styles.identity} aria-live="polite">
              <strong>{author}</strong>
              <small>
                第 {viewer.index + 1} 則，共 {viewer.group.stories.length} 則
              </small>
            </div>
            <button
              className={styles.action}
              ref={closeButton}
              type="button"
              onClick={viewer.close}
              aria-label="關閉限時動態"
            >
              ×
            </button>
          </div>
        </header>
        <div
          className={styles.canvas}
          onPointerDown={(e) => {
            gesture.current =
              e.isPrimary && e.button === 0
                ? { x: e.clientX, y: e.clientY, pointerId: e.pointerId }
                : null;
          }}
          onPointerCancel={() => {
            gesture.current = null;
          }}
          onPointerUp={(e) => {
            const start = gesture.current;
            gesture.current = null;
            if (!start || e.pointerId !== start.pointerId) return;
            const dx = e.clientX - start.x;
            const dy = e.clientY - start.y;
            if (Math.abs(dx) >= 50 && Math.abs(dx) > Math.abs(dy) * 1.5) {
              viewer.switchAuthor(dx < 0 ? 1 : -1);
            } else if (Math.abs(dx) < 8 && Math.abs(dy) < 8 && !window.getSelection()?.toString()) {
              const rect = e.currentTarget.getBoundingClientRect();
              const fraction = (e.clientX - rect.left) / rect.width;
              if (fraction < 0.3) viewer.previous();
              if (fraction > 0.7) viewer.next();
            }
          }}
        >
          {story.kind === 'video' && mediaUrl && failedId !== story.id ? (
            <video
              key={story.id}
              src={mediaUrl}
              className={styles.photo}
              controls
              autoPlay
              playsInline
              onLoadedData={() => setLoadedId(story.id)}
              onError={() => setFailedId(story.id)}
            />
          ) : photo && mediaUrl && failedId !== story.id ? (
            <Image
              unoptimized
              loading="eager"
              width={900}
              height={1600}
              key={story.id}
              className={styles.photo}
              src={mediaUrl!}
              alt="限時動態照片"
              onLoad={() => setLoadedId(story.id)}
              onError={() => setFailedId(story.id)}
            />
          ) : photo ? (
            <p className={styles.unavailable}>照片暫時無法顯示</p>
          ) : null}
          {!!story.text && <p className={photo ? styles.caption : styles.text}>{story.text}</p>}
        </div>
        <footer className={styles.footer}>
          {story.poiName && <span className={styles.location}>{story.poiName}</span>}
          <nav aria-label="限時動態播放控制" className={styles.controls}>
            <button type="button" disabled={!viewer.hasPrevious} onClick={viewer.previous}>
              ‹ 上一則
            </button>
            <button type="button" aria-pressed={auto} onClick={() => setAuto((v) => !v)}>
              {auto ? '暫停' : '自動播放'}
            </button>
            <button type="button" onClick={viewer.next}>
              {viewer.hasNext ? '下一則 ›' : '看完了 ✓'}
            </button>
          </nav>
        </footer>
      </div>
    </dialog>
  );
}
