'use client';

import Link from 'next/link';
import { SiteShell } from '@/components/SiteShell';
import { Button } from '@/components/ui/Button';
import styles from './servicePages.module.css';

export default function PageError({ reset }: { reset: () => void }) {
  return (
    <SiteShell title="目前無法開啟這個頁面" subtitle="請稍後重試，或返回首頁使用其他服務。">
      <section className={styles.stateCard} aria-labelledby="page-recovery-title">
        <h2 id="page-recovery-title">再試一次</h2>
        <p>重新載入這個頁面。若問題持續發生，請稍後再回來。</p>
        <div className={styles.actions}>
          <Button type="button" variant="primary" onClick={reset}>
            重新載入
          </Button>
          <Link href="/" className="btn">
            返回首頁
          </Link>
        </div>
      </section>
    </SiteShell>
  );
}
