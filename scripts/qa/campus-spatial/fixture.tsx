import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import CampusSpatialExplorer from '../../../apps/web/src/app/map/CampusSpatialExplorer';
import { withProvidenceCampusPlaces } from '../../../packages/shared/src/providenceCampus';
import type { MapLocation } from '../../../apps/web/src/app/map/mapService';
import '../../../apps/web/src/app/globals.css';

const places = withProvidenceCampusPlaces('pu', []);
// Keep the QA oracle tied to fixture input IDs, independently of the
// disambiguated marker/chooser labels rendered by the production component.
Object.defineProperty(window, '__campusSpatialFixturePlaceNames', {
  value: Object.freeze(Object.fromEntries(places.map(({ id, name }) => [id, name]))),
});
function Fixture() {
  const [selected, setSelected] = useState<MapLocation | null>(null);
  return (
    <main style={{ padding: 24 }}>
      <p style={{ color: 'var(--muted)', fontSize: 13 }}>元件驗證 · 使用專案公開地點快照，未連線學校帳號</p>
      <h1>校園地圖</h1>
      <p>開啟導覽，選擇地點，或用鍵盤操作導覽進度。</p>
      <CampusSpatialExplorer school="pu" locations={places} selected={selected} onSelect={setSelected} />
      <p role="status">{selected ? `已選取：${selected.name}` : '尚未選取地點'}</p>
      <button className="btn" type="button">背景操作測試</button>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<Fixture />);
