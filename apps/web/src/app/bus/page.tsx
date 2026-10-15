import { Suspense } from 'react';
import { SiteShell } from '@/components/SiteShell';
import { BusContext } from './BusContext';

export const dynamic = 'force-dynamic';

function OfficialTransitNotice() {
  return (
    <aside className="card" data-transit-mode="official-links" aria-labelledby="transit-availability-title">
      <h2 id="transit-availability-title">即時到站尚未啟用</h2>
      <p>目前無法在這裡查詢即時站牌與到站時間。請依搭車地點開啟官方網站查詢。</p>
      <p><a href="https://citybus-free.taichung.gov.tw/" target="_blank" rel="noopener noreferrer">臺中市官方公車查詢 ↗</a></p>
      <p><a href="https://www.taiwanbus.tw/" target="_blank" rel="noopener noreferrer">其他縣市與公路客運查詢 ↗</a></p>
    </aside>
  );
}

export default function BusPage() {
  const unavailable = process.env.TDX_CLIENT_ID === undefined && process.env.TDX_CLIENT_SECRET === undefined;
  const notice = unavailable ? <OfficialTransitNotice /> : undefined;
  return (
    <div data-campus-bus-shell="true">
      <Suspense fallback={<SiteShell title="公車與交通">{notice}<p role="status">讀取校園交通資料…</p></SiteShell>}>
        <BusContext availabilityNotice={notice} />
      </Suspense>
    </div>
  );
}
