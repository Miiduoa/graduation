import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "隱私政策 | 校園助手",
  description: "校園助手正式版隱私政策",
};

const sections = [
  {
    title: "蒐集哪些資料",
    body:
      "我們會蒐集建立帳號、學校驗證、課程與校園服務所需的最小資料，包括基本識別資料、學校識別碼、裝置與推播資訊，以及你主動提供的內容。",
  },
  {
    title: "如何使用資料",
    body:
      "資料只用於提供你所屬學校的課務、成績、通知、社群、客服與安全稽核功能，不會把個人資料販售給第三方。",
  },
  {
    title: "資料保存與刪除",
    body:
      "你可以在 App 內申請資料匯出與刪除。依法必須保留的支付、交易或稽核資料會做匿名化處理，其餘資料會依服務性質刪除。",
  },
  {
    title: "聯絡方式",
    body:
      "若你對資料處理有疑問，請來信 support@campus-app.com，我們會在合理期間內回覆並協助處理。",
  },
];

export default function PrivacyPage() {
  return (
    <main className="pageStack" style={{ maxWidth: 880, margin: "0 auto", padding: "32px 20px 72px" }}>
      <section className="card" style={{ display: "grid", gap: 16 }}>
        <span className="pill brand">Privacy Policy</span>
        <div>
          <h1 className="h1" style={{ marginBottom: 10 }}>
            校園助手隱私政策
          </h1>
          <p className="sub" style={{ margin: 0 }}>
            本頁適用於校園助手 iOS、Android 與 Web 正式版。若你的學校另有個別資料處理規範，會以該校公告為優先。
          </p>
        </div>
      </section>

      {sections.map((section) => (
        <section key={section.title} className="card" style={{ display: "grid", gap: 10 }}>
          <h2 style={{ margin: 0, fontSize: 22 }}>{section.title}</h2>
          <p style={{ margin: 0, lineHeight: 1.8 }}>{section.body}</p>
        </section>
      ))}
    </main>
  );
}
