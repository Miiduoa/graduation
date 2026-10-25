'use client';

import { use } from 'react';
import { EventDetail } from '@/components/events/EventDetail';
import styles from '@/components/events/events.module.css';
import { SiteShell } from '@/components/SiteShell';
import { useCampusBrowseContext } from '@/lib/useCampusBrowseContext';
import { readCampusEventFilters } from '@/components/events/eventPresentation';

export default function CampusEventDetailPage(props: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{
    school?: string;
    schoolId?: string;
    campus?: string;
    source?: string;
    q?: string;
    view?: string;
    page?: string;
  }>;
}) {
  const { id } = use(props.params);
  const params = props.searchParams ? use(props.searchParams) : undefined;
  const context = useCampusBrowseContext(params);
  const schoolId = context.schoolId;
  const source = params?.source;

  return (
    <SiteShell
      schoolName={context.status === 'ready' ? context.schoolName : undefined}
      title="活動詳情"
      subtitle="查看活動內容；若來源支援線上報名，需另行確認學校帳號資格。"
    >
      {context.status !== 'ready' || !schoolId ? (
        <section className={styles.status}>
          <h2>
            {context.status === 'loading'
              ? '正在讀取所選校園…'
              : context.status === 'error'
                ? '無法取得校園目錄'
                : '先選擇一所學校'}
          </h2>
        </section>
      ) : (
        <EventDetail
          key={`${schoolId}:${id}:${source || ''}`}
          schoolId={schoolId}
          schoolSearch={context.schoolSearch}
          eventId={id}
          sourceParam={source}
          listFilters={readCampusEventFilters(params)}
        />
      )}
    </SiteShell>
  );
}
