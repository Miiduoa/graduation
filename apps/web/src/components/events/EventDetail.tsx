'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { loadCampusEvent, type CampusEvent, type CampusEventSource } from '@/lib/campusEvents';
import { buildCampusEventCalendar, canExportCampusEvent } from '@/lib/campusEventCalendar';
import { campusEventPhase, campusEventPhaseLabel } from '@campus/shared/src/campusEventTime';
import { useEventClock } from './useEventClock';
import { EventRegistrationPanel } from './EventRegistrationPanel';
import {
  buildCampusEventDetailHref,
  buildCampusEventListHref,
  campusEventSourceLabel,
  formatCampusEventDateTime,
  isCampusEventSource,
  userFacingCampusEventError,
  type CampusEventFilters,
} from './eventPresentation';
import styles from './events.module.css';

type LoadState =
  | { status: 'loading'; schoolId: string; id: string; source: CampusEventSource }
  | { status: 'failed'; schoolId: string; id: string; source: CampusEventSource; message: string }
  | {
      status: 'ready';
      schoolId: string;
      id: string;
      source: CampusEventSource;
      event: CampusEvent | null;
    }
  | { status: 'invalid-source'; schoolId: string; id: string };

function detailForRequest(
  state: LoadState,
  schoolId: string,
  id: string,
  source: CampusEventSource | null,
): LoadState {
  if (!source) return { status: 'invalid-source', schoolId, id };
  return state.status !== 'invalid-source' &&
    state.schoolId === schoolId &&
    state.id === id &&
    state.source === source
    ? state
    : { status: 'loading', schoolId, id, source };
}

export function EventDetail({
  schoolId,
  schoolSearch,
  eventId,
  sourceParam,
  listFilters,
}: {
  schoolId: string;
  schoolSearch: string;
  eventId: string;
  sourceParam: string | undefined;
  listFilters?: CampusEventFilters;
}) {
  const source = isCampusEventSource(sourceParam) ? sourceParam : null;
  const [state, setState] = useState<LoadState>(() =>
    source
      ? { status: 'loading', schoolId, id: eventId, source }
      : { status: 'invalid-source', schoolId, id: eventId },
  );
  const noticeScope = JSON.stringify([schoolId, eventId, source]);
  const [noticeState, setNoticeState] = useState({ scope: noticeScope, message: '' });
  const notice = noticeState.scope === noticeScope ? noticeState.message : '';
  const setNotice = (message: string) => setNoticeState({ scope: noticeScope, message });
  const now = useEventClock();
  const generation = useRef(0);
  const mounted = useRef(false);
  const view = detailForRequest(state, schoolId, eventId, source);
  const listHref = buildCampusEventListHref(schoolSearch, listFilters);
  const returnPath = source
    ? buildCampusEventDetailHref(eventId, source, schoolSearch, listFilters)
    : listHref;

  const load = useCallback(() => {
    if (!source) {
      return Promise.resolve();
    }
    const request = ++generation.current;
    return loadCampusEvent(schoolId, eventId, source).then(
      (event) => {
        if (!mounted.current || request !== generation.current) return;
        setState({ status: 'ready', schoolId, id: eventId, source, event });
      },
      (error) => {
        if (!mounted.current || request !== generation.current) return;
        setState({
          status: 'failed',
          schoolId,
          id: eventId,
          source,
          message: userFacingCampusEventError(error, '暫時無法讀取這場活動，請稍後再試。'),
        });
      },
    );
  }, [schoolId, eventId, source]);

  function reload() {
    if (source) setState({ status: 'loading', schoolId, id: eventId, source });
    void load();
  }

  useEffect(() => {
    mounted.current = true;
    void load();
    return () => {
      mounted.current = false;
      generation.current += 1;
    };
  }, [load]);

  async function copyLink() {
    if (!source) return;
    const request = generation.current;
    const url = new URL(
      buildCampusEventDetailHref(eventId, source, schoolSearch),
      window.location.origin,
    );
    setNotice('');
    try {
      await navigator.clipboard.writeText(url.href);
      if (mounted.current && request === generation.current) setNotice('已複製活動連結。');
    } catch {
      if (mounted.current && request === generation.current) {
        setNotice('複製失敗，請從網址列複製連結。');
      }
    }
  }

  function downloadCalendar() {
    if (view.status !== 'ready' || !view.event || !source) return;
    setNotice('');
    let url: string | undefined;
    const anchor = document.createElement('a');
    try {
      const detailUrl = new URL(buildCampusEventDetailHref(eventId, source, schoolSearch), window.location.origin);
      const calendar = buildCampusEventCalendar(view.event, detailUrl.href);
      url = URL.createObjectURL(new Blob([calendar.content], { type: 'text/calendar;charset=utf-8' }));
      anchor.href = url;
      anchor.download = calendar.filename;
      anchor.hidden = true;
      document.body.append(anchor);
      anchor.click();
      setNotice(calendar.hasEndTime
        ? '行事曆檔案已備妥，開啟下載的檔案即可加入；活動報名請另行完成。'
        : '行事曆檔案已備妥。活動未提供結束時間，加入行事曆後請確認活動長度；報名請另行完成。');
    } catch {
      setNotice('暫時無法下載行事曆，請稍後再試。');
    } finally {
      anchor.remove();
      // Give the browser time to start the user-requested download before releasing the blob.
      const downloadUrl = url;
      if (downloadUrl) window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 1_000);
    }
  }

  if (view.status === 'invalid-source') {
    return (
      <section className={styles.status} role="alert">
        <h2>無法開啟此活動</h2>
        <p>請返回活動列表，重新選擇活動。</p>
        <Link className="btn" href={listHref}>
          回到活動列表
        </Link>
      </section>
    );
  }

  if (view.status === 'loading') {
    return (
      <p className={styles.status} role="status">
        正在讀取活動…
      </p>
    );
  }

  if (view.status === 'failed') {
    return (
      <section className={styles.status} role="alert">
        <h2>無法讀取這場活動</h2>
        <p>{view.message}</p>
        <button type="button" className="btn" onClick={reload}>
          重新讀取
        </button>
        <Link className="btn" href={listHref}>
          回到活動列表
        </Link>
      </section>
    );
  }

  if (!view.event) {
    return (
      <section className={styles.status}>
        <h2>找不到這場活動</h2>
        <p>活動可能已移除，或不屬於目前查看的學校與來源。</p>
        <Link className="btn" href={listHref}>
          回到活動列表
        </Link>
      </section>
    );
  }

  const event = view.event;
  return (
    <article className={styles.detail}>
      <div className={styles.meta}>
        <span className={styles.phase} data-phase={campusEventPhase(event, now)}>
          {campusEventPhaseLabel(campusEventPhase(event, now))}
        </span>
        <span>{campusEventSourceLabel(event.source)}</span>
        <time dateTime={event.startsAt || undefined}>
          {formatCampusEventDateTime(event.startsAt)}
        </time>
        {event.endsAt ? (
          <span>至 {formatCampusEventDateTime(event.endsAt)}</span>
        ) : null}
        {event.location ? <span>{event.location}</span> : null}
        {event.organizer ? <span>{event.organizer}</span> : null}
      </div>
      <h2>{event.title}</h2>
      {event.description ? <p className={styles.body}>{event.description}</p> : null}
      <div className={styles.detailActions}>
        <Link className="btn" href={listHref}>
          回到活動列表
        </Link>
        <button type="button" className="btn" onClick={() => void copyLink()}>
          複製連結
        </button>
        <button type="button" className="btn" disabled={!canExportCampusEvent(event)}
          onClick={downloadCalendar} aria-describedby="event-calendar-note">
          加入行事曆
        </button>
        <button type="button" className="btn" onClick={reload}>
          重新讀取
        </button>
      </div>
      <p id="event-calendar-note" className={styles.notice}>
        {canExportCampusEvent(event)
          ? '下載活動行事曆檔案後，可加入你慣用的行事曆。時間異動請回到此頁確認。'
          : '活動時間待公告，提供開始時間後即可加入行事曆。'}
      </p>
      {notice ? (
        <p className={styles.notice} role="status">
          {notice}
        </p>
      ) : null}
      <EventRegistrationPanel key={`${event.schoolId}:${event.source}:${event.id}`} event={event} returnPath={returnPath} />
    </article>
  );
}
