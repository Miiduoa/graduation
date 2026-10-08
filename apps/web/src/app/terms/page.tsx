import type { Metadata } from 'next';
import { SiteShell } from '@/components/SiteShell';
import styles from '../servicePages.module.css';

export const metadata: Metadata = {
  title: '使用條款 | Campus One',
  description: 'Campus One 使用條款',
};

const sections = [
  {
    title: '服務範圍',
    body: 'Campus One 提供公告、課程、成績、校園地圖、訊息與經學校驗證的延伸服務。各項服務依學校開通情況提供。',
  },
  {
    title: '帳號責任',
    body: '請妥善保管登入資訊與裝置，並對自己的帳號使用負責。不得冒用或濫用學校帳號、爬取資料，或干擾其他使用者正常使用。',
  },
  {
    title: '支付與交易',
    body: '若學校已正式開通支付功能，所有支付行為都以合作支付供應商與校方規範為準；未開通時，正式版不會顯示支付入口。',
  },
  {
    title: '服務調整',
    body: '我們可能因法規、學校要求、資訊安全或維運需要調整服務內容。重大變更會透過 App 內公告、Email 或校務通知說明。',
  },
  {
    title: '聯絡方式',
    body: (
      <>
        對服務或使用條款有疑問，請來信{' '}
        <a href="mailto:demohan513@gmail.com">demohan513@gmail.com</a>。
      </>
    ),
  },
];

export default function TermsPage() {
  return (
    <SiteShell title="使用條款" subtitle="使用 Campus One 前，請先了解服務範圍與帳號責任。">
      <div className={styles.documentLayout}>
        <nav className={styles.contents} aria-label="使用條款章節">
          <p>本頁內容</p>
          <ol>
            {sections.map((section, index) => (
              <li key={section.title}>
                <a href={`#terms-${index + 1}`}>
                  <span aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
                  {section.title}
                </a>
              </li>
            ))}
          </ol>
        </nav>
        <article className={styles.document} aria-label="使用條款內容">
          {sections.map((section, index) => (
            <section
              key={section.title}
              id={`terms-${index + 1}`}
              aria-labelledby={`terms-title-${index + 1}`}
            >
              <h2 id={`terms-title-${index + 1}`}>{section.title}</h2>
              <p>{section.body}</p>
            </section>
          ))}
        </article>
      </div>
    </SiteShell>
  );
}
