'use client';

import { use } from 'react';
import { ScopedEventDetail } from '@/components/events/ScopedEventDetail';
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
  const source = params?.source;

  return (
    <SiteShell
      schoolName={context.status === 'ready' ? context.schoolName : undefined}
      title="活動詳情"
      subtitle="查看活動內容；若來源支援線上報名，需另行確認學校帳號資格。"
    >
      <ScopedEventDetail
        key={JSON.stringify([id, source])}
        context={context}
        eventId={id}
        source={source}
        filters={readCampusEventFilters(params)}
      />
    </SiteShell>
  );
}
