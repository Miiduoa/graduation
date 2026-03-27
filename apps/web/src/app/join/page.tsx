"use client";

import Link from "next/link";
import { SiteShell } from "@/components/SiteShell";
import { resolveSchoolPageContext } from "@/lib/pageContext";

export default function JoinPage(props: {
  searchParams?: { school?: string; schoolId?: string };
}) {
  const { schoolName, schoolSearch } = resolveSchoolPageContext(props.searchParams);

  return (
    <SiteShell schoolName={schoolName}>
      <div style={{ maxWidth: 560, margin: "0 auto" }}>
        <div className="pageStack">
          <div
            className="card"
            style={{
              background: "linear-gradient(135deg, var(--brand) 0%, var(--brand2) 100%)",
              border: "none",
              color: "#fff",
              textAlign: "center",
              padding: "32px 24px",
              boxShadow: "6px 6px 16px rgba(94,106,210,0.36), -3px -3px 8px rgba(255,255,255,0.7)",
            }}
          >
            <div style={{ fontSize: 52, marginBottom: 12 }}>🏫</div>
            <h1 style={{ margin: "0 0 8px", fontSize: 24, fontWeight: 800, letterSpacing: "-0.04em" }}>
              {schoolName} 已開通
            </h1>
            <p style={{ margin: 0, fontSize: 14, opacity: 0.82 }}>
              Campus One 目前聚焦在靜宜大學版本，已不再提供多校切換入口。
            </p>
          </div>

          <div className="card" style={{ display: "grid", gap: 14 }}>
            <p style={{ margin: 0, color: "var(--muted)", lineHeight: 1.8 }}>
              如果你是靜宜學生，請直接使用學號與 e 校園密碼登入。若只是想先看看內容，可以先回首頁或查看公告等公開頁面。
            </p>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <Link href={`/login${schoolSearch}`} className="btn primary">
                前往登入
              </Link>
              <Link href={`/announcements${schoolSearch}`} className="btn">
                查看公告
              </Link>
            </div>
          </div>
        </div>
      </div>
    </SiteShell>
  );
}
