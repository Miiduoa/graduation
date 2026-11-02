'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  createMaterialBookmarkBatchResolver,
  materialBookmarkId,
  resolveMaterialBookmark,
  type MaterialBookmark,
} from '@campus/shared/src/materialBookmarks';
import { formatTaipeiDateTime } from '@campus/shared/src/taipeiTime';
import { useMaterialBookmarks } from '@/lib/materialBookmarks';
import { useClasses } from './CourseUI';
import { useNuniSession } from './Session';
import { classroomCourseHref } from './studyNavigation';
import shared from './NuniApp.module.css';
import styles from './CourseLearning.module.css';

type Resolution = Awaited<ReturnType<typeof resolveMaterialBookmark>>;
type ResolveBookmark = (bookmark: MaterialBookmark, cancelled: () => boolean, urgent?: boolean) => Promise<Resolution>;

function limitMaterialReads() {
  let reading = 0;
  const waiting: Array<{
    read: () => Promise<Resolution>;
    cancelled: () => boolean;
    finish: (result: Resolution) => void;
  }> = [];
  const next = () => {
    while (reading < 3 && waiting.length) {
      const work = waiting.shift()!;
      if (work.cancelled()) {
        work.finish({ status: 'cancelled' });
        continue;
      }
      reading += 1;
      void work.read()
        .then(work.finish, () => work.finish({ status: 'error', message: '目前無法確認教材，請稍後重試。' }))
        .finally(() => {
          reading -= 1;
          next();
        });
    }
  };
  return (read: () => Promise<Resolution>, cancelled: () => boolean, urgent: boolean) => new Promise<Resolution>((finish) => {
    const work = { read, cancelled, finish };
    if (urgent) waiting.unshift(work);
    else waiting.push(work);
    next();
  });
}

export function MaterialBookmarks() {
  const { session, pendingLogout } = useNuniSession();
  if (!session || pendingLogout) return null;
  return (
    <Bookmarks
      key={`${session.platformAccountId}:${session.context}`}
      accountId={session.platformAccountId}
    />
  );
}

function Bookmarks({ accountId }: { accountId: string }) {
  const currentClasses = useClasses();
  // Bookmarks remounts for every account or session context replacement.
  const [classes] = useState(() => currentClasses);
  const [schedule] = useState(limitMaterialReads);
  const bookmarks = useMaterialBookmarks(accountId);
  const [revision, setRevision] = useState(0);
  // A refresh discards authorized pages. Explicit retries and opens always read fresh pages.
  const validation = useMemo(() => {
    const resolveBatch = createMaterialBookmarkBatchResolver(classes);
    const resolve: ResolveBookmark = (bookmark, cancelled, urgent = false) => schedule(() => urgent
      ? resolveMaterialBookmark(classes, bookmark, cancelled)
      : resolveBatch(bookmark, cancelled), cancelled, urgent);
    return { revision, resolve };
  }, [classes, revision, schedule]);
  const [notice, setNotice] = useState('');
  const reload = useRef(bookmarks.reload);
  const active = useRef(true);

  useEffect(() => {
    reload.current = bookmarks.reload;
  });

  useEffect(() => {
    active.current = true;
    const refresh = () => {
      setNotice('');
      setRevision((value) => value + 1);
      void reload.current();
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    window.addEventListener('focus', refresh);
    window.addEventListener('online', refresh);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      active.current = false;
      window.removeEventListener('focus', refresh);
      window.removeEventListener('online', refresh);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  return (
    <section className={shared.panel} aria-labelledby="material-bookmarks-title">
      <div className={styles.heading}>
        <div>
          <p className={shared.eyebrow}>教材</p>
          <h1 id="material-bookmarks-title">此裝置收藏</h1>
        </div>
        <button
          type="button"
          className={`${shared.button} ${shared.secondary} ${styles.bookmarkButton}`}
          disabled={bookmarks.loading}
          onClick={() => {
            setNotice('');
            setRevision((value) => value + 1);
            void bookmarks.reload();
          }}
        >
          {bookmarks.loading ? '讀取收藏中…' : '更新收藏'}
        </button>
      </div>
      <p className={shared.muted}>
        這份清單只記在此瀏覽器的目前帳號，換裝置不會同步。教材內容仍需連線讀取，清除瀏覽器資料也會清除收藏。
      </p>
      <Link href="/classroom">回我的課程</Link>
      {bookmarks.loading && <p role="status">正在讀取此裝置收藏…</p>}
      {bookmarks.error && (
        <p role="alert" className={shared.notice}>
          {bookmarks.error} 請使用「更新收藏」重新讀取；儲存未完成時，原本的收藏會保留。
        </p>
      )}
      {notice && <p role="status" className={shared.receipt}>{notice}</p>}
      {bookmarks.ready && !bookmarks.loading && !bookmarks.items.length && (
        <div className={styles.bookmarkEmpty}>
          <h2>還沒有收藏的教材</h2>
          <p>在教材卡按「加入此裝置收藏」，下次就能從這裡接著看。</p>
          <Link className={`${shared.button} ${styles.bookmarkButton}`} href="/classroom">
            到我的課程找教材
          </Link>
        </div>
      )}
      {bookmarks.items.length > 0 && (
        <ul className={`${shared.list} ${styles.materials}`} aria-label="收藏的教材">
          {bookmarks.items.map((bookmark) => {
            const id = materialBookmarkId(bookmark);
            return (
              <BookmarkEntry
                key={`${id}:${validation.revision}`}
                bookmark={bookmark}
                resolve={validation.resolve}
                removing={bookmarks.pending.includes(id)}
                remove={async () => {
                  setNotice('');
                  const removed = await bookmarks.setBookmark(bookmark.courseId, bookmark.materialId, false);
                  if (removed && active.current) setNotice('已移除此裝置收藏。');
                  return removed;
                }}
              />
            );
          })}
        </ul>
      )}
    </section>
  );
}

function BookmarkEntry({
  bookmark,
  resolve,
  removing,
  remove,
}: {
  bookmark: MaterialBookmark;
  resolve: ResolveBookmark;
  removing: boolean;
  remove: () => Promise<boolean>;
}) {
  const router = useRouter();
  const active = useRef(true);
  const request = useRef(0);
  const [result, setResult] = useState<Resolution | null>(null);
  const [opening, setOpening] = useState(false);

  async function verify(open: boolean, urgent = true) {
    const run = ++request.current;
    setResult(null);
    setOpening(open);
    const cancelled = () => !active.current || request.current !== run || document.visibilityState === 'hidden';
    const resolution = await resolve(bookmark, cancelled, urgent);
    if (cancelled() || resolution.status === 'cancelled') return;
    setResult(resolution);
    setOpening(false);
    if (open && resolution.status === 'available') {
      router.push(classroomCourseHref(bookmark.courseId, '', { kind: 'material', id: bookmark.materialId }));
    }
  }

  useEffect(() => {
    active.current = true;
    // Mount starts the same validation used by the explicit retry action.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void verify(false, false);
    return () => {
      active.current = false;
    };
    // The entry remounts when the account, saved item, or refresh revision changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const material = result?.status === 'available' ? result.material : null;
  const title = material?.title ?? (result?.status === 'unavailable' ? '教材目前無法查看' : result?.status === 'error' ? '暫時無法讀取教材' : '正在確認教材…');

  return (
    <li>
      <article className={styles.bookmarkCard} aria-label={title}>
        <div className={styles.metadata}>
          <time dateTime={bookmark.savedAt}>
            收藏於 {formatTaipeiDateTime(bookmark.savedAt, { seconds: false })}
          </time>
          {material?.unitTitle && <span>{material.unitTitle}</span>}
        </div>
        <h2>{title}</h2>
        {!result && <p role="status">{opening ? '正在確認權限，確認後會開啟原教材…' : '正在確認這份教材的查看權限…'}</p>}
        {result && (result.status === 'unavailable' || result.status === 'error') && (
          <>
            <p role={result.status === 'error' ? 'alert' : 'status'}>
              {result.message} {result.status === 'unavailable'
                ? '可以重新確認權限，或從此裝置收藏移除。'
                : '請確認連線後重試；也可以移除此裝置收藏。'}
            </p>
            <p className={styles.note}>教材編號：{bookmark.materialId}</p>
          </>
        )}
        <div className={`${shared.actions} ${styles.bookmarkActions}`}>
          <button
            type="button"
            className={`${shared.button} ${styles.bookmarkButton}`}
            disabled={!result || opening || removing}
            aria-label={material ? `開啟「${material.title}」原教材` : '重新確認教材權限'}
            aria-busy={!result || opening}
            onClick={() => void verify(!!material)}
          >
            {!result ? '確認中…' : material ? '開啟原教材' : '重新確認教材'}
          </button>
          <button
            type="button"
            className={`${shared.button} ${shared.secondary} ${styles.bookmarkButton}`}
            disabled={removing}
            aria-busy={removing}
            aria-label={`移除${material ? `「${material.title}」` : '這份教材'}的此裝置收藏`}
            onClick={async () => {
              ++request.current;
              setOpening(false);
              const removed = await remove();
              if (!removed && active.current && !result) void verify(false);
            }}
          >
            {removing ? '移除中…' : '移除收藏'}
          </button>
        </div>
      </article>
    </li>
  );
}
