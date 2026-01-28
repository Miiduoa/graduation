import { resolveSchoolByCode } from "@campus/shared/src/schools";
import { mockClubEvents } from "@campus/shared/src/mockData";

export default function ClubsPage(props: { searchParams?: { school?: string } }) {
  const school = resolveSchoolByCode(props.searchParams?.school);

  return (
    <main style={{ padding: 24, fontFamily: "system-ui" }}>
      <h2>社團活動（假資料）</h2>
      <div style={{ opacity: 0.7, marginBottom: 12 }}>
        學校：{school.name}（{school.code}）
      </div>
      <ul>
        {mockClubEvents.map((e) => (
          <li key={e.id}>
            <strong>{e.title}</strong>
            <div style={{ opacity: 0.7, fontSize: 12 }}>
              {e.startsAt} ~ {e.endsAt}
            </div>
            <div>{e.location}</div>
            <p>{e.description}</p>
            <button disabled>報名（待接後端）</button>
          </li>
        ))}
      </ul>
    </main>
  );
}
