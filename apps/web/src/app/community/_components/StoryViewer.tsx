'use client';

import { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { openModalSession } from '@/components/ui/modalSession';
import { StoryAudience } from './StoryAudience';
import { StoryReply } from './StoryReply';
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
  const playbackButton = useRef<HTMLButtonElement>(null);
  const photoElement = useRef<HTMLImageElement>(null);
  const videoElement = useRef<HTMLVideoElement>(null);
  const videoBar = useRef<HTMLElement>(null);
  const beforePanel = useRef<{ element: HTMLVideoElement; playing: boolean } | null>(null);
  const gesture = useRef<{ x: number; y: number; pointerId: number } | null>(null);
  const [auto, setAuto] = useState(false);
  const [panelFor, setPanelFor] = useState<string | null>(null);
  const [hidden, setHidden] = useState(() => document.hidden);
  const story = viewer.group.stories[viewer.index]!;
  const photo = story.kind === 'image' && !!story.mediaUrl;
  const video = story.kind === 'video';
  const media = photo || video;
  const scope = JSON.stringify([viewer.viewerUid, story.schoolId, story.authorUid, story.id]);
  const mediaScope = JSON.stringify([scope, story.kind, story.mediaUrl]);
  const [mediaState, setMediaState] = useState<{
    scope: string;
    attempt: number;
    status: 'loading' | 'loaded' | 'failed';
  }>({ scope: mediaScope, attempt: 0, status: 'loading' });
  // A newly mounted image must finish loading even when returning to the same story.
  if (mediaState.scope !== mediaScope) {
    setMediaState({ scope: mediaScope, attempt: 0, status: 'loading' });
  }
  const mediaKey = JSON.stringify([mediaScope, mediaState.attempt]);
  const photoLoaded = photo && mediaState.status === 'loaded';
  const failedVideo = video && (!story.mediaUrl || mediaState.status === 'failed');
  const failedPhoto = photo && mediaState.status === 'failed';
  const canReply =
    story.allowReplies === true &&
    !!viewer.viewerUid &&
    viewer.viewerUid !== story.authorUid &&
    !viewer.isOwner &&
    viewer.group.authorUid === story.authorUid;
  const panelOpen = panelFor === scope && (viewer.isOwner || canReply);
  if (panelFor !== null && !panelOpen) setPanelFor(null);
  const running =
    auto &&
    !panelOpen &&
    !hidden &&
    !video &&
    (!photo || photoLoaded) &&
    !failedPhoto;
  const onNext = useRef(viewer.next);
  useEffect(() => {
    onNext.current = viewer.next;
  }, [viewer.next]);
  const remaining = useRef(DWELL_MS);

  function retryMedia() {
    // Keep the same signed URL; appending a cache buster could invalidate its signature.
    setAuto(false);
    setMediaState((current) => ({ ...current, attempt: current.attempt + 1, status: 'loading' }));
  }

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    return openModalSession(element, closeButton.current);
  }, []);
  useEffect(() => {
    if (mediaState.attempt > 0) playbackButton.current?.focus({ preventScroll: true });
  }, [mediaState.scope, mediaState.attempt]);
  useEffect(() => {
    const element = videoElement.current;
    let live = true;
    let resumeOnReturn = false;
    function play() {
      void element?.play().catch((error: unknown) => {
        // Pausing (including when the tab hides) may abort a pending play request.
        if (live && !(error instanceof DOMException && error.name === 'AbortError')) setAuto(false);
      });
    }
    const saved = beforePanel.current;
    if (panelOpen && element) {
      if (saved?.element !== element) {
        beforePanel.current = { element, playing: !element.paused && !element.ended };
      }
      element.pause();
    } else {
      const shouldPlay = saved?.element === element ? saved.playing : auto;
      beforePanel.current = null;
      if (shouldPlay && !document.hidden) play();
      else element?.pause();
    }
    function sync() {
      setHidden(document.hidden);
      if (!element) return;
      if (document.hidden) {
        resumeOnReturn = !panelOpen && auto && !element.paused && !element.ended;
        element.pause();
      } else if (resumeOnReturn) {
        resumeOnReturn = false;
        play();
      }
    }
    document.addEventListener('visibilitychange', sync);
    return () => {
      live = false;
      document.removeEventListener('visibilitychange', sync);
    };
  }, [auto, panelOpen, failedVideo, mediaKey]);

  useEffect(() => {
    remaining.current = DWELL_MS;
    gesture.current = null;
  }, [scope]);
  useEffect(() => {
    if (!running) return;
    const start = performance.now();
    const timer = window.setTimeout(() => onNext.current(), remaining.current);
    return () => {
      window.clearTimeout(timer);
      remaining.current = Math.max(0, remaining.current - (performance.now() - start));
    };
  }, [scope, running]);

  return (
    <dialog
      ref={dialog}
      className={styles.dialog}
      aria-label="限時動態"
      aria-modal="true"
      onCancel={(e) => {
        e.preventDefault();
        if (!panelOpen) viewer.close();
      }}
      onKeyDown={(e) => {
        if (
          panelOpen ||
          e.altKey ||
          e.metaKey ||
          e.ctrlKey ||
          e.shiftKey ||
          e.target instanceof HTMLVideoElement
        )
          return;
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          e.preventDefault();
          if (e.key === 'ArrowLeft') viewer.previous();
          else viewer.next();
        }
      }}
    >
      <div
        className={styles.frame}
        style={{ backgroundColor: media ? '#121212' : story.bgColor || '#243b35' }}
      >
        <header className={styles.header}>
          <div className={styles.segments} aria-hidden="true" key={scope}>
            {viewer.group.stories.map((s, i) => (
              <span key={s.id} data-past={i < viewer.index}>
                {i === viewer.index && (
                  <i
                    ref={video ? videoBar : undefined}
                    style={
                      video
                        ? { animation: 'none', transform: 'scaleX(0)' }
                        : {
                            animationDuration: DWELL_MS + 'ms',
                            animationPlayState: running ? 'running' : 'paused',
                          }
                    }
                  />
                )}
              </span>
            ))}
          </div>
          <div className={styles.byline}>
            <span className={styles.avatar} aria-hidden="true">
              {avatar ? (
                <Image src={avatar} alt="" unoptimized width={38} height={38} />
              ) : (
                author.slice(0, 1)
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
            if (e.target instanceof Element && e.target.closest('button')) {
              gesture.current = null;
              return;
            }
            // Leave native play/seek controls alone; swipes across the picture can still change author.
            if (
              e.target instanceof HTMLVideoElement &&
              e.clientY >= e.target.getBoundingClientRect().bottom - 60
            ) {
              gesture.current = null;
              return;
            }
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
            if (e.target instanceof Element && e.target.closest('button')) return;
            if (!start || e.pointerId !== start.pointerId) return;
            const dx = e.clientX - start.x;
            const dy = e.clientY - start.y;
            if (Math.abs(dx) >= 50 && Math.abs(dx) > Math.abs(dy) * 1.5) {
              viewer.switchAuthor(dx < 0 ? 1 : -1);
            } else if (
              !(e.target instanceof HTMLVideoElement) &&
              Math.abs(dx) < 8 &&
              Math.abs(dy) < 8 &&
              !window.getSelection()?.toString()
            ) {
              const rect = e.currentTarget.getBoundingClientRect();
              const fraction = (e.clientX - rect.left) / rect.width;
              if (fraction < 0.3) viewer.previous();
              if (fraction > 0.7) viewer.next();
            }
          }}
        >
          {video && story.mediaUrl && !failedVideo ? (
            <video
              key={mediaKey}
              ref={videoElement}
              className={styles.photo}
              src={story.mediaUrl}
              aria-label="限時動態影片"
              controls
              muted
              playsInline
              preload="metadata"
              tabIndex={0}
              onTimeUpdate={(event) => {
                if (event.currentTarget !== videoElement.current) return;
                const { currentTime, duration } = event.currentTarget;
                if (videoBar.current && duration > 0 && Number.isFinite(duration)) {
                  videoBar.current.style.transform = `scaleX(${Math.min(1, currentTime / duration)})`;
                }
              }}
              onEnded={(event) => {
                if (event.currentTarget !== videoElement.current) return;
                if (auto && !panelOpen && !document.hidden) viewer.next();
              }}
              onError={(event) => {
                if (event.currentTarget !== videoElement.current) return;
                setMediaState((current) => ({ ...current, status: 'failed' }));
                setAuto(false);
              }}
            />
          ) : video ? (
            <div role="status" className={styles.mediaError}>
              <p>這段影片暫時無法播放。</p>
              {story.mediaUrl && (
                <button type="button" onClick={retryMedia}>重新載入影片</button>
              )}
            </div>
          ) : photo && !failedPhoto ? (
            <div className={styles.photoFrame}>
              <Image
                unoptimized
                loading="eager"
                width={900}
                height={1600}
                key={mediaKey}
                ref={photoElement}
                className={styles.photo}
                src={story.mediaUrl!}
                alt="限時動態照片"
                onLoad={(event) => {
                  if (event.currentTarget === photoElement.current) {
                    setMediaState((current) => ({ ...current, status: 'loaded' }));
                  }
                }}
                onError={(event) => {
                  if (event.currentTarget !== photoElement.current) return;
                  setMediaState((current) => ({ ...current, status: 'failed' }));
                  setAuto(false);
                }}
              />
              {!photoLoaded && <p className={styles.mediaLoading} role="status">照片載入中…</p>}
            </div>
          ) : photo ? (
            <div role="status" className={styles.mediaError}>
              <p>照片暫時無法顯示</p>
              <button type="button" onClick={retryMedia}>重新載入照片</button>
            </div>
          ) : null}
          {!!story.text && <p className={media ? styles.caption : styles.text}>{story.text}</p>}
        </div>
        <footer className={styles.footer}>
          {viewer.isOwner && (
            <button
              className={styles.audienceButton}
              type="button"
              aria-haspopup="dialog"
              aria-expanded={panelOpen}
              onClick={() => setPanelFor(scope)}
            >
              誰看過
            </button>
          )}
          {canReply && (
            <button
              className={styles.audienceButton}
              type="button"
              aria-haspopup="dialog"
              aria-expanded={panelOpen}
              onClick={() => setPanelFor(scope)}
            >
              私下回覆
            </button>
          )}
          {!viewer.isOwner && <small className={styles.receiptNotice}>作者可查看誰看過</small>}
          {story.poiName && <span className={styles.location}>{story.poiName}</span>}
          <nav aria-label="限時動態播放控制" className={styles.controls}>
            <button type="button" disabled={!viewer.hasPrevious} onClick={viewer.previous}>
              ‹ 上一則
            </button>
            <button
              ref={playbackButton}
              type="button"
              aria-pressed={auto}
              disabled={failedVideo || failedPhoto}
              onClick={() => setAuto((v) => !v)}
            >
              {video ? (auto ? '停止連播' : '連續播放') : auto ? '暫停' : '自動播放'}
            </button>
            <button type="button" onClick={viewer.next}>
              {viewer.hasNext ? '下一則 ›' : '看完了 ✓'}
            </button>
          </nav>
        </footer>
      </div>
      {viewer.isOwner && panelOpen && (
        <StoryAudience key={scope} story={story} onClose={() => setPanelFor(null)} />
      )}
      {canReply && viewer.viewerUid && (
        <StoryReply
          key={scope}
          story={story}
          author={author}
          viewerUid={viewer.viewerUid}
          open={panelOpen}
          onClose={() => setPanelFor(null)}
        />
      )}
    </dialog>
  );
}
