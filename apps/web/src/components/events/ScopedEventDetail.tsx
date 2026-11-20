'use client';

import Link from 'next/link';
import { useState } from 'react';
import type { CampusBrowseContext } from '@/lib/useCampusBrowseContext';
import { EventDetail } from './EventDetail';
import { buildCampusEventListHref, type CampusEventFilters } from './eventPresentation';
import styles from './events.module.css';

export function ScopedEventDetail({
  context,
  eventId,
  source,
  filters,
}: {
  context: CampusBrowseContext;
  eventId: string;
  source: string | undefined;
  filters: CampusEventFilters;
}) {
  const [boundSchoolId, setBoundSchoolId] = useState(context.schoolId);
  if (!boundSchoolId && context.status === 'ready' && context.schoolId) {
    setBoundSchoolId(context.schoolId);
  }

  if (context.status !== 'ready' || !context.schoolId) {
    return (
      <section className={styles.status}>
        <h2>
          {context.status === 'loading'
            ? '正在讀取所選校園…'
            : context.status === 'error'
              ? '無法取得校園目錄'
              : '先選擇一所學校'}
        </h2>
      </section>
    );
  }

  if (boundSchoolId && boundSchoolId !== context.schoolId) {
    return (
      <section className={styles.status}>
        <h2>瀏覽校園已變更</h2>
        <p>請從目前校園的活動列表選擇活動。</p>
        <Link href={buildCampusEventListHref(context.schoolSearch)}>前往活動列表</Link>
      </section>
    );
  }

  return (
    <EventDetail
      schoolId={context.schoolId}
      schoolSearch={context.schoolSearch}
      eventId={eventId}
      sourceParam={source}
      listFilters={filters}
    />
  );
}
