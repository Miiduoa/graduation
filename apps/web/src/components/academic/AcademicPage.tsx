'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { useAuth } from '@/components/AuthGuard';
import { SchoolAccountRequired } from '@/components/SchoolAccountRequired';
import { useOptionalSelectedSchool } from '@/components/SelectedSchoolProvider';
import { SiteShell } from '@/components/SiteShell';
import { useAcademicRecords } from '@/lib/useAcademicRecords';
import { useSignInOptions } from '@/lib/signInOptions';
import type { AcademicKind, AcademicSnapshot } from '@/lib/academicClient';
import { loadFailureCopy } from '@campus/shared/src/loadFailureCopy';
import { findSchoolById } from '@campus/shared/src/schools';
import styles from './academic.module.css';
import { PersonalImportSummary } from '@/components/imports/PersonalImportSummary';

const PROVIDENCE_E_CAMPUS = 'https://alcat.pu.edu.tw/';

type Props<K extends AcademicKind> = {
  kind: K;
  title: string;
  subtitle: string;
  closedAlternative: string;
  lead?: ReactNode;
  children: (snapshot: AcademicSnapshot<K>) => ReactNode;
};

function Records<K extends AcademicKind>({
  kind,
  closedAlternative,
  children,
}: Pick<Props<K>, 'kind' | 'closedAlternative' | 'children'>) {
  const { state, refresh } = useAcademicRecords(kind);
  const path = usePathname();
  const options = useSignInOptions();
  const browsing = useOptionalSelectedSchool();
  const browsingId = browsing?.selectedSchoolId;
  // Official e-campus deep link is only for the connected Providence adapter.
  const showProvidenceCampus =
    !browsing || browsingId === 'pu' || browsingId === 'tw-pu';
  if (!state || state.status === 'loading') {
    return (
      <div className={styles.status} role="status">
        正在向學校讀取資料…
      </div>
    );
  }
  if (state.status === 'error' || !state.snapshot) {
    const reconnect = state.reason === 'reconnect';
    const permission = state.reason === 'permission';
    const unconfigured = state.reason === 'unconfigured';
    if (reconnect || permission) {
      if (options.loading) {
        return (
          <div className={styles.status} role="status">
            正在確認這項功能…
          </div>
        );
      }
      if (!options.studentId) {
        return <SchoolAccountRequired returnUrl={path} alternative={closedAlternative} />;
      }
    }
    return (
      <section className={styles.status} role={unconfigured ? 'status' : 'alert'}>
        <p className={styles.eyebrow}>學校資料</p>
        <h2>
          {reconnect
            ? '請重新連線學校帳號'
            : permission
              ? '目前帳號無法讀取這份資料'
              : unconfigured
                ? '學校資料雲端讀取尚未啟用'
                : '暫時無法讀取學校資料'}
        </h2>
        <p>
          {reconnect
            ? '學校登入已到期，重新登入後就能更新課表與成績。'
            : permission
              ? '請確認目前使用的是你的學校帳號。'
              : unconfigured
                ? '目前尚未接上雲端函式服務，無法從學校系統讀取這份資料。請改到學校官方系統查詢。'
                : `${loadFailureCopy(state.error, { online: navigator.onLine })}。這次未取得資料，不會以舊紀錄代替。`}
        </p>
        <div className={styles.actions}>
          {reconnect || permission ? (
            <Link
              className="btn primary"
              href={`/login?reconnect=school&returnUrl=${encodeURIComponent(path)}`}
            >
              連線學校帳號
            </Link>
          ) : unconfigured ? null : (
            <button className="btn primary" onClick={() => void refresh()}>
              重新讀取
            </button>
          )}
          {!reconnect && !permission && !unconfigured && options.studentId && (
            <Link
              className="btn"
              href={`/login?reconnect=school&returnUrl=${encodeURIComponent(path)}`}
            >
              重新連線學校帳號
            </Link>
          )}
          {showProvidenceCampus ? (
            <a
              className="btn"
              href={PROVIDENCE_E_CAMPUS}
              target="_blank"
              rel="noopener noreferrer"
            >
              前往 e 校園 ↗
            </a>
          ) : (
            <p className={styles.notice}>
              目前瀏覽的是
              {browsing?.selectedSchool?.name || '其他校園'}
              ；這項校務讀取尚未接到該校官方系統，請改到學校教務單位查詢。
            </p>
          )}
        </div>
      </section>
    );
  }
  const sourceSchool =
    findSchoolById(state.snapshot.schoolId)?.name ||
    (state.snapshot.schoolId === 'pu' ? '靜宜大學' : '學校');
  return (
    <>
      <div className={styles.source}>
        <span>
          來源：{sourceSchool} e 校園 ·{' '}
          {new Date(state.snapshot.fetchedAt).toLocaleString('zh-TW', {
            timeZone: 'Asia/Taipei',
            month: 'numeric',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          })}{' '}
          讀取
        </span>
        <button className="btn" onClick={() => void refresh()}>
          更新資料
        </button>
      </div>
      {children(state.snapshot)}
    </>
  );
}

export function AcademicPage<K extends AcademicKind>(props: Props<K>) {
  const { user, loading, error } = useAuth();
  const path = usePathname();
  return (
    <SiteShell title={props.title} subtitle={props.subtitle}>
      {props.lead}
      <nav className={styles.navigation} aria-label="我的課務">
        {(
          [
            ['/timetable', '我的課表'],
            ['/grades', '成績紀錄'],
            ['/credit-planner', '學分規劃'],
          ] as const
        ).map(([href, name]) => (
          <Link key={href} href={href} aria-current={path === href ? 'page' : undefined}>
            {name}
          </Link>
        ))}
      </nav>
      <PersonalImportSummary kind="grades" />
      {loading ? (
        <div className={styles.status} role="status">
          正在確認帳號…
        </div>
      ) : !user ? (
        error ? (
          <section className={styles.status}>
            <h2>暫時無法確認登入狀態</h2>
            <p>{loadFailureCopy(error, { online: navigator.onLine })}。</p>
          </section>
        ) : (
          <SchoolAccountRequired returnUrl={path} alternative={props.closedAlternative} />
        )
      ) : (
        <Records key={user.uid} kind={props.kind} closedAlternative={props.closedAlternative}>
          {props.children}
        </Records>
      )}
    </SiteShell>
  );
}
