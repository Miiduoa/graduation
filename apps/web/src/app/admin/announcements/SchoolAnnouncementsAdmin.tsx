'use client';

import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/components/AuthGuard';
import { SiteShell } from '@/components/SiteShell';
import { Button } from '@/components/ui/Button';
import { adminAnnouncementsSection, canSeeSchoolAnnouncementAdmin } from '@/lib/adminNav';
import { campusServiceHref } from '@/lib/campusNavigationLinks';
import type { Announcement } from '@/lib/firebase';
import {
  announcementPublicHref,
  listSchoolAnnouncementsForAdmin,
} from '@/lib/schoolAnnouncementsAdmin';
import { useCampusBrowseContext } from '@/lib/useCampusBrowseContext';
import { useSchoolRoleState } from '@/lib/useSchoolRole';
import { AnnouncementAdminForm } from './AnnouncementAdminForm';
import styles from './announcementsAdmin.module.css';

type ListState =
  | { status: 'loading'; schoolId: string }
  | { status: 'ready'; schoolId: string; items: Announcement[] }
  | { status: 'failed'; schoolId: string; message: string };

function formatPublishedAt(value: string): string {
  if (!value) return '尚未標示時間';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  return date.toLocaleString('zh-TW', { dateStyle: 'medium', timeStyle: 'short' });
}

export function SchoolAnnouncementsAdmin() {
  const { user, loading: authLoading } = useAuth();
  const campus = useCampusBrowseContext();
  const schoolId = campus.schoolId;
  const readySchool = campus.status === 'ready' && Boolean(schoolId);
  const membership = useSchoolRoleState(!authLoading && readySchool ? user?.uid : null, schoolId);
  const allowed = membership.status === 'ready' && canSeeSchoolAnnouncementAdmin(membership.role);
  const publicHref = `/announcements${campus.schoolSearch}`;
  const recovery = (
    <div className={styles.actions}>
      <Button type="button" variant="outline" onClick={membership.retry}>
        重新確認權限
      </Button>
      <Link href={publicHref}>查看公開公告</Link>
    </div>
  );

  return (
    <SiteShell
      title={adminAnnouncementsSection.heading}
      schoolName={readySchool ? campus.schoolName : undefined}
    >
      <div className={styles.page}>
        <header className={styles.intro}>
          <p className={styles.eyebrow}>管理範圍 · 本校</p>
          <h1>{adminAnnouncementsSection.heading}</h1>
          <p>{adminAnnouncementsSection.purpose}</p>
        </header>

        {authLoading ? (
          <p className={styles.status} role="status">
            正在確認登入狀態…
          </p>
        ) : !user ? (
          <section className={styles.gate}>
            <h2>請先登入</h2>
            <p>登入具校管或內容編輯身分的帳號後，即可在網頁發布與編輯校園公告。</p>
            <Link
              href={`/login?returnUrl=${encodeURIComponent(`/admin/announcements${campus.schoolSearch}`)}`}
            >
              前往登入
            </Link>
          </section>
        ) : campus.status === 'loading' ? (
          <p className={styles.status} role="status">
            正在確認所選校園…
          </p>
        ) : campus.status === 'error' ? (
          <section className={styles.gate}>
            <h2>無法取得校園目錄</h2>
            <p>請稍後再試，或先到首頁重新選擇學校。</p>
            <Link href="/">返回今天</Link>
          </section>
        ) : !readySchool ? (
          <section className={styles.gate}>
            <h2>先選擇一所學校</h2>
            <p>校園公告會寫入目前所選學校。請先選擇學校後再回來發布。</p>
            <Link href="/">返回今天並選擇學校</Link>
          </section>
        ) : membership.status === 'loading' ? (
          <section className={styles.gate}>
            <p className={styles.status} role="status">
              正在確認校管權限…
            </p>
            <p>取得目前學校的確認前，暫停編輯。也可以先查看公開公告。</p>
            {recovery}
          </section>
        ) : membership.status === 'error' ? (
          <section className={styles.gate}>
            <h2>暫時無法確認校管權限</h2>
            <p role="alert">目前無法讀取你的校內資格，請重新確認。</p>
            {recovery}
          </section>
        ) : !allowed ? (
          <section className={styles.gate}>
            <h2>目前帳號無法管理公告</h2>
            <p>這個帳號需要取得目前學校的公告管理權限。若校方剛完成指派，可以重新確認。</p>
            {recovery}
          </section>
        ) : (
          <AuthorizedAnnouncementsWorkspace
            key={JSON.stringify([user.uid, schoolId])}
            schoolId={schoolId!}
            schoolName={campus.schoolName}
          />
        )}
      </div>
    </SiteShell>
  );
}

/** Editing and pending callbacks belong to this account and campus only. */
function AuthorizedAnnouncementsWorkspace({
  schoolId,
  schoolName,
}: {
  schoolId: string;
  schoolName: string;
}) {
  const [list, setList] = useState<ListState | null>(null);
  const [editing, setEditing] = useState<Announcement | null>(null);
  const generation = useRef(0);
  const mounted = useRef(false);
  const reload = useCallback(async () => {
    if (!mounted.current) return;
    const request = ++generation.current;
    setList({ status: 'loading', schoolId });
    try {
      const items = await listSchoolAnnouncementsForAdmin(schoolId);
      if (!mounted.current || request !== generation.current) return;
      setList({ status: 'ready', schoolId, items });
    } catch (failure) {
      if (!mounted.current || request !== generation.current) return;
      setList({
        status: 'failed',
        schoolId,
        message:
          failure instanceof Error && failure.message.trim() ? failure.message : '無法載入公告列表',
      });
    }
  }, [schoolId]);

  useLayoutEffect(() => {
    let active = true;
    mounted.current = true;
    void Promise.resolve().then(() => {
      if (active) void reload();
    });
    return () => {
      active = false;
      mounted.current = false;
      generation.current += 1;
    };
  }, [reload]);

  return (
    <div className={styles.layout}>
      <AnnouncementAdminForm
        schoolId={schoolId}
        schoolName={schoolName}
        editing={editing}
        onCancelEdit={() => setEditing(null)}
        onSaved={() => {
          if (!mounted.current) return;
          setEditing(null);
          void reload();
        }}
      />
      <section className={styles.panel} aria-labelledby="announcement-list-heading">
        <div className={styles.toolbar}>
          <h2 id="announcement-list-heading">本校公告</h2>
          <Link
            href={campusServiceHref(
              '/announcements',
              new URLSearchParams({ schoolId: schoolId, campus: schoolId }).toString(),
            )}
          >
            查看公開公告列表
          </Link>
          <Button
            type="button"
            variant="ghost"
            onClick={() => void reload()}
            disabled={list?.status === 'loading'}
          >
            {list?.status === 'loading' ? '載入中…' : '重新整理'}
          </Button>
        </div>
        {list?.status === 'loading' ? (
          <p className={styles.status} role="status">
            正在載入公告…
          </p>
        ) : list?.status === 'failed' ? (
          <p className={styles.error} role="alert">
            載入失敗：{list.message}
          </p>
        ) : list?.status === 'ready' && list.items.length === 0 ? (
          <p className={styles.status}>尚無公告。可在左側表單發布第一則。</p>
        ) : list?.status === 'ready' ? (
          <ul className={styles.list}>
            {list.items.map((item) => (
              <li className={styles.listItem} key={item.id}>
                <div className={styles.listItemHeader}>
                  <strong>
                    {item.pinned ? '置頂 · ' : ''}
                    {item.title}
                  </strong>
                  <p className={styles.meta}>{formatPublishedAt(item.publishedAt)}</p>
                </div>
                <p className={styles.meta}>{item.source ? `來源：${item.source}` : '未標示來源'}</p>
                <div className={styles.actions}>
                  <Button type="button" variant="outline" onClick={() => setEditing(item)}>
                    編輯
                  </Button>
                  <Link className={styles.meta} href={announcementPublicHref(item.id, schoolId)}>
                    查看公開頁
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        ) : null}
      </section>
    </div>
  );
}
