'use client';

import { useEffect, useId, useRef, useState } from 'react';
import Link from 'next/link';
import { nuniErrorMessage } from '@campus/shared/src/nuni';
import { formatTaipeiDateTime } from '@campus/shared/src/taipeiTime';
import {
  courseMaterialHref,
  describeMaterial,
  isMaterialNew,
  loadSearchableMaterials,
  searchCourseMaterials,
  type MaterialSearchSeed,
  type SearchableMaterial,
} from '@/lib/courseMaterials';
import { useClientNow } from '@/lib/useMaterialClientState';
import { useClasses } from './CourseUI';
import { useNuniSession } from './Session';
import shared from './NuniApp.module.css';
import styles from './CourseLearning.module.css';

export function CourseMaterialSearch({
  compact = false,
  seed = null,
}: {
  compact?: boolean;
  seed?: MaterialSearchSeed | null;
}) {
  const { session, pendingLogout } = useNuniSession();
  if (!session || pendingLogout) return null;
  return <Search key={session.context} compact={compact} seed={seed} />;
}

function Search({ compact, seed }: { compact: boolean; seed: MaterialSearchSeed | null }) {
  const classes = useClasses();
  const courseApi = useRef(classes);
  const inputId = useId();
  const [query, setQuery] = useState('');
  const [catalog, setCatalog] = useState<SearchableMaterial[] | null>(null);
  const [skipped, setSkipped] = useState(0);
  const [truncated, setTruncated] = useState(false);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState('');
  const now = useClientNow();
  const request = useRef(0);
  const loadStarted = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    courseApi.current = classes;
  });

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      request.current += 1;
      setReading(false);
      if (!catalog) loadStarted.current = false;
      return;
    }
    if (catalog || loadStarted.current) return;
    loadStarted.current = true;
    const run = ++request.current;
    setReading(true);
    setError('');
    const api = courseApi.current;
    void api
      .list()
      .then((workspaces) => loadSearchableMaterials(api, workspaces, seed))
      .then((result) => {
        if (!mounted.current || run !== request.current) return;
        setCatalog(result.items);
        setSkipped(result.skipped);
        setTruncated(result.truncated);
      })
      .catch((failure) => {
        if (!mounted.current || run !== request.current) return;
        loadStarted.current = false;
        setError(nuniErrorMessage(failure));
      })
      .finally(() => {
        if (mounted.current && run === request.current) setReading(false);
      });
  }, [catalog, query, seed]);

  const hits = catalog && query.trim() ? searchCourseMaterials(query, catalog) : [];

  return (
    <section className={compact ? styles.homeSearch : shared.panel} aria-labelledby={inputId}>
      {compact ? null : (
        <>
          <p className={shared.eyebrow}>跨課搜尋</p>
          <h2>找教材</h2>
          <p className={shared.muted}>
            一次搜你修的課和教的課。打錯字或只打關鍵字也可以；結果會標課名與週次，點一下落到那份教材。
          </p>
        </>
      )}
      <label className={styles.cabinetSearch} htmlFor={inputId}>
        {compact ? '找所有課的教材' : '搜尋教材'}
        <input
          id={inputId}
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="例如：主鍵、第三週、口試簡報"
          autoComplete="off"
        />
      </label>
      {reading && <p role="status">正在讀取你各門課的教材…</p>}
      {error && (
        <p role="alert" className={shared.notice}>
          {error} 還沒搜到任何課的教材，請確認連線後再試。
        </p>
      )}
      {skipped > 0 && catalog && (
        <p className={styles.note}>有 {skipped} 門課目前沒有權限，已略過，沒有拿來搜。</p>
      )}
      {truncated && catalog && (
        <p className={styles.note}>每門課目前最多搜到 100 則教材。更早的請進入該課教材櫃再載入較早頁面。</p>
      )}
      {query.trim() && catalog && !reading && !hits.length && (
        <p className={shared.muted}>
          找不到符合「{query.trim()}」的教材。可改打課名、週次或檔名關鍵字。
        </p>
      )}
      {hits.length > 0 && (
        <ul className={`${shared.list} ${styles.searchHits}`}>
          {hits.map((item) => {
            const described = describeMaterial(item);
            return (
              <li key={`${item.workspaceId}-${item.id}`}>
                <Link
                  className={styles.searchHit}
                  href={courseMaterialHref(item.workspaceId, item.id)}
                >
                  <strong>{item.title}</strong>
                  <span>
                    {item.courseTitle}
                    {item.unitTitle ? ` · ${item.unitTitle}` : ''}
                    {` · ${described.kindLabel}`}
                    {now != null && isMaterialNew(item.createdAt, now) ? ' · 新教材' : ''}
                  </span>
                  <small>
                    發布 {formatTaipeiDateTime(item.createdAt, { seconds: false })} · 開啟這份教材
                  </small>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
