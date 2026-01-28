import { mockPois } from "@campus/shared/src/mockData";

export default function MapPage() {
  return (
    <main style={{ padding: 24, fontFamily: "system-ui" }}>
      <h2>校園地圖（先用點位列表代替）</h2>
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
