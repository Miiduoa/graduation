import { resolveSchool } from "@campus/shared/src/schools";
import { mockPois } from "@campus/shared/src/mockData";

export default function MapPage(props: { searchParams?: { school?: string; schoolId?: string } }) {
  const school = resolveSchool({ school: props.searchParams?.school, schoolId: props.searchParams?.schoolId });

  return (
    <main style={{ padding: 24, fontFamily: "system-ui" }}>
      <h2>校園地圖（先用點位列表代替）</h2>
      <div style={{ opacity: 0.7, marginBottom: 12 }}>
        學校：{school.name}（{school.code}）
      </div>
      <p>之後可換成 Leaflet/Mapbox 並顯示點位。</p>
      <ul>
        {mockPois.map((p) => (
          <li key={p.id}>
            {p.name} ({p.lat}, {p.lng})
          </li>
        ))}
      </ul>
    </main>
  );
}
