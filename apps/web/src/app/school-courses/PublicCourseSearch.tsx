'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { parsePersonalImport } from '@campus/shared/src/imports/parser';
import { readPersonalImportDraft, readPersonalImportPartialDraft, writePersonalImportDraft } from '@/lib/personalImportDrafts';
import { usePersonalImportScope } from '@/lib/usePersonalImports';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { resolveOfficialCourseQueryLink } from '@campus/shared/src/courseCatalogCapability';
import { isPublicCourseCatalog, type PublicCatalogCourse, type PublicCourseCatalogResponse } from '@campus/shared/src/publicCourseCatalog';
import { ncnuCourseMeetings, ncnuTimetableImportCsv } from '@campus/shared/src/ncnuCourseSchedule';
import { nthuCourseMeetings, nthuTimetableImportCsv } from '@campus/shared/src/nthuCourseSchedule';
import { formatSemester } from '@/lib/academicRecords';
import { campusServiceHref } from '@/lib/campusNavigation';
import styles from '@/components/academic/academic.module.css';
import courseStyles from './schoolCourses.module.css';

type SearchResult =
  | { status: 'loading' | 'error'; query: string }
  | { status: 'ready'; query: string; courses: PublicCatalogCourse[]; truncated: boolean };

function CatalogCourse({ course, schoolId, importHref, review }: {
  course: PublicCatalogCourse;
  schoolId: PublicCourseCatalogResponse['schoolId'];
  importHref: string;
  review: (course: PublicCatalogCourse, csv: string) => string;
}) {
  const [notice, setNotice] = useState('');
  const [copy, setCopy] = useState<'idle' | 'copied' | 'manual'>('idle');
  const meetings = schoolId === 'ncnu' ? ncnuCourseMeetings(course.time, course.semester) : null;
  const pairedMeetings = schoolId === 'nthu'
    ? nthuCourseMeetings(course.meetings ?? [], course.semester)?.map((meeting) => ({ time: meeting.label, room: meeting.room }))
      ?? (course.meetings?.length ? course.meetings : [{ time: course.time, room: course.room }])
    : null;
  const csv = schoolId === 'nthu' ? nthuTimetableImportCsv(course) : ncnuTimetableImportCsv(course);

  async function copyCourse() {
    if (!csv) return;
    try {
      await navigator.clipboard.writeText(csv);
      setCopy('copied');
    } catch {
      setCopy('manual');
    }
  }
  return (
    <li>
      <p className={courseStyles.code}>{formatSemester(course.semester)} · 課號 {course.code || '未提供'} · 班別 {course.section || '未提供'}</p>
      <h3>{course.title}</h3>
      <dl>
        <div><dt>{schoolId === 'nthu' ? '開課單位代碼' : '開課單位'}</dt><dd>{course.department || '未提供'}</dd></div>
        <div><dt>授課老師</dt><dd>{course.teacher || '未提供'}</dd></div>
        <div><dt>學分</dt><dd>{course.credits || '未提供'}</dd></div>
        {pairedMeetings ? (
          <div><dt>時間與教室</dt><dd>
            {pairedMeetings.map((meeting, index) => (
              <div key={index}>{meeting.time || '時間未提供'} · {meeting.room || '教室未提供'}</div>
            ))}
          </dd></div>
        ) : (
          <>
            <div><dt>校方節次</dt><dd>{meetings?.map((meeting) => meeting.label).join('；') || course.time || '未提供'}</dd></div>
            <div><dt>上課地點</dt><dd>{course.room || '未提供'}</dd></div>
          </>
        )}
      </dl>
      {csv && (
        <div className={courseStyles.cardActions}>
          <button type="button" className="btn primary" onClick={() => setNotice(review(course, csv))}>帶入課表核對</button>
          <button type="button" className="btn" onClick={() => void copyCourse()}>複製課表匯入資料</button>
          {notice && <p role="status">{notice}</p>}
          {copy !== 'idle' && (
            <>
              {copy === 'manual' ? (
                <label className={styles.field}>複製下方資料
                  <textarea readOnly value={csv} onFocus={(event) => event.target.select()} />
                </label>
              ) : <p role="status">已複製，可到匯入頁貼上並核對這門課的時段。</p>}
              <Link href={importHref}>前往課表匯入</Link>
            </>
          )}
        </div>
      )}
    </li>
  );
}

export function PublicCourseSearch({ schoolId, schoolName, schoolSearch }: { schoolId: PublicCourseCatalogResponse['schoolId']; schoolName: string; schoolSearch: string }) {
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<SearchResult | null>(null);
  const pending = useRef<{ controller: AbortController; timer: ReturnType<typeof setTimeout> } | null>(null);
  const router = useRouter();
  const context = usePersonalImportScope();
  const importHref = campusServiceHref('/import?kind=timetable', schoolSearch);

  function review(course: PublicCatalogCourse, csv: string): string {
    const { scope } = context;
    if (!context.canPrepareSchoolDraft || scope.schoolId !== schoolId) {
      return `請先確認目前帳號和所選校園為${schoolName}，也可以先複製課表資料。`;
    }
    try {
      if (readPersonalImportDraft(scope) || readPersonalImportPartialDraft(scope)) {
        return '匯入頁已有待核對的草稿。請先處理草稿，或複製本課程資料留用。';
      }
      const year = course.semester.slice(0, -1);
      const semester = course.semester.slice(-1);
      const source = { type: 'paste' as const, name: `${schoolName}本學期開設課程` };
      const { rows, issues } = parsePersonalImport(csv, { kind: 'timetable', schoolId, academicYear: year, semester, source });
      if (!rows.length || issues.some(issue => issue.severity === 'error')) return '課表資料需要手動核對，請先複製再貼到匯入頁。';
      writePersonalImportDraft(scope, { kind: 'timetable', year, semester, text: csv, source, rows, parseIssues: issues, excluded: [], backup: null });
    } catch {
      return '無法安全讀寫這個分頁的草稿，請先複製課表資料。';
    }
    router.push(importHref + '#import-review');
    return '';
  }
  useEffect(() => () => {
    if (!pending.current) return;
    pending.current.controller.abort();
    clearTimeout(pending.current.timer);
  }, []);
  const catalog = resolveOfficialCourseQueryLink(schoolId);

  async function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const term = query.trim();
    if (pending.current) {
      pending.current.controller.abort();
      clearTimeout(pending.current.timer);
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      if (pending.current?.controller !== controller || controller.signal.aborted) return;
      controller.abort();
      setResult({ status: 'error', query: term });
    }, 25_000);
    pending.current = { controller, timer };
    setResult({ status: 'loading', query: term });
    try {
      const params = new URLSearchParams({ schoolId });
      if (term) params.set('q', term);
      const response = await fetch('/api/public-course-catalog?' + params, {
        signal: controller.signal, credentials: 'omit', cache: 'no-store', redirect: 'error',
      });
      if (!response.ok) throw new Error();
      const data = await response.json();
      if (!isPublicCourseCatalog(data, schoolId)) throw new Error('Invalid catalog');
      if (!controller.signal.aborted) setResult({ status: 'ready', query: term, courses: data.courses, truncated: data.truncated });
    } catch {
      if (!controller.signal.aborted) setResult({ status: 'error', query: term });
    } finally {
      clearTimeout(timer);
    }
  }

  const term = result?.query ? '「' + result.query + '」' : '';
  return (
    <section aria-labelledby="public-course-title">
      <h2 id="public-course-title">{schoolName}開課查詢</h2>
      <p>查找校方公布的課程。可輸入關鍵字，或留白瀏覽開課清單。</p>
      <form className={courseStyles.toolbar} onSubmit={search} role="search" aria-label="搜尋校方開課資料">
        <label className={styles.field}>
          課名、課號或授課老師
          <input type="search" value={query} maxLength={80} placeholder="例如：資料庫" onChange={(event) => setQuery(event.target.value)} />
        </label>
        <button type="submit" className="btn primary" disabled={result?.status === 'loading' && result.query === query.trim()}>
          {result?.status === 'error' && result.query === query.trim() ? '重新查詢' : '查詢課程'}
        </button>
      </form>
      {result?.status === 'loading' && <p role="status">正在查詢{term}開課資料…</p>}
      {result?.status === 'error' && (
        <p role="alert">暫時無法取得校方課程資料，請重新查詢{catalog && <>或前往<a href={catalog.url} target="_blank" rel="noopener noreferrer">校方課程目錄</a></>}。</p>
      )}
      {result?.status === 'ready' && (
        <>
          <p role="status">
            {result.courses.length ? `顯示${term}${result.courses.length} 筆開課資料。` : `這次查詢沒有找到${term}課程。`}
            {result.truncated ? '符合條件的課程超過顯示上限，可改用課號或老師姓名縮小範圍。' : null}
          </p>
          {result.courses.length > 0 && (
            <ul className={courseStyles.courses}>
              {result.courses.map((course) => (
                <CatalogCourse
                  key={JSON.stringify([course.semester, course.code, course.section])}
                  course={course}
                  schoolId={schoolId}
                  importHref={importHref}
                  review={review}
                />
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
