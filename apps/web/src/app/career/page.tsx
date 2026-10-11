import type { Metadata } from 'next';
import { SiteShell } from '@/components/SiteShell';
import styles from '../servicePages.module.css';

export const metadata: Metadata = {
  title: '職涯 | Campus One',
  description: 'Campus One 目前還沒接到校方職涯資料',
};

export default function CareerPage() {
  return (
    <SiteShell title="職涯" subtitle="這頁只說明現在接得到什麼。">
      <article className={styles.document}>
        <section>
          <h2>還沒接到校方資料</h2>
          <p>
            職缺、實習與履歷諮詢仍以靜宜職涯發展暨校友服務處為準。Campus One
            目前沒有職涯資料源，這裡不會列出假職缺，也不會用預覽學生履歷充當你的資料。
          </p>
        </section>
        <section>
          <h2>之後怎麼接</h2>
          <p>等校方提供可核對的職缺或活動資料後，才會在生活入口打開列表。沒接到之前，這頁維持空的。</p>
        </section>
      </article>
    </SiteShell>
  );
}
