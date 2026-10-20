'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  CAMPUS_NEXT_ROUTES, campusEtaView, hasCampusNext, pickCampusNext, queryTransit,
  type TransitArrival,
} from '@/lib/transit';
import { CampusArrivalRow } from './CampusArrivalRow';
import css from './transit.module.css';
import styles from '@/app/home.module.css';

export function HomeCampusBusCard({ schoolId }: { schoolId: string }) {
  const [arrivals, setArrivals] = useState<TransitArrival[] | null>(null);
  const [clock, setClock] = useState(() => Date.now());
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!hasCampusNext(schoolId)) return;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);
    queryTransit({ action: 'campus-next', schoolId }, controller.signal).then((result) => {
      if (controller.signal.aborted) return;
      setArrivals(result.status === 'ready' && result.kind === 'arrivals' ? result.arrivals : []);
    }).catch(() => {
      if (!controller.signal.aborted) setArrivals([]);
    }).finally(() => {
      clearTimeout(timeout);
      if (!controller.signal.aborted) setReady(true);
    });
    const timer = setInterval(() => setClock(Date.now()), 15_000);
    return () => {
      controller.abort();
      clearTimeout(timeout);
      clearInterval(timer);
    };
  }, [schoolId]);
  const rows = pickCampusNext(arrivals ?? [], clock, CAMPUS_NEXT_ROUTES)
    .filter((row) => campusEtaView(row.arrival, clock).kind !== 'empty')
    .slice(0, 2);
  const showRows = ready && rows.length > 0;
  return (
    <section className={styles.busEntry} aria-label="公車" data-testid="home-bus-entry">
      <div className={styles.busEntryHead}>
        <div>
          <strong>校門口公車</strong>
          <small>最快的兩班，點進去看全部。</small>
        </div>
        <Link className={styles.busEntryAll} href="/bus">看全部 →</Link>
      </div>
      {showRows ? (
        <ul className={css.campusNextList}>
          {rows.map((row) => (
            <li key={`${row.route}:${row.heading}`}>
              <CampusArrivalRow row={row} now={clock} href="/bus" />
            </li>
          ))}
        </ul>
      ) : (
        <Link className={styles.busEntryLink} href="/bus">
          <small>{ready ? '到站資料還沒接通，先看站牌和方向。' : '正在查看校門口班次…'}</small>
        </Link>
      )}
    </section>
  );
}
