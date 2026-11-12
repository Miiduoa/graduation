'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import {
  confirmDmPhoto,
  isDmPhotoUnavailable,
  photoAccept,
  readDmPhoto,
  uploadDmPhoto,
  validDmPhoto,
  type PhotoScope,
} from '@/lib/dmPhotos';
import { newPrivateMessageId, type PrivateMessage } from '@/lib/privateMessages';
import styles from './messaging.module.css';
import { areFunctionsConfigured } from '@/lib/cloudFunctions';

function PhotoIcon() {
  return (
    <svg
      aria-hidden="true"
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3" y="3" width="18" height="18" rx="4" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <path d="m4 17 5-5 3 3 4-5 5 6" />
    </svg>
  );
}

type PhotoDraft = {
  file: File;
  previewReady: boolean;
  messageId: string;
  uploadedPath?: string;
};

export function DmPhotoComposer({
  scope,
  ready,
  confirmedPhotos,
  onSent,
}: {
  scope: Omit<PhotoScope, 'messageId'>;
  ready: boolean;
  confirmedPhotos?: readonly PrivateMessage[];
  onSent: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const request = useRef<{
    controller: AbortController;
    messageId: string;
    publishedPath: string | undefined;
    confirmed: boolean;
  } | null>(null);
  const [draft, setDraft] = useState<PhotoDraft | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);
  const preview = useRef<HTMLImageElement>(null);
  const previewFile = draft?.file;
  useLayoutEffect(() => {
    const image = preview.current;
    if (!previewFile || !image) return;
    const url = URL.createObjectURL(previewFile);
    try {
      const localUrl = new URL(url);
      if (localUrl.protocol === 'blob:') image.src = localUrl.href;
    } catch {
      // Invalid object URLs must never become preview sources.
    }
    return () => {
      image.removeAttribute('src');
      URL.revokeObjectURL(url);
    };
  }, [previewFile]);
  useLayoutEffect(() => () => request.current?.controller.abort(), []);
  const finish = useCallback(() => {
    setDraft(null);
    setError('');
    setSent(true);
    onSent();
    requestAnimationFrame(() => {
      if (document.activeElement === document.body) opener.current?.focus();
    });
  }, [onSent]);
  useLayoutEffect(() => {
    const pending = request.current;
    const publishedPath = pending?.publishedPath ?? draft?.uploadedPath?.replace(/\/photo\.(jpg|png|webp)$/, '/sent.$1');
    const messageId = pending?.messageId ?? draft?.messageId;
    if (!publishedPath || !confirmedPhotos?.some((message) =>
      message.id === messageId && message.senderId === scope.viewerUid &&
      message.type === 'image' && message.attachmentPath === publishedPath,
    )) return;
    if (pending) pending.confirmed = true;
    else finish();
  }, [confirmedPhotos, scope.viewerUid, sending, draft?.messageId, draft?.uploadedPath, finish]);

  function select(file?: File) {
    if (!file || !ready || request.current) return;
    setSent(false);
    if (!validDmPhoto(file)) {
      setError('請選擇小於 10 MiB 的 JPG、PNG 或 WebP 照片。');
      return;
    }
    setError('');
    setDraft({
      file,
      previewReady: false,
      messageId: newPrivateMessageId(scope.conversationId),
    });
  }

  async function send() {
    if (!draft?.previewReady || !ready || request.current) return;
    const controller = new AbortController();
    const pending = {
      controller,
      messageId: draft.messageId,
      publishedPath: draft.uploadedPath?.replace(/\/photo\.(jpg|png|webp)$/, '/sent.$1'),
      confirmed: false,
    };
    request.current = pending;
    setSending(true);
    setError('');
    const submission = { ...scope, messageId: draft.messageId };
    try {
      const path =
        draft.uploadedPath ?? (await uploadDmPhoto(submission, draft.file, controller.signal));
      if (controller.signal.aborted) return;
      pending.publishedPath = path.replace(/\/photo\.(jpg|png|webp)$/, '/sent.$1');
      // A lost acknowledgment retries only the message commit, with the same ID and object.
      if (!draft.uploadedPath) setDraft({ ...draft, uploadedPath: path });
      await confirmDmPhoto(submission, path, controller.signal).catch((error) => {
        if (!pending.confirmed) throw error;
      });
      if (controller.signal.aborted) return;
      finish();
    } catch (error) {
      if (!controller.signal.aborted) setError(isDmPhotoUnavailable(error) ? '照片私訊尚未開通' : '照片尚未確認送出，可以重試。');
    } finally {
      request.current = null;
      if (!controller.signal.aborted) setSending(false);
    }
  }

  return (
    <div className={styles.photoComposer}>
      <input
        hidden
        ref={input}
        type="file"
        aria-label="選擇私訊照片"
        accept={photoAccept}
        onChange={(event) => {
          select(event.target.files?.[0]);
          event.target.value = '';
        }}
      />
      {!draft ? (
        <button
          className={styles.photoButton}
          ref={opener}
          type="button"
          disabled={!ready}
          title="JPG、PNG 或 WebP，小於 10 MiB"
          onClick={() => {
            if (!areFunctionsConfigured()) setError('照片私訊尚未開通');
            else input.current?.click();
          }}
        >
          <PhotoIcon /> 加入照片
        </button>
      ) : (
        <div className={styles.photoDraft}>
          {/* Persistent image optimizers must never receive a private or local preview. */}
          {/* Only the selected File's blob object URL may become a preview source. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            key={draft.messageId}
            className={styles.photoThumb}
            ref={preview}
            alt="待傳送照片預覽"
            onLoad={() => {
              if (preview.current?.getAttribute('src')) {
                setDraft((current) => current && { ...current, previewReady: true });
              }
            }}
            onError={() => {
              setDraft(null);
              setError('無法讀取這張照片，請重新選擇。');
              requestAnimationFrame(() => opener.current?.focus());
            }}
          />
          <div className={styles.photoDetails}>
            <strong>待傳送照片</strong>
            <span>{draft.file.name}</span>
          </div>
          <div className={styles.photoActions}>
            <button
              type="button"
              className={styles.button}
              disabled={sending}
              onClick={() => {
                setDraft(null);
                setError('');
                requestAnimationFrame(() => opener.current?.focus());
              }}
            >
              移除照片
            </button>
            <button
              type="button"
              className={styles.primary}
              disabled={!ready || !draft.previewReady || sending}
              onClick={() => void send()}
            >
              {sending
                ? '照片傳送中…'
                : !draft.previewReady
                  ? '讀取照片中…'
                  : error
                    ? '重新傳送照片'
                    : '傳送照片'}
            </button>
          </div>
        </div>
      )}
      {error && (
        <small role="alert" className={styles.feedback}>
          {error}
        </small>
      )}
      {sent && (
        <small role="status" className={styles.muted}>
          照片已傳送
        </small>
      )}
    </div>
  );
}

export function DmPhotoMessage({ scope, path }: { scope: PhotoScope; path: string }) {
  const [grant, setGrant] = useState<Awaited<ReturnType<typeof readDmPhoto>> | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const request = useRef<AbortController | null>(null);
  const image = useRef<HTMLImageElement>(null);
  const viewing = loading || !!grant;
  useLayoutEffect(() => () => request.current?.abort(), []);
  useLayoutEffect(() => {
    if (!viewing) return;
    function hide() {
      request.current?.abort();
      request.current = null;
      // Discard the image before the browser freezes this document in its back/forward cache.
      image.current?.removeAttribute('src');
      flushSync(() => {
        setGrant(null);
        setLoading(false);
        setError('');
      });
    }
    function onVisibility() {
      if (document.hidden) hide();
    }
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', hide);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', hide);
    };
  }, [viewing]);
  useEffect(() => {
    if (!grant) return;
    const timer = window.setTimeout(
      () => {
        setGrant(null);
        setError('檢視時間已結束，可以再次開啟。');
      },
      Math.max(0, Date.parse(grant.expiresAt) - Date.now()),
    );
    return () => window.clearTimeout(timer);
  }, [grant]);

  async function toggle() {
    if (grant) {
      setGrant(null);
      setError('');
      return;
    }
    if (document.hidden || request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    setError('');
    try {
      const next = await readDmPhoto(scope, path, controller.signal);
      if (!controller.signal.aborted && !document.hidden) setGrant(next);
    } catch (error) {
      if (!controller.signal.aborted) setError(isDmPhotoUnavailable(error) ? '照片私訊尚未開通' : '照片暫時無法開啟，請再試一次。');
    } finally {
      if (request.current === controller) {
        request.current = null;
        if (!controller.signal.aborted) setLoading(false);
      }
    }
  }
  return (
    <div className={styles.photoMessage}>
      <button
        type="button"
        className={styles.photoButton}
        aria-expanded={!!grant}
        disabled={loading}
        onClick={() => void toggle()}
      >
        <PhotoIcon />
        {grant ? '收合照片' : loading ? '正在開啟…' : '查看照片'}
      </button>
      {grant && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          ref={image}
          className={styles.chatPhoto}
          src={grant.url}
          referrerPolicy="no-referrer"
          alt="對話中的照片"
          onError={() => {
            setGrant(null);
            setError('照片暫時無法顯示，請再試一次。');
          }}
        />
      )}
      {error && (
        <small role="status" className={styles.muted}>
          {error}
        </small>
      )}
    </div>
  );
}
