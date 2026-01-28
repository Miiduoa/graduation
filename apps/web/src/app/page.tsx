import Link from "next/link";
import { resolveSchool } from "@campus/shared/src/schools";

export default function HomePage(props: { searchParams?: { school?: string; schoolId?: string } }) {
  const school = resolveSchool({
    school: props.searchParams?.school,
    schoolId: props.searchParams?.schoolId,
  });

  const q = `?school=${encodeURIComponent(school.code)}&schoolId=${encodeURIComponent(school.id)}`;

  return (
    <main style={{ padding: 24, fontFamily: "system-ui" }}>
      <h1>畢業專題｜校園應用（Web）</h1>
      <p style={{ marginTop: 6 }}>
        目前學校：<strong>{school.name}</strong>（代碼：{school.code}）
      </p>
      <p style={{ opacity: 0.75 }}>
        平台型多校通用：代碼可撞碼（像 Moodle 的多站台/外掛思維），因此用 <code>schoolId</code> 做唯一識別。
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
