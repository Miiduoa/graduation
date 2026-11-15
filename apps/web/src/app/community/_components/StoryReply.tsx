'use client';

import Link from 'next/link';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { openModalSession } from '@/components/ui/modalSession';
import { sendStoryReply } from '@/lib/community/storyReplies';
import type { CampusStoryDoc } from '@/lib/community/firestore';
import modal from './StoryAudience.module.css';
import styles from './StoryReply.module.css';

function errorText(error: unknown) {
  if (error instanceof Error && error.message === 'reply-session')
    return '請重新登入學校帳號後再回覆。';
  switch ((error as { code?: string } | null)?.code) {
    case 'functions/unauthenticated':
      return '請重新登入學校帳號後再回覆。';
    case 'functions/permission-denied':
    case 'functions/not-found':
    case 'functions/failed-precondition':
      return '目前無法回覆這則限動，可能已過期或無法傳送私訊。';
    default:
      return '尚未確認送達，請確認連線後重試。';
  }
}

export function StoryReply({
  story,
  author,
  viewerUid,
  open,
  onClose,
}: {
  story: CampusStoryDoc;
  author: string;
  viewerUid: string;
  open: boolean;
  onClose: () => void;
}) {
  const title = useId();
  const field = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const receipt = useRef<HTMLParagraphElement>(null);
  const attempt = useRef<{ content: string; id: string } | null>(null);
  const inFlight = useRef(false);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const [sentTo, setSentTo] = useState('');
  useEffect(() => {
    if (open && dialog.current)
      return openModalSession(dialog.current, input.current ?? receipt.current);
  }, [open]);
  useEffect(() => {
    if (sentTo && open) receipt.current?.focus({ preventScroll: true });
  }, [sentTo, open]);

  const close = () => {
    if (sentTo) setSentTo('');
    onClose();
  };
  async function submit(event: FormEvent) {
    event.preventDefault();
    const content = draft.trim();
    if (!content || content.length > 500 || inFlight.current || sentTo) return;
    if (navigator.onLine === false) {
      setError('目前離線，請在恢復連線後重試。');
      return;
    }
    inFlight.current = true;
    setSending(true);
    setError('');
    try {
      if (attempt.current?.content !== content) {
        attempt.current = { content, id: crypto.randomUUID() };
      }
      const conversationId = await sendStoryReply(viewerUid, {
        schoolId: story.schoolId,
        storyId: story.id,
        authorUid: story.authorUid,
        replyId: attempt.current.id,
        content,
      });
      setSentTo(conversationId);
      setDraft('');
      attempt.current = null;
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      inFlight.current = false;
      setSending(false);
    }
  }

  if (!open) return null;
  return (
    <dialog
      ref={dialog}
      className={modal.panel}
      aria-labelledby={title}
      aria-modal="true"
      onCancel={(event) => {
        event.preventDefault();
        event.stopPropagation();
        close();
      }}
    >
      <header className={modal.heading}>
        <div>
          <h2 id={title}>回覆限時動態</h2>
          <p>回覆會傳到你和{author}的私訊。</p>
        </div>
        <button type="button" aria-label="返回限時動態" onClick={close}>
          ×
        </button>
      </header>
      {sentTo ? (
        <div className={styles.result}>
          <p role="status" ref={receipt} tabIndex={-1}>
            回覆已送出
          </p>
          <Link href={`/dms/${encodeURIComponent(sentTo)}`}>開啟私訊</Link>
        </div>
      ) : (
        <form className={styles.form} onSubmit={submit}>
          <label htmlFor={field}>回覆內容</label>
          <textarea
            ref={input}
            id={field}
            value={draft}
            readOnly={sending}
            maxLength={500}
            rows={3}
            placeholder="想對作者說什麼？"
            onChange={(event) => {
              setDraft(event.target.value);
              setError('');
            }}
          />
          {error && <p role="alert">{error}</p>}
          <div className={styles.actions}>
            <small>{draft.length} / 500</small>
            <button type="submit" disabled={!draft.trim() || sending}>
              {sending ? '傳送中…' : error ? '重試送出' : '送出回覆'}
            </button>
          </div>
        </form>
      )}
    </dialog>
  );
}
