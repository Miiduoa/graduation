import type { Metadata } from 'next';
import Link from 'next/link';
import { SiteShell } from '@/components/SiteShell';
import styles from '../servicePages.module.css';

export const metadata: Metadata = {
  title: '刪除帳號 | Campus One',
  description: '如何刪除 Campus One 帳號',
};

export default function AccountDeletionPage() {
  return (
    <SiteShell title="刪除帳號" subtitle="刪的是 Campus One 帳號，不是學校學籍。">
      <article className={styles.document}>
        <section>
          <h2>在產品裡刪</h2>
          <p>
            登入後到 <Link href="/settings">設定</Link>
            ，使用「刪除帳號」。送出前會列出會清掉與會留下的資料。共享內容、已完成的訂單與財務紀錄可能仍會保留。
          </p>
        </section>
        <section>
          <h2>用信件提出</h2>
          <p>
            若無法登入，請來信 <a href="mailto:demohan513@gmail.com">demohan513@gmail.com</a>{' '}
            ，主旨寫「刪除帳號」，並說明你用來登入的電子郵件。我們沒有自動回條信箱。
          </p>
        </section>
        <section>
          <h2>刪不掉的東西</h2>
          <p>學校帳號、TronClass、e 校園與其他服務的資料不會一併刪除，需要向各系統分別申請。</p>
        </section>
      </article>
    </SiteShell>
  );
}
