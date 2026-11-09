'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  CAMPUS_NEXT_ROUTES, TRANSIT_FRESHNESS_MS, campusHomeSummary, hasCampusNext, pickCampusNext, queryTransit,
  type TransitArrival,
} from '@/lib/transit';
import styles from '@/app/home.module.css';

type BusSnapshot = {
  schoolId: string;
  revision: number;
  arrivals: TransitArrival[];
  fetchedAt: string;
};

export function HomeCampusBusCard({ schoolId }: { schoolId: string }) {
  const [snapshot, setSnapshot] = useState<BusSnapshot | null>(null);
  const [clock, setClock] = useState(() => Date.now());
  const [online, setOnline] = useState(() => typeof navigator === 'undefined' || navigator.onLine);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const disconnect = () => {
      setOnline(false);
      setSnapshot(null);
    };
    const reconnect = () => {
      setOnline(true);
      setSnapshot(null);
      setRevision((value) => value + 1);
    };
    const resume = () => {
      if (document.visibilityState === 'visible' && navigator.onLine) reconnect();
    };
    window.addEventListener('offline', disconnect);
    window.addEventListener('online', reconnect);
    document.addEventListener('visibilitychange', resume);
    return () => {
      window.removeEventListener('offline', disconnect);
      window.removeEventListener('online', reconnect);
      document.removeEventListener('visibilitychange', resume);
    };
  }, []);

  useEffect(() => {
    if (!hasCampusNext(schoolId) || !online) return;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);
    void queryTransit({ action: 'campus-next', schoolId }, controller.signal).then((result) => {
      if (controller.signal.aborted) return;
      setSnapshot(result.status === 'ready' && result.kind === 'arrivals' && !result.stale
        ? { schoolId, revision, arrivals: result.arrivals, fetchedAt: result.fetchedAt }
        : null);
    }).catch(() => {
      if (!controller.signal.aborted) setSnapshot(null);
    }).finally(() => clearTimeout(timeout));
    const timer = setInterval(() => setClock(Date.now()), 15_000);
    return () => {
      controller.abort();
      clearTimeout(timeout);
      clearInterval(timer);
    };
  }, [schoolId, revision, online]);

  const current = snapshot?.schoolId === schoolId && snapshot.revision === revision ? snapshot : null;
  const fetched = current ? Date.parse(current.fetchedAt) : NaN;
  const fresh = Number.isFinite(fetched) && fetched <= clock + 30_000 && clock - fetched < TRANSIT_FRESHNESS_MS;
  const summary = current && fresh
    ? campusHomeSummary(pickCampusNext(current.arrivals, clock, CAMPUS_NEXT_ROUTES), clock)
    : '';
  if (!hasCampusNext(schoolId) || !online || !summary) return null;

  return (
    <nav className={styles.busEntry} aria-label="下一班公車" data-testid="home-bus-entry">
      <Link className={styles.busEntryLink} href="/bus">
        <strong>下一班公車</strong>
        <span className={styles.busEntryMeta}>{summary}</span>
      </Link>
    </nav>
  );
}
