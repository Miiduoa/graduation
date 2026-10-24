'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { loadCampusEvent, type CampusEvent, type CampusEventSource } from '@/lib/campusEvents';
import { EventRegistrationPanel } from './EventRegistrationPanel';
import {
  buildCampusEventDetailHref,
  buildCampusEventListHref,
  campusEventSourceLabel,
  formatCampusEventDateTime,
  isCampusEventSource,
  userFacingCampusEventError,
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
}: {
  schoolId: string;
  schoolSearch: string;
  eventId: string;
  sourceParam: string | undefined;
}) {
  const source = isCampusEventSource(sourceParam) ? sourceParam : null;
  const [state, setState] = useState<LoadState>(() =>
    source
      ? { status: 'loading', schoolId, id: eventId, source }
      : { status: 'invalid-source', schoolId, id: eventId },
  );
  const [notice, setNotice] = useState('');
  const generation = useRef(0);
  const mounted = useRef(false);
  const view = detailForRequest(state, schoolId, eventId, source);
  const listHref = buildCampusEventListHref(schoolSearch);
  const returnPath = source
    ? buildCampusEventDetailHref(eventId, source, schoolSearch)
    : listHref;

  const load = useCallback(() => {
    if (!source) {
      setState({ status: 'invalid-source', schoolId, id: eventId });
      return Promise.resolve();
    }
    const request = ++generation.current;
    setState({ status: 'loading', schoolId, id: eventId, source });
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

  if (view.status === 'invalid-source') {
    return (
      <section className={styles.status} role="alert">
        <h2>活動來源無效</h2>
        <p>請從活動列表重新開啟；相同編號可能存在於不同資料來源，請勿直接改寫網址。</p>
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
        <button type="button" className="btn" onClick={() => void load()}>
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
        <button type="button" className="btn" onClick={() => void load()}>
          重新讀取
        </button>
      </div>
      {notice ? (
        <p className={styles.notice} role="status">
          {notice}
        </p>
      ) : null}
      <EventRegistrationPanel key={`${event.schoolId}:${event.source}:${event.id}`} event={event} returnPath={returnPath} />
    </article>
  );
}
