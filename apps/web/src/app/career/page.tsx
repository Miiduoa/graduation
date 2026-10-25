import type { Metadata } from 'next';
import { SiteShell } from '@/components/SiteShell';
import { SchoolPublicServiceLinks } from '@/components/SchoolPublicServiceLinks';
import styles from '../servicePages.module.css';

export const metadata: Metadata = {
  title: '職涯 | Campus One',
  description: 'Campus One 目前還沒接到校方職涯資料',
};

export default function CareerPage() {
  return (
    <SiteShell title="職涯" subtitle="職缺、實習與履歷諮詢。">
      <article className={styles.document}>
        <section>
          <h2>個人職涯服務尚未開放</h2>
          <p>履歷與個人申請紀錄尚未連結。</p>
        </section>
        <SchoolPublicServiceLinks service="career" />
      </article>
    </SiteShell>
  );
}
