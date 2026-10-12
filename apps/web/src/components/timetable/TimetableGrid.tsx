'use client';

import { useId } from 'react';
import { cleanCourse, courseTimeLabel, PERIOD_TIMES, WEEKDAY_LABELS, type PersonalCourse } from '@campus/shared';
import { coursesAtSlot, isPlacedCourse } from './courseEditorModel';
import styles from './timetable.module.css';

type CourseActions = {
  courses: PersonalCourse[];
  disabled: boolean;
  onEdit: (course: PersonalCourse) => void;
};

export function TimetableGrid({ courses, disabled, onEdit }: CourseActions) {
  const hintId = useId();
  return (
    <>
      <p id={hintId} className={styles.hint}>點選空白格新增課程，點選課程編輯。連續節次會標示續堂；窄螢幕可左右捲動查看。</p>
      <div className={styles.gridViewport} role="region" aria-label="課表捲動區" aria-describedby={hintId} tabIndex={0}>
        <table className={styles.grid}>
          <caption className={styles.srOnly}>一週格子課表</caption>
          <thead>
            <tr><th scope="col">節次</th>{WEEKDAY_LABELS.map((label) => <th scope="col" key={label}>{label}</th>)}</tr>
          </thead>
          <tbody>
            {PERIOD_TIMES.map((time, index) => {
              const period = index + 1;
              return (
                <tr key={period}>
                  <th scope="row" className={styles.period}><strong>第 {period} 節</strong><span>{time[0]}</span><span>{time[1]}</span></th>
                  {WEEKDAY_LABELS.map((label, dayIndex) => {
                    const day = dayIndex + 1;
                    const entries = coursesAtSlot(courses, day, period, PERIOD_TIMES.length, WEEKDAY_LABELS.length);
                    return (
                      <td key={day} className={entries.length > 1 ? styles.overlapCell : undefined}>
                        {entries.length > 1 && <span className={styles.overlapLabel}>同時有 {entries.length} 門課</span>}
                        {entries.length ? entries.map((course) => (
                          <button
                            type="button"
                            key={course.id}
                            className={`${styles.course} ${period > course.start ? styles.continuation : ''}`}
                            disabled={disabled}
                            aria-label={`編輯 ${course.name}，${label}第 ${period} 節${period > course.start ? '，續堂' : ''}`}
                            onClick={() => onEdit(course)}
                          >
                            <strong>{course.name}</strong>
                            <span>{period > course.start ? '續堂' : courseTimeLabel(course)}</span>
                            {course.room && period === course.start && <span>{course.room}</span>}
                          </button>
                        )) : (
                          <button
                            type="button"
                            className={styles.addSlot}
                            disabled={disabled}
                            aria-label={`${label}第 ${period} 節新增課程`}
                            onClick={() => onEdit({ ...cleanCourse({ day, start: period, end: period }), name: '' })}
                          ><span aria-hidden="true">＋</span></button>
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

export function UnscheduledCourses({ courses, disabled, onEdit }: CourseActions) {
  const pending = courses.filter((course) => !isPlacedCourse(course, PERIOD_TIMES.length, WEEKDAY_LABELS.length));
  if (!pending.length) return null;
  return (
    <section className={styles.unscheduled} aria-label="待排時間的課程">
      <h2>待排時間 <span>({pending.length})</span></h2>
      <p className={styles.hint}>這些課程仍保留在課表中，尚未列入空堂計算。點選課程補上時間。</p>
      <div className={styles.pendingList}>
        {pending.map((course) => (
          <button type="button" key={course.id} className={styles.course} disabled={disabled} onClick={() => onEdit(course)}>
            <strong>{course.name}</strong><span>{course.teacher || '教師未填'} · {course.room || '教室未填'}</span><span>安排時間</span>
          </button>
        ))}
      </div>
    </section>
  );
}
