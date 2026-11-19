import Link from 'next/link';
import { useEffect, useId, useRef } from 'react';
import {
  IDENTITY_LOOKUP_FAILED_COPY,
  IDENTITY_LOOKUP_FAILED_HINT,
  IDENTITY_RETRY_COPY,
  type AccountIdentity,
  type TeachingIdentity,
} from '@/lib/accountIdentity';
import styles from './AccountWorkspaces.module.css';

type Props = {
  data: AccountIdentity | null;
  loading: boolean;
  isPlatformOperator: boolean;
  includeTeaching?: boolean;
  attempted?: boolean;
  onRetry: () => void;
};

/** Work destinations come from confirmed memberships, never a self-selected role. */
export function AccountWorkspaces({
  data,
  loading,
  isPlatformOperator,
  includeTeaching = true,
  attempted = false,
  onRetry,
}: Props) {
  const headingId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const restoreFocus = useRef(false);
  const teaching = includeTeaching && data?.teaching.status === 'ok' ? data.teaching.items : [];
  const stores = data?.stores.status === 'ok' ? data.stores.items : [];
  const applications = data?.applications.status === 'ok' ? data.applications.items : [];
  const failed =
    (includeTeaching && data?.teaching.status === 'error') ||
    data?.stores.status === 'error' ||
    data?.applications.status === 'error';
  const hasMerchantWork = stores.length > 0 || applications.length > 0;
  const hasWork = teaching.length > 0 || hasMerchantWork || isPlatformOperator;
  const teachingLink = (course: TeachingIdentity) => (
    <li key={course.id}>
      <Link href={course.href}>
        <span>{course.name}</span>
        <span className={styles.meta}>{course.role}</span>
      </Link>
    </li>
  );
  useEffect(() => {
    if (!loading && !failed && restoreFocus.current) {
      restoreFocus.current = false;
      heading.current?.focus();
    }
  }, [loading, failed]);

  // Students with no additional responsibilities keep their daily work first.
  // A failed lookup is an unknown result and must retain a recovery action.
  if (!hasWork && !failed && !attempted) return null;

  return (
    <section
      className={styles.workspaces}
      aria-labelledby={headingId}
      aria-busy={loading}
      onBlurCapture={(event) => {
        if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget as Node))
          restoreFocus.current = false;
      }}
    >
      <div className={styles.heading}>
        <h2 id={headingId} ref={heading} tabIndex={-1}>
          我的工作
        </h2>
        <p>從目前已加入的課程、門市與工作權限接著處理。</p>
      </div>
      {!loading && !failed && !hasWork && (
        <p role="status">工作身分已確認，請繼續查看下方今天的安排。</p>
      )}
      <div
        className={styles.grid}
        inert={loading}
        onClickCapture={(event) => {
          if (loading) event.preventDefault();
        }}
      >
        {teaching.length > 0 && (
          <section className={styles.group} aria-label="教學工作">
            <h3>授課與協作</h3>
            <p>開啟課程，接續教材、作業與繳交紀錄。</p>
            <ul>{teaching.slice(0, 2).map(teachingLink)}</ul>
            {teaching.length > 2 && (
              <details>
                <summary className={styles.more}>其他授課課程（{teaching.length - 2}）</summary>
                <ul>{teaching.slice(2).map(teachingLink)}</ul>
              </details>
            )}
          </section>
        )}
        {hasMerchantWork && (
          <section className={styles.group} aria-label="門市工作">
            <h3>門市工作</h3>
            <p className={styles.meta}>
              {stores.length > 0 ? `${stores.length} 間已授權門市` : '進駐申請'}
              {stores.length > 0 && applications.length > 0
                ? ` · ${applications.length} 筆申請`
                : ''}
            </p>
            <Link className={styles.action} href="/merchant/workspace">
              {data?.merchantNextStep?.title ?? '確認門市與申請'} →
            </Link>
            <p>
              {data?.merchantNextStep?.description ??
                '部分店家資料尚未確認，請進入工作台重新讀取。'}
            </p>
          </section>
        )}
        {isPlatformOperator && (
          <section className={styles.group} aria-label="平台工作">
            <h3>平台工作</h3>
            <p>接續學校接入、店家審核、人員授權與案件處理。</p>
            <Link className={styles.action} href="/admin">
              進入平台工作台 →
            </Link>
          </section>
        )}
      </div>
      {failed && (
        <div className={styles.recovery} role="alert">
          <div>
            <p>{IDENTITY_LOOKUP_FAILED_COPY}</p>
            <p className={styles.meta}>{IDENTITY_LOOKUP_FAILED_HINT}</p>
          </div>
          <button
            type="button"
            className="btn"
            onClick={(event) => {
              restoreFocus.current = document.activeElement === event.currentTarget;
              onRetry();
            }}
            disabled={loading}
          >
            {loading ? '確認中…' : IDENTITY_RETRY_COPY}
          </button>
        </div>
      )}
    </section>
  );
}
