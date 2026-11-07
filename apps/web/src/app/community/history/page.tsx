'use client';

import Link from 'next/link';
import { SiteShell } from '@/components/SiteShell';
import { SchoolScopePlaceholder } from '@/components/SchoolScopePlaceholder';
import { useBrowsingSchoolPageContext } from '@/lib/useBrowsingSchoolPageContext';
import { CommunityAccess } from '../_components/CommunityAccess';
import { TitleHistorySearch } from '../_components/TitleHistorySearch';
import styles from '../community.module.css';

export default function CommunityHistoryPage() {
  const { schoolId, schoolName, ready } = useBrowsingSchoolPageContext();
  return (
    <SiteShell title="找回校園舊貼文" subtitle="記得標題開頭，就從歷史內容直接找。"
      schoolName={ready ? schoolName : undefined}>
      {ready ? <CommunityAccess>
        <div className={styles.content}>
          <Link className={styles.secondaryLink} href={`/community?schoolId=${encodeURIComponent(schoolId)}`}>
            返回校園動態
          </Link>
          <TitleHistorySearch schoolId={schoolId} />
        </div>
      </CommunityAccess> : <SchoolScopePlaceholder />}
    </SiteShell>
  );
}
