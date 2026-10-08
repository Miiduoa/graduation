import type { Metadata } from 'next';
import { SiteShell } from '@/components/SiteShell';
import styles from '../servicePages.module.css';

export const metadata: Metadata = {
  title: '隱私政策 | Campus One',
  description: 'Campus One 隱私政策',
};

const sections = [
  {
    title: '蒐集哪些資料',
    body: '我們會蒐集建立帳號、學校驗證、課程與校園服務所需的最小資料，包括基本識別資料、學校識別碼、裝置與推播資訊，以及你主動提供的內容。',
  },
  {
    title: '如何使用資料',
    body: '資料只用於提供你所屬學校的課務、成績、通知、社群、客服與安全稽核功能，不會把個人資料販售給第三方。',
  },
  {
    title: '資料保存與刪除',
    body: '手機版「我的」頁面提供資料匯出與帳號刪除入口。匯出內容依所選項目與結果中的範圍說明為準。刪除 Campus One 帳號不會刪除學校帳號、校方保存的資料或其他服務帳號；已傳送的訊息與共同內容可能仍會保留。操作前請先閱讀頁面列出的處理範圍。',
  },
  {
    title: '聯絡方式',
    body: (
      <>
        服務使用與隱私相關問題，請來信{' '}
        <a href="mailto:demohan513@gmail.com">demohan513@gmail.com</a>。
      </>
    ),
  },
];

export default function PrivacyPage() {
  return (
    <SiteShell title="隱私政策" subtitle="了解 Campus One 使用哪些資料，以及你可以如何管理。">
      <div className={styles.documentLayout}>
        <nav className={styles.contents} aria-label="隱私政策章節">
          <p>本頁內容</p>
          <ol>
            {sections.map((section, index) => (
              <li key={section.title}>
                <a href={`#privacy-${index + 1}`}>
                  <span aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
                  {section.title}
                </a>
              </li>
            ))}
          </ol>
        </nav>
        <article className={styles.document} aria-label="隱私政策內容">
          {sections.map((section, index) => (
            <section
              key={section.title}
              id={`privacy-${index + 1}`}
              aria-labelledby={`privacy-title-${index + 1}`}
            >
              <h2 id={`privacy-title-${index + 1}`}>{section.title}</h2>
              <p>{section.body}</p>
            </section>
          ))}
        </article>
      </div>
    </SiteShell>
  );
}
