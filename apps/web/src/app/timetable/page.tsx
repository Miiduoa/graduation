'use client';

import { useMemo, useState } from 'react';
import { AcademicPage } from '@/components/academic/AcademicPage';
import {
  findScheduleConflicts,
  formatSemester,
  type AcademicCourse,
  type AcademicCourseResponse,
} from '@/lib/academicRecords';
import styles from '@/components/academic/academic.module.css';

const DAYS = ['一', '二', '三', '四', '五', '六', '日'];
function courseTime(course: AcademicCourse) {
  const hasGaps = course.periods.some(
    (period, index) => index > 0 && period !== course.periods[index - 1] + 1,
  );
  if (hasGaps) return `第 ${course.periods.join('、')} 節`;
  if (course.startTime && course.endTime) return `${course.startTime}–${course.endTime}`;
  if (course.periods.length) return `第 ${course.periods.join('、')} 節`;
  return '時間待確認';
}
function CourseCard({ course }: { course: AcademicCourse }) {
  return (
    <article className={styles.course}>
      <time>{courseTime(course)}</time>
      <h4>{course.name}</h4>
      <p>{course.location || '教室待確認'}</p>
      <p>{course.teacherName || '教師資料未提供'}</p>
      <p>
        {course.code} · {course.credits} 學分
      </p>
      {course.scheduleWarning && (
        <p>
          {course.scheduleWarning}
          {course.timePlaceRaw ? `：${course.timePlaceRaw}` : ''}
        </p>
      )}
    </article>
  );
}
function Timetable({ records }: { records: AcademicCourseResponse }) {
  const [view, setView] = useState<'week' | 'list'>('week');
  const [day, setDay] = useState('all');
  const [search, setSearch] = useState('');
  const courses = useMemo(
    () =>
      records.courses
        .filter(
          (course) =>
            (day === 'all' || String(course.dayOfWeek) === day) &&
            [course.name, course.code, course.teacherName, course.location]
              .join(' ')
              .toLocaleLowerCase()
              .includes(search.trim().toLocaleLowerCase()),
        )
        .sort(
          (a, b) =>
            (a.dayOfWeek ?? 8) - (b.dayOfWeek ?? 8) ||
            (a.startTime ?? '99:99').localeCompare(b.startTime ?? '99:99') ||
            (a.periods[0] ?? 99) - (b.periods[0] ?? 99),
        ),
    [records, day, search],
  );
  const conflicts = useMemo(() => findScheduleConflicts(records.courses), [records]);
  const unknown = records.courses.filter((course) => course.scheduleWarning || !course.dayOfWeek);
  return (
    <>
      <div className={styles.overview}>
        <div className={styles.metric}>
          <p>來源學期</p>
          <strong>{formatSemester(records.semester)}</strong>
          <small>依學校目前提供的選課紀錄</small>
        </div>
        <div className={styles.metric}>
          <p>修課科目</p>
          <strong>{records.courses.length}</strong>
          <small>已讀取的課程筆數</small>
        </div>
        <div className={styles.metric}>
          <p>修課學分</p>
          <strong>{records.totalCredits}</strong>
          <small>依課程紀錄加總</small>
        </div>
      </div>
      {conflicts.length > 0 && (
        <section className={styles.warning} aria-label="課程時間重疊">
          <strong>有 {conflicts.length} 組課程時間重疊</strong>
          <ul>
            {conflicts.map(({ first, second, dayOfWeek }) => (
              <li key={`${first.id}-${second.id}`}>
                週{DAYS[dayOfWeek - 1]}：{first.name}、{second.name}
              </li>
            ))}
          </ul>
          請核對學校選課紀錄，這裡不會替你加退選。
        </section>
      )}
      {unknown.length > 0 && (
        <p className={styles.note}>
          有 {unknown.length} 門課的上課時間尚待確認；請查看原始上課資訊，避免漏掉跨日或分段課程。
        </p>
      )}
      <div className={styles.toolbar}>
        <div className={styles.segment} aria-label="課表顯示方式">
          <button aria-pressed={view === 'week'} onClick={() => setView('week')}>
            一週課表
          </button>
          <button aria-pressed={view === 'list'} onClick={() => setView('list')}>
            課程清單
          </button>
        </div>
        <label className={styles.field}>
          搜尋課程
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="科目、教師或教室"
          />
        </label>
        <label className={styles.field}>
          上課日
          <select value={day} onChange={(event) => setDay(event.target.value)}>
            <option value="all">全部日期</option>
            {DAYS.map((name, index) => (
              <option value={index + 1} key={name}>
                星期{name}
              </option>
            ))}
          </select>
        </label>
      </div>
      {!records.courses.length ? (
        <p className={styles.empty}>
          學校這次回傳的選課清單是空的。如已完成選課，請至 e 校園確認。
        </p>
      ) : !courses.length ? (
        <p className={styles.empty}>沒有符合條件的課程，試試其他日期或關鍵字。</p>
      ) : view === 'week' ? (
        <>
          <div className={styles.week}>
            {DAYS.map((name, index) => {
              if (day !== 'all' && day !== String(index + 1)) return null;
              const entries = courses.filter((course) => course.dayOfWeek === index + 1);
              return (
                <section className={styles.day} key={name}>
                  <h3>星期{name}</h3>
                  {entries.length ? (
                    entries.map((course) => <CourseCard key={course.id} course={course} />)
                  ) : (
                    <p className={styles.empty}>{unknown.length ? '無已確認時段' : '無排定課程'}</p>
                  )}
                </section>
              );
            })}
          </div>
          {courses.some((course) => !course.dayOfWeek) && (
            <section className={styles.section}>
              <h2>上課日待確認</h2>
              {courses
                .filter((course) => !course.dayOfWeek)
                .map((course) => (
                  <CourseCard key={course.id} course={course} />
                ))}
            </section>
          )}
        </>
      ) : (
        <ul className={styles.list}>
          {courses.map((course) => (
            <li key={course.id}>
              <div>
                <h3>{course.name}</h3>
                <p>
                  {course.code} · {course.teacherName || '教師待確認'} · {course.credits} 學分
                </p>
                <p>
                  {course.dayOfWeek ? `星期${DAYS[course.dayOfWeek - 1]} · ` : ''}
                  {courseTime(course)} · {course.location || '教室待確認'}
                </p>
                {course.scheduleWarning && (
                  <p>
                    {course.scheduleWarning}：{course.timePlaceRaw || '學校未提供上課資訊'}
                  </p>
                )}
              </div>
              <span>{course.courseType}</span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
export default function TimetablePage() {
  return (
    <AcademicPage kind="courses" title="我的課表" subtitle="先看今天去哪上課，再安排這一週。">
      {({ records }) => <Timetable records={records} />}
    </AcademicPage>
  );
}
