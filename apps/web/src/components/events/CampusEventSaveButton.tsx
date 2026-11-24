'use client';

import { useId, useRef, useState } from 'react';
import {
  campusEventShortlistScopeCopy,
  toSavedCampusEvent,
  type CampusEventShortlistController,
  type SavedCampusEvent,
} from '@/lib/campusEventShortlist';
import styles from './events.module.css';

type EventIdentity = Pick<SavedCampusEvent, 'schoolId' | 'id' | 'source' | 'title'>;

/**
 * Toggle for the device-local saved list. Saved state comes only from the stored copy, so a
 * failed write never looks saved. It uses aria-disabled so keyboard focus survives a busy write.
 */
export function CampusEventSaveButton({ event, shortlist, showHint = false }: {
  event: EventIdentity;
  shortlist: CampusEventShortlistController;
  /** Explain why saving is not available yet; used on the detail page where there is room. */
  showHint?: boolean;
}) {
  const hintId = useId();
  const saved = shortlist.isSaved(event);
  const busy = shortlist.isBusy(event);
  const unavailable = !shortlist.ready || busy;
  const hint = !showHint
    ? ''
    : shortlist.scope === 'pending'
      ? campusEventShortlistScopeCopy(shortlist.scope)
      : shortlist.phase === 'loading'
        ? '正在讀取此裝置的收藏…'
        : '';
  const button = (
    <button
      type="button"
      className={`btn ${styles.saveButton}`}
      data-saved={saved ? 'true' : 'false'}
      aria-disabled={unavailable ? 'true' : undefined}
      aria-busy={busy ? 'true' : undefined}
      aria-describedby={hint ? hintId : undefined}
      onClick={() => {
        if (!unavailable) void shortlist.toggle(toSavedCampusEvent(event), !saved);
      }}
    >
      <span aria-hidden="true" className={styles.saveMark}>{saved ? '★' : '☆'}</span>
      <span>{busy ? '儲存中…' : saved ? '取消收藏' : '收藏'}</span>
      <span className={styles.srOnly}>「{event.title}」</span>
    </button>
  );
  if (!showHint) return button;
  return (
    <span className={styles.saveControl}>
      {button}
      {hint ? <span id={hintId} className={styles.saveHint}>{hint}</span> : null}
    </span>
  );
}

/**
 * One persistent live region for save/remove results and a persistent-failure alert with retry.
 * Retry restores focus to this container because the retry button disappears on success.
 */
export function CampusEventShortlistFeedback({ shortlist }: { shortlist: CampusEventShortlistController }) {
  const container = useRef<HTMLDivElement>(null);
  const [retrying, setRetrying] = useState(false);
  async function retry() {
    if (retrying) return;
    setRetrying(true);
    try {
      if (await shortlist.retry()) container.current?.focus();
    } finally {
      setRetrying(false);
    }
  }
  return (
    <div ref={container} tabIndex={-1} className={styles.shortlistFeedback}>
      <p role="status" aria-live="polite" className={styles.shortlistNotice}>
        {shortlist.scope === 'signing-out' ? campusEventShortlistScopeCopy(shortlist.scope) : shortlist.notice}
      </p>
      {shortlist.error ? (
        <div role="alert" className={styles.shortlistError}>
          <p>{shortlist.error}</p>
          <button type="button" className="btn" aria-disabled={retrying ? 'true' : undefined} onClick={() => void retry()}>
            {retrying ? '重試中…' : '重試'}
          </button>
        </div>
      ) : null}
    </div>
  );
}
