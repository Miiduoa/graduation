import Link from "next/link";

export default function HomePage() {
  return (
    <main style={{ padding: 24, fontFamily: "system-ui" }}>
      <h1>畢業專題｜校園應用（Web）</h1>
      <p>目前是骨架（假資料）。之後會接 Firebase + 學校 SSO。</p>

      <ul>
        <li><Link href="/announcements">公告</Link></li>
        <li><Link href="/timetable">課表</Link></li>
        <li><Link href="/map">校園地圖</Link></li>
        <li><Link href="/clubs">社團活動</Link></li>
        <li><Link href="/cafeteria">餐廳</Link></li>
        <li><Link href="/login">登入（SSO placeholder）</Link></li>
      </ul>
    </main>
  );
}
