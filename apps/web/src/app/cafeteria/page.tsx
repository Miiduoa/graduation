import { mockMenus } from "@campus/shared/src/mockData";

export default function CafeteriaPage() {
  return (
    <main style={{ padding: 24, fontFamily: "system-ui" }}>
      <h2>餐廳菜單（假資料）</h2>
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
