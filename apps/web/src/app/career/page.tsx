import type { Metadata } from 'next';
import { SiteShell } from '@/components/SiteShell';
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
          <h2>還沒接到校方資料</h2>
          <p>
            職涯資料還沒接到學校，先到學校職涯或校友服務單位查職缺、實習與履歷諮詢。
          </p>
        </section>
        <section>
          <h2>之後怎麼接</h2>
          <p>學校提供職缺或活動資料後，會在這裡列出來。</p>
        </section>
      </article>
    </SiteShell>
  );
}
