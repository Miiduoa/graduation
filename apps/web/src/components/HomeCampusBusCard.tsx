'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  CAMPUS_NEXT_ROUTES, campusHomeSummary, hasCampusNext, pickCampusNext, queryTransit,
  type TransitArrival,
} from '@/lib/transit';
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
  const summary = campusHomeSummary(pickCampusNext(arrivals ?? [], clock, CAMPUS_NEXT_ROUTES), clock);
  const line = !ready ? '正在查看…' : summary || '看全部';
  return (
    <nav className={styles.busEntry} aria-label="公車" data-testid="home-bus-entry">
      <Link className={styles.busEntryLink} href="/bus">
        <strong>校門口公車</strong>
        <span className={styles.busEntryMeta}>{line}</span>
      </Link>
    </nav>
  );
}
