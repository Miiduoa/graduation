'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  NuniError,
  type NuniMaterial,
  type NuniUnit,
  type NuniWorkspace,
} from '@campus/shared/src/nuni';
import { materialCapabilities, materialFailureMessage, readMaterialWithDeadline } from '@campus/shared/src/materialAccess';
import { materialBookmarkId } from '@campus/shared/src/materialBookmarks';
import { useMaterialBookmarks } from '@/lib/materialBookmarks';
import { shareCourseMaterial } from '@/lib/shareCourseMaterial';
import { formatTaipeiDateTime } from '@campus/shared/src/taipeiTime';
import {
  COURSE_WORK_MISSING_MATERIAL,
  courseWorkElementId,
  landOnCourseWork,
  parseCourseWorkHash,
} from '@/lib/courseWorkLanding';
import {
  courseMaterialHref,
  describeMaterial,
  groupMaterialsByUnit,
  isMaterialNew,
  markMaterialRead,
  searchCourseMaterials,
} from '@/lib/courseMaterials';
import {
  materialBrowserStorage,
  useClientNow,
  useMaterialReadIds,
} from '@/lib/useMaterialClientState';
import { MutationForm, useClasses } from './CourseUI';
import { CourseUnitSelect } from './CourseUnitSelect';
import { selectCourseUnit } from './courseOutline';
import { useLocationHash } from '@/lib/useLocationHash';
import { useNuniSession } from './Session';
import { classroomCourseHref, classroomDirectoryHref } from './studyNavigation';
import shared from './NuniApp.module.css';
import styles from './CourseLearning.module.css';

function referenceUrl(candidate: string): string | null {
  try {
    const url = new URL(candidate);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}

export function CourseText({ text }: { text: string }) {
  const parts: ReactNode[] = [];
  const expression = /https?:\/\/[^\s<>"']+/gi;
  let offset = 0;
  for (const match of text.matchAll(expression)) {
    const start = match.index!;
    const candidate = match[0].replace(/[。，、；：！？）〉》」』】,.;!?)]+$/u, '');
    parts.push(text.slice(offset, start));
    const href = referenceUrl(candidate);
    if (href) {
      parts.push(
        <a key={start} href={href} target="_blank" rel="noopener noreferrer">
          {candidate}
        </a>,
      );
      parts.push(match[0].slice(candidate.length));
    } else {
      parts.push(match[0]);
    }
    offset = start + match[0].length;
  }
  parts.push(text.slice(offset));
  return <div className={`${shared.prose} ${styles.body}`}>{parts}</div>;
}

export function CourseMaterials({ workspace, units, onChanged }: { workspace: NuniWorkspace; units?: NuniUnit[] | null; onChanged?: () => void }) {
  const { session, pendingLogout } = useNuniSession();
  if (!session || pendingLogout) return null;
  return (
    <Materials
      key={`${session.platformAccountId}:${session.context}:${workspace.id}:${workspace.memberRole}:${workspace.state}`}
      workspace={workspace}
      units={units}
      onChanged={onChanged}
      accountId={session.platformAccountId}
    />
  );
}

function Materials({
  workspace,
  units,
  onChanged,
  accountId,
}: {
  workspace: NuniWorkspace;
  units?: NuniUnit[] | null;
  onChanged?: () => void;
  accountId: string;
}) {
  const classes = useClasses();
  const params = useSearchParams();
  const context = params?.toString() ?? '';
  const [items, setItems] = useState<NuniMaterial[] | null>(null);
  const hash = useLocationHash();
  const revealed = useRef('');
  const [reading, setReading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [accessDenied, setAccessDenied] = useState(false);
  const denied = useRef(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [readingMore, setReadingMore] = useState(false);
  const [moreError, setMoreError] = useState('');
  const [query, setQuery] = useState('');
  const now = useClientNow();
  const readIds = useMaterialReadIds(accountId);
  const bookmarks = useMaterialBookmarks(accountId);
  const savedIds = new Set(bookmarks.items.map(materialBookmarkId));
  const moreRequest = useRef<symbol | null>(null);
  const request = useRef(0);
  const seenCursors = useRef(new Set<string>());
  const mounted = useRef(true);
  const editable =
    !accessDenied && workspace.state === 'active' && workspace.memberRole !== 'student';
  const linked = parseCourseWorkHash(hash);
  const linkedMaterial = linked?.kind === 'material' ? linked.id : null;

  async function load() {
    if (denied.current) return;
    const run = ++request.current;
    moreRequest.current = null;
    setReadingMore(false);
    setMoreError('');
    setNextCursor(null);
    seenCursors.current.clear();
    setReading(true);
    setError('');
    try {
      const result = await readMaterialWithDeadline(classes.materialsPage(workspace.id));
      if (mounted.current && run === request.current) {
        setItems(result.materials);
        setNextCursor(result.nextCursor);
      }
    } catch (failure) {
      if (mounted.current && run === request.current) {
        if (failure instanceof NuniError && [401, 403, 404, 410].includes(failure.status)) {
          setItems(null);
          setNotice('');
          denied.current = true;
          setAccessDenied(true);
        }
        setError(materialFailureMessage(failure, !navigator.onLine));
      }
    } finally {
      if (mounted.current && run === request.current) setReading(false);
    }
  }

  async function loadMore() {
    if (reading || denied.current || !nextCursor || moreRequest.current) return;
    const run = request.current;
    const token = Symbol();
    moreRequest.current = token;
    setReadingMore(true);
    setMoreError('');
    try {
      const result = await readMaterialWithDeadline(classes.materialsPage(workspace.id, nextCursor));
      if (!mounted.current || run !== request.current || moreRequest.current !== token) return;
      setItems((previous) => {
        const existing = new Set(previous?.map((item) => item.id));
        return [...(previous ?? []), ...result.materials.filter((item) => !existing.has(item.id))];
      });
      seenCursors.current.add(nextCursor);
      if (result.nextCursor && seenCursors.current.has(result.nextCursor)) {
        setNextCursor(null);
        setMoreError('較早教材未能繼續載入，請更新教材後再試。');
      } else {
        setNextCursor(result.nextCursor);
      }
    } catch (failure) {
      if (!mounted.current || run !== request.current || moreRequest.current !== token) return;
      if (failure instanceof NuniError && [401, 403, 404, 410].includes(failure.status)) {
        denied.current = true;
        setAccessDenied(true);
        setItems(null);
        setNextCursor(null);
        setNotice('');
        setError(materialFailureMessage(failure, !navigator.onLine));
      } else if (failure instanceof NuniError && failure.code === 'CLASS_WORKSPACE_MATERIAL_CURSOR_INVALID') {
        ++request.current;
        moreRequest.current = null;
        setReadingMore(false);
        setNextCursor(null);
        setError(materialFailureMessage(failure, !navigator.onLine));
      } else {
        setMoreError(materialFailureMessage(failure, !navigator.onLine));
      }
    } finally {
      if (mounted.current && run === request.current && moreRequest.current === token) {
        moreRequest.current = null;
        setReadingMore(false);
      }
    }
  }

  function rememberRead(materialId: string) {
    markMaterialRead(accountId, materialId, materialBrowserStorage());
  }

  useEffect(() => {
    mounted.current = true;
    // Start the course read on mount; the same loader also manages explicit refreshes.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    return () => {
      mounted.current = false;
    };
    // The parent key changes with session, workspace, role and archive status.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!linkedMaterial) return;
    setQuery('');
  }, [linkedMaterial]);

  useEffect(() => {
    if (!linkedMaterial || reading || readingMore || accessDenied || moreError || !nextCursor) return;
    if (items?.some((item) => item.id === linkedMaterial)) return;
    void loadMore();
    // loadMore closes over the current cursor; the effect re-runs after each page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessDenied, items, linkedMaterial, moreError, nextCursor, reading, readingMore]);

  useEffect(() => {
    if (!linkedMaterial || revealed.current === `material-${linkedMaterial}` ||
      !items?.some((item) => item.id === linkedMaterial)) return;
    const target = courseWorkElementId('material', linkedMaterial);
    const frame = window.requestAnimationFrame(() => {
      if (landOnCourseWork(target)) {
        revealed.current = target;
        rememberRead(linkedMaterial);
      }
    });
    return () => window.cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, linkedMaterial]);

  const filtered = !query.trim()
    ? items
    : items &&
      searchCourseMaterials(
        query,
        items.map((item) => ({
          id: item.id,
          workspaceId: item.workspaceId,
          courseTitle: workspace.title,
          title: item.title,
          body: item.body,
          unitTitle: item.unitTitle,
          createdAt: item.createdAt,
        })),
      ).flatMap((hit) => items.filter((item) => item.id === hit.id));
  const visible = filtered ?? [];
  const groups = groupMaterialsByUnit(visible, units);
  const missingLinked =
    items !== null &&
    !reading &&
    !readingMore &&
    !nextCursor &&
    !moreError &&
    !error &&
    !!linkedMaterial &&
    !items.some((item) => item.id === linkedMaterial);

  useEffect(() => {
    if (!linkedMaterial || (!accessDenied && !missingLinked)) return;
    // Keep the explanation visible while removing the unavailable target from the address.
    window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search);
  }, [accessDenied, linkedMaterial, missingLinked]);

  return (
    <section className={shared.panel} aria-labelledby={`materials-${workspace.id}`}>
      <div className={styles.heading}>
        <div>
          <p className={shared.eyebrow}>課程內容</p>
          <h2 id={`materials-${workspace.id}`}>教材櫃</h2>
        </div>
        <button
          type="button"
          className={`${shared.button} ${shared.secondary}`}
          disabled={reading || accessDenied}
          onClick={() => void load()}
        >
          {reading ? '讀取中…' : '更新教材'}
        </button>
      </div>
      <p className={shared.muted}>
        依週次或單元整理教材，可搜尋名稱與內容。閱讀教材不會算成作業完成。
      </p>
      <p className={styles.note}>{materialCapabilities(workspace)}</p>
      <div className={shared.actions}>
        <a href={classroomCourseHref(workspace.id, context)}>回課程首頁</a>
        <a href={classroomDirectoryHref(context, 'bookmarks')}>此裝置收藏</a>
      </div>
      <p className={styles.note}>收藏只記在此瀏覽器的目前帳號，換裝置不會同步；閱讀與收藏分開記錄。</p>
      {bookmarks.error && (
        <div role="alert" className={shared.notice}>
          <p>{bookmarks.error}</p>
          <button type="button" className={`${shared.button} ${shared.secondary}`}
            disabled={bookmarks.loading} onClick={() => void bookmarks.reload()}>
            {bookmarks.loading ? '讀取收藏中…' : '重新讀取收藏'}
          </button>
        </div>
      )}
      {workspace.state === 'archived' && (
        <p className={styles.note}>課程已封存，教材保留供成員閱讀。</p>
      )}
      {notice && (
        <p role="status" className={shared.receipt}>
          {notice}
        </p>
      )}
      {error && (
        <p role="alert" className={shared.notice}>
          {error} {accessDenied ? '請回到課程列表，重新確認課程權限。' : '請使用「更新教材」重試。'}
        </p>
      )}
      {reading && items === null && <p role="status">正在讀取教材櫃…</p>}
      {items !== null && (
        <label className={styles.cabinetSearch}>
          在這門課找教材
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="課名、週次、檔名或關鍵字"
            autoComplete="off"
          />
        </label>
      )}
      {missingLinked ? (
        <p role="status" className={shared.notice}>
          {COURSE_WORK_MISSING_MATERIAL}
        </p>
      ) : null}
      {items !== null &&
        (items.length ? (
          visible.length ? (
            <div className={styles.cabinet}>
              {groups.map((group) => (
                <section
                  key={group.id ?? 'unassigned'}
                  className={styles.cabinetGroup}
                  aria-labelledby={`material-group-${group.id ?? 'loose'}-${workspace.id}`}
                >
                  <h3 id={`material-group-${group.id ?? 'loose'}-${workspace.id}`}>{group.title}</h3>
                  <ul className={`${shared.list} ${styles.materials}`}>
                    {group.materials.map((item) => {
                      const described = describeMaterial(item);
                      const unread = readIds != null && !readIds.has(item.id);
                      const fresh = now != null && isMaterialNew(item.createdAt, now);
                      const bookmarkKey = materialBookmarkId({ courseId: workspace.id, materialId: item.id });
                      const saved = savedIds.has(bookmarkKey);
                      const saving = bookmarks.pending.includes(bookmarkKey);
                      return (
                        <li key={item.id}>
                          <article
                            id={`material-${item.id}`}
                            tabIndex={-1}
                            aria-labelledby={`material-heading-${item.id}`}
                            className={`${shared.courseWorkTarget} ${styles.cabinetCard}`}
                          >
                            <div className={styles.metadata}>
                              {item.unitTitle && <span>{item.unitTitle}</span>}
                              <span>{described.kindLabel}</span>
                              <span>{described.sizeLabel}</span>
                              <time dateTime={item.createdAt}>
                                發布 {formatTaipeiDateTime(item.createdAt, { seconds: false })}
                              </time>
                              {fresh ? <span className={styles.fresh}>新教材</span> : null}
                              {unread ? <span className={styles.unread}>未讀</span> : null}
                            </div>
                            <h3 id={`material-heading-${item.id}`}>{item.title}</h3>
                            <CourseText text={item.body} />
                            <button
                              type="button"
                              className={`${shared.button} ${shared.secondary} ${styles.bookmarkButton}`}
                              aria-label={`${saved ? '移除' : '加入'}「${item.title}」的此裝置收藏`}
                              aria-pressed={saved}
                              aria-busy={saving}
                              disabled={!bookmarks.ready || saving}
                              onClick={async () => {
                                setNotice('');
                                const changed = await bookmarks.setBookmark(workspace.id, item.id, !saved);
                                if (changed && mounted.current && !denied.current)
                                  setNotice(saved ? '已移除此裝置收藏。' : '已加入此裝置收藏，可從收藏清單再開啟。');
                              }}
                            >
                              {saving ? (saved ? '移除中…' : '收藏中…') : saved ? '已加入此裝置收藏' : '加入此裝置收藏'}
                            </button>
                            <a href={courseMaterialHref(workspace.id, item.id)}>這份教材的連結</a>
                            <button type="button" className={`${shared.button} ${shared.secondary}`}
                              onClick={() => void shareCourseMaterial(item.title, courseMaterialHref(workspace.id, item.id))
                                .then(setNotice).catch(() => setNotice('分享沒有完成，請使用這份教材的連結。'))}>
                              分享／另存連結
                            </button>
                            {described.open.href ? (
                              <a
                                className={`${shared.button} ${styles.openAction}`}
                                href={described.open.href}
                                target="_blank"
                                rel="noopener noreferrer"
                                download={described.open.downloadName || undefined}
                                onClick={() => rememberRead(item.id)}
                              >
                                {described.open.label}
                              </a>
                            ) : (
                              <button
                                type="button"
                                className={`${shared.button} ${shared.secondary} ${styles.openAction}`}
                                onClick={() => {
                                  rememberRead(item.id);
                                  landOnCourseWork(`material-${item.id}`);
                                }}
                              >
                                閱讀
                              </button>
                            )}
                          </article>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ))}
            </div>
          ) : (
            <p className={shared.muted}>
              找不到符合「{query.trim()}」的教材。可改打週次、檔名或課文關鍵字。
            </p>
          )
        ) : (
          <p className={shared.muted}>
            目前還沒有教材。
            {editable ? '可在下方發布課程說明或參考連結。' : '老師發布後會顯示在這裡。'}
          </p>
        ))}
      {moreError && (
        <p role="alert" className={shared.notice}>
          {moreError} 已讀取的教材仍保留。請重試載入較早教材，或使用「更新教材」重新讀取。
        </p>
      )}
      {nextCursor && !accessDenied && (
        <button
          type="button"
          className={`${shared.button} ${shared.secondary}`}
          disabled={reading || readingMore}
          onClick={() => void loadMore()}
        >
          {readingMore ? '讀取較早教材中…' : moreError ? '重試載入較早教材' : '載入較早教材'}
        </button>
      )}
      {editable && (
        <details className={`${shared.compose} ${styles.compose}`}>
          <summary>發布教材</summary>
          <p className={shared.muted}>填寫文字內容，或貼上學生可以開啟的參考網址。</p>
          <MutationForm
            label="發布教材"
            submit={async (data, key) => {
              setNotice('');
              const receipt = await classes.createMaterial(workspace.id, {
                title: String(data.get('title') ?? ''),
                body: String(data.get('body') ?? ''),
                unitId: units === undefined ? undefined : selectCourseUnit(data, units),
                idempotencyKey: key,
              });
              if (!mounted.current || denied.current) throw new NuniError(409, 'SESSION_CHANGED');
              ++request.current;
              setItems((previous) => [
                receipt,
                ...(previous ?? []).filter((item) => item.id !== receipt.id),
              ]);
              setNotice(`已發布「${receipt.title}」。`);
              onChanged?.();
              void load();
            }}
          >
            <label>
              教材標題
              <input name="title" required maxLength={160} placeholder="例如：本週閱讀與課前準備" />
            </label>
            {units !== undefined && <CourseUnitSelect units={units} />}
            <label>
              教材內容或參考連結
              <textarea
                name="body"
                required
                maxLength={8000}
                placeholder="說明閱讀重點，或貼上 https:// 開頭的參考網址。"
              />
            </label>
          </MutationForm>
        </details>
      )}
    </section>
  );
}
