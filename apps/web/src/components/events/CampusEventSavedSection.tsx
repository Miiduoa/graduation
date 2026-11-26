'use client';

import Link from 'next/link';
import { useEffect, useId, useRef } from 'react';
import {
  campusEventShortlistIdentity,
  campusEventShortlistScopeCopy,
  type CampusEventShortlistController,
  type SavedCampusEvent,
} from '@/lib/campusEventShortlist';
import {
  buildCampusEventDetailHref,
  campusEventSourceLabel,
  type CampusEventFilters,
} from './eventPresentation';
import styles from './events.module.css';

type FocusPlan = {
  removed: string;
  target: string | null;
  origin: HTMLButtonElement;
};

/**
 * Saved events are rendered from the stored identity and title only. They stay usable while the
 * live browse list is loading, failed or on a later page; the detail page reads the live event.
 */
export function CampusEventSavedSection({ shortlist, schoolSearch, filters, onBrowse }: {
  shortlist: CampusEventShortlistController;
  schoolSearch: string;
  filters: CampusEventFilters;
  onBrowse: () => void;
}) {
  const headingId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const removeButtons = useRef(new Map<string, HTMLButtonElement>());
  const focusPlan = useRef<FocusPlan | null>(null);
  const { items, phase } = shortlist;

  useEffect(() => {
    const plan = focusPlan.current;
    if (!plan) return;
    if (phase !== 'ready') {
      focusPlan.current = null;
      return;
    }
    if (items.some((item) => campusEventShortlistIdentity(item) === plan.removed)) return;
    focusPlan.current = null;
    // Only restore lost focus. A user may have moved to another control
    // while the device write was queued.
    if (document.activeElement !== document.body && document.activeElement !== plan.origin) return;
    const next = plan.target ? removeButtons.current.get(plan.target) : undefined;
    (next ?? heading.current)?.focus();
  }, [items, phase]);

  async function remove(item: SavedCampusEvent, index: number) {
    const identity = campusEventShortlistIdentity(item);
    const neighbor = items[index + 1] ?? items[index - 1];
    const origin = removeButtons.current.get(identity);
    // Pointer activation need not move the keyboard focus.
    const plan = origin && document.activeElement === origin
      ? { removed: identity, target: neighbor ? campusEventShortlistIdentity(neighbor) : null, origin }
      : null;
    focusPlan.current = plan;
    const result = await shortlist.toggle(item, false);
    if (result !== 'done' && focusPlan.current === plan) focusPlan.current = null;
  }

  return (
    <section className={styles.saved} aria-labelledby={headingId} data-testid="saved-events">
      <div className={styles.savedHeader}>
        <h2 id={headingId} ref={heading} tabIndex={-1}>我的收藏活動</h2>
        {phase === 'ready' ? <span className={styles.savedCount}>共 {items.length} 場</span> : null}
      </div>
      {(shortlist.scope === 'account' || shortlist.scope === 'guest') && (
        <p className={styles.savedScope}>{campusEventShortlistScopeCopy(shortlist.scope)}</p>
      )}

      {shortlist.scope === 'pending' && <p className={styles.savedState}>正在確認登入狀態…</p>}
      {phase === 'loading' && <p className={styles.savedState}>正在讀取此裝置的收藏…</p>}
      {phase === 'ready' && (items.length === 0 ? (
        <div className={styles.savedEmpty}>
          <h3>還沒有收藏的活動</h3>
          <p>瀏覽活動時按「收藏」，之後就能從這裡查看最新時間與報名方式。</p>
          <button type="button" className="btn primary" onClick={onBrowse}>瀏覽活動</button>
        </div>
      ) : (
        <ul className={styles.savedList} aria-label="已收藏活動">
          {items.map((item, index) => {
            const identity = campusEventShortlistIdentity(item);
            const busy = shortlist.isBusy(item);
            return (
              <li key={identity} className={styles.savedItem}>
                <div className={styles.savedBody}>
                  <p className={styles.savedSource}>{campusEventSourceLabel(item.source)}</p>
                  <h3>
                    <Link href={buildCampusEventDetailHref(item.id, item.source, schoolSearch, { ...filters, saved: true })}>
                      {item.title}
                    </Link>
                  </h3>
                </div>
                <button
                  type="button"
                  className="btn"
                  aria-disabled={busy ? 'true' : undefined}
                  ref={(node) => {
                    if (node) removeButtons.current.set(identity, node);
                    else removeButtons.current.delete(identity);
                  }}
                  onClick={() => { if (!busy) void remove(item, index); }}
                >
                  {busy ? '移除中…' : '取消收藏'}
                  <span className={styles.srOnly}>「{item.title}」</span>
                </button>
              </li>
            );
          })}
        </ul>
      ))}
    </section>
  );
}
