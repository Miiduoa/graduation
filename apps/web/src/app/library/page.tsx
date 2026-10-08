'use client';

import { use, useState } from 'react';
import { SiteShell } from '@/components/SiteShell';
import { resolveSchoolPageContext } from '@/lib/pageContext';

const CATALOG = 'https://webpacx.lib.pu.edu.tw/';
const LIBRARY = 'https://library.pu.edu.tw/';

export default function LibraryPage(props: {
  searchParams?: Promise<{ school?: string; schoolId?: string }>;
}) {
  const searchParams = props.searchParams ? use(props.searchParams) : undefined;
  const { schoolId, schoolName } = resolveSchoolPageContext(searchParams);
  return <LibraryContent key={schoolId} schoolId={schoolId} schoolName={schoolName} />;
}

function LibraryContent({ schoolId, schoolName }: { schoolId: string; schoolName: string }) {
  const [keyword, setKeyword] = useState('');
  const [field, setField] = useState('FullText');
  if (schoolId !== 'pu') {
    return (
      <SiteShell title="圖書館" schoolName={schoolName}>
        <section className="card">
          <h2>尚未提供這所學校的圖書館入口</h2>
          <p>請從學校官網前往圖書館，查詢館藏與借閱紀錄。</p>
        </section>
      </SiteShell>
    );
  }
  return (
    <SiteShell
      title="圖書館"
      subtitle="查館藏、看借閱紀錄，或找個地方讀書。"
      schoolName={schoolName}
    >
      <div className="pageStack">
        <section className="card">
          <p className="eyebrow">蓋夏圖書館</p>
          <h2>找一本書</h2>
          <p style={{ color: 'var(--muted)' }}>
            搜尋會在新分頁開啟學校館藏系統，顯示圖書館提供的資料。
          </p>
          <form
            action={`${CATALOG}search`}
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
        <section className="card">
          <h2>借閱紀錄與續借</h2>
          <p style={{ color: 'var(--muted)', lineHeight: 1.8 }}>
            前往圖書館網站登入後，查看自己的到期日與可辦理的續借項目。是否續借成功，以圖書館的回覆為準。
          </p>
          <a className="btn" href={`${CATALOG}personal/`} target="_blank" rel="noopener noreferrer">
            前往我的借閱紀錄 ↗
          </a>
        </section>
        <section className="card">
          <h2>到館前先看看</h2>
          <p style={{ color: 'var(--muted)' }}>開放時間可能因假日或館方公告調整。</p>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <a
              className="btn"
              href={`${LIBRARY}p/426-1054-32.php?Lang=zh-tw`}
              target="_blank"
              rel="noopener noreferrer"
            >
              開館時間 ↗
            </a>
            <a
              className="btn"
              href={`${LIBRARY}p/426-1054-14.php?Lang=zh-tw`}
              target="_blank"
              rel="noopener noreferrer"
            >
              空間與設備預約 ↗
            </a>
            <a
              className="btn"
              href="https://jumper.lib.pu.edu.tw/"
              target="_blank"
              rel="noopener noreferrer"
            >
              電子資源 ↗
            </a>
          </div>
        </section>
      </div>
    </SiteShell>
  );
}
