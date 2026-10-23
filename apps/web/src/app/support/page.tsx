import type { Metadata } from 'next';
import { SiteShell } from '@/components/SiteShell';
import styles from '../servicePages.module.css';

export const metadata: Metadata = {
  title: '支援 | Campus One',
  description: 'Campus One 能提供的協助範圍',
};

export default function SupportPage() {
  return (
    <SiteShell title="支援" subtitle="這裡只寫目前做得到的事。">
      <article className={styles.document}>
        <section>
          <h2>怎麼找得到人</h2>
          <p>
            帳號、隱私或刪除資料，請來信{' '}
            <a href="mailto:demohan513@gmail.com">demohan513@gmail.com</a>
            。這不是即時客服，也沒有工單系統。
          </p>
        </section>
        <section>
          <h2>學校事務</h2>
          <p>
            選課、成績、出缺席與正式公告仍以學校校務系統與各處室為準。Campus One
            無法代替校務系統核准請假或加退選。
          </p>
        </section>
        <section>
          <h2>還沒開通的服務</h2>
          <p>
            沒有接到的金流、職涯職缺、校方選課與正式測驗繳交，這裡不會寫成已經提供。店家可以改菜單與營業時間，但還不能在這裡收款。
          </p>
        </section>
      </article>
    </SiteShell>
  );
}
