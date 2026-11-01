'use client';

import { use, useState } from 'react';
import { resolveSchoolPublicServices } from '@campus/shared/src/schoolPublicServices';
import {
  PUBLIC_SCHOOL_INFO_CATALOG_URL,
  PUBLIC_SCHOOL_INFO_SNAPSHOT_DATE,
  buildPublicSchoolMapsSearchUrl,
  formatPublicSchoolAddress,
  formatPublicSchoolCity,
  getPublicSchoolInfo,
  getPublicSchoolTelHref,
  getSafePublicSchoolWebsiteUrl,
} from '@campus/shared/src/publicSchoolInfo';
import { PublicSourceNotice } from '@/components/PublicSourceNotice';
import { SiteShell } from '@/components/SiteShell';
import { useCampusBrowseContext, type CampusBrowseContext } from '@/lib/useCampusBrowseContext';

export default function SchoolInfoPage(props: {
  searchParams?: Promise<{ school?: string; schoolId?: string; campus?: string }>;
}) {
  const searchParams = props.searchParams ? use(props.searchParams) : undefined;
  const context = useCampusBrowseContext(searchParams);
  // Include name so copy status/error remounts cleanly on same-ID identity change.
  const contentKey = [context.status, context.schoolId ?? '', context.schoolName ?? ''].join('|');
  return <SchoolInfoContent key={contentKey} {...context} />;
}

function SchoolInfoContent({ schoolId, schoolName, status }: CampusBrowseContext) {
  const [copyMessage, setCopyMessage] = useState('');
  const [copyError, setCopyError] = useState('');

  if (status !== 'ready' || !schoolId) {
    const loading = status === 'loading';
    const failed = status === 'error';
    return (
      <SiteShell title="學校資訊">
        <section className="card" role="status">
          <h2>{loading ? '正在讀取所選校園…' : failed ? '暫時無法確認校園' : '先選擇一所學校'}</h2>
          <p>
            {loading
              ? '確認校園後，即可查看該校公開聯絡資訊。'
              : failed
                ? '校園目錄讀取失敗，請在頁首重新取得目錄。'
                : '從頁首選擇校園，即可查看該校公開的聯絡與來源資訊。'}
          </p>
        </section>
      </SiteShell>
    );
  }

  const info = getPublicSchoolInfo(schoolId, schoolName);
  if (!info) {
    return (
      <SiteShell title="學校資訊">
        <section className="card">
          <h2>目前沒有這所學校的公開聯絡資料</h2>
          <p>名錄資訊尚待確認，請先從頁首重新選擇學校。</p>
        </section>
      </SiteShell>
    );
  }

  const websiteUrl = getSafePublicSchoolWebsiteUrl(info.websiteUrl);
  const telHref = getPublicSchoolTelHref(info.telephone);
  const mapsUrl = buildPublicSchoolMapsSearchUrl(info);
  const city = formatPublicSchoolCity(info);
  const address = formatPublicSchoolAddress(info);
  const career = resolveSchoolPublicServices(schoolId)?.services.career;

  async function copyTelephone() {
    setCopyMessage('');
    setCopyError('');
    try {
      if (!navigator.clipboard?.writeText) {
        setCopyError('瀏覽器無法自動複製，請自行選取上方總機號碼後複製。');
        return;
      }
      await navigator.clipboard.writeText(info!.telephone);
      setCopyMessage('已複製學校總機號碼。');
    } catch {
      setCopyError('目前無法自動複製，請自行選取上方總機號碼後複製。');
    }
  }

  return (
    <SiteShell
      title="學校資訊"
      subtitle="依目前瀏覽的校園，顯示教育部名錄中的公開聯絡資訊。"
      schoolName={info.name}
    >
      <div className="pageStack">
        <section className="card">
          <p className="eyebrow">{info.academicYear} 學年度名錄</p>
          <h2>{info.name}</h2>
          <p style={{ color: 'var(--muted)', lineHeight: 1.8 }}>
            {city}
            <br />
            {address}
          </p>
          <p style={{ color: 'var(--muted)', lineHeight: 1.7, marginBottom: 0 }}>
            上述為名錄中的機構地址；若學校有多個校區，請至官方網站確認實際位置與交通資訊。
          </p>
        </section>

        <section className="card">
          <h2>聯絡方式</h2>
          <p style={{ color: 'var(--muted)', lineHeight: 1.8 }}>學校總機：{info.telephone}</p>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            {telHref ? (
              <a className="btn" href={telHref}>
                撥打學校總機
              </a>
            ) : (
              <button type="button" className="btn" onClick={() => void copyTelephone()}>
                複製學校總機
              </button>
            )}
            <a className="btn" href={mapsUrl} target="_blank" rel="noopener noreferrer">
              用地圖搜尋校名與地址 ↗
            </a>
          </div>
          {copyMessage ? (
            <p style={{ color: 'var(--muted)', lineHeight: 1.7, marginBottom: 0 }}>{copyMessage}</p>
          ) : null}
          {copyError ? (
            <p
              role="alert"
              style={{ color: 'var(--danger, #b42318)', lineHeight: 1.7, marginBottom: 0 }}
            >
              {copyError}
            </p>
          ) : null}
        </section>

        {career ? (
          <section className="card">
            <h2>校方職涯資訊</h2>
            <p>
              {career.entryKind === 'student-portal-fallback'
                ? '請在臺大學生專區查找職涯與實習資訊。'
                : '職缺、實習與諮詢資訊請到所選學校官方網站查看。'}
            </p>
            <a className="btn" href={career.url} target="_blank" rel="noopener noreferrer">
              {career.label} ↗
            </a>
            <p style={{ color: 'var(--muted)', fontSize: 14 }}>來源：{career.sourceLabel}</p>
          </section>
        ) : null}

        <section className="card">
          <h2>資料來源</h2>
          <p style={{ color: 'var(--muted)', lineHeight: 1.8 }}>
            資料來自教育部統計處大專校院名錄（{info.academicYear} 學年度），快照日期{' '}
            {PUBLIC_SCHOOL_INFO_SNAPSHOT_DATE}
            。此頁提供公開聯絡方式；校務服務依學校目前開放項目使用。
          </p>
          <PublicSourceNotice
            sourceLabel={`教育部統計處大專校院名錄（${info.academicYear} 學年度）`}
            confirmedAt={PUBLIC_SCHOOL_INFO_SNAPSHOT_DATE}
            timeLabel="最後確認（名錄快照）"
            officialUrl={websiteUrl}
            officialLabel="官方網站"
          />
          <a
            className="btn"
            href={PUBLIC_SCHOOL_INFO_CATALOG_URL}
            target="_blank"
            rel="noopener noreferrer"
          >
            政府資料開放平台名錄 ↗
          </a>
        </section>
      </div>
    </SiteShell>
  );
}
