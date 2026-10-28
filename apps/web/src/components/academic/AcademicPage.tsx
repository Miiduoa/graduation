'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { useAuth } from '@/components/AuthGuard';
import { SchoolAccountRequired } from '@/components/SchoolAccountRequired';
import { SiteShell } from '@/components/SiteShell';
import { useAcademicRecords, type AcademicRecordState } from '@/lib/useAcademicRecords';
import { useCampusBrowseContext } from '@/lib/useCampusBrowseContext';
import { useSignInOptions } from '@/lib/signInOptions';
import type { AcademicKind, AcademicSnapshot } from '@/lib/academicClient';
import { formatSemester, type AcademicCourseResponse, type AcademicGradeResponse } from '@/lib/academicRecords';
import {
  isOfficialAcademicSchool,
  OFFICIAL_ACADEMIC_PORTAL_URL,
  OFFICIAL_ACADEMIC_SOURCE_LABEL,
} from '@/lib/academicOfficialSchool';
import { loadFailureCopy } from '@campus/shared/src/loadFailureCopy';
import styles from './academic.module.css';
import { PersonalImportSummary } from '@/components/imports/PersonalImportSummary';
import { AcademicRefreshControls } from './AcademicRefreshControls';
import { AcademicChangeSummary } from './AcademicChangeSummary';

type Props<K extends AcademicKind> = {
  kind: K;
  title: string;
  subtitle: string;
  closedAlternative: string;
  lead?: ReactNode;
  workspace?: (scope: { userId: string | null; schoolId: string | null; schoolName: string }) => ReactNode;
  children: (snapshot: AcademicSnapshot<K>) => ReactNode;
};

type RecordsProps<K extends AcademicKind> = {
  kind: K;
  closedAlternative: string;
  returnUrl: string;
  schoolName: string;
  children: (snapshot: AcademicSnapshot<K>) => ReactNode;
};

function Records<K extends AcademicKind>(props: RecordsProps<K>) {
  const [automatic, setAutomatic] = useState(false);
  const { state, refresh, automaticStatus } = useAcademicRecords(props.kind, true, 'pu', automatic);
  return (
    <>
      <RecordContent {...props} state={state} refresh={refresh} />
      <AcademicRefreshControls
        enabled={automatic}
        status={automaticStatus}
        onChange={setAutomatic}
      />
      <AcademicChangeSummary kind={props.kind} state={state} />
    </>
  );
}

function RecordContent<K extends AcademicKind>({
  kind,
  state,
  refresh,
  closedAlternative,
  returnUrl,
  schoolName,
  children,
}: RecordsProps<K> & {
  state: AcademicRecordState<K> | null;
  refresh: () => Promise<void>;
}) {
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
                ? '學校資料讀取尚未啟用'
                : kind === 'grades'
                  ? '暫時無法讀取學校成績'
                  : '暫時無法讀取學校資料'}
        </h2>
        <p>
          {reconnect
            ? '學校登入已到期，重新登入後就能更新課表與成績。'
            : permission
              ? '請確認目前使用的是你的學校帳號。'
              : unconfigured
                ? '目前無法從學校取得這份資料。你可以先到 e 校園查詢，或匯入自己的成績檔案。'
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
  const records = state.snapshot.records as AcademicCourseResponse | AcademicGradeResponse;
  const gradeRecords = 'grades' in records ? records : null;
  const count = 'grades' in records ? records.grades.length : records.courses.length;
  const range = 'grades' in records
    ? `${new Set(records.grades.map((grade) => grade.semester)).size} 個學期 · ${count} 筆成績`
    : `${formatSemester(records.semester)} · ${count} 筆課程`;
  return (
    <>
      <section className={styles.source} aria-label="學校資料讀取結果" aria-busy={state.refreshing || undefined}>
        <div className={styles.sourceDetail}>
          <div className={styles.sourceTitle}>
            <h2>{count ? range : gradeRecords ? '這次未取得成績明細' : '這次未取得課程明細'}</h2>
            <span className={styles.sourceBadge}>
              {state.refreshing ? '更新中' : gradeRecords?.coverage?.status === 'partial' ? '部分讀取' : count ? '已讀取' : '待確認'}
            </span>
          </div>
          <p>
          來源：{sourceLabel} ·{' '}
          {new Date(state.snapshot.fetchedAt).toLocaleString('zh-TW', {
            timeZone: 'Asia/Taipei',
            month: 'numeric',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          })}{' '}
          讀取{state.refreshing ? '（正在更新）' : ''}
          </p>
          {gradeRecords && <p>顯示本次取得的成績範圍；課堂作業與教材請至 <a href="https://tronclass.pu.edu.tw/" target="_blank" rel="noopener noreferrer">WOW Class ↗</a>。</p>}
        </div>
        <button className="btn" disabled={state.refreshing} onClick={() => void refresh()}>
          {state.refreshing ? '更新中…' : '更新資料'}
        </button>
      </section>
      {gradeRecords?.coverage?.status === 'partial' && <p className={styles.warning} role="status">
        有 {gradeRecords.coverage.skippedRows} 筆來源資料的學期或學分尚無法確認，未納入下方明細與合計。已辨識的成績仍可查看，請至 e 校園核對缺漏。
      </p>}
      {gradeRecords?.creditSummaryUnavailable && <p className={styles.warning} role="status">
        學分摘要未能確認，已保留本次取得的成績明細。請更新資料或至 e 校園查看學分試算表。
      </p>}
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
          key={`${user.uid}:${schoolKey}:${props.kind}`}
          kind={props.kind}
          closedAlternative={props.closedAlternative}
          returnUrl={returnUrl}
          schoolName={browse.schoolName}
        >
          {props.children}
        </Records>
      )}
      {props.workspace && browse.status === 'ready' && browse.schoolId && !loading && !error
        ? props.workspace({
            userId: user?.uid ?? null,
            schoolId: browse.schoolId,
            schoolName: browse.schoolName,
          })
        : null}
    </SiteShell>
  );
}
