export default function LoginPage() {
  return (
    <main style={{ padding: 24, fontFamily: "system-ui" }}>
      <h2>登入（學校 SSO placeholder）</h2>
      <p>
        目前先做 UI 與流程占位。等你提供學校 SSO 規格（OIDC/SAML/CAS）後，
        再接到 Firebase Auth（自訂 token / OIDC provider）。
      </p>
      <button disabled>用學校帳號登入（待接 SSO）</button>
    </main>
  );
}
