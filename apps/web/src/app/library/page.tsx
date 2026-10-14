'use client';

import { use, useState } from 'react';
import { SiteShell } from '@/components/SiteShell';
import { PublicCampusStatus } from '@/components/PublicCampusStatus';
import { usePublicSchoolContext } from '@/lib/usePublicSchoolContext';
import { getSchoolLibrary, type SchoolLibraryEntry } from '@campus/shared/src/libraryDirectory';

export default function LibraryPage(props: {
  searchParams?: Promise<{ school?: string; schoolId?: string; campus?: string }>;
}) {
  const params = props.searchParams ? use(props.searchParams) : undefined;
  const context = usePublicSchoolContext(params);
  if (context.status !== 'ready') {
    return (
      <SiteShell title="圖書館" subtitle="查各校館藏及官方服務。">
        <PublicCampusStatus status={context.status} service="圖書館" />
      </SiteShell>
    );
  }
  return (
    <LibraryContent
      key={context.schoolId}
      schoolId={context.schoolId}
      schoolName={context.schoolName}
    />
  );
}

function LibraryContent({ schoolId, schoolName }: { schoolId: string; schoolName: string }) {
  const [keyword, setKeyword] = useState('');
  const [field, setField] = useState('FullText');
  const library = getSchoolLibrary(schoolId, schoolName);

  if (!library) {
    return (
      <SiteShell title="圖書館" schoolName={schoolName}>
        <section className="card">
          <h2>尚未提供這所學校的圖書館入口</h2>
          <p>目前沒有核對完成的官方圖書館網站，請由學校官網前往。本站不會顯示其他學校的館藏或借閱資訊。</p>
        </section>
      </SiteShell>
    );
  }

  return (
    <SiteShell
      title="圖書館"
      subtitle="找書、查借閱、安排到館；所有連結都對應目前選擇的學校。"
      schoolName={schoolName}
    >
      <div className="pageStack">
        {library.searchMode === 'pu-webpac' ? (
          <section className="card">
            <p className="eyebrow">{library.name}</p>
            <h2>找一本書</h2>
            <p style={{ color: 'var(--muted)' }}>
              搜尋會在新分頁開啟這所學校的官方館藏系統。
            </p>
            <form
              action={new URL('search', library.catalog || library.homepage).toString()}
              method="get"
              target="_blank"
              rel="noopener noreferrer"
              className="pageStack"
            >
              <label>
                搜尋範圍
                <select
                  className="input"
                  name="searchField"
                  value={field}
                  onChange={(event) => setField(event.target.value)}
                >
                  <option value="FullText">全部欄位</option>
                  <option value="Title">書名</option>
                  <option value="Author">作者</option>
                  <option value="ISBN">ISBN</option>
                  <option value="Subject">主題</option>
                </select>
              </label>
              <label>
                關鍵字
                <input
                  className="input"
                  type="search"
                  name="searchInput"
                  placeholder="書名、作者或 ISBN"
                  value={keyword}
                  onChange={(event) => setKeyword(event.target.value)}
                  maxLength={200}
                  required
                />
              </label>
              <div>
                <button className="btn primary" type="submit" disabled={!keyword.trim()}>
                  搜尋學校館藏 ↗
                </button>
              </div>
            </form>
          </section>
        ) : (
          <section className="card">
            <p className="eyebrow">{library.name}</p>
            <h2>館藏查詢</h2>
            <p>
              已找到{schoolName}的官方圖書館入口。不同學校採用不同的館藏系統，
              目前請在館方網站輸入書名、作者或 ISBN；尚未將結果整合為本站內的即時館藏。
            </p>
            <a
              className="btn primary"
              href={library.catalog || library.homepage}
              target="_blank"
              rel="noopener noreferrer"
            >
              {library.catalog ? '開啟官方館藏目錄 ↗' : '前往學校圖書館查詢 ↗'}
            </a>
          </section>
        )}
        <LibraryPersonalSection library={library} />
        <section className="card">
          <h2>到館與電子資源</h2>
          <p style={{ color: 'var(--muted)' }}>
            開館時間、座位及預約規則可能臨時變動，請以館方即時公告與登入後的結果為準。
          </p>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <a className="btn" href={library.homepage} target="_blank" rel="noopener noreferrer">
              圖書館官方網站 ↗
            </a>
            {library.hours && (
              <a className="btn" href={library.hours} target="_blank" rel="noopener noreferrer">
                開館時間 ↗
              </a>
            )}
            {library.reservation && (
              <a className="btn" href={library.reservation} target="_blank" rel="noopener noreferrer">
                空間與設備預約 ↗
              </a>
            )}
            {library.electronic && (
              <a className="btn" href={library.electronic} target="_blank" rel="noopener noreferrer">
                電子資源 ↗
              </a>
            )}
          </div>
        </section>
      </div>
    </SiteShell>
  );
}

function LibraryPersonalSection({ library }: { library: SchoolLibraryEntry }) {
  return (
    <section className="card">
      <h2>借閱紀錄與續借</h2>
      <p style={{ color: 'var(--muted)', lineHeight: 1.8 }}>
        請在這所學校的官方網站登入讀者帳號後查看到期日與可辦理的續借項目。
        本站不會假裝讀取個人借閱紀錄，是否續借成功以館方回覆為準。
      </p>
      <a
        className="btn"
        href={library.personal || library.homepage}
        target="_blank"
        rel="noopener noreferrer"
      >
        {library.personal ? '前往我的借閱紀錄 ↗' : '開啟官方讀者服務入口 ↗'}
      </a>
    </section>
  );
}
