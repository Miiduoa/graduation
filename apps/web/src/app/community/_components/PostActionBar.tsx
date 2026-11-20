import type { ReactNode } from 'react';
import { BOOKMARK_UNAVAILABLE_COPY } from '@/lib/community/bookmarks';
import styles from '../community.module.css';

export function PostActionsRow({ children }: { children: ReactNode }) {
  return <div className={styles.postActions}>{children}</div>;
}

export function PostBookmarkShareActions({
  saved,
  bookmarkDisabled,
  bookmarkUnavailable,
  onBookmark,
  onShare,
  shareAriaLabel,
}: {
  saved: boolean;
  bookmarkDisabled?: boolean;
  bookmarkUnavailable?: boolean;
  onBookmark: () => void;
  onShare: () => void;
  shareAriaLabel: string;
}) {
  return (
    <div className={styles.postActionsEnd}>
      <button
        type="button"
        className={`${styles.postAction} ${styles.postBookmark}`}
        onClick={() => {
          if (bookmarkDisabled || bookmarkUnavailable) return;
          onBookmark();
        }}
        disabled={bookmarkDisabled || bookmarkUnavailable}
        aria-pressed={saved}
        aria-label={bookmarkUnavailable ? BOOKMARK_UNAVAILABLE_COPY : saved ? '取消收藏貼文' : '收藏貼文'}
        title={bookmarkUnavailable ? BOOKMARK_UNAVAILABLE_COPY : undefined}
      >
        <span aria-hidden="true">{saved ? '🔖' : '▤'}</span>
        <span className={styles.postActionFull}>{saved ? '已收藏' : '收藏'}</span>
        <span className={styles.postActionShort}>{saved ? '已藏' : '收藏'}</span>
      </button>
      <button type="button" className={styles.postAction} onClick={onShare} aria-label={shareAriaLabel}>
        <span aria-hidden="true">🔗</span>
        <span className={styles.postActionFull}>分享</span>
        <span className={styles.postActionShort}>分享</span>
      </button>
    </div>
  );
}
