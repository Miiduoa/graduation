import { mockCourses } from "@campus/shared/src/mockData";

export default function TimetablePage() {
  return (
    <main style={{ padding: 24, fontFamily: "system-ui" }}>
      <h2>課表（假資料）</h2>
      <ul>
        {mockCourses.map((c) => (
          <li key={c.id}>
            {c.name}｜週{c.dayOfWeek} {c.startTime}-{c.endTime}｜{c.location}
          </li>
        ))}
      </ul>
    </main>
  );
}
