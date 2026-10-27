'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import type { ReactNode } from 'react';
import { useAuth } from '@/components/AuthGuard';
import { SchoolAccountRequired } from '@/components/SchoolAccountRequired';
import { SiteShell } from '@/components/SiteShell';
import { useAcademicRecords } from '@/lib/useAcademicRecords';
import { useCampusBrowseContext } from '@/lib/useCampusBrowseContext';
import { useSignInOptions } from '@/lib/signInOptions';
import type { AcademicKind, AcademicSnapshot } from '@/lib/academicClient';
import {
  isOfficialAcademicSchool,
  OFFICIAL_ACADEMIC_PORTAL_URL,
  OFFICIAL_ACADEMIC_SOURCE_LABEL,
} from '@/lib/academicOfficialSchool';
import { loadFailureCopy } from '@campus/shared/src/loadFailureCopy';
import styles from './academic.module.css';
import { PersonalImportSummary } from '@/components/imports/PersonalImportSummary';

type Props<K extends AcademicKind> = {
  kind: K;
  title: string;
  subtitle: string;
  closedAlternative: string;
  lead?: ReactNode;
  workspace?: (scope: { userId: string | null; schoolId: string | null; schoolName: string }) => ReactNode;
  children: (snapshot: AcademicSnapshot<K>) => ReactNode;
};

function Records<K extends AcademicKind>({
  kind,
  closedAlternative,
  returnUrl,
  schoolName,
  children,
}: {
  kind: K;
  closedAlternative: string;
  returnUrl: string;
  schoolName: string;
  children: (snapshot: AcademicSnapshot<K>) => ReactNode;
}) {
  const { state, refresh } = useAcademicRecords(kind, true, 'pu');
  const options = useSignInOptions();
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
        return <SchoolAccountRequired returnUrl={returnUrl} alternative={closedAlternative} />;
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
              href={`/login?reconnect=school&returnUrl=${encodeURIComponent(returnUrl)}`}
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
              href={`/login?reconnect=school&returnUrl=${encodeURIComponent(returnUrl)}`}
            >
              重新連線學校帳號
            </Link>
          )}
          <a
            className="btn"
            href={OFFICIAL_ACADEMIC_PORTAL_URL}
            target="_blank"
            rel="noopener noreferrer"
          >
            前往 e 校園 ↗
          </a>
        </div>
      </section>
    );
  }
  const sourceLabel =
    state.snapshot.schoolId === 'pu' ? OFFICIAL_ACADEMIC_SOURCE_LABEL : schoolName;
  return (
    <>
      <div className={styles.source}>
        <span>
          來源：{sourceLabel} ·{' '}
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

function BrowseUnavailable({
  status,
  schoolName,
}: {
  status: 'loading' | 'error' | 'unselected' | 'unsupported';
  schoolName: string;
}) {
  if (status === 'loading') {
    return (
      <div className={styles.status} role="status">
        <h2>正在確認所選校園…</h2>
        <p>確認校園後再讀取正式成績，不會先顯示其他學校的資料。</p>
      </div>
    );
  }
  if (status === 'error') {
    return (
      <section className={styles.status} role="alert">
        <h2>暫時無法確認所選校園</h2>
        <p>校園目錄讀取失敗，目前不會顯示正式成績資料。</p>
      </section>
    );
  }
  if (status === 'unselected') {
    return (
      <section className={styles.status} role="status">
        <h2>請先選擇一所學校</h2>
        <p>從頁首選擇校園後，才會讀取該校可提供的正式課業資料。</p>
      </section>
    );
  }
  return (
    <section className={styles.status} role="status">
      <h2>這所學校尚未提供官方成績來源</h2>
      <p>
        目前無法讀取「{schoolName}」的正式成績或學分資料，也不會顯示其他學校的正式紀錄。你仍可使用上方自行匯入的個人資料。
      </p>
    </section>
  );
}

export function AcademicPage<K extends AcademicKind>(props: Props<K>) {
  const { user, loading, error } = useAuth();
  const path = usePathname();
  const searchParams = useSearchParams();
  const browse = useCampusBrowseContext({
    school: searchParams.get('school') ?? undefined,
    schoolId: searchParams.get('schoolId') ?? undefined,
    campus: searchParams.get('campus') ?? undefined,
  });
  const schoolSearch = browse.schoolSearch;
  const returnUrl = `${path}${schoolSearch}`;
  const readyOfficial =
    browse.status === 'ready' && isOfficialAcademicSchool(browse.schoolId);
  const schoolKey =
    browse.status === 'ready' && browse.schoolId ? browse.schoolId : `:${browse.status}`;

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
          <Link
            key={href}
            href={`${href}${schoolSearch}`}
            aria-current={path === href ? 'page' : undefined}
          >
            {name}
          </Link>
        ))}
      </nav>
      {props.workspace && browse.status === 'ready' && browse.schoolId && !loading && !error
        ? props.workspace({
            userId: user?.uid ?? null,
            schoolId: browse.schoolId,
            schoolName: browse.schoolName,
          })
        : null}
      <PersonalImportSummary kind="grades" />
      {browse.status === 'loading' ? (
        <BrowseUnavailable status="loading" schoolName="" />
      ) : browse.status === 'error' ? (
        <BrowseUnavailable status="error" schoolName="" />
      ) : browse.status === 'unselected' || !browse.schoolId ? (
        <BrowseUnavailable status="unselected" schoolName="" />
      ) : !readyOfficial ? (
        <BrowseUnavailable status="unsupported" schoolName={browse.schoolName} />
      ) : loading ? (
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
          <SchoolAccountRequired returnUrl={returnUrl} alternative={props.closedAlternative} />
        )
      ) : (
        <Records
          key={`${user.uid}:${schoolKey}`}
          kind={props.kind}
          closedAlternative={props.closedAlternative}
          returnUrl={returnUrl}
          schoolName={browse.schoolName}
        >
          {props.children}
        </Records>
      )}
    </SiteShell>
  );
}
