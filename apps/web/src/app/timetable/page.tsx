'use client';

import { SiteShell } from '@/components/SiteShell';
import { PersonalTimetable } from '@/components/timetable/PersonalTimetable';

export default function TimetablePage() {
  return (
    <SiteShell title="我的課表" subtitle="先看這週去哪上課。截圖或學校課表都要確認後才會寫入。">
      <PersonalTimetable />
    </SiteShell>
  );
}
