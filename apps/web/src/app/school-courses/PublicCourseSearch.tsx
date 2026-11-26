'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { parsePersonalImport } from '@campus/shared/src/imports/parser';
import { readPersonalImportDraft, readPersonalImportPartialDraft, writePersonalImportDraft } from '@/lib/personalImportDrafts';
import { usePersonalImportScope } from '@/lib/usePersonalImports';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { resolveOfficialCourseQueryLink } from '@campus/shared/src/courseCatalogCapability';
import { isPublicCourseOperationQuery } from '@campus/shared/src/publicCourseOperations';
import { exceedsPublicCourseResponseByteLimit } from '@campus/shared/src/publicCourseAssistantClient';
import { formatPublicCatalogFetchedAt, isPublicCourseCatalog, type PublicCatalogCourse, type PublicCourseCatalogResponse } from '@campus/shared/src/publicCourseCatalog';
import {
  hasPublicCourseFilters, parsePublicCourseFilterParams, publicCourseFilterLabel, type PublicCourseFilters,
} from '@campus/shared/src/publicCourseFilters';
import { ncnuCourseMeetings, ncnuTimetableImportCsv } from '@campus/shared/src/ncnuCourseSchedule';
import { nthuCourseMeetings, nthuTimetableImportCsv } from '@campus/shared/src/nthuCourseSchedule';
import { MAX_PUBLIC_COURSE_BULK_SELECTION, mergePublicCourseTimetableCsv } from '@campus/shared/src/mergePublicCourseTimetableCsv';
import { formatSemester } from '@/lib/academicRecords';
import { campusServiceHref } from '@/lib/campusNavigation';
import styles from '@/components/academic/academic.module.css';
import courseStyles from './schoolCourses.module.css';

type CourseSearch = { query: string; filters?: PublicCourseFilters };
type SearchResult = CourseSearch & (
  | { status: 'loading' | 'error' }
  | { status: 'ready'; courses: PublicCatalogCourse[]; truncated: boolean; sourceUrl: string; fetchedAt?: string; unresolvedCount?: number }
);

const QUERY_LENGTH_NOTICE = '搜尋文字最多 80 個字，請縮短後再查詢。';
const REPEATED_QUERY_NOTICE = '連結帶入多個查詢條件。請在搜尋欄確認要查的內容，再按「查詢課程」。';
const INVALID_LINK_FILTER_NOTICE = '連結帶入的篩選條件無效或重複，請重新設定星期、學分或清除篩選後再查詢。';
const FILTER_NOTICE = '星期請選擇星期一至星期日；學分請填 0～40，最多兩位小數，留白表示不限。';
const WEEKDAYS = ['星期一', '星期二', '星期三', '星期四', '星期五', '星期六', '星期日'];

function filterParameters(weekdays: readonly string[], credits: readonly string[]): URLSearchParams {
  const params = new URLSearchParams();
  weekdays.forEach((value) => params.append('weekday', value));
  credits.forEach((value) => params.append('credits', value));
  return params;
}

function formFilters(weekday: string, credits: string): PublicCourseFilters | null {
  return parsePublicCourseFilterParams(filterParameters(
    weekday.trim() ? [weekday.trim()] : [],
    credits.trim() ? [credits.trim()] : [],
  ));
}

function courseSearch(query: string, filters: PublicCourseFilters): CourseSearch {
  return { query: query.trim(), ...(hasPublicCourseFilters(filters) ? { filters } : {}) };
}

function sameSearch(left: CourseSearch, right: CourseSearch): boolean {
  return left.query === right.query && left.filters?.weekday === right.filters?.weekday && left.filters?.credits === right.filters?.credits;
}

const MAX_PUBLIC_COURSE_RESPONSE_BYTES = 512 * 1024;

// Bound the decoded response *while it streams*. Checking only response.text()
// still buffers a maliciously large reply before the 512 KiB guard can run.
async function readBoundedCatalogBody(response: Response, signal: AbortSignal): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) {
    // Some browser test doubles and older fetch implementations expose text()
    // but no readable body; preserve the size check on that fallback.
    const text = await response.text();
    if (exceedsPublicCourseResponseByteLimit(text)) throw new Error('Oversized public catalog');
    return text;
  }

  // Reject invalid UTF-8 instead of silently replacing damaged official course names.
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const fragments: string[] = [];
  let bytes = 0;
  let finished = false;
  const cancel = () => { void reader.cancel().catch(() => undefined); };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    if (signal.aborted) throw new Error('Cancelled public catalog');
    while (true) {
      const chunk = await reader.read();
      if (signal.aborted) throw new Error('Cancelled public catalog');
      if (chunk.done) { finished = true; break; }
      bytes += chunk.value.byteLength;
      if (bytes > MAX_PUBLIC_COURSE_RESPONSE_BYTES) throw new Error('Oversized public catalog');
      fragments.push(decoder.decode(chunk.value, { stream: true }));
    }
    fragments.push(decoder.decode());
    const text = fragments.join('');
    if (exceedsPublicCourseResponseByteLimit(text)) throw new Error('Oversized public catalog');
    return text;
  } finally {
    signal.removeEventListener('abort', cancel);
    // Abort/oversize must also close the reader, not leave a network body open.
    if (!finished) await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

// Serialize clipboard writes across cards. A slow earlier write must never
// replace the student's most recently requested course after it finishes.
let latestClipboardCopy = 0;
let clipboardQueue: Promise<void> = Promise.resolve();

function queuePublicCourseClipboardWrite(
  write: () => Promise<void>, isCurrent: () => boolean,
): Promise<'copied' | 'manual' | 'superseded'> {
  const request = ++latestClipboardCopy;
  const operation = clipboardQueue.then(async () => {
    if (request !== latestClipboardCopy || !isCurrent()) return 'superseded' as const;
    try {
      await write();
    } catch {
      return request === latestClipboardCopy && isCurrent() ? 'manual' as const : 'superseded' as const;
    }
    return request === latestClipboardCopy && isCurrent() ? 'copied' as const : 'superseded' as const;
  });
  clipboardQueue = operation.then(() => undefined, () => undefined);
  return operation;
}

type ClipboardFeedback = { csv: string; cardId: string; status: 'copied' | 'manual' };

function courseCardId(course: PublicCatalogCourse, index: number): string {
  return JSON.stringify([
    course.semester, course.code, course.section, course.title,
    course.department, course.teacher, course.time, course.room,
    course.credits, course.meetings ?? [], index,
  ]);
}

function CatalogCourse({ course, schoolId, importHref, cardId, rowNumber, selected, onSelect, review, copyFeedback, onCopy }: {
  course: PublicCatalogCourse;
  schoolId: PublicCourseCatalogResponse['schoolId'];
  importHref: string;
  cardId: string;
  rowNumber: number;
  selected: boolean;
  onSelect: (selected: boolean) => void;
  review: (course: PublicCatalogCourse, csv: string) => string;
  copyFeedback: ClipboardFeedback | null;
  onCopy: (csv: string) => void;
}) {
  const [notice, setNotice] = useState('');
  const meetings = schoolId === 'ncnu' ? ncnuCourseMeetings(course.time, course.semester) : null;
  const pairedMeetings = schoolId === 'nthu'
    ? nthuCourseMeetings(course.meetings ?? [], course.semester)?.map((meeting) => ({ time: meeting.label, room: meeting.room }))
      ?? (course.meetings?.length ? course.meetings : [{ time: course.time, room: course.room }])
    : null;
  const csv = schoolId === 'nthu' ? nthuTimetableImportCsv(course) : ncnuTimetableImportCsv(course);

  // Cross-listed rows may serialize to identical CSV but belong to distinct cards.
  const copyStatus = copyFeedback?.cardId === cardId && copyFeedback?.csv === csv
    ? copyFeedback.status : 'idle';
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
      {!csv && <p role="status">校方課號或上課節次尚無法安全匯入（可能缺漏或重複），請先至校方課程目錄核對。</p>}
      {csv && (
        <div className={courseStyles.cardActions}>
          <label className={styles.field}>
            <input type="checkbox" checked={selected}
              aria-label={`選入批次核對：第${rowNumber}筆，${course.title}，課號${course.code}，班別${course.section || '未提供'}`}
              onChange={(event) => onSelect(event.target.checked)} />
            選入批次核對
          </label>
          <button type="button" className="btn primary" onClick={() => setNotice(review(course, csv))}>帶入課表核對</button>
          <button type="button" className="btn" onClick={() => onCopy(csv)}>複製課表匯入資料</button>
          {notice && <p role="status">{notice}</p>}
          {copyStatus !== 'idle' && (
            <>
              {copyStatus === 'manual' ? (
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

type PublicCourseSearchProps = {
  schoolId: PublicCourseCatalogResponse['schoolId'];
  schoolName: string;
  schoolSearch: string;
  queryParameters?: readonly string[];
  weekdayParameters?: readonly string[];
  creditsParameters?: readonly string[];
};

export function PublicCourseSearch(props: PublicCourseSearchProps) {
  return <PublicCourseSearchForm key={JSON.stringify([
    props.schoolId, props.queryParameters ?? [], props.weekdayParameters ?? [], props.creditsParameters ?? [],
  ])} {...props} />;
}

function PublicCourseSearchForm({
  schoolId, schoolName, schoolSearch, queryParameters = [], weekdayParameters = [], creditsParameters = [],
}: PublicCourseSearchProps) {
  const [linked] = useState(() => {
    const query = queryParameters[0] ?? '';
    const filters = parsePublicCourseFilterParams(filterParameters(weekdayParameters, creditsParameters));
    const hasSearch = queryParameters.length > 0 || weekdayParameters.length > 0 || creditsParameters.length > 0;
    return {
      query, weekday: weekdayParameters[0] ?? '', credits: creditsParameters[0] ?? '',
      invalidWeekday: parsePublicCourseFilterParams(filterParameters(weekdayParameters, [])) === null,
      invalidCredits: parsePublicCourseFilterParams(filterParameters([], creditsParameters)) === null,
      search: hasSearch && queryParameters.length <= 1 && isPublicCourseOperationQuery(query) && filters
        ? courseSearch(query, filters) : null,
    };
  });
  const [query, setQuery] = useState(linked.query);
  const [weekday, setWeekday] = useState(linked.weekday);
  const [credits, setCredits] = useState(linked.credits);
  const [invalidLinkedFields, setInvalidLinkedFields] = useState({ weekday: linked.invalidWeekday, credits: linked.invalidCredits });
  const [queryNotice, setQueryNotice] = useState<string | null>(() => queryParameters.length > 1
    ? REPEATED_QUERY_NOTICE
    : !isPublicCourseOperationQuery(linked.query) ? QUERY_LENGTH_NOTICE : null);
  const [result, setResult] = useState<SearchResult | null>(() => linked.search ? { status: 'loading', ...linked.search } : null);
  const [copyFeedback, setCopyFeedback] = useState<ClipboardFeedback | null>(null);
  const [selectedCards, setSelectedCards] = useState<string[]>([]);
  const [bulkNotice, setBulkNotice] = useState<string | null>(null);
  const copyAttempt = useRef(0);
  // A pending queued copy belongs to the visible search, never a departed page.
  useEffect(() => () => { copyAttempt.current += 1; }, []);
  const pending = useRef<{ controller: AbortController; timer: ReturnType<typeof setTimeout> } | null>(null);
  const router = useRouter();
  const context = usePersonalImportScope();
  const importHref = campusServiceHref('/import?kind=timetable', schoolSearch);
  const copyCourse = useCallback(async (csv: string, cardId: string) => {
    const attempt = ++copyAttempt.current;
    setCopyFeedback(null);
    const status = await queuePublicCourseClipboardWrite(
      () => navigator.clipboard.writeText(csv), () => attempt === copyAttempt.current,
    );
    // Search/school changes invalidate clipboard feedback even if the old
    // write completes while a fresh result containing the same CSV is shown.
    if (status !== 'superseded' && attempt === copyAttempt.current) {
      setCopyFeedback({ csv, cardId, status });
    }
  }, []);

  function reviewCourses(courses: readonly PublicCatalogCourse[], csv: string): string {
    const first = courses[0];
    if (!first || courses.some((course) => course.semester !== first.semester)) {
      return '所選課程包含不同學期，請分開核對與匯入。';
    }
    const { scope } = context;
    if (!context.canPrepareSchoolDraft || scope.schoolId !== schoolId) {
      return `請先確認目前帳號和所選校園為${schoolName}，也可以先複製課表資料。`;
    }
    try {
      if (readPersonalImportDraft(scope) || readPersonalImportPartialDraft(scope)) {
        return '匯入頁已有待核對的草稿。請先處理草稿，或複製本課程資料留用。';
      }
      const year = first.semester.slice(0, -1);
      const semester = first.semester.slice(-1);
      // Keep provenance for both single-course and batch review drafts.
      // A retrieval timestamp is not the university's last-updated time.
      const fetchedAt = result?.status === 'ready' && result.fetchedAt
        ? formatPublicCatalogFetchedAt(result.fetchedAt) : null;
      const sourceUrl = result?.status === 'ready' ? result.sourceUrl : '未提供';
      const source = {
        type: 'paste' as const,
        name: `${schoolName}｜${year}學年度第${semester}學期公開開課資料｜來源：${sourceUrl}｜` +
          `資料擷取：${fetchedAt ? `${fetchedAt}（台灣時間；非校方更新時間）` : '時間未提供'}`,
      };
      const { rows, issues } = parsePersonalImport(csv, { kind: 'timetable', schoolId, academicYear: year, semester, source });
      if (courses.length > 1 && issues.some(issue => issue.code === 'duplicate-row')) {
        return '所選課程包含重複的課表資料。請取消問題課程後重試。';
      }
      if (!rows.length || issues.some(issue => issue.severity === 'error')) return '課表資料需要手動核對，請先複製再貼到匯入頁。';
      writePersonalImportDraft(scope, { kind: 'timetable', year, semester, text: csv, source, rows, parseIssues: issues, excluded: [], backup: null });
    } catch {
      return '無法安全讀寫這個分頁的草稿，請先複製課表資料。';
    }
    router.push(importHref + '#import-review');
    return '';
  }

  function review(course: PublicCatalogCourse, csv: string): string {
    return reviewCourses([course], csv);
  }

  function selectCard(cardId: string, checked: boolean) {
    setBulkNotice(null);
    if (checked && !selectedCards.includes(cardId) &&
        selectedCards.length >= MAX_PUBLIC_COURSE_BULK_SELECTION) {
      setBulkNotice(`一次最多選取 ${MAX_PUBLIC_COURSE_BULK_SELECTION} 門課，請分批核對。`);
      return;
    }
    setSelectedCards((previous) => checked
      ? previous.includes(cardId) ? previous : [...previous, cardId]
      : previous.filter((key) => key !== cardId));
  }
  const cancelSearch = useCallback(() => {
    if (!pending.current) return;
    pending.current.controller.abort();
    clearTimeout(pending.current.timer);
    pending.current = null;
  }, []);
  const catalog = resolveOfficialCourseQueryLink(schoolId);

  const searchCourses = useCallback(async (search: CourseSearch) => {
    cancelSearch();
    const controller = new AbortController();
    const timer = setTimeout(() => {
      if (pending.current?.controller !== controller || controller.signal.aborted) return;
      controller.abort();
      setResult({ status: 'error', ...search });
    }, 25_000);
    pending.current = { controller, timer };
    try {
      const params = new URLSearchParams({ schoolId });
      if (search.query) params.set('q', search.query);
      if (search.filters?.weekday !== undefined) params.set('weekday', String(search.filters.weekday));
      if (search.filters?.credits !== undefined) params.set('credits', String(search.filters.credits));
      const response = await fetch('/api/public-course-catalog?' + params, {
        signal: controller.signal, credentials: 'omit', cache: 'no-store', redirect: 'error',
      });
      // A cancelled fetch can still resolve with a late Response (for example
      // through a service worker). Do not start reading its body: in the
      // text()-only fallback that would buffer a stale, potentially large reply.
      if (controller.signal.aborted || pending.current?.controller !== controller) {
        void response.body?.cancel().catch(() => undefined);
        return;
      }
      // Align Web with native and assistant: reject malformed length metadata
      // or a non-JSON response before reading any course payload.
      const lengthHeader = response.headers?.get('content-length') ?? null;
      const contentType = response.headers?.get('content-type') ?? null;
      const declaredBytes = lengthHeader === null ? 0 : Number(lengthHeader);
      if (!response.ok ||
          (lengthHeader !== null &&
            (!/^\d+$/.test(lengthHeader.trim()) ||
              !Number.isSafeInteger(declaredBytes) ||
              declaredBytes > MAX_PUBLIC_COURSE_RESPONSE_BYTES)) ||
          (contentType !== null &&
            !/^application\/json(?:\s*;|\s*$)/i.test(contentType.trim()))) {
        // A rejected source must not keep downloading in the background.
        void response.body?.cancel().catch(() => undefined);
        throw new Error('Invalid public catalog response');
      }
      const body = await readBoundedCatalogBody(response, controller.signal);
      // An older response or a cancelled search must never be parsed or displayed.
      if (pending.current?.controller !== controller || controller.signal.aborted) return;
      const data: unknown = JSON.parse(body);
      if (!isPublicCourseCatalog(data, schoolId, search.filters)) throw new Error('Invalid catalog');
      if (pending.current?.controller === controller && !controller.signal.aborted) {
        setResult({
          status: 'ready', ...search, courses: data.courses, truncated: data.truncated,
          sourceUrl: data.sourceUrl, fetchedAt: data.fetchedAt, unresolvedCount: data.unresolvedCount,
        });
      }
    } catch {
      if (pending.current?.controller === controller && !controller.signal.aborted) setResult({ status: 'error', ...search });
    } finally {
      clearTimeout(timer);
    }
  }, [schoolId, cancelSearch]);

  useEffect(() => {
    if (linked.search) void searchCourses(linked.search);
    return cancelSearch;
  }, [linked, searchCourses, cancelSearch]);

  const filters = formFilters(weekday, credits);
  const invalidWeekday = invalidLinkedFields.weekday || formFilters(weekday, '') === null;
  const invalidCredits = invalidLinkedFields.credits || formFilters('', credits) === null;
  const filterNotice = invalidLinkedFields.weekday || invalidLinkedFields.credits
    ? INVALID_LINK_FILTER_NOTICE : filters === null ? FILTER_NOTICE : null;

  function editSearch() {
    cancelSearch();
    setSelectedCards([]);
    setBulkNotice(null);
    copyAttempt.current += 1;
    setResult(null);
    setCopyFeedback(null);
  }

  function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!isPublicCourseOperationQuery(query)) {
      cancelSearch();
      setResult(null);
      setQueryNotice(QUERY_LENGTH_NOTICE);
      return;
    }
    if (filterNotice || !filters) {
      cancelSearch();
      setResult(null);
      return;
    }
    setQueryNotice(null);
    copyAttempt.current += 1;
    setCopyFeedback(null);
    setSelectedCards([]);
    setBulkNotice(null);
    const submitted = courseSearch(query, filters);
    setResult({ status: 'loading', ...submitted });
    void searchCourses(submitted);
  }

  function clearFilters() {
    editSearch();
    setWeekday('');
    setCredits('');
    setInvalidLinkedFields({ weekday: false, credits: false });
    if (!isPublicCourseOperationQuery(query)) {
      setQueryNotice(QUERY_LENGTH_NOTICE);
      return;
    }
    setQueryNotice(null);
    const submitted = courseSearch(query, {});
    setResult({ status: 'loading', ...submitted });
    void searchCourses(submitted);
  }

  // Match native's source-freshness guidance: a successful search does not
  // establish that the university has published an up-to-date offering.
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const update = () => setNow(Date.now());
    update();
    const timer = window.setInterval(update, 60_000);
    window.addEventListener('focus', update);
    document.addEventListener('visibilitychange', update);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', update);
      document.removeEventListener('visibilitychange', update);
    };
  }, []);
  const fetchedAt = result?.status === 'ready' ? result.fetchedAt : undefined;
  const fetchAgeMs = fetchedAt && now !== null ? now - Date.parse(fetchedAt) : null;
  const fetchIsOld = fetchAgeMs !== null && fetchAgeMs > 24 * 60 * 60 * 1000;
  // Allow a small client/server clock skew without presenting false warnings.
  const fetchIsFuture = fetchAgeMs !== null && fetchAgeMs < -5 * 60 * 1000;

  const visibleCourses = result?.status === 'ready' ? result.courses : [];
  const selectedCourses = visibleCourses
    .map((course, index) => ({ course, cardId: courseCardId(course, index) }))
    .filter(({ cardId }) => selectedCards.includes(cardId))
    .map(({ course }) => course);

  function reviewSelectedCourses() {
    const csv = mergePublicCourseTimetableCsv(schoolId, selectedCourses);
    if (!csv) {
      setBulkNotice('所選課程可能有不同學期、重複課號班別或無法核對的節次／學分。請取消問題課程後重試。');
      return;
    }
    const notice = reviewCourses(selectedCourses, csv);
    if (notice) setBulkNotice(notice);
  }

  const term = result?.query ? '「' + result.query + '」' : '';
  const currentSearch = !filterNotice && filters ? courseSearch(query, filters) : null;
  const isCurrentSearch = Boolean(result && currentSearch && sameSearch(result, currentSearch));
  const appliedFilters = publicCourseFilterLabel(result?.filters);
  return (
    <section aria-labelledby="public-course-title">
      <h2 id="public-course-title">{schoolName}開課查詢</h2>
      <p>查找校方公布的課程。可輸入關鍵字、指定上課星期或學分；留白表示不限。</p>
      <form className={`${courseStyles.toolbar} ${courseStyles.publicSearch}`} onSubmit={search} role="search" aria-label="搜尋校方開課資料">
        <label className={`${styles.field} ${courseStyles.queryField}`}>
          課名、課號或授課老師
          <input type="search" value={query} placeholder="例如：資料庫"
            aria-invalid={queryNotice ? true : undefined}
            aria-describedby={queryNotice ? 'public-course-query-notice' : undefined}
            onChange={(event) => {
              editSearch();
              setQuery(event.target.value);
              setQueryNotice(isPublicCourseOperationQuery(event.target.value) ? null : QUERY_LENGTH_NOTICE);
            }} />
        </label>
        <label className={styles.field}>
          上課星期
          <select value={weekday} aria-invalid={invalidWeekday || undefined}
            aria-describedby={`public-course-weekday-help${invalidWeekday ? ' public-course-filter-notice' : ''}`}
            onChange={(event) => {
              editSearch();
              setWeekday(event.target.value);
              setInvalidLinkedFields((previous) => ({ ...previous, weekday: false }));
            }}>
            <option value="">不限</option>
            {weekday && !/^[1-7]$/.test(weekday) && <option value={weekday}>連結值：{weekday}（請重選）</option>}
            {WEEKDAYS.map((label, index) => <option key={label} value={index + 1}>{label}</option>)}
          </select>
        </label>
        <label className={`${styles.field} ${courseStyles.creditsField}`}>
          學分（完全符合）
          <input type="text" inputMode="decimal" value={credits} placeholder="不限"
            aria-invalid={invalidCredits || undefined}
            aria-describedby={`public-course-credits-help${invalidCredits ? ' public-course-filter-notice' : ''}`}
            onChange={(event) => {
              editSearch();
              setCredits(event.target.value);
              setInvalidLinkedFields((previous) => ({ ...previous, credits: false }));
            }} />
        </label>
        <div className={courseStyles.searchActions}>
          <button type="submit" className="btn primary" disabled={result?.status === 'loading' && isCurrentSearch}>
            {result?.status === 'error' && isCurrentSearch ? '重新查詢' : '查詢課程'}
          </button>
          <button type="button" className="btn" onClick={clearFilters}
            disabled={!weekday && !credits && !invalidLinkedFields.weekday && !invalidLinkedFields.credits}>清除篩選</button>
        </div>
        <div className={courseStyles.filterHelp}>
          <p id="public-course-weekday-help">星期篩選表示當天有課，課程也可能在其他天上課。</p>
          <p id="public-course-credits-help">學分可填 0～40，最多兩位小數；清除篩選會保留關鍵字重新查詢。</p>
        </div>
      </form>
      {queryNotice && <p id="public-course-query-notice" role="alert">{queryNotice}</p>}
      {filterNotice && <p id="public-course-filter-notice" role="alert">{filterNotice}</p>}
      {result && <p className={courseStyles.appliedFilters}>
        {result.status === 'ready' ? '已套用條件' : '本次查詢條件'}：{result.query ? `關鍵字「${result.query}」` : '關鍵字不限'}
        {appliedFilters ? ` · ${appliedFilters}` : ' · 星期與學分不限'}
      </p>}
      {result?.status === 'loading' && <p role="status">正在查詢{term}開課資料…</p>}
      {result?.status === 'error' && (
        <p role="alert">暫時無法取得校方課程資料，請重新查詢{catalog && <>或前往<a href={catalog.url} target="_blank" rel="noopener noreferrer">校方課程目錄</a></>}。</p>
      )}
      {result?.status === 'ready' && (
        <>
          <p role="status" aria-label="查詢結果">
            {result.courses.length ? `顯示${term}${result.courses.length} 筆開課資料。` : `這次查詢沒有找到${term}課程。`}
            {result.truncated ? '符合條件的課程超過顯示上限，可改用課號或老師姓名縮小範圍。' : null}
          </p>
          {!!result.unresolvedCount && <p className={courseStyles.filterHelp}>
            另有 {result.unresolvedCount} 筆資料無法確認是否符合上述篩選條件，未列入結果。
          </p>}
          {result.fetchedAt && <p>校方資料擷取：{formatPublicCatalogFetchedAt(result.fetchedAt)}（台灣時間；非校方更新時間）</p>}
          {!result.fetchedAt && <p aria-live="polite">
            目前沒有校方資料的擷取時間。加入個人課表前，請先至
            {catalog ? <a href={catalog.url} target="_blank" rel="noopener noreferrer">官方課程目錄</a> : '官方課程目錄'}核對。
          </p>}
          {fetchIsOld && <p aria-live="polite">
            距離伺服器上次取得校方資料已超過 24 小時，課程與教室可能變動。加入前請先查看
            {catalog ? <a href={catalog.url} target="_blank" rel="noopener noreferrer">官方課程目錄</a> : '官方課程目錄'}。
          </p>}
          {fetchIsFuture && <p aria-live="polite">
            伺服器提供的擷取時間比此裝置時間晚超過 5 分鐘，無法確認課程資料時效。加入前請先查看
            {catalog ? <a href={catalog.url} target="_blank" rel="noopener noreferrer">官方課程目錄</a> : '官方課程目錄'}。
          </p>}
          {result.courses.length > 0 && (
            <div className={courseStyles.searchActions}>
              <p role="status" aria-label="選取課程">已選 {selectedCourses.length} 門課（最多 {MAX_PUBLIC_COURSE_BULK_SELECTION} 門），可一次帶入同學期課表核對。</p>
              <button type="button" className="btn primary" disabled={selectedCourses.length < 2}
                onClick={reviewSelectedCourses}>將選取的課程一起帶入核對</button>
              <button type="button" className="btn" disabled={selectedCourses.length === 0}
                onClick={() => { setSelectedCards([]); setBulkNotice(null); }}>清除已選課程</button>
              {bulkNotice && <p role="alert">{bulkNotice}</p>}
            </div>
          )}
          {result.courses.length > 0 && (
            <ul className={courseStyles.courses}>
              {result.courses.map((course, index) => {
                const cardId = courseCardId(course, index);
                return <CatalogCourse
                  key={cardId}
                  cardId={cardId}
                  rowNumber={index + 1}
                  selected={selectedCards.includes(cardId)}
                  onSelect={(checked) => selectCard(cardId, checked)}
                  course={course}
                  schoolId={schoolId}
                  importHref={importHref}
                  review={review}
                  copyFeedback={copyFeedback}
                  onCopy={(csv) => { void copyCourse(csv, cardId); }}
                />;
              })}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
