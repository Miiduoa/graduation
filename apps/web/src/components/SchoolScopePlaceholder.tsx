'use client';

import { useOptionalSelectedSchool } from './SelectedSchoolProvider';
import { SchoolSelector } from './SchoolSelector';

export function SchoolScopePlaceholder() {
  const selection = useOptionalSelectedSchool();
  if (selection?.catalogStatus === 'error') {
    return (
      <section className="card" role="alert">
        <h2>校園目錄暫時無法讀取</h2>
        <p>請重新連線後重試。為避免顯示錯誤學校的資訊，目前暫停載入此頁。</p>
        <button className="btn" type="button" onClick={() => selection.onRetryCatalog?.()}>
          重新讀取校園
        </button>
      </section>
    );
  }
  if (
    selection && !selection.loading && selection.catalogStatus === 'ready' &&
    selection.selectedSchoolId === null
  ) {
    return (
      <section className="card" aria-label="選擇校園資料範圍">
        <h2>先選擇要瀏覽的校園</h2>
        <p>地圖、公車、公告及校園交流會依選擇的學校提供資料。切換不影響你的登入或校務權限。</p>
        <SchoolSelector />
      </section>
    );
  }
  return <p role="status">正在確認校園目錄…</p>;
}
