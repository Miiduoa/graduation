'use client';

import { SchoolSelector } from './SchoolSelector';
import { useOptionalSelectedSchool } from './SelectedSchoolProvider';
import type { PublicSchoolStatus } from '@/lib/usePublicSchoolContext';

export function PublicCampusStatus({
  status,
  service,
}: {
  status: PublicSchoolStatus;
  service: string;
}) {
  const selected = useOptionalSelectedSchool();
  if (status === 'ready') return null;
  if (status === 'loading') {
    return <section className="card" role="status">正在確認要瀏覽的校園…</section>;
  }
  if (status === 'error') {
    return (
      <section className="card" role="alert">
        <h2>校園目錄暫時無法使用</h2>
        <p>無法確認你選擇的學校，因此不會顯示其他學校的{service}資料。</p>
        {selected?.onRetryCatalog && (
          <button className="btn primary" onClick={selected.onRetryCatalog}>
            重新讀取校園目錄
          </button>
        )}
      </section>
    );
  }
  return (
    <section className="card">
      <h2>{status === 'unknown' ? '無法確認這所學校' : '請先選擇學校'}</h2>
      <p>
        {status === 'unknown'
          ? `原本指定的校園不在目前目錄，請重新選擇。為避免混入其他學校的資料，暫不顯示${service}。`
          : `選好學校後，就會顯示該校可查詢的${service}，不會預設帶入靜宜大學資料。`}
      </p>
      {selected && <SchoolSelector />}
    </section>
  );
}
