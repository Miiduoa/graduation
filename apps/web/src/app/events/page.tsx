'use client';

import { use } from 'react';
import { CampusEventsWorkspace } from '@/components/events/CampusEventsWorkspace';
import styles from '@/components/events/events.module.css';
import { SiteShell } from '@/components/SiteShell';
import { useCampusBrowseContext } from '@/lib/useCampusBrowseContext';
import { readCampusEventFilters } from '@/components/events/eventPresentation';
import type { ServiceListSearchParams } from '@/lib/serviceListNavigation';

export default function CampusEventsPage(props: {
  searchParams?: Promise<ServiceListSearchParams>;
}) {
  const params = props.searchParams ? use(props.searchParams) : undefined;
  const context = useCampusBrowseContext(params);
  const schoolId = context.schoolId;

  return (
    <SiteShell
      schoolName={context.status === 'ready' ? context.schoolName : undefined}
      title="校園活動"
      subtitle="瀏覽校園公開活動，並把想參加的活動收藏在這個裝置。報名需另行確認學校帳號資格。"
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
        <CampusEventsWorkspace key={schoolId} schoolId={schoolId} schoolSearch={context.schoolSearch}
          initialFilters={readCampusEventFilters(params)} />
      )}
    </SiteShell>
  );
}
