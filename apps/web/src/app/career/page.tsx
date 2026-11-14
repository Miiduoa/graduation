'use client';
import { useEffect, useState } from 'react';
import {
  CAREER_EMPTY,
  CAREER_JOBS_UNAVAILABLE,
  CAREER_LINKS,
  careerCalendarUrl,
  careerSoon,
  emptyCareerFeed,
  fetchCareerFeed,
  type CareerFeed,
} from '@campus/shared/src/career';
import { resolveSchoolPublicServices } from '@campus/shared/src/schoolPublicServices';
import { SiteShell } from '@/components/SiteShell';
import { useCampusBrowseContext } from '@/lib/useCampusBrowseContext';
import styles from './career.module.css';
function CareerContent({ schoolId, schoolName }: { schoolId: string; schoolName: string }) {
  const [feed, setFeed] = useState<CareerFeed | null>(null);
  const [retry, setRetry] = useState(0);
  const official = resolveSchoolPublicServices(schoolId)?.services.career;
  useEffect(() => {
    const controller = new AbortController();
    fetchCareerFeed(schoolId, '', controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setFeed(data);
      })
      .catch(() => {
        if (!controller.signal.aborted) setFeed(emptyCareerFeed());
      });
    return () => controller.abort();
  }, [schoolId, retry]);
  return (
    <>
      <section className={styles.panel}>
        <h2>接下來</h2>
        <p>職產處、系所與校園徵才的明確日期，最多顯示 5 筆。日期來自標題，詳細時段請回原文確認。</p>
        {!feed ? (
          <p role="status">正在讀取公開職涯資訊…</p>
        ) : !feed.timeline.length ? (
          <p>目前沒有可確認日期的近期截止日或活動。</p>
        ) : (
          <ul className={styles.timeline}>
            {feed.timeline.map((item) => (
              <li key={item.url} className={careerSoon(item.date) ? styles.soon : ''}>
                <a
                  aria-label={`${item.date} ${item.title}，加入行事曆`}
                  href={careerCalendarUrl(item)}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <time dateTime={item.date}>{item.date.slice(5).replace('-', '/')}</time>
                  <span>
                    <strong>{item.title}</strong>
                    <small>{item.source}</small>
                  </span>
                </a>
              </li>
            ))}
          </ul>
        )}
        <p className={styles.muted}>
          點選日期列可「加入行事曆」，將開啟 Google 日曆確認；不會自動建立或發送提醒。
        </p>
        {feed?.announcementsUnavailable && (
          <p role="status">部分校方公告暫時讀不到，仍可前往官方網站。</p>
        )}
        <button
          onClick={() => {
            setFeed(null);
            setRetry((v) => v + 1);
          }}
        >
          重新整理
        </button>
      </section>
      <section className={styles.panel}>
        <h2>校內工讀與實習</h2>
        <p>{CAREER_EMPTY}</p>
        {official && (
          <a href={official.url} target="_blank" rel="noopener noreferrer">
            {official.label} ↗
          </a>
        )}
        <p>
          此頁提供公開資訊，尚未接上校內工讀申請及實習學分系統。申請、權益說明與學分認定請洽校方；這裡不受理投遞或登錄時數。
        </p>
      </section>
      <section className={styles.panel}>
        <h2>校方職涯公告</h2>
        <p>{schoolName} · 只顯示標題、公告日期與原文連結；公告日期不是截止日。</p>
        {feed && !feed.supported && <p>目前尚未接上這所學校的公告來源，請從校方職涯入口查詢。</p>}
        {feed?.announcements.length ? (
          <ul className={styles.announcements}>
            {feed.announcements.map((a) => (
              <li key={a.url}>
                <span>
                  {a.source} · {a.date || '未提供公告日期'}
                </span>
                <a href={a.url} target="_blank" rel="noopener noreferrer">
                  {a.title} ↗
                </a>
              </li>
            ))}
          </ul>
        ) : (
          <p>目前沒有可顯示的公告。</p>
        )}
        {official && (
          <p>
            <a href={official.url} target="_blank" rel="noopener noreferrer">
              前往校方職涯資源 ↗
            </a>
          </p>
        )}
      </section>
      <section className={styles.panel}>
        <h2>附近職缺補充</h2>
        <p>
          來源：
          <a href="https://data.gov.tw/dataset/44062" target="_blank" rel="noopener noreferrer">
            台灣就業通開放資料 ↗
          </a>
          。
          {feed?.supported !== false
            ? '靜宜周邊：沙鹿（433）。'
            : '目前僅接入靜宜周邊沙鹿（433），不套用到其他學校。'}
          外站職缺不代表校方推薦或可抵實習學分。
        </p>
        {feed?.jobsUnavailable ? (
          <p role="status">{CAREER_JOBS_UNAVAILABLE}</p>
        ) : feed?.supported && !feed.jobs.length ? (
          <p>目前沒有沙鹿地區的補充職缺。</p>
        ) : null}
        {!!feed?.jobs.length && (
          <ul className={styles.announcements}>
            {feed.jobs.map((j) => (
              <li key={j.url}>
                <span>台灣就業通 · {j.company}</span>
                <a href={j.url} target="_blank" rel="noopener noreferrer">
                  {j.title} ↗
                </a>
              </li>
            ))}
          </ul>
        )}
        <div className={styles.actions}>
          {CAREER_LINKS.map((link) => (
            <a key={link.url} href={link.url} target="_blank" rel="noopener noreferrer">
              {link.label} ↗
            </a>
          ))}
        </div>
      </section>
      <aside className={styles.panel}>
        <h2>給學生、職涯承辦與平台營運</h2>
        <p>
          訪客與登入者看到相同的公開資訊。承辦與營運可從來源連結核對公告；本頁沒有上架、申請審核、學生名冊或實習紀錄管理功能。諮詢預約請依校方網站流程辦理。
        </p>
      </aside>
    </>
  );
}
export default function CareerPage() {
  const campus = useCampusBrowseContext();
  return (
    <SiteShell title="職涯" subtitle="校內工讀、實習學分與校園徵才，從校方消息掌握下一步。">
      <div className={styles.page}>
        {campus.status === 'ready' && campus.schoolId ? (
          <CareerContent
            key={campus.schoolId}
            schoolId={campus.schoolId}
            schoolName={campus.schoolName}
          />
        ) : (
          <section className={styles.panel}>
            <p role="status">
              {campus.status === 'loading'
                ? '正在確認學校…'
                : '請從頁首先選擇學校，再查看該校的職涯資訊。'}
            </p>
          </section>
        )}
      </div>
    </SiteShell>
  );
}
