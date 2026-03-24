import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: '使用條款 | 校園助手',
  description: '校園助手正式版使用條款',
};

const sections = [
  {
    title: '服務範圍',
    body: '校園助手提供公告、課程、成績、校園地圖、訊息與經學校驗證的延伸服務。未完成整合驗收的學校與功能不會出現在正式版。',
  },
  {
    title: '帳號責任',
    body: '你必須對自己的登入狀態與裝置安全負責，不得冒用、濫用學校帳號、爬取資料或干擾其他使用者正常使用。',
  },
  {
    title: '支付與交易',
    body: '若學校已正式開通支付功能，所有支付行為都以合作支付供應商與校方規範為準；未開通時，正式版不會顯示支付入口。',
  },
  {
    title: '服務調整',
    body: '我們可能因法規、學校要求、資訊安全或維運需要調整服務內容。重大變更會透過 App 內公告、Email 或校務通知說明。',
  },
];

export default function TermsPage() {
  return (
    <main
      className="pageStack"
      style={{ maxWidth: 880, margin: '0 auto', padding: '32px 20px 72px' }}
    >
      <section className="card" style={{ display: 'grid', gap: 16 }}>
        <span className="pill brand">Terms of Service</span>
        <div>
          <h1 className="h1" style={{ marginBottom: 10 }}>
            校園助手使用條款
          </h1>
          <p className="sub" style={{ margin: 0 }}>
            使用校園助手代表你同意依本條款與所屬學校的校務規範使用本服務。
          </p>
        </div>
      </section>

      {sections.map((section) => (
        <section key={section.title} className="card" style={{ display: 'grid', gap: 10 }}>
          <h2 style={{ margin: 0, fontSize: 22 }}>{section.title}</h2>
          <p style={{ margin: 0, lineHeight: 1.8 }}>{section.body}</p>
        </section>
      ))}
    </main>
  );
}
