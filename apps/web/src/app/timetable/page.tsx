import { resolveSchool } from "@campus/shared/src/schools";
import { mockCourses } from "@campus/shared/src/mockData";

export default function TimetablePage(props: { searchParams?: { school?: string; schoolId?: string } }) {
  const school = resolveSchool({ school: props.searchParams?.school, schoolId: props.searchParams?.schoolId });

  return (
    <main style={{ padding: 24, fontFamily: "system-ui" }}>
      <h2>課表（假資料）</h2>
      <div style={{ opacity: 0.7, marginBottom: 12 }}>
        學校：{school.name}（{school.code}）
      </div>
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
