'use client';

import { useEffect, useRef, useState } from 'react';
import {
  CAMPUS_NEXT, CAMPUS_NEXT_ROUTES, CAMPUS_SEGMENTS, campusDirectionEnded,
  campusLaneDisplay, campusLiveUnavailable, campusSegmentRows, campusSegmentWaitLine,
  campusUpdatedLabel, hasCampusNext, queryTransit,
  type CampusSegmentKey, type TransitResult,
} from '@/lib/transit';
import { CampusArrivalRow } from './CampusArrivalRow';
import { SchoolSelector } from './SchoolSelector';
import { useOptionalSelectedSchool } from './SelectedSchoolProvider';
import css from './transit.module.css';

function RefreshIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
      <path
        d="M20 12a8 8 0 1 1-2.2-5.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path d="M20 4.5v5h-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function SkeletonList() {
  return (
    <ul className={css.boardList} aria-hidden="true" data-testid="campus-skeleton">
      {[0, 1, 2].map((index) => (
        <li key={index} className={css.skeletonRow}>
          <span className={css.skeletonBadge} />
          <span className={css.skeletonCopy}>
            <span className={css.skeletonLine} />
            <span className={css.skeletonLineShort} />
          </span>
          <span className={css.skeletonEta} />
        </li>
      ))}
    </ul>
  );
}

export function CampusBusBoard({ schoolId, schoolName }: { schoolId: string; schoolName: string }) {
  const selection = useOptionalSelectedSchool();
  const spec = hasCampusNext(schoolId) ? CAMPUS_NEXT[schoolId] : null;
  const [segment, setSegment] = useState<CampusSegmentKey>('往沙鹿');
  const [result, setResult] = useState<TransitResult | null>(null);
  const [busy, setBusy] = useState(true);
  const [revision, setRevision] = useState(0);
  const [clock, setClock] = useState(() => Date.now());
  const [offline, setOffline] = useState(false);
  const [laneOpen, setLaneOpen] = useState(false);
  const inFlight = useRef(false);
  useEffect(() => {
    if (!spec) return;
    let active = true;
    let controller: AbortController | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function refresh() {
      if (!active || inFlight.current || document.visibilityState === 'hidden' || !navigator.onLine) {
        if (active && !navigator.onLine) { setOffline(true); setBusy(false); }
        return;
      }
      const current = new AbortController();
      controller = current;
      inFlight.current = true;
      const timeout = setTimeout(() => current.abort(), 20_000);
      setBusy(true);
      let delay = 30_000;
      try {
        const next = await queryTransit({ action: 'campus-next', schoolId }, current.signal);
        if (!active || current.signal.aborted) return;
        if (next.status === 'ready') {
          setResult(next);
        } else {
          setResult((current) => current?.status === 'ready' ? current : next);
          delay = 60_000;
        }
        setClock(Date.now());
      } catch {
        if (active && controller === current) {
          setResult((current) => current?.status === 'ready' ? current : { status: 'unavailable', reason: 'network' });
          delay = 60_000;
        }
      } finally {
        clearTimeout(timeout);
        if (controller === current) controller = null;
        inFlight.current = false;
        if (active) {
          setBusy(false);
          if (document.visibilityState === 'visible' && navigator.onLine) timer = setTimeout(() => void refresh(), delay);
        }
      }
    }
    const resume = () => {
      clearTimeout(timer);
      setOffline(!navigator.onLine);
      setClock(Date.now());
      if (document.visibilityState === 'visible' && navigator.onLine) void refresh();
    };
    const clockTimer = setInterval(() => setClock(Date.now()), 15_000);
    void refresh();
    document.addEventListener('visibilitychange', resume);
    window.addEventListener('online', resume);
    window.addEventListener('offline', resume);
    return () => {
      active = false;
      controller?.abort();
      inFlight.current = false;
      clearTimeout(timer);
      clearInterval(clockTimer);
      document.removeEventListener('visibilitychange', resume);
      window.removeEventListener('online', resume);
      window.removeEventListener('offline', resume);
    };
  }, [schoolId, spec, revision]);
  useEffect(() => {
    setLaneOpen(false);
  }, [segment]);
  if (!spec) return null;
  const current = CAMPUS_SEGMENTS.find((item) => item.key === segment) ?? CAMPUS_SEGMENTS[0];
  const arrivals = result?.status === 'ready' && result.kind === 'arrivals' ? result.arrivals : [];
  const rows = campusSegmentRows(arrivals, current.group, clock, CAMPUS_NEXT_ROUTES);
  const lane = current.group === '專用道' ? campusLaneDisplay(rows, clock) : { shown: rows, extra: [] };
  const waitLine = campusSegmentWaitLine(current, rows);
  const allEnded = campusDirectionEnded(rows, clock);
  const liveUnavailable = campusLiveUnavailable(rows, clock, result?.status === 'ready' && result.stale === true);
  const fetchedAt = result?.status === 'ready' ? result.fetchedAt : '';
  const stamp = fetchedAt ? campusUpdatedLabel(fetchedAt, clock, liveUnavailable) : busy ? '' : '';
  const missing = result?.status === 'unavailable';
  const showSkeleton = !result;
  function retry() {
    if (busy || inFlight.current) return;
    setBusy(true);
    setRevision((value) => value + 1);
  }
  return (
    <section className={css.board} aria-labelledby="campus-bus-title" aria-busy={busy} data-testid="campus-next">
      <header className={css.boardHead}>
        <div className={css.boardHeadCopy}>
          {selection ? <SchoolSelector compact variant="name" /> : <p className={css.boardSchool}>{schoolName}</p>}
          <h1 id="campus-bus-title" className={css.boardTitle}>公車</h1>
          {offline ? <p className={css.boardStamp} role="status">目前離線，恢復網路後會重新查詢。</p> : null}
          {!offline && stamp ? <p className={css.boardStamp}>{stamp}</p> : null}
          {allEnded ? <p className={css.boardEndedHint}>這個方向今天的班次都結束了</p> : null}
        </div>
        <button
          type="button"
          className={css.refreshIcon}
          aria-label="重新整理"
          disabled={busy || offline}
          onClick={retry}
        >
          <RefreshIcon />
        </button>
      </header>
      <div className={css.segmentWrap} ref={(node) => { if (node) node.dataset.campusSegments = 'true'; }}>
        <div className={css.segmentBar} role="tablist" aria-label="站牌方向">
          {CAMPUS_SEGMENTS.map((item) => (
            <button
              key={item.key}
              type="button"
              role="tab"
              aria-selected={segment === item.key}
              className={css.segment}
              onClick={() => setSegment(item.key)}
            >
              {item.key}
            </button>
          ))}
        </div>
      </div>
      <p className={css.waitLine}>{waitLine}</p>
      {missing ? (
        <div className={css.boardError} role="status">
          <p>暫時讀不到資料，請稍後再試</p>
          <button type="button" className={css.retry} disabled={busy} onClick={retry}>再試一次</button>
        </div>
      ) : showSkeleton ? (
        <SkeletonList />
      ) : (
        <ul key={segment} className={`${css.boardList} ${css.boardListEnter}`}>
          {lane.shown.length ? lane.shown.map((row) => (
            <li key={`${row.route}:${row.heading}`}>
              <CampusArrivalRow row={row} now={clock} />
            </li>
          )) : (
            <li>
              <p className={css.emptyGroup} role="status">暫無班次資訊</p>
            </li>
          )}
          {laneOpen ? lane.extra.map((row) => (
            <li key={`${row.route}:${row.heading}`}>
              <CampusArrivalRow row={row} now={clock} />
            </li>
          )) : null}
          {lane.extra.length ? (
            <li className={css.laneMore}>
              <button
                type="button"
                className={css.laneMoreToggle}
                aria-expanded={laneOpen}
                onClick={() => setLaneOpen((open) => !open)}
              >
                {laneOpen ? '收合' : `還有 ${lane.extra.length} 班`}
              </button>
            </li>
          ) : null}
        </ul>
      )}
    </section>
  );
}
