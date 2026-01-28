import { resolveSchoolByCode } from "@campus/shared/src/schools";
import { mockMenus } from "@campus/shared/src/mockData";

export default function CafeteriaPage(props: { searchParams?: { school?: string } }) {
  const school = resolveSchoolByCode(props.searchParams?.school);

  return (
    <main style={{ padding: 24, fontFamily: "system-ui" }}>
      <h2>餐廳菜單（假資料）</h2>
      <div style={{ opacity: 0.7, marginBottom: 12 }}>
        學校：{school.name}（{school.code}）
      </div>
      <ul>
        {mockMenus.map((m) => (
          <li key={m.id}>
            {m.availableOn}｜{m.cafeteria}｜{m.name}（{m.price ?? "-"}）
          </li>
        ))}
      </ul>
    </main>
  );
}
