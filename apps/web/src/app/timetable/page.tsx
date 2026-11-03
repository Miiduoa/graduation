'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { SiteShell } from '@/components/SiteShell';
import { PersonalTimetable } from '@/components/timetable/PersonalTimetable';
import { campusServiceHref, useCampusNavigationSearch } from '@/lib/campusNavigation';

export default function TimetablePage() {
  const params = useSearchParams();
  const campusSearch = useCampusNavigationSearch(params);
  return (
    <SiteShell title="我的課表" compactHeading>
      <PersonalTimetable />
      <Link className="btn" href={campusServiceHref('/classroom', campusSearch)}>
        課程教材與作業
      </Link>
    </SiteShell>
  );
}
