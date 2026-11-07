'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/components/AuthGuard';
import { useOptionalSelectedSchool } from '@/components/SelectedSchoolProvider';
import {
  notificationDestination,
  watchAccountNotifications,
  type AccountNotification,
} from '@/lib/privateMessages';
import {
  TODAY_NOTIFY_EMPTY,
  TODAY_NOTIFY_ERROR,
  TODAY_NOTIFY_TITLE,
  TODAY_NOTIFY_UNSIGNED,
} from '@/lib/todayCourseWork';
import { isFirebaseConfigured } from '@/lib/firebase';
import styles from './StudentToday.module.css';

type FeedState =
  | { status: 'loading' }
  | { status: 'ready'; items: AccountNotification[] }
  | { status: 'error' };

export function TodayUnreadNotifications({ unsigned }: { unsigned: boolean }) {
  const { user, loading: authLoading } = useAuth();
  const school = useOptionalSelectedSchool();
  const schoolId = school?.selectedSchool?.id || '';
  if (!unsigned && !authLoading && !user) return null;
  return (
    <UnreadFeed
      key={JSON.stringify([user?.uid, schoolId, unsigned, authLoading])}
      uid={user?.uid}
      schoolId={schoolId}
      unsigned={unsigned}
      authLoading={authLoading}
    />
  );
}

function UnreadFeed({
  uid,
  schoolId,
  unsigned,
  authLoading,
}: {
  uid?: string;
  schoolId: string;
  unsigned: boolean;
  authLoading: boolean;
}) {
  const [feed, setFeed] = useState<FeedState>({ status: 'loading' });
  const [retryKey, setRetryKey] = useState(0);

  const configured = isFirebaseConfigured();
  const canWatch = !unsigned && !authLoading && !!uid && !!schoolId && configured;

  useEffect(() => {
    if (!canWatch || !uid || !schoolId) return;
    let active = true;
    const stop = watchAccountNotifications(
      { uid, schoolId },
      (next) => {
        if (!active) return;
        setFeed({
          status: 'ready',
          items: next.notifications.filter((row) => !row.read),
        });
      },
      () => {
        if (active) setFeed({ status: 'error' });
      },
    );
    return () => {
      active = false;
      stop();
    };
  }, [canWatch, uid, schoolId, retryKey]);

  const visible = feed.status === 'ready' ? feed.items.slice(0, 3) : [];
  const extra = feed.status === 'ready' ? Math.max(0, feed.items.length - visible.length) : 0;

  return (
    <section
      className={styles.section + ' ' + styles.notifications}
      aria-labelledby="today-notify-title"
      data-testid="today-notifications"
    >
      <h2 id="today-notify-title" className={styles.sectionTitle}>
        {TODAY_NOTIFY_TITLE}
      </h2>
      {unsigned ? (
        <p className={styles.empty}>
          {TODAY_NOTIFY_UNSIGNED} <Link href="/messages">前往通知匣</Link>
        </p>
      ) : !configured && !authLoading ? (
        <p className={styles.empty}>目前無法取得校園通知。</p>
      ) : !schoolId ? (
        <p className={styles.empty}>
          先選擇校園後，就能在這裡看到該校的未讀通知。 <Link href="/messages">前往通知匣</Link>
        </p>
      ) : feed.status === 'loading' || authLoading ? (
        <div className={styles.skeleton} aria-busy="true">
          <span className={styles.bone} />
          <span className={styles.bone} />
        </div>
      ) : feed.status === 'error' ? (
        <>
          <p className={styles.empty} role="alert">
            {TODAY_NOTIFY_ERROR}
          </p>
          <button
            type="button"
            className={styles.retry}
            onClick={() => {
              setFeed({ status: 'loading' });
              setRetryKey((n) => n + 1);
            }}
          >
            重試
          </button>
          <Link className={styles.import} href="/messages">
            前往通知匣
          </Link>
        </>
      ) : visible.length === 0 ? (
        <p className={styles.empty}>
          {TODAY_NOTIFY_EMPTY} <Link href="/messages">查看全部通知</Link>
        </p>
      ) : (
        <ul className={styles.list}>
          {visible.map((item) => {
            const destination = notificationDestination(item);
            const href = destination?.href || '/messages';
            // Reload the document so attendance receives its camera permissions policy.
            const DestinationLink = item.type === 'live_session' ? 'a' : Link;
            return (
              <li key={`${item.source}:${item.id}`}>
                <DestinationLink href={href} className={styles.row}>
                  <span className={styles.rowBody}>
                    <span className={styles.rowTitle}>{item.title}</span>
                    <span className={styles.rowMeta}>
                      {item.body || destination?.label || '查看通知'}
                    </span>
                  </span>
                </DestinationLink>
              </li>
            );
          })}
          {extra > 0 ? (
            <li>
              <Link className={styles.more} href="/messages">
                還有 {extra} 則未讀
              </Link>
            </li>
          ) : (
            <li>
              <Link className={styles.more} href="/messages">
                查看全部通知
              </Link>
            </li>
          )}
        </ul>
      )}
    </section>
  );
}
