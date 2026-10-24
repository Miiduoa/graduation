'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  loadCampusEventPage,
  type CampusEvent,
  type CampusEventCursor,
  type CampusEventSkippedRow,
} from '@/lib/campusEvents';
import {
  buildCampusEventDetailHref,
  campusEventKey,
  campusEventMatchesSearch,
  campusEventSourceLabel,
  formatCampusEventDateTime,
  userFacingCampusEventError,
} from './eventPresentation';
import styles from './events.module.css';

type ReadyState = {
  status: 'ready';
  schoolId: string;
  items: CampusEvent[];
  nextCursor: CampusEventCursor | null;
  skipped: CampusEventSkippedRow[];
  moreError: string | null;
  loadingMore: boolean;
};

type LoadState =
  | { status: 'loading'; schoolId: string }
  | { status: 'failed'; schoolId: string; message: string }
  | ReadyState;

function listForSchool(state: LoadState, schoolId: string): LoadState {
  return state.schoolId === schoolId ? state : { status: 'loading', schoolId };
}

function mergePage(
  existing: CampusEvent[],
  incoming: CampusEvent[],
): CampusEvent[] {
  const seen = new Set(existing.map(campusEventKey));
  const merged = [...existing];
  for (const item of incoming) {
    const key = campusEventKey(item);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(item);
  }
  return merged;
}

export function EventList({
  schoolId,
  schoolSearch,
}: {
  schoolId: string;
  schoolSearch: string;
}) {
  const [state, setState] = useState<LoadState>({ status: 'loading', schoolId });
  const [search, setSearch] = useState('');
  const generation = useRef(0);
  const mounted = useRef(false);
  const view = listForSchool(state, schoolId);

  const loadInitial = useCallback(() => {
    const request = ++generation.current;
    setState({ status: 'loading', schoolId });
    return loadCampusEventPage(schoolId, null).then(
      (page) => {
        if (!mounted.current || request !== generation.current) return;
        setState({
          status: 'ready',
          schoolId,
          items: page.items,
          nextCursor: page.nextCursor,
          skipped: page.skipped,
          moreError: null,
          loadingMore: false,
        });
      },
      (error) => {
        if (!mounted.current || request !== generation.current) return;
        setState({
          status: 'failed',
          schoolId,
          message: userFacingCampusEventError(error, '暫時無法讀取校園活動，請稍後再試。'),
        });
      },
    );
  }, [schoolId]);

  useEffect(() => {
    mounted.current = true;
    void loadInitial();
    return () => {
      mounted.current = false;
      generation.current += 1;
    };
  }, [loadInitial]);

  async function loadMore() {
    if (view.status !== 'ready' || !view.nextCursor || view.loadingMore) return;
    const request = generation.current;
    const cursor = view.nextCursor;
    setState({ ...view, loadingMore: true, moreError: null });
    try {
      const page = await loadCampusEventPage(schoolId, cursor);
      if (!mounted.current || request !== generation.current) return;
      setState((current) => {
        if (current.status !== 'ready' || current.schoolId !== schoolId) return current;
        return {
          ...current,
          items: mergePage(current.items, page.items),
          nextCursor: page.nextCursor,
          skipped: [...current.skipped, ...page.skipped],
          moreError: null,
          loadingMore: false,
        };
      });
    } catch (error) {
      if (!mounted.current || request !== generation.current) return;
      setState((current) => {
        if (current.status !== 'ready' || current.schoolId !== schoolId) return current;
        return {
          ...current,
          // Keep existing items and cursor on load-more failure.
          nextCursor: cursor,
          moreError: userFacingCampusEventError(error, '無法載入更多活動，已保留目前列表。'),
          loadingMore: false,
        };
      });
    }
  }

  if (view.status === 'loading') {
    return (
      <div className={styles.status} role="status">
        正在讀取校園活動…
      </div>
    );
  }

  if (view.status === 'failed') {
    return (
      <section className={styles.status} role="alert">
        <h2>無法讀取校園活動</h2>
        <p>{view.message}</p>
        <button type="button" className="btn" onClick={() => void loadInitial()}>
          重新讀取
        </button>
      </section>
    );
  }

  const filtered = view.items.filter((event) => campusEventMatchesSearch(event, search));
  const searching = search.trim().length > 0;

  return (
    <div className={styles.page}>
      {view.items.length > 0 ? (
        <div className={styles.toolbar}>
          <label className={styles.search}>
            在已載入的活動中搜尋
            <input
              type="search"
              placeholder="標題、地點、主辦或來源"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
        </div>
      ) : null}

      {view.skipped.length > 0 ? (
        <p className={styles.incomplete} role="status">
          有 {view.skipped.length}{' '}
          筆活動資料不完整，已略過。
        </p>
      ) : null}

      {view.items.length === 0 ? (
        <section className={styles.status}>
          <h2>目前沒有可顯示的校園活動</h2>
          <p>這所學校目前沒有讀到可公開顯示的活動資料。</p>
          <button type="button" className="btn" onClick={() => void loadInitial()}>
            重新讀取
          </button>
        </section>
      ) : filtered.length === 0 ? (
        <section className={styles.status}>
          <h2>已載入的活動中沒有符合的結果</h2>
          <p>搜尋範圍為已載入的活動，可載入更多後再找。</p>
        </section>
      ) : (
        <div className={styles.list} aria-label="校園活動列表">
          {filtered.map((event) => (
            <article key={campusEventKey(event)} className={styles.item}>
              <div className={styles.meta}>
                <span>{campusEventSourceLabel(event.source)}</span>
                <time dateTime={event.startsAt || undefined}>
                  {formatCampusEventDateTime(event.startsAt)}
                </time>
                {event.location ? <span>{event.location}</span> : null}
              </div>
              <h2>
                <Link href={buildCampusEventDetailHref(event.id, event.source, schoolSearch)}>
                  {event.title}
                </Link>
              </h2>
              {event.description ? (
                <p className={styles.summary}>
                  {event.description.length > 160
                    ? `${event.description.slice(0, 160)}…`
                    : event.description}
                </p>
              ) : null}
            </article>
          ))}
        </div>
      )}

      {!searching && view.nextCursor ? (
        <div className={styles.more}>
          {view.moreError ? (
            <p className={styles.notice} role="alert">
              {view.moreError}
            </p>
          ) : null}
          <button
            type="button"
            className="btn"
            disabled={view.loadingMore}
            onClick={() => void loadMore()}
          >
            {view.loadingMore ? '載入更多中…' : '載入更多'}
          </button>
        </div>
      ) : null}
    </div>
  );
}
