'use client';

import { use } from 'react';

import Link from 'next/link';
import { SiteShell } from '@/components/SiteShell';
import { resolveSchoolPageContext } from '@/lib/pageContext';
import styles from './join.module.css';

export default function JoinPage(props: {
  searchParams?: Promise<{ school?: string; schoolId?: string }>;
}) {
  const searchParams = props.searchParams ? use(props.searchParams) : undefined;
  const { schoolName, schoolSearch } = resolveSchoolPageContext(searchParams);

  return (
    <SiteShell
      title="開始你的校園日常"
      subtitle="查課表、找教室，接收校園裡的新消息。"
      schoolName={schoolName}
    >
      <div className={styles.options}>
        <section className={`card ${styles.option}`}>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 600 }}>我是{schoolName}學生</h2>
          <p style={{ margin: 0, color: 'var(--muted)', lineHeight: 1.8 }}>
            使用學號與 e 校園密碼登入，查看自己的課程、成績與通知。
          </p>
          <div>
            <Link href={`/login${schoolSearch}`} className="btn primary">
              登入校園帳號
            </Link>
          </div>
        </section>
        <section className={`card ${styles.option}`}>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 600 }}>先看看校園</h2>
          <p style={{ margin: 0, color: 'var(--muted)', lineHeight: 1.8 }}>
            公開公告與服務入口不用登入也能瀏覽。需要個人資料時，再登入即可。
          </p>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <Link href={`/announcements${schoolSearch}`} className="btn">
              查看公告
            </Link>
            <Link href={`/search${schoolSearch}`} className="btn">
              瀏覽所有服務
            </Link>
          </div>
        </section>
      </div>
    </SiteShell>
  );
}
