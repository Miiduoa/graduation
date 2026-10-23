import Link from 'next/link';
import { SiteShell } from '@/components/SiteShell';
import styles from './servicePages.module.css';

export default function NotFound() {
  return (
    <SiteShell title="找不到這個頁面" subtitle="連結可能已變更，或這項內容已移除。">
      <section className={styles.stateCard} aria-labelledby="missing-page-options">
        <span className={styles.stateCode}>404</span>
        <h2 id="missing-page-options">從你需要的服務繼續</h2>
        <p>回到首頁查看今日事項，或從服務總覽尋找課務與校園功能。</p>
        <div className={styles.actions}>
          <Link href="/" className="btn primary">
            返回首頁
          </Link>
          <Link href="/search" className="btn">
            查看校園服務
          </Link>
        </div>
      </section>
    </SiteShell>
  );
}
