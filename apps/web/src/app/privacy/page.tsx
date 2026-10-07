import type { Metadata } from 'next';
import { SiteShell } from '@/components/SiteShell';

export const metadata: Metadata = {
  title: '隱私政策 | Campus One',
  description: 'Campus One隱私政策',
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
    body: '你可以在 App 內申請資料匯出與刪除。依法必須保留的支付、交易或稽核資料會做匿名化處理，其餘資料會依服務性質刪除。',
  },
  {
    title: '聯絡方式',
    body: '服務聯絡方式尚待確認，將於正式開放前公布。',
  },
];

export default function PrivacyPage() {
  return (
    <SiteShell title="隱私政策" subtitle="Campus One 服務資訊">
      <div className="pageStack" style={{ maxWidth: 880 }}>
        {sections.map((section) => (
          <section key={section.title} className="card" style={{ display: 'grid', gap: 10 }}>
            <h2 style={{ margin: 0, fontSize: 22 }}>{section.title}</h2>
            <p style={{ margin: 0, lineHeight: 1.8 }}>{section.body}</p>
          </section>
        ))}
      </div>
    </SiteShell>
  );
}
