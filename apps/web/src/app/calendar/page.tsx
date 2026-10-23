'use client';

import { SiteShell } from '@/components/SiteShell';
import { PersonalCalendar } from '@/components/calendar/PersonalCalendar';

export default function CalendarPage() {
  return (
    <SiteShell title="個人行事曆" subtitle="自己的活動與考試，依日期排好。">
      <PersonalCalendar />
    </SiteShell>
  );
}
