import { resolveSchool } from "@campus/shared/src/schools";
import { mockAnnouncements } from "@campus/shared/src/mockData";

export default function AnnouncementsPage(props: { searchParams?: { school?: string; schoolId?: string } }) {
  const school = resolveSchool({ school: props.searchParams?.school, schoolId: props.searchParams?.schoolId });

  return (
    <main style={{ padding: 24, fontFamily: "system-ui" }}>
      <h2>公告</h2>
      <div style={{ opacity: 0.7, marginBottom: 12 }}>
        學校：{school.name}（{school.code}）
      </div>
      <ul>
        {mockAnnouncements.map((a) => (
          <li key={a.id}>
            <strong>{a.title}</strong>
            <div style={{ opacity: 0.7, fontSize: 12 }}>{a.publishedAt}</div>
            <p>{a.body}</p>
          </li>
        ))}
      </ul>
    </main>
  );
}
