import Link from "next/link";
import { resolveSchoolByCode } from "@campus/shared/src/schools";

export default function HomePage(props: { searchParams?: { school?: string } }) {
  const schoolCode = props.searchParams?.school ?? "DEMO";
  const school = resolveSchoolByCode(schoolCode);

  const q = `?school=${encodeURIComponent(school.code)}`;

  return (
    <main style={{ padding: 24, fontFamily: "system-ui" }}>
      <h1>畢業專題｜校園應用（Web）</h1>
      <p style={{ marginTop: 6 }}>
        目前學校：<strong>{school.name}</strong>（代碼：{school.code}）
      </p>
      <p style={{ opacity: 0.75 }}>
        平台型多校通用：先用假資料，後續接 Firebase + 各校 Provider（參考 Moodle 的外掛思維）。
      </p>

      <p>
        <Link href="/join">更換/加入學校</Link>
      </p>

      <ul>
        <li><Link href={`/announcements${q}`}>公告</Link></li>
        <li><Link href={`/timetable${q}`}>課表</Link></li>
        <li><Link href={`/map${q}`}>校園地圖</Link></li>
        <li><Link href={`/clubs${q}`}>社團活動</Link></li>
        <li><Link href={`/cafeteria${q}`}>餐廳</Link></li>
        <li><Link href={`/login${q}`}>登入（SSO placeholder）</Link></li>
      </ul>
    </main>
  );
}
