'use client';

import Link from 'next/link';
import { SiteShell } from '@/components/SiteShell';
import { PersonalTimetable } from '@/components/timetable/PersonalTimetable';
import { TimetableSyncStatus } from '@/components/timetable/TimetableSyncStatus';
import styles from '@/components/academic/academic.module.css';

export default function TimetablePage() {
  return (
    <SiteShell title="我的課表" subtitle="先看這週去哪上課。截圖或學校課表都要確認後才會寫入。">
      <p className={styles.notice}>
        老師在 Nuni 開的課、教材和作業在這裡：<Link href="/classroom">Nuni 課程 →</Link>
      </p>
      <TimetableSyncStatus />
      <PersonalTimetable />
    </SiteShell>
  );
}
