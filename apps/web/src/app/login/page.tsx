import { resolveSchoolByCode } from "@campus/shared/src/schools";

export default function LoginPage(props: { searchParams?: { school?: string } }) {
  const school = resolveSchoolByCode(props.searchParams?.school);

  return (
    <main style={{ padding: 24, fontFamily: "system-ui" }}>
      <h2>登入（學校 SSO placeholder）</h2>
      <div style={{ opacity: 0.7, marginBottom: 12 }}>
        學校：{school.name}（{school.code}）
      </div>
      <p>
        這裡會依 schoolId 決定要走 OIDC / SAML / CAS 或免登入。
        目前先做 UI 與流程占位，後續再接 Firebase Auth。
      </p>
      <button disabled>用學校帳號登入（待接 SSO）</button>
    </main>
  );
}
