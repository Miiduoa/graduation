'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { formatTaipeiDateTime } from '@campus/shared/src/taipeiTime';
import { NuniError } from '@campus/shared/src/nuni';
import { GradesTabs } from '@/components/academic/GradesTabs';
import { SiteShell } from '@/components/SiteShell';
import { NuniSignIn } from '@/components/NuniSignIn';
import { useAuth } from '@/components/AuthGuard';
import { useClientHydrated } from '@/lib/useClientHydrated';
import { browserRequest, useNuniSession } from './Session';
import {
  GRADE_COPY,
  LMS_GRADES_HREF,
  LMS_GRADES_TITLE,
  type CourseGradeSection,
  type GradeFilter,
  type GradeItem,
  type StudentGradebook,
  getGradeReadEpoch,
  gradeFilterLabel,
  gradeOwnerForSource,
  gradeStatusLabel,
  isPublishedGradeUnread,
  markPublishedGradeRead,
  matchesGradeFilter,
  subscribeGradeRead,
} from '@/lib/lmsStudentGrades';
import { isNuniSessionError, loadNuniStudentGrades } from '@/lib/nuniStudentGrades';
import { loadSchoolStudentGrades } from '@/lib/schoolStudentGrades';
import styles from './StudentGrades.module.css';
import shared from './NuniApp.module.css';

const FILTERS: GradeFilter[] = ['all', 'unread', 'graded', 'waiting', 'missing'];

function useOnline() {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);
  return online;
}

function useGradeReadEpoch() {
  return useSyncExternalStore(subscribeGradeRead, getGradeReadEpoch, () => 0);
}

export function StudentGradesBoard({
  nuni,
  school,
  ownerId,
  nuniAccountId,
  schoolUid,
  filter,
  onFilter,
  onOpen,
}: {
  nuni: StudentGradebook | null;
  school: StudentGradebook | null;
  ownerId?: string;
  nuniAccountId?: string | null;
  schoolUid?: string | null;
  filter: GradeFilter;
  onFilter: (value: GradeFilter) => void;
  onOpen: (item: GradeItem, ownerId: string) => void;
}) {
  useGradeReadEpoch();
  const hydrated = useClientHydrated();
  const ownerFor = (item: GradeItem) =>
    gradeOwnerForSource(item.source, nuniAccountId, schoolUid) || ownerId || '';
  const courses = [...(nuni?.courses ?? []), ...(school?.courses ?? [])];
  const items = courses.flatMap((course) => course.items);
  const summary = {
    graded: 0,
    waiting: 0,
    missing: 0,
    unread: 0,
  };
  for (const item of items) {
    if (item.status === 'graded') summary.graded += 1;
    if (item.status === 'waiting') summary.waiting += 1;
    if (item.status === 'missing') summary.missing += 1;
    if (hydrated && isPublishedGradeUnread(ownerFor(item), item)) summary.unread += 1;
  }
  const visibleCourses = courses
    .map((course) => ({
      ...course,
      visible: course.items.filter((item) => {
        if (filter === 'unread') {
          return hydrated && isPublishedGradeUnread(ownerFor(item), item);
        }
        return matchesGradeFilter(item, filter, ownerFor(item));
      }),
    }))
    .filter(
      (course) =>
        course.status !== 'ready' ||
        course.visible.length > 0 ||
        course.assignmentError ||
        course.quizError ||
        (filter === 'all' && course.items.length === 0),
    );

  return (
    <>
      <div className={styles.summary} aria-label="成績摘要">
        <div className={styles.metric}>
          <span>已評分／已公布回饋</span>
          <strong>{summary.graded}</strong>
        </div>
        <div className={styles.metric}>
          <span>等待公布</span>
          <strong>{summary.waiting}</strong>
        </div>
        <div className={styles.metric}>
          <span>缺交</span>
          <strong>{summary.missing}</strong>
        </div>
        <div className={styles.metric}>
          <span>未讀</span>
          <strong>{summary.unread}</strong>
        </div>
      </div>
      <div className={styles.filters} role="group" aria-label="篩選成績狀態">
        {FILTERS.map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={filter === value}
            onClick={() => onFilter(value)}
          >
            {gradeFilterLabel(value)}
            {value === 'unread'
              ? ` ${summary.unread}`
              : value === 'graded'
                ? ` ${summary.graded}`
                : value === 'waiting'
                  ? ` ${summary.waiting}`
                  : value === 'missing'
                    ? ` ${summary.missing}`
                    : ''}
          </button>
        ))}
      </div>
      {nuni?.listError ? (
        <p className={styles.notice} role="alert">
          課程空間名單還沒讀到：{nuni.listError}
        </p>
      ) : null}
      {school?.listError ? (
        <p className={styles.notice} role="alert">
          學校課程名單還沒讀到：{school.listError}
        </p>
      ) : null}
      {!courses.length && !nuni?.listError && !school?.listError ? (
        <p className={styles.empty} role="status">
          {GRADE_COPY.emptyCourses}
          <Link href="/classroom">加入 nuni 課程</Link>
        </p>
      ) : null}
      {visibleCourses.map((course) => (
        <CourseSection
          key={`${course.source}-${course.courseId}`}
          course={course}
          items={course.visible}
          ownerId={ownerId}
          nuniAccountId={nuniAccountId}
          schoolUid={schoolUid}
          hydrated={hydrated}
          filter={filter}
          onOpen={onOpen}
        />
      ))}
      {courses.length > 0 && visibleCourses.length === 0 ? (
        <p className={styles.empty} role="status">
          {GRADE_COPY.emptyFilter}
        </p>
      ) : null}
      <p className={styles.note}>{GRADE_COPY.note}</p>
    </>
  );
}

function CourseSection({
  course,
  items,
  ownerId,
  nuniAccountId,
  schoolUid,
  hydrated,
  filter,
  onOpen,
}: {
  course: CourseGradeSection & { visible: GradeItem[] };
  items: GradeItem[];
  ownerId?: string;
  nuniAccountId?: string | null;
  schoolUid?: string | null;
  hydrated: boolean;
  filter: GradeFilter;
  onOpen: (item: GradeItem, ownerId: string) => void;
}) {
  return (
    <section
      className={styles.course}
      aria-labelledby={`course-${course.source}-${course.courseId}`}
    >
      <div className={styles.courseHeader}>
        <div>
          <h2 id={`course-${course.source}-${course.courseId}`}>{course.courseName}</h2>
          <p className={styles.muted}>
            來源：nuni 課程{course.source === 'school' ? '（學校課程空間）' : ''} · 本次讀取：{course.checkedAt ? formatTaipeiDateTime(course.checkedAt, { seconds: false }) : '尚未確認'}
            {course.archived ? ' · 已封存' : ''}
          </p>
        </div>
        <Link href={course.href}>開啟課程</Link>
      </div>
      {course.status !== 'ready' ? (
        <p className={styles.notice} role="alert">
          {course.error || GRADE_COPY.courseFailed}
        </p>
      ) : null}
      {course.assignmentError ? (
        <p className={styles.notice} role="alert">
          {course.assignmentError}
        </p>
      ) : null}
      {course.quizError ? (
        <p className={styles.notice} role="alert">
          {course.quizError}
        </p>
      ) : null}
      {course.status === 'ready' &&
      !items.length &&
      filter === 'all' &&
      !course.assignmentError &&
      !course.quizError ? (
        <p className={styles.muted} role="status">
          {GRADE_COPY.emptyItems}
        </p>
      ) : null}
      {items.length ? (
        <ul className={styles.list}>
          {items.map((item) => (
            <GradeRow
              key={gradeRowKey(item)}
              item={item}
              ownerId={gradeOwnerForSource(item.source, nuniAccountId, schoolUid) || ownerId || ''}
              hydrated={hydrated}
              onOpen={onOpen}
            />
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function gradeRowKey(item: GradeItem) {
  return `${item.source}-${item.courseId}-${item.kind}-${item.id}`;
}

function GradeRow({
  item,
  ownerId,
  hydrated,
  onOpen,
}: {
  item: GradeItem;
  ownerId: string;
  hydrated: boolean;
  onOpen: (item: GradeItem, ownerId: string) => void;
}) {
  const unread = hydrated && isPublishedGradeUnread(ownerId, item);
  const when = item.publishedAt || item.submittedAt;
  return (
    <li>
      <Link href={item.href} className={styles.row} onClick={() => onOpen(item, ownerId)}>
        <span>
          <strong>{item.title}</strong>
          <span className={styles.meta}>
            {gradeStatusLabel(item)}
            {item.staleFeedback ? ' · 早於最近繳交' : ''}
          </span>
          {item.submissionPreview ? (
            <span className={styles.preview}>你交的內容：{item.submissionPreview}</span>
          ) : item.status === 'missing' ? (
            <span className={styles.preview}>還沒看到你的繳交紀錄。</span>
          ) : null}
          {item.feedback ? <span className={styles.preview}>老師評語：{item.feedback}</span> : null}
          {!when && <span className={styles.meta}>紀錄更新時間：未知</span>}
          {when && hydrated ? (
            <span className={styles.meta}>
              {item.publishedAt ? '回饋公布：' : '最近繳交：'}<time dateTime={when}>{formatTaipeiDateTime(when, { seconds: false })}</time>
            </span>
          ) : null}
        </span>
        <span className={styles.badges}>
          {unread ? <span className={styles.unread}>{GRADE_COPY.unread}</span> : null}
          <span className={styles.kind}>{item.kind === 'quiz' ? '測驗' : '作業'}</span>
        </span>
      </Link>
    </li>
  );
}

export function StudentGradesPage() {
  const hydrated = useClientHydrated();
  const nuni = useNuniSession();
  const { user, loading: authLoading } = useAuth();
  const online = useOnline();
  const [filter, setFilter] = useState<GradeFilter>('all');
  const [nuniResult, setNuniResult] = useState<{ owner: string; book: StudentGradebook } | null>(
    null,
  );
  const [schoolResult, setSchoolResult] = useState<{
    owner: string;
    book: StudentGradebook;
  } | null>(null);
  const [schoolLoading, setSchoolLoading] = useState(false);
  const [nuniLoading, setNuniLoading] = useState(false);
  const generation = useRef(0);
  const nuniAccount = hydrated ? nuni.session?.platformAccountId : undefined;
  const nuniContext = hydrated ? nuni.session?.context : undefined;
  const refreshNuni = nuni.refresh;
  const uid = hydrated ? user?.uid : undefined;
  const owner = `${nuniContext ?? ''}:${nuniAccount ?? ''}:${uid ?? ''}`;
  const nuniBook = nuniResult?.owner === owner ? nuniResult.book : null;
  const schoolBook = schoolResult?.owner === owner ? schoolResult.book : null;
  const signedIn = (!!nuniAccount && !!nuniContext) || !!uid;
  const sessionLoading = !hydrated || nuni.loading || authLoading;
  const blocked = nuni.pendingLogout || (!!nuni.error && !nuniAccount && !uid);

  const load = useCallback(async () => {
    const request = ++generation.current;
    const schoolLoad = async () => {
      if (!uid) {
        setSchoolResult(null);
        setSchoolLoading(false);
        return;
      }
      setSchoolLoading(true);
      try {
        const book = await loadSchoolStudentGrades(uid, { online });
        if (request === generation.current) setSchoolResult({ owner, book });
      } catch {
        if (request === generation.current)
          setSchoolResult({
            owner,
            book: {
              teachingCount: 0,
              courses: [],
              listError: GRADE_COPY.offline,
            },
          });
      } finally {
        if (request === generation.current) setSchoolLoading(false);
      }
    };
    const schoolRequest = schoolLoad();
    if (nuniAccount && nuniContext) {
      setNuniLoading(true);
      try {
        const next = await loadNuniStudentGrades(
          (path, input) => browserRequest(path, nuniContext, input),
          nuniAccount,
          { online },
        );
        if (request === generation.current) setNuniResult({ owner, book: next });
      } catch (error) {
        if (request !== generation.current) return;
        if (isNuniSessionError(error)) void refreshNuni();
        setNuniResult({
          owner,
          book: {
            teachingCount: 0,
            courses: [],
            listError: error instanceof NuniError ? GRADE_COPY.denied : GRADE_COPY.offline,
          },
        });
      } finally {
        if (request === generation.current) setNuniLoading(false);
      }
    } else {
      setNuniResult(null);
      setNuniLoading(false);
    }
    await schoolRequest;
  }, [nuniAccount, nuniContext, online, refreshNuni, uid, owner]);

  useEffect(() => {
    if (sessionLoading || blocked) return;
    void load();
    return () => {
      generation.current += 1;
    };
  }, [load, sessionLoading, blocked]);

  const busy = sessionLoading || nuniLoading || schoolLoading;
  const teachingOnly =
    signedIn &&
    !busy &&
    (nuniBook?.teachingCount ?? 0) + (schoolBook?.teachingCount ?? 0) > 0 &&
    !nuniBook?.courses.length &&
    !schoolBook?.courses.length;

  const openItem = useCallback((item: GradeItem, itemOwner: string) => {
    if (itemOwner) markPublishedGradeRead(itemOwner, item);
  }, []);

  return (
    <SiteShell>
      <div className={styles.page}>
        <GradesTabs active="feedback" />
        <p className={styles.notice}>
          課程成績與回饋優先顯示 nuni，並保留既有課程資料；學校成績請切換至學期成績。
          <Link href="/classroom">前往 nuni 課程</Link>
        </p>
        <div className={styles.heading}>
          <div>
            <p className={styles.eyebrow}>課程空間</p>
            <h1>{LMS_GRADES_TITLE}</h1>
            <p className={styles.lead}>
              各門課目前的成績、等待公布與缺交，點一筆就到作業回饋與你交的內容。
            </p>
          </div>
          <div className={styles.toolbar}>
            {signedIn ? (
              <button
                type="button"
                className={`${styles.button} ${styles.secondary}`}
                onClick={() => void load()}
                disabled={busy}
              >
                {busy ? '更新中…' : '更新成績'}
              </button>
            ) : null}
            <Link href="/classroom" className={`${styles.button} ${styles.secondary}`}>
              我的課程
            </Link>
          </div>
        </div>
        {!online ? (
          <p className={styles.notice} role="alert">
            {GRADE_COPY.offline}
          </p>
        ) : null}
        {blocked ? (
          <p className={styles.notice} role="alert">
            {nuni.pendingLogout ? '登出尚未完成，請重試登出後再查看成績。' : nuni.error}
          </p>
        ) : sessionLoading ? (
          <p role="status">{GRADE_COPY.loading}</p>
        ) : !signedIn ? (
          <section className={shared.panel}>
            <h2>登入後查看成績</h2>
            <p className={styles.muted}>{GRADE_COPY.unsigned}</p>
            <NuniSignIn returnUrl={LMS_GRADES_HREF} />
          </section>
        ) : busy && !nuniBook && !schoolBook ? (
          <div aria-busy="true">
            <p role="status">{GRADE_COPY.loading}</p>
            <div className={styles.skeleton} aria-hidden="true">
              <span />
              <span />
              <span />
            </div>
          </div>
        ) : teachingOnly ? (
          <p className={styles.empty} role="status">
            {GRADE_COPY.teacherOnly}
          </p>
        ) : (
          <StudentGradesBoard
            nuni={nuniBook}
            school={schoolBook}
            nuniAccountId={nuniAccount}
            schoolUid={uid}
            filter={filter}
            onFilter={setFilter}
            onOpen={openItem}
          />
        )}
      </div>
    </SiteShell>
  );
}
