'use client';

import Link from 'next/link';
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AcademicConnectionError, loadAcademicRecords } from '@/lib/academicClient';
import { ECAMPUS_PAUSED_MESSAGE } from '@/lib/ecampusPause';
import { formatSemester } from '@/lib/academicRecords';
import {
  reconcileSchoolCourses, schoolCourseHref,
  type CourseMatchState, type SchoolCourseComparison,
} from '@/lib/schoolCourseReconciliation';
import type { SchoolLmsSnapshot } from '@/lib/tronClassCourses';
import styles from './schoolCourseReconciliation.module.css';

type Props = {
  uid: string;
  schoolId: 'pu';
  lms: SchoolLmsSnapshot | null;
  returnUrl: string;
  canReconnect: boolean;
};
type ReadState = {
  source: SchoolLmsSnapshot | null;
  status: 'loading' | 'ready' | 'error';
  comparison?: SchoolCourseComparison;
  error?: unknown;
};
const MATCH_LABELS: Record<CourseMatchState, string> = {
  matched: '已對上課堂',
  'lms-unavailable': 'WOW Class 未連線，尚未對照',
  'missing-key': '缺少課號或學期，需核對',
  ambiguous: '同課號有多筆資料，需核對',
  'credit-conflict': '校方學分欄位不一致，需核對',
  'not-in-list': '這份 WOW Class 清單未對上',
};
const PAGE_SIZE = 12;
function readTime(value: string) {
  return new Date(value).toLocaleString('zh-TW', {
    timeZone: 'Asia/Taipei', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

export function SchoolCourseReconciliation(props: Props) {
  const [identity, setIdentity] = useState(() => ({
    uid: props.uid, schoolId: props.schoolId, source: props.lms, revision: 0,
  }));
  // 新來源即建立新工作區；即使時間戳相同或切回舊來源，也不復用先前結果。
  if (identity.uid !== props.uid || identity.schoolId !== props.schoolId || identity.source !== props.lms) {
    setIdentity({ uid: props.uid, schoolId: props.schoolId, source: props.lms, revision: identity.revision + 1 });
    return null;
  }
  return <ReconciliationWorkspace key={identity.revision} {...props} />;
}

function ReconciliationWorkspace({ uid, schoolId, lms, returnUrl, canReconnect }: Props) {
  const [state, setState] = useState<ReadState | null>(null);
  const [search, setSearch] = useState('');
  const [onlyReview, setOnlyReview] = useState(false);
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [lmsLimit, setLmsLimit] = useState(PAGE_SIZE);
  const generation = useRef(0);
  const busy = useRef(false);
  const lifetime = useRef<AbortController | null>(null);
  // 每次已提交的來源都有獨立生命週期；切回相同物件也不能復活舊請求。
  // signal 只控制結果是否可採用，不宣稱取消已送出的校務 HTTP 請求。
  useLayoutEffect(() => {
    const controller = new AbortController();
    lifetime.current = controller;
    return () => {
      controller.abort();
      generation.current += 1;
      busy.current = false;
      if (lifetime.current === controller) lifetime.current = null;
    };
  }, [uid, schoolId, lms]);
  const visible = state?.source === lms ? state : null;
  const comparison = visible?.status === 'ready' ? visible.comparison : undefined;
  const query = search.normalize('NFKC').trim().toLocaleLowerCase();
  const rows = useMemo(() => comparison?.rows.filter((row) =>
    (!onlyReview || row.match !== 'matched') && (!query ||
      [row.name, row.code, row.classOffered, ...row.teachers].some((text) =>
        text.normalize('NFKC').toLocaleLowerCase().includes(query))),
  ) ?? [], [comparison, onlyReview, query]);

  async function compare() {
    const controller = lifetime.current;
    if (!controller || controller.signal.aborted || busy.current) return;
    busy.current = true;
    const request = ++generation.current;
    const active = () => !controller.signal.aborted && request === generation.current;
    setState({ source: lms, status: 'loading' });
    try {
      const academic = await loadAcademicRecords('courses', uid, schoolId);
      if (!active()) return;
      const result = reconcileSchoolCourses(academic, lms, { uid, schoolId });
      setSearch(''); setOnlyReview(false); setLimit(PAGE_SIZE); setLmsLimit(PAGE_SIZE);
      setState({ source: lms, status: 'ready', comparison: result });
    } catch (error: unknown) {
      if (active()) setState({ source: lms, status: 'error', error });
    } finally {
      if (active()) busy.current = false;
    }
  }

  const needsLogin = visible?.error instanceof AcademicConnectionError &&
    ['reconnect', 'permission'].includes(visible.error.reason);
  const paused = visible?.error instanceof AcademicConnectionError && visible.error.reason === 'paused';
  return (
    <section className={styles.panel} aria-label="校方課表與 WOW Class 對照" aria-busy={visible?.status === 'loading'}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>選課與課堂，分開核對</p>
          <h2>學分、上課地點與課堂入口</h2>
          <p className={styles.description}>{lms ? '讀取本人的 e 校園課表，對照目前這份 WOW Class 清單。' : 'WOW Class 暫時未連線，仍可先讀取 e 校園的選課學分與上課地點。'}不更動選課，也不計算畢業採計學分。</p>
        </div>
        <button type="button" className="btn" disabled={visible?.status === 'loading'} onClick={() => void compare()}>
          {visible?.status === 'loading' ? '正在核對…' : comparison ? '重新核對校方課表' : '核對校方課表'}
        </button>
      </header>
      {visible?.status === 'loading' ? <p className={styles.message} role="status">正在讀取 e 校園的選課學分與上課地點…</p> : null}
      {visible?.status === 'error' ? <div className={styles.message} role={paused ? 'status' : 'alert'}>
        <h3>{paused ? ECAMPUS_PAUSED_MESSAGE : needsLogin ? 'e 校園需要重新連線' : '校方課表暫時無法核對'}</h3>
        <p>{paused ? '校方課表暫時不更新，不會顯示為零學分。你可以先前往校方網站核對。'
          : needsLogin ? '正式選課資料需要有效的 e 校園連線；你可以重新連線，或先前往校方網站核對。'
          : '校方課表尚未取得，不會顯示為零學分。請稍後重試，或前往校方網站核對。'}</p>
        <div className={styles.actions}>
          {needsLogin && canReconnect ? <Link className="btn" href={`/login?reconnect=school&returnUrl=${encodeURIComponent(returnUrl)}`}>重新連線 e 校園</Link> : null}
          <a className="btn" href="https://alcat.pu.edu.tw/" target="_blank" rel="noopener noreferrer">前往 e 校園 ↗</a>
        </div>
      </div> : null}
      {comparison ? <>
        <div className={styles.summary}>
          <div><span>校方選課學期</span><strong>{formatSemester(comparison.semester)}</strong></div>
          <div><span>校方選課學分小計</span><strong>{comparison.sourceTotalCredits === null ? '校方未提供' : `${comparison.sourceTotalCredits} 學分`}</strong></div>
          <div><span>已對上課堂</span><strong>{comparison.lmsAvailable ? `${comparison.matchedCount} / ${comparison.rows.length} 門` : '尚未對照'}</strong></div>
        </div>
        <p className={styles.source}>e 校園：{readTime(comparison.academicFetchedAt)} 讀取；WOW Class：{comparison.lmsFetchedAt ? `${readTime(comparison.lmsFetchedAt)} 讀取` : '未取得，未進行對照'}。</p>
        <p className={styles.source}>依同學期與完整課號核對，不猜同名課程；未對上可能只是課程狀態不同，並不代表未選課。</p>
        {comparison.rows.length ? <>
          <div className={styles.filters}>
            <label>搜尋校方課程
              <input type="search" value={search} placeholder="課名、課號、班別或老師" onChange={(event) => { setSearch(event.target.value); setLimit(PAGE_SIZE); }} />
            </label>
            <button type="button" className="btn" aria-pressed={onlyReview} onClick={() => { setOnlyReview((value) => !value); setLimit(PAGE_SIZE); }}>
              只看待核對（{comparison.needsReviewCount}）
            </button>
          </div>
          <p className={styles.source} role="status">符合條件 {rows.length} 門，顯示 {Math.min(limit, rows.length)} 門</p>
          <ul className={styles.rows}>
            {rows.slice(0, limit).map((row) => <li key={row.key}>
              <div className={styles.rowHeading}>
                <div><p className={styles.source}>{row.code || '課號未提供'} · {row.classOffered || '班別未提供'}</p><h3>{row.name}</h3></div>
                <strong className={styles.credits}>{row.credits === null ? '學分待核對' : `${row.credits} 學分`}</strong>
              </div>
              <dl>
                <div><dt>上課時間與地點</dt><dd>{row.schedule.length ? row.schedule.map((text) => <p key={text}>{text}</p>) : '校方未提供，請核對原課表'}</dd></div>
                <div><dt>校方授課教師</dt><dd>{row.teachers.join('、') || '校方未提供'}</dd></div>
                <div><dt>修別</dt><dd>{row.courseType || '校方未提供'}</dd></div>
              </dl>
              {row.scheduleIncomplete ? <p className={styles.source}>上課時間尚未完整辨識；以上保留原始內容，不據此推算空堂。</p> : null}
              <footer className={styles.rowFooter}>
                <span>{MATCH_LABELS[row.match]}</span>
                {row.lms ? <a href={row.lms.href} target="_blank" rel="noopener noreferrer" aria-label={`前往 ${row.name} 的對應課堂`}>開啟 WOW Class 課堂 ↗</a> : null}
              </footer>
            </li>)}
          </ul>
          {!rows.length ? <p className={styles.message}>沒有符合條件的課程，請調整搜尋或待核對篩選。</p> : null}
          {rows.length > limit ? <button type="button" className="btn" onClick={() => setLimit((value) => value + PAGE_SIZE)}>顯示更多校方課程（還有 {rows.length - limit} 門）</button> : null}
        </> : <p className={styles.message}>這次校方回應沒有可核對的選課列；不表示沒有修課，也不據此判定零學分。</p>}
        {comparison.unmatchedLms.length ? <details className={styles.unmatched}>
          <summary>另有 {comparison.unmatchedLms.length} 門 WOW Class 課堂未建立唯一對應</summary>
          <p className={styles.source}>可能屬於其他學期、其他班別或非正式選課課堂，不把它們加入校方學分小計。</p>
          <ul>{comparison.unmatchedLms.slice(0, lmsLimit).map((course) => <li key={course.id}>
            <a href={schoolCourseHref(course.id)} target="_blank" rel="noopener noreferrer">{course.name} ↗</a>
            <span>{course.code || '課號未提供'} · {formatSemester(course.semester)}</span>
          </li>)}</ul>
          {comparison.unmatchedLms.length > lmsLimit ? <button type="button" className="btn" onClick={() => setLmsLimit((value) => value + PAGE_SIZE)}>顯示更多未對應課堂</button> : null}
        </details> : null}
      </> : null}
    </section>
  );
}
