'use client';

import { useEffect, useId, useRef, useState } from 'react';
import Link from 'next/link';
import { materialFailureMessage } from '@campus/shared/src/materialAccess';
import { formatTaipeiDateTime } from '@campus/shared/src/taipeiTime';
import {
  continueSearchableMaterials,
  courseMaterialHref,
  describeMaterial,
  isMaterialNew,
  loadSearchableMaterials,
  restartSearchableMaterials,
  searchCourseMaterials,
  type MaterialSearchSeed,
  type SearchableMaterial,
  type SearchableMaterialsCatalog,
} from '@/lib/courseMaterials';
import { useClientNow } from '@/lib/useMaterialClientState';
import { useClasses } from './CourseUI';
import { useNuniSession } from './Session';
import { classroomCourseHref } from './studyNavigation';
import shared from './NuniApp.module.css';
import styles from './CourseLearning.module.css';

export function CourseMaterialSearch({
  compact = false,
  seed = null,
  context = '',
}: {
  compact?: boolean;
  seed?: MaterialSearchSeed | null;
  context?: string;
}) {
  const { session, pendingLogout } = useNuniSession();
  if (!session || pendingLogout) return null;
  return <Search key={session.context} compact={compact} seed={seed} context={context} />;
}

function Search({
  compact,
  seed,
  context,
}: {
  compact: boolean;
  seed: MaterialSearchSeed | null;
  context: string;
}) {
  const classes = useClasses();
  const courseApi = useRef(classes);
  const inputId = useId();
  const [query, setQuery] = useState('');
  const [catalog, setCatalog] = useState<SearchableMaterialsCatalog | null>(null);
  const [reading, setReading] = useState(false);
  const [continuing, setContinuing] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [error, setError] = useState('');
  const [loadEpoch, setLoadEpoch] = useState(0);
  const now = useClientNow();
  const request = useRef(0);
  const loadStarted = useRef(false);
  const continueRequest = useRef(0);
  const restartRequest = useRef(0);
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
      continueRequest.current += 1;
      restartRequest.current += 1;
      // Clearing the query cancels in-flight catalogue work without keeping stale hits.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setReading(false);
      setContinuing(false);
      setRestarting(false);
      if (!catalog) loadStarted.current = false;
      return;
    }
    if (catalog || loadStarted.current) return;
    loadStarted.current = true;
    const run = ++request.current;
    setReading(true);
    setError('');
    const api = courseApi.current;
    const fence = { cancelled: () => !mounted.current || run !== request.current };
    void api
      .list()
      .then((workspaces) => {
        if (fence.cancelled()) return null;
        return loadSearchableMaterials(api, workspaces, seed, fence);
      })
      .then((result) => {
        if (!result || fence.cancelled()) return;
        setCatalog(result);
      })
      .catch((failure) => {
        if (fence.cancelled()) return;
        loadStarted.current = false;
        setError(materialFailureMessage(failure, !navigator.onLine));
      })
      .finally(() => {
        if (mounted.current && run === request.current) setReading(false);
      });
  }, [catalog, loadEpoch, query, seed]);

  async function loadMore() {
    const current = catalog;
    if (!current || reading || continuing || restarting) return;
    const pending = current.courses.some(
      (course) => !course.denied && !course.complete && !course.needsRestart && !!course.nextCursor,
    );
    if (!pending) return;
    const run = ++continueRequest.current;
    const loadRun = request.current;
    setContinuing(true);
    const api = courseApi.current;
    const fence = {
      cancelled: () =>
        !mounted.current || run !== continueRequest.current || loadRun !== request.current,
    };
    try {
      const next = await continueSearchableMaterials(api, current, fence);
      if (fence.cancelled()) return;
      setCatalog(next);
    } catch (failure) {
      if (fence.cancelled()) return;
      setCatalog({
        ...current,
        partialError: materialFailureMessage(failure, !navigator.onLine),
      });
    } finally {
      if (mounted.current && run === continueRequest.current) setContinuing(false);
    }
  }

  async function restartCatalog() {
    const current = catalog;
    if (reading || continuing || restarting) return;
    if (current) {
      const stalled = current.courses.some((course) => !course.denied && course.needsRestart);
      if (!stalled) return;
      const run = ++restartRequest.current;
      const loadRun = request.current;
      setRestarting(true);
      const api = courseApi.current;
      const fence = {
        cancelled: () =>
          !mounted.current || run !== restartRequest.current || loadRun !== request.current,
      };
      try {
        const next = await restartSearchableMaterials(api, current, fence);
        if (fence.cancelled()) return;
        setCatalog(next);
      } catch (failure) {
        if (fence.cancelled()) return;
        setCatalog({
          ...current,
          partialError: materialFailureMessage(failure, !navigator.onLine),
        });
      } finally {
        if (mounted.current && run === restartRequest.current) setRestarting(false);
      }
      return;
    }
    // First-page catalogue failure: explicit retry without editing the query.
    loadStarted.current = false;
    setError('');
    request.current += 1;
    continueRequest.current += 1;
    restartRequest.current += 1;
    setCatalog(null);
    setLoadEpoch((value) => value + 1);
  }

  const items: SearchableMaterial[] = catalog?.items ?? [];
  const hits = catalog && query.trim() ? searchCourseMaterials(query, items) : [];
  const needsRestart =
    !!catalog && catalog.courses.some((course) => !course.denied && course.needsRestart);
  const canContinuePages =
    !!catalog &&
    catalog.courses.some(
      (course) => !course.denied && !course.complete && !course.needsRestart && !!course.nextCursor,
    );
  const hasMore = !!catalog && (catalog.truncated || !!catalog.partialError);
  const showContinue =
    !!catalog && !reading && !restarting && query.trim().length > 0 && canContinuePages;
  const showRestart =
    !!query.trim() && !reading && !continuing && (needsRestart || (!!error && !catalog));

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
      {continuing && <p role="status">正在載入較早的教材頁面…</p>}
      {restarting && <p role="status">正在重新讀取教材…</p>}
      {error && (
        <p role="alert" className={shared.notice}>
          {error} 還沒搜到任何課的教材，請確認連線後再試。
        </p>
      )}
      {(catalog?.skipped ?? 0) > 0 && catalog && (
        <p className={styles.note}>有 {catalog.skipped} 門課目前無法查看，搜尋結果不包含這些課程。</p>
      )}
      {needsRestart && catalog?.partialError && (
        <p role="alert" className={styles.note}>
          {catalog.partialError} 已載入的教材仍可搜尋；請重新讀取教材以更新清單。
        </p>
      )}
      {catalog?.partialError && !needsRestart && (
        <p role="alert" className={styles.note}>
          {catalog.partialError} 已載入的教材仍可搜尋；請重試載入較早的教材。
        </p>
      )}
      {hasMore && catalog && !catalog.partialError && !needsRestart && (
        <p className={styles.note}>
          部分課程還有較早的教材頁面未載入。若找不到需要的內容，請繼續載入後再搜。
        </p>
      )}
      {query.trim() && catalog && !reading && !hits.length && (
        <p className={shared.muted}>
          {hasMore
            ? `目前已載入的教材中找不到「${query.trim()}」。可繼續載入較早頁面，或改打課名、週次、檔名關鍵字。`
            : `找不到符合「${query.trim()}」的教材。可改打課名、週次或檔名關鍵字。`}
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
                  href={
                    context
                      ? classroomCourseHref(item.workspaceId, context, {
                          kind: 'material',
                          id: item.id,
                        })
                      : courseMaterialHref(item.workspaceId, item.id)
                  }
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
      {showContinue && (
        <button
          type="button"
          className={`${shared.button} ${shared.secondary}`}
          disabled={continuing}
          onClick={() => void loadMore()}
        >
          {continuing
            ? '載入較早教材中…'
            : catalog?.partialError
              ? '重試載入較早教材'
              : '繼續載入較早教材'}
        </button>
      )}
      {showRestart && (
        <button
          type="button"
          className={`${shared.button} ${shared.secondary}`}
          disabled={restarting}
          onClick={() => void restartCatalog()}
        >
          {restarting ? '重新讀取教材中…' : '重新讀取教材'}
        </button>
      )}
    </section>
  );
}
