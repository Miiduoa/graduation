'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/components/AuthGuard';
import { SiteShell } from '@/components/SiteShell';
import { Button } from '@/components/ui/Button';
import { adminAnnouncementsSection, canSeeSchoolAnnouncementAdmin } from '@/lib/adminNav';
import type { Announcement } from '@/lib/firebase';
import {
  announcementPublicHref,
  listSchoolAnnouncementsForAdmin,
} from '@/lib/schoolAnnouncementsAdmin';
import { useCampusBrowseContext } from '@/lib/useCampusBrowseContext';
import { useSchoolRole } from '@/lib/useSchoolRole';
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
  const role = useSchoolRole(readySchool ? user?.uid : null, schoolId || 'pu');
  const [list, setList] = useState<ListState | null>(null);
  const [editing, setEditing] = useState<Announcement | null>(null);
  const generation = useRef(0);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const reload = useCallback(async (targetSchoolId: string) => {
    const request = ++generation.current;
    setList({ status: 'loading', schoolId: targetSchoolId });
    try {
      const items = await listSchoolAnnouncementsForAdmin(targetSchoolId);
      if (!mounted.current || request !== generation.current) return;
      setList({ status: 'ready', schoolId: targetSchoolId, items });
    } catch (failure) {
      if (!mounted.current || request !== generation.current) return;
      setList({
        status: 'failed',
        schoolId: targetSchoolId,
        message:
          failure instanceof Error && failure.message.trim()
            ? failure.message
            : '無法載入公告列表',
      });
    }
  }, []);

  const allowed = canSeeSchoolAnnouncementAdmin(role);

  useEffect(() => {
    if (!user || !readySchool || !schoolId || !allowed) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- identity fence before async list load
    void reload(schoolId);
  }, [allowed, readySchool, reload, schoolId, user]);

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

        {authLoading || (user && readySchool && role === null) ? (
          <p className={styles.status} role="status">
            正在確認校管權限…
          </p>
        ) : !user ? (
          <section className={styles.gate}>
            <h2>請先登入</h2>
            <p>登入具校管或內容編輯身分的帳號後，即可在網頁發布與編輯校園公告。</p>
            <Link href={`/login?returnUrl=${encodeURIComponent('/admin/announcements')}`}>
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
        ) : !allowed ? (
          <section className={styles.gate}>
            <h2>目前帳號無法管理公告</h2>
            <p>
              只有該校既有的校管（admin）或內容編輯（editor）可在此發布公告。伺服端授權仍由後端既有檢查負責。
            </p>
            <Link href="/announcements">查看公開公告</Link>
          </section>
        ) : (
          <div className={styles.layout}>
            <AnnouncementAdminForm
              schoolId={schoolId!}
              schoolName={campus.schoolName}
              editing={editing}
              onCancelEdit={() => setEditing(null)}
              onSaved={() => {
                setEditing(null);
                void reload(schoolId!);
              }}
            />
            <section className={styles.panel} aria-labelledby="announcement-list-heading">
              <div className={styles.toolbar}>
                <h2 id="announcement-list-heading">本校公告</h2>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => void reload(schoolId!)}
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
                      <p className={styles.meta}>
                        {item.source ? `來源：${item.source}` : '未標示來源'}
                      </p>
                      <div className={styles.actions}>
                        <Button type="button" variant="outline" onClick={() => setEditing(item)}>
                          編輯
                        </Button>
                        <Link
                          className={styles.meta}
                          href={announcementPublicHref(item.id, schoolId!)}
                        >
                          查看公開頁
                        </Link>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : null}
            </section>
          </div>
        )}
      </div>
    </SiteShell>
  );
}
