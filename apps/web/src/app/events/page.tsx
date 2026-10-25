'use client';

import { use } from 'react';
import { EventList } from '@/components/events/EventList';
import styles from '@/components/events/events.module.css';
import { SiteShell } from '@/components/SiteShell';
import { useCampusBrowseContext } from '@/lib/useCampusBrowseContext';

export default function CampusEventsPage(props: {
  searchParams?: Promise<{ school?: string; schoolId?: string; campus?: string }>;
}) {
  const params = props.searchParams ? use(props.searchParams) : undefined;
  const context = useCampusBrowseContext(params);
  const schoolId = context.schoolId;

  return (
    <SiteShell
      schoolName={context.status === 'ready' ? context.schoolName : undefined}
      title="校園活動"
      subtitle="瀏覽校園公開活動與講座資訊。報名需另行確認學校帳號資格。"
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
          {context.status === 'unselected' ? (
            <p>選擇學校後，才能讀取該校的公開活動資料。</p>
          ) : null}
        </section>
      ) : (
        <EventList key={schoolId} schoolId={schoolId} schoolSearch={context.schoolSearch} />
      )}
    </SiteShell>
  );
}
