import { SiteShell } from "@/components/SiteShell";
import Link from "next/link";
import { resolveSchool } from "@campus/shared/src/schools";

export default function HomePage(props: { searchParams?: { school?: string; schoolId?: string } }) {
  const school = resolveSchool({
    school: props.searchParams?.school,
    schoolId: props.searchParams?.schoolId,
  });

  const q = `?school=${encodeURIComponent(school.code)}&schoolId=${encodeURIComponent(school.id)}`;

  return (
    <SiteShell
      schoolName={school.name}
      schoolCode={school.code}
      title="平台型校園 App（Web）"
      subtitle="邏輯清楚、現代 UI：先做多校通用資訊平台，再逐步接 Firebase 與各校 SSO。"
    >
      <div className="card" style={{ marginBottom: 12 }}>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <Link className="btn" href={`/announcements${q}`}>
            公告
          </Link>
          <Link className="btn" href={`/clubs${q}`}>
            活動
          </Link>
          <Link className="btn" href={`/map${q}`}>
            地圖
          </Link>
          <Link className="btn" href={`/cafeteria${q}`}>
            餐廳
          </Link>
          <Link className="btn" href={`/login${q}`}>
            登入
          </Link>
        </div>
      </div>

      <div className="card">
        <div className="kv">下一步（不需要你介入）</div>
        <ul style={{ marginTop: 10, lineHeight: 1.8 }}>
          <li>把 Web/Mobile 的導覽統一成「公告 / 活動 / 地圖 / 餐廳 / 我的」</li>
          <li>把 school 選擇改成可保存（避免說明文字和網址參數到處飛）</li>
          <li>準備 Firebase 端 schema 與 rules（已完成骨架）</li>
        </ul>
      </div>
    </SiteShell>
  );
}
