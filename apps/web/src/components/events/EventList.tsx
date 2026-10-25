'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { campusEventPhase, campusEventPhaseLabel, compareCampusEventTime } from '@campus/shared/src/campusEventTime';
import { replaceServiceListQuery } from '@/lib/serviceListNavigation';
import { useServiceListQuery } from '@/lib/useServiceListQuery';
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
  campusEventMatchesView,
  campusEventFilterQuery,
  campusEventSourceLabel,
  CAMPUS_EVENT_VIEWS,
  EVENT_RESTORE_BATCH_SIZE,
  formatCampusEventDateTime,
  readCampusEventFilters,
  userFacingCampusEventError,
  type CampusEventFilters,
} from './eventPresentation';
import styles from './events.module.css';
import { useEventClock } from './useEventClock';

type ReadyState = {
  status: 'ready';
  schoolId: string;
  items: CampusEvent[];
  nextCursor: CampusEventCursor | null;
  skipped: CampusEventSkippedRow[];
  moreError: string | null;
  loadingMore: boolean;
  refreshing: boolean;
  refreshError: string | null;
  pagesLoaded: number;
};

type LoadState =
  | { status: 'loading'; schoolId: string }
  | { status: 'failed'; schoolId: string; message: string }
  | ReadyState;

function listForSchool(state: LoadState, schoolId: string): LoadState {
  return state.schoolId === schoolId ? state : { status: 'loading', schoolId };
}

function mergePage(existing: CampusEvent[], incoming: CampusEvent[]): CampusEvent[] {
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

export function EventList({ schoolId, schoolSearch, initialFilters }: {
  schoolId: string;
  schoolSearch: string;
  initialFilters?: CampusEventFilters;
}) {
  const [state, setState] = useState<LoadState>({ status: 'loading', schoolId });
  const currentQuery = useServiceListQuery('/events', schoolId,
    campusEventFilterQuery(initialFilters ?? { q: '', view: 'all' }));
  const queryKey = `${schoolId}:${currentQuery.toString()}`;
  const parsedFilters = readCampusEventFilters(currentQuery);
  const [selection, setSelection] = useState({ queryKey, filters: parsedFilters });
  const filters = selection.queryKey === queryKey ? selection.filters : parsedFilters;
  if (selection.queryKey !== queryKey) setSelection({ queryKey, filters });
  const initialPage = parsedFilters.page ?? 1;
  const restoreKey = `${schoolId}:${initialPage}`;
  const [restoreTarget, setRestoreTarget] = useState({
    key: restoreKey, schoolId, page: Math.min(EVENT_RESTORE_BATCH_SIZE, initialPage), requestedPage: initialPage,
  });
  if (restoreTarget.key !== restoreKey) {
    setRestoreTarget({ key: restoreKey, schoolId, page: Math.min(EVENT_RESTORE_BATCH_SIZE, initialPage), requestedPage: initialPage });
  }
  const now = useEventClock();
  const generation = useRef(0);
  const activeMore = useRef<symbol | null>(null);
  const mounted = useRef(false);
  const searchInput = useRef<HTMLInputElement>(null);
  const view = listForSchool(state, schoolId);

  function updateFilters(next: CampusEventFilters) {
    const normalized = readCampusEventFilters(campusEventFilterQuery(next));
    setSelection({ queryKey, filters: normalized });
    replaceServiceListQuery('/events', schoolId, ['q', 'view'], campusEventFilterQuery(normalized));
  }

  const loadInitial = useCallback(() => {
    const request = ++generation.current;
    activeMore.current = null;
    setState((current) => current.status === 'ready' && current.schoolId === schoolId
      ? { ...current, refreshing: true, refreshError: null, loadingMore: false }
      : { status: 'loading', schoolId });
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
          refreshing: false,
          refreshError: null,
          pagesLoaded: 1,
        });
      },
      (error) => {
        if (!mounted.current || request !== generation.current) return;
        const message = userFacingCampusEventError(error, '暫時無法讀取校園活動，請稍後再試。');
        setState((current) => current.status === 'ready' && current.schoolId === schoolId
          ? { ...current, refreshing: false, refreshError: message }
          : { status: 'failed', schoolId, message });
      },
    );
  }, [schoolId]);

  useEffect(() => {
    mounted.current = true;
    void loadInitial();
    return () => {
      mounted.current = false;
      generation.current += 1;
      activeMore.current = null;
    };
  }, [loadInitial]);

  const loadMore = useCallback(async () => {
    if (view.status !== 'ready' || !view.nextCursor || view.loadingMore || view.refreshing || activeMore.current) return;
    const token = Symbol('more');
    activeMore.current = token;
    const request = generation.current;
    const cursor = view.nextCursor;
    setState({ ...view, loadingMore: true, moreError: null });
    try {
      const page = await loadCampusEventPage(schoolId, cursor);
      if (!mounted.current || request !== generation.current) return;
      const pagesLoaded = view.pagesLoaded + 1;
      const returnPage = page.nextCursor && restoreTarget.schoolId === schoolId
        ? Math.max(pagesLoaded, restoreTarget.requestedPage) : pagesLoaded;
      replaceServiceListQuery('/events', schoolId, ['page'], campusEventFilterQuery({ q: '', view: 'all', page: returnPage }));
      setState((current) => {
        if (current.status !== 'ready' || current.schoolId !== schoolId) return current;
        return {
          ...current,
          items: mergePage(current.items, page.items),
          nextCursor: page.nextCursor,
          skipped: [...current.skipped, ...page.skipped],
          moreError: null,
          loadingMore: false,
          pagesLoaded,
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
    } finally {
      if (activeMore.current === token) activeMore.current = null;
    }
  }, [view, schoolId, restoreTarget]);

  useEffect(() => {
    if (view.status === 'ready' && restoreTarget.schoolId === schoolId &&
      view.pagesLoaded < restoreTarget.page && !view.moreError && !view.refreshing) {
      void loadMore();
    }
  }, [view, restoreTarget, schoolId, loadMore]);

  function refreshList() {
    if (view.status === 'ready') setRestoreTarget({ key: restoreKey, schoolId, page: view.pagesLoaded, requestedPage: view.pagesLoaded });
    void loadInitial();
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

  const filtered = view.items
    .filter((event) => campusEventMatchesSearch(event, filters.q) && campusEventMatchesView(event, filters.view, now))
    .sort((a, b) => compareCampusEventTime(a, b, now));
  const searching = filters.q.trim().length > 0;
  const filtering = searching || filters.view !== 'all';

  return (
    <div className={styles.page}>
      <section className={styles.browse} aria-label="尋找校園活動">
        <div className={styles.toolbar}>
          <label className={styles.search}>
            在已載入的活動中搜尋
            <input
              ref={searchInput}
              type="search"
              placeholder="標題、地點、主辦或來源"
              maxLength={200}
              value={filters.q}
              onChange={(event) => updateFilters({ ...filters, q: event.target.value })}
            />
          </label>
          {searching ? (
            <button
              type="button"
              className="btn"
              onClick={() => {
                updateFilters({ ...filters, q: '' });
                searchInput.current?.focus();
              }}
            >
              清除搜尋
            </button>
          ) : null}
          <button type="button" className="btn" disabled={view.refreshing}
            onClick={refreshList}>
            {view.refreshing ? '更新中…' : '更新活動'}
          </button>
        </div>
        <div className={styles.filters} role="group" aria-label="活動時間">
          {CAMPUS_EVENT_VIEWS.map((option) => (
            <button key={option.value} type="button" aria-pressed={filters.view === option.value}
              onClick={() => updateFilters({ ...filters, view: option.value })}>
              {option.label}
              <span aria-hidden="true">{view.items.filter((event) => campusEventMatchesView(event, option.value, now)).length}</span>
            </button>
          ))}
        </div>
        <p className={styles.resultCount} role="status" aria-live="polite">
          已載入 {view.items.length} 場，顯示 {filtered.length} 場。
          {view.nextCursor ? '可繼續載入更多活動。' : ''}
        </p>
      </section>

      {view.refreshError ? <p className={styles.notice} role="alert">{view.refreshError} 目前列表已保留，可再次更新。</p> : null}

      {view.skipped.length > 0 ? (
        <p className={styles.incomplete} role="status">
          有 {view.skipped.length} 筆活動資料不完整，已略過。
        </p>
      ) : null}

      {view.items.length === 0 ? (
        <section className={styles.status}>
          <h2>目前沒有可顯示的校園活動</h2>
          <p>這所學校目前沒有讀到可公開顯示的活動資料。</p>
          <button type="button" className="btn" disabled={view.refreshing} onClick={refreshList}>
            重新讀取
          </button>
        </section>
      ) : filtered.length === 0 ? (
        <section className={styles.status}>
          <h2>已載入的活動中沒有符合的結果</h2>
          <p>
            {view.nextCursor
              ? '搜尋範圍為已載入的活動，可保留關鍵字，繼續載入更多。'
              : '目前已載入全部活動，請試試其他關鍵字或清除搜尋。'}
          </p>
          {filtering ? <button type="button" className="btn" onClick={() => {
            updateFilters({ q: '', view: 'all' });
            searchInput.current?.focus();
          }}>清除全部篩選</button> : null}
        </section>
      ) : (
        <div className={styles.list} aria-label="校園活動列表">
          {filtered.map((event) => (
            <article key={campusEventKey(event)} className={styles.item}>
              <div className={styles.dateTile} aria-hidden="true">
                {Number.isFinite(Date.parse(event.startsAt)) ? <>
                  <span>{new Date(event.startsAt).toLocaleDateString('zh-TW', { timeZone: 'Asia/Taipei', month: 'short' })}</span>
                  <strong>{new Date(event.startsAt).toLocaleDateString('zh-TW', { timeZone: 'Asia/Taipei', day: 'numeric' }).replace('日', '')}</strong>
                </> : <span>待公告</span>}
              </div>
              <div className={styles.itemContent}>
              <div className={styles.meta}>
                <span className={styles.phase} data-phase={campusEventPhase(event, now)}>
                  {campusEventPhaseLabel(campusEventPhase(event, now))}
                </span>
                <span>{campusEventSourceLabel(event.source)}</span>
                <time dateTime={event.startsAt || undefined}>
                  {formatCampusEventDateTime(event.startsAt)}
                </time>
                {event.location ? <span>{event.location}</span> : null}
              </div>
              <h2>
                <Link href={buildCampusEventDetailHref(event.id, event.source, schoolSearch, { ...filters, page: view.pagesLoaded })}>
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
              </div>
            </article>
          ))}
        </div>
      )}

      {view.nextCursor ? (
        <div className={styles.more}>
          {restoreTarget.schoolId === schoolId && view.pagesLoaded >= restoreTarget.page &&
            view.pagesLoaded < restoreTarget.requestedPage ? (
              <div className={styles.restore}>
                <p>已還原 {view.pagesLoaded} 頁，先前共展開 {restoreTarget.requestedPage} 頁。</p>
                <button type="button" className="btn" disabled={view.loadingMore || view.refreshing}
                  onClick={() => setRestoreTarget({ ...restoreTarget, page: Math.min(restoreTarget.requestedPage, view.pagesLoaded + EVENT_RESTORE_BATCH_SIZE) })}>
                  繼續還原先前列表
                </button>
              </div>
            ) : null}
          {view.moreError ? (
            <p className={styles.notice} role="alert">
              {view.moreError}
            </p>
          ) : null}
          <button
            type="button"
            className="btn"
            disabled={view.loadingMore || view.refreshing}
            onClick={() => void loadMore()}
          >
            {view.loadingMore ? '載入更多中…' : '載入更多'}
          </button>
        </div>
      ) : null}
    </div>
  );
}
