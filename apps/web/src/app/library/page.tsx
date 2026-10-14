'use client';

import { use, useState } from 'react';
import { getOfficialLibrary } from '@campus/shared/src/officialLibraries';
import { SiteShell } from '@/components/SiteShell';
import { useCampusBrowseContext, type CampusBrowseContext } from '@/lib/useCampusBrowseContext';

export default function LibraryPage(props: {
  searchParams?: Promise<{ school?: string; schoolId?: string; campus?: string }>;
}) {
  const searchParams = props.searchParams ? use(props.searchParams) : undefined;
  const context = useCampusBrowseContext(searchParams);
  return <LibraryContent key={context.schoolId ?? context.status} {...context} />;
}

function LibraryContent({ schoolId, schoolName, status }: CampusBrowseContext) {
  const [keyword, setKeyword] = useState('');
  const [field, setField] = useState('FullText');
  const [copyMessage, setCopyMessage] = useState('');
  const library = getOfficialLibrary(schoolId);

  async function copyKeyword() {
    const query = keyword.trim();
    if (!query) return;
    try {
      await navigator.clipboard.writeText(query);
      setCopyMessage('已複製關鍵字，請貼到學校的官方館藏搜尋。');
    } catch {
      setCopyMessage('目前無法自動複製，請選取上方的關鍵字後複製。');
    }
  }

  if (status !== 'ready' || !schoolId) {
    const loading = status === 'loading';
    const failed = status === 'error';
    return (
      <SiteShell title="圖書館">
        <section className="card" role="status">
          <h2>{loading ? '正在讀取所選校園…' : failed ? '暫時無法確認校園' : '先選擇一所學校'}</h2>
          <p>
            {loading
              ? '確認校園後再提供對應圖書館，不會先顯示其他學校的館藏。'
              : failed
                ? '校園目錄讀取失敗，請在頁首重新取得目錄。'
                : '從頁首選擇校園，即可開啟該校已核對的圖書館服務。'}
          </p>
        </section>
      </SiteShell>
    );
  }

  if (!library) {
    return (
      <SiteShell title="圖書館" schoolName={schoolName}>
        <section className="card">
          <h2>尚未提供這所學校的圖書館入口</h2>
          <p>尚未核對到這所學校的官方圖書館網站，因此不會顯示其他學校的館藏或借閱入口。</p>
        </section>
      </SiteShell>
    );
  }

  return (
    <SiteShell
      title="圖書館"
      subtitle="依目前瀏覽的校園，前往該校官方館藏與借閱服務。"
      schoolName={schoolName}
    >
      <div className="pageStack">
        <section className="card">
          <p className="eyebrow">{library.name}</p>
          <h2>找一本書</h2>
          {library.catalogSearch === 'pu-webpac' ? (
            <>
              <p style={{ color: 'var(--muted)' }}>
                搜尋會在新分頁開啟學校館藏系統，顯示圖書館提供的資料。
              </p>
              <form
                action={new URL('search', library.catalogUrl).toString()}
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
            </>
          ) : (
            <div className="pageStack">
              <p style={{ color: 'var(--muted)' }}>
                已對應這所學校的官方館藏入口。各校查詢方式不同，請在學校網站完成搜尋；未取得的即時館藏與可借狀態不會以推測資料代替。
              </p>
              <label>
                想找的書或關鍵字
                <input
                  className="input"
                  type="search"
                  placeholder="書名、作者或 ISBN"
                  value={keyword}
                  onChange={(event) => { setKeyword(event.target.value); setCopyMessage(''); }}
                  maxLength={200}
                />
              </label>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                <a className="btn primary" href={library.catalogUrl} target="_blank" rel="noopener noreferrer">
                  前往官方館藏入口 ↗
                </a>
                <button className="btn" type="button" disabled={!keyword.trim()} onClick={() => void copyKeyword()}>
                  複製關鍵字
                </button>
              </div>
              {copyMessage && <p role="status">{copyMessage}</p>}
            </div>
          )}
        </section>
        <section className="card">
          <h2>借閱紀錄與續借</h2>
          <p style={{ color: 'var(--muted)', lineHeight: 1.8 }}>
            請使用這所學校圖書館的帳號入口登入，查看到期日與續借資格。實際借閱及續借結果以館方系統為準。
          </p>
          {library.accountUrl ? (
            <a className="btn" href={library.accountUrl} target="_blank" rel="noopener noreferrer">
              前往我的借閱紀錄 ↗
            </a>
          ) : (
            <a className="btn" href={library.websiteUrl} target="_blank" rel="noopener noreferrer">
              從本校圖書館官網登入 ↗
            </a>
          )}
        </section>
        <section className="card">
          <h2>到館前先看看</h2>
          <p style={{ color: 'var(--muted)' }}>開放時間與空間使用規定可能因假日或館方公告調整。</p>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            {library.hoursUrl && (
              <a className="btn" href={library.hoursUrl} target="_blank" rel="noopener noreferrer">
                開館時間 ↗
              </a>
            )}
            {library.spacesUrl && (
              <a className="btn" href={library.spacesUrl} target="_blank" rel="noopener noreferrer">
                空間與設備預約 ↗
              </a>
            )}
            {library.electronicResourcesUrl && (
              <a className="btn" href={library.electronicResourcesUrl} target="_blank" rel="noopener noreferrer">
                電子資源 ↗
              </a>
            )}
            <a className="btn" href={library.websiteUrl} target="_blank" rel="noopener noreferrer">
              {library.hoursUrl ? '圖書館官網 ↗' : '開館時間與服務資訊 ↗'}
            </a>
          </div>
        </section>
      </div>
    </SiteShell>
  );
}
