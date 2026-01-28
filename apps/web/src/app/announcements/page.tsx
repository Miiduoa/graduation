import { mockAnnouncements } from "@campus/shared/src/mockData";

export default function AnnouncementsPage() {
  return (
    <main style={{ padding: 24, fontFamily: "system-ui" }}>
      <h2>公告</h2>
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
