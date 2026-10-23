'use client';

import { use, useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/components/AuthGuard';
import { SiteShell } from '@/components/SiteShell';
import type { Announcement } from '@/lib/firebase';
import { loadAnnouncementFeed, type AnnouncementSourceHealth } from './publicAnnouncements';
import {
  ANNOUNCEMENT_ALL_VIEW_LABEL,
  ANNOUNCEMENT_EMPTY_CONNECTED_TEXT,
  ANNOUNCEMENT_EMPTY_SCHOOL_TEXT,
  ANNOUNCEMENT_OFFICIAL_SITE_BUTTON,
  ANNOUNCEMENT_READ_FAILURE_TEXT,
  ANNOUNCEMENT_RETRY_TEXT,
  ANNOUNCEMENT_STUDENT_WALL_LABEL,
  announcementEmptyHeading,
  announcementEmptyKind,
  announcementMatchesSearch,
  formatStaleAnnouncementNotice,
  listAnnouncementCatalogLinks,
  staleAnnouncementUpdatedAt,
  verifiedOfficialAnnouncementUrl,
} from '@campus/shared/src/campusAnnouncements';
import { isAnnouncementSchoolVisibleToPublic } from '@campus/shared/src/campusAnnouncements';
import { getAnnouncementVisibilityEnv } from '@/lib/runtime';
import { useCampusBrowseContext } from '@/lib/useCampusBrowseContext';
import styles from './announcements.module.css';

type Category = 'all' | 'academic' | 'event' | 'general';
type ListView = 'student' | 'all';
type ReadyState = {
  status: 'ready';
  schoolId: string;
  announcements: Announcement[];
  officialAnnouncements: Announcement[];
  sources: AnnouncementSourceHealth[];
  allUnavailable: boolean;
  fetchedAt: string;
  stale: boolean;
};
type LoadState =
  | { status: 'loading'; schoolId: string }
  | { status: 'failed'; schoolId: string }
  | ReadyState;

function feedForSchool(state: LoadState, schoolId: string): LoadState {
  return state.schoolId === schoolId ? state : { status: 'loading', schoolId };
}

const categories: { id: Category; label: string }[] = [
  { id: 'all', label: '全部' },
  { id: 'academic', label: '學術' },
  { id: 'event', label: '活動' },
  { id: 'general', label: '一般' },
];

function categoryOf(announcement: Announcement): Category {
  return announcement.category === 'academic' || announcement.category === 'event'
    ? announcement.category
    : 'general';
}

function OfficeSourceLinks({
  links,
}: {
  links: Array<{ sourceId: string; office: string; listUrl?: string }>;
}) {
  const items = links.filter((item) => item.listUrl);
  if (!items.length) return null;
  return (
    <p>
      {items.map((item, index) => (
        <span key={item.sourceId}>
          {index > 0 ? '、' : null}
          <a href={item.listUrl} rel="noopener noreferrer" target="_blank">
            {item.office}
          </a>
        </span>
      ))}
    </p>
  );
}

function OfficialSiteButton({
  schoolId,
  secondary = false,
}: {
  schoolId: string;
  secondary?: boolean;
}) {
  const url = verifiedOfficialAnnouncementUrl(schoolId);
  if (!url) return null;
  return (
    <p>
      <a
        className={secondary ? undefined : 'btn'}
        href={url}
        rel="noopener noreferrer"
        target="_blank"
      >
        {ANNOUNCEMENT_OFFICIAL_SITE_BUTTON}
      </a>
    </p>
  );
}

function VerifiedCatalogLinks({ schoolId }: { schoolId: string }) {
  if (!verifiedOfficialAnnouncementUrl(schoolId)) return null;
  return <OfficeSourceLinks links={listAnnouncementCatalogLinks(schoolId)} />;
}

function AnnouncementReader({ schoolId }: { schoolId: string }) {
  const [state, setState] = useState<LoadState>({ status: 'loading', schoolId });
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<Category>('all');
  const [listView, setListView] = useState<ListView>('student');
  const [pinnedOnly, setPinnedOnly] = useState(false);
  const [notice, setNotice] = useState('');
  const generation = useRef(0);
  const mounted = useRef(false);
  const view = feedForSchool(state, schoolId);

  const load = useCallback(() => {
    const request = ++generation.current;
    return loadAnnouncementFeed(schoolId).then(
      (feed) => {
        if (mounted.current && request === generation.current) {
          setState({
            status: 'ready',
            schoolId,
            announcements: feed.announcements,
            officialAnnouncements: feed.officialAnnouncements,
            sources: feed.sources,
            allUnavailable: feed.allUnavailable,
            fetchedAt: new Date().toISOString(),
            stale: false,
          });
        }
      },
      () => {
        if (!mounted.current || request !== generation.current) return;
        setState((current) =>
          current.schoolId === schoolId &&
          current.status === 'ready' &&
          current.announcements.length > 0
            ? { ...current, stale: true }
            : { status: 'failed', schoolId },
        );
      },
    );
  }, [schoolId]);

  function refresh() {
    setNotice('');
    setState((current) =>
      current.schoolId === schoolId &&
      current.status === 'ready' &&
      current.announcements.length > 0
        ? current
        : { status: 'loading', schoolId },
    );
    void load();
  }

  useEffect(() => {
    mounted.current = true;
    void load();
    return () => {
      mounted.current = false;
      generation.current += 1;
    };
  }, [load]);

  async function share(announcement: Announcement) {
    const request = generation.current;
    const url = new URL(
      `/announcements/${encodeURIComponent(announcement.id)}`,
      window.location.origin,
    );
    url.searchParams.set('schoolId', schoolId);
    setNotice('');
    try {
      if (navigator.share) {
        await navigator.share({
          title: announcement.title,
          text: announcement.body,
          url: url.href,
        });
      } else {
        await navigator.clipboard.writeText(url.href);
        if (mounted.current && request === generation.current) setNotice('已複製公告連結。');
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return;
      if (mounted.current && request === generation.current) {
        setNotice('暫時無法分享，請從網址列複製這個頁面的連結。');
      }
    }
  }

  if (view.status === 'loading') {
    return (
      <div className={styles.status} role="status">
        正在讀取公告…
      </div>
    );
  }
  if (view.status === 'failed') {
    return (
      <section className={styles.status}>
        <h2>{ANNOUNCEMENT_READ_FAILURE_TEXT}</h2>
        <button className="btn" type="button" onClick={() => void refresh()}>
          {ANNOUNCEMENT_RETRY_TEXT}
        </button>
      </section>
    );
  }
  const student = view.announcements;
  const official = view.officialAnnouncements || [];
  const listed = listView === 'all' ? official : student;
  const emptyKind = announcementEmptyKind(student, view.sources);
  const showFeed = official.length > 0 || student.length > 0;
  const filtered = listed.filter((announcement) => {
    return (
      announcementMatchesSearch(announcement, search) &&
      (category === 'all' || categoryOf(announcement) === category) &&
      (!pinnedOnly || announcement.pinned)
    );
  });
  const downLinks = view.sources.filter((item) => item.status === 'unavailable' && item.listUrl);
  const showStaleNotice =
    listed.length > 0 && (view.stale || view.sources.some((item) => item.status === 'unavailable'));
  const staleSources =
    view.stale && !view.sources.some((item) => item.status === 'unavailable')
      ? [{ status: 'unavailable' as const, lastSuccessAt: view.fetchedAt }]
      : view.sources;

  return (
    <div className={styles.page}>
      <div className={styles.source}>
        <p>
          公開公告 · 最近 {listed.length} 則
          <span>
            {new Date(view.fetchedAt).toLocaleTimeString('zh-TW', {
              timeZone: 'Asia/Taipei',
              hour: '2-digit',
              minute: '2-digit',
            })}{' '}
            讀取
          </span>
        </p>
        <button className="btn" onClick={() => void refresh()}>
          更新公告
        </button>
      </div>
      {showFeed ? (
        <div className={styles.toolbar}>
          <label className={styles.search}>
            搜尋公告
            <input
              type="search"
              placeholder="標題、內容或發布單位"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
          <div className={styles.filters} aria-label="公告檢視">
            <button
              type="button"
              aria-pressed={listView === 'student'}
              onClick={() => setListView('student')}
            >
              {ANNOUNCEMENT_STUDENT_WALL_LABEL}
            </button>
            <button type="button" aria-pressed={listView === 'all'} onClick={() => setListView('all')}>
              {ANNOUNCEMENT_ALL_VIEW_LABEL}
            </button>
          </div>
          <div className={styles.filters} aria-label="公告分類">
            {categories.map((item) => (
              <button
                key={item.id}
                type="button"
                aria-pressed={category === item.id}
                onClick={() => setCategory(item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>
          <label className={styles.pinnedFilter}>
            <input
              type="checkbox"
              checked={pinnedOnly}
              onChange={(event) => setPinnedOnly(event.target.checked)}
            />
            只看置頂
          </label>
        </div>
      ) : null}
      {notice && (
        <p role="status" className={styles.notice}>
          {notice}
        </p>
      )}
      {showStaleNotice && (
        <p role="status" className={styles.notice}>
          {formatStaleAnnouncementNotice(
            staleAnnouncementUpdatedAt(staleSources, listed),
            view.stale ? 'firestore' : 'source_down',
          )}
        </p>
      )}
      {!showFeed ? (
        <section className={styles.status}>
          {emptyKind === 'source_down' ? (
            <>
              <h2>{ANNOUNCEMENT_READ_FAILURE_TEXT}</h2>
              <p>
                <button className="btn" type="button" onClick={() => void refresh()}>
                  {ANNOUNCEMENT_RETRY_TEXT}
                </button>
              </p>
              <OfficialSiteButton schoolId={schoolId} secondary />
              <OfficeSourceLinks
                links={
                  downLinks.length
                    ? downLinks
                    : verifiedOfficialAnnouncementUrl(schoolId)
                      ? listAnnouncementCatalogLinks(schoolId)
                      : []
                }
              />
            </>
          ) : (
            <>
              <h2>{announcementEmptyHeading(emptyKind) ?? ANNOUNCEMENT_EMPTY_SCHOOL_TEXT}</h2>
              <OfficialSiteButton schoolId={schoolId} />
              <VerifiedCatalogLinks schoolId={schoolId} />
            </>
          )}
        </section>
      ) : filtered.length === 0 ? (
        <section className={styles.status}>
          {listView === 'student' && student.length === 0 ? (
            <>
              <h2>{ANNOUNCEMENT_EMPTY_CONNECTED_TEXT}</h2>
              <p>教師向、資安轉知等正式公告可到「{ANNOUNCEMENT_ALL_VIEW_LABEL}」查看。</p>
            </>
          ) : (
            <>
              <h2>沒有符合條件的公告</h2>
              <p>試試其他關鍵字或分類。</p>
            </>
          )}
        </section>
      ) : (
        <div className={styles.list} aria-label="公告列表">
          {filtered.map((announcement) => (
            <article
              key={announcement.id}
              id={`announcement-${encodeURIComponent(announcement.id)}`}
              className={styles.announcement}
            >
              <div className={styles.meta}>
                {announcement.pinned && <span className={styles.pinned}>置頂</span>}
                <span>
                  {categories.find((item) => item.id === categoryOf(announcement))?.label}
                </span>
                {(announcement.source || announcement.office) && (
                  <span>{announcement.source || announcement.office}</span>
                )}
                {announcement.publishedAt ? (
                  <time dateTime={announcement.publishedAt}>
                    {new Date(announcement.publishedAt).toLocaleDateString('zh-TW', {
                      timeZone: 'Asia/Taipei',
                      year: 'numeric',
                      month: 'numeric',
                      day: 'numeric',
                    })}
                  </time>
                ) : (
                  <span>未提供發布日期</span>
                )}
              </div>
              <h2>
                <Link
                  href={`/announcements/${encodeURIComponent(announcement.id)}?schoolId=${encodeURIComponent(schoolId)}`}
                >
                  {announcement.title}
                </Link>
              </h2>
              {(announcement.summary || announcement.body) && (
                <p className={styles.body}>{announcement.summary || announcement.body}</p>
              )}
              {announcement.originalUrl ? (
                <a
                  className={styles.share}
                  href={announcement.originalUrl}
                  rel="noreferrer"
                  target="_blank"
                >
                  看原文
                </a>
              ) : (
                <button
                  className={styles.share}
                  onClick={() => void share(announcement)}
                  aria-label={`分享公告：${announcement.title}`}
                >
                  分享公告 ↗
                </button>
              )}
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

export default function AnnouncementsPage(props: {
  searchParams?: Promise<{ school?: string; schoolId?: string; campus?: string }>;
}) {
  const params = props.searchParams ? use(props.searchParams) : undefined;
  const context = useCampusBrowseContext(params);
  const schoolId = context.schoolId;
  const visible = Boolean(
    context.status === 'ready' &&
    schoolId &&
    isAnnouncementSchoolVisibleToPublic({ schoolId }, getAnnouncementVisibilityEnv()),
  );
  const { user, loading } = useAuth();
  return (
    <SiteShell
      schoolName={visible ? context.schoolName : undefined}
      title="校園公告"
      subtitle="公開處室公告的摘要與原文連結。一般帳號即可查看。"
    >
      {!visible ? (
        <section className={styles.status}>
          <h2>
            {context.status === 'loading'
              ? '正在讀取所選校園…'
              : context.status === 'error'
                ? '無法取得校園目錄'
                : context.status === 'unselected'
                  ? '先選擇一所學校'
                  : '目前沒有公開公告'}
          </h2>
        </section>
      ) : loading ? (
        <div className={styles.status} role="status">
          正在準備公告…
        </div>
      ) : (
        <AnnouncementReader
          key={JSON.stringify([schoolId, user?.uid ?? null])}
          schoolId={schoolId!}
        />
      )}
    </SiteShell>
  );
}
