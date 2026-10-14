'use client';

import { useId, useRef, useState } from 'react';
import { cleanCourse, courseTimeLabel, PERIOD_TIMES, WEEKDAY_LABELS, type PersonalCourse } from '@campus/shared';
import { coursesAtSlot, hasCourseChanges, isPlacedCourse } from './courseEditorModel';
import { moveCourseToSlot } from './timetableMovement';
import styles from './timetable.module.css';
import movement from './timetableMovement.module.css';

type CourseActions = {
  courses: PersonalCourse[];
  disabled: boolean;
  onEdit: (course: PersonalCourse) => void;
};
type MovingCourse = { course: PersonalCourse; offset: number };
type Slot = { day: number; period: number };

export function TimetableGrid({ courses, disabled, onEdit }: CourseActions) {
  const hintId = useId();
  const toolsId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [choosing, setChoosing] = useState(false);
  const [selected, setSelected] = useState<MovingCourse | null>(null);
  const [dragged, setDragged] = useState<MovingCourse | null>(null);
  const [target, setTarget] = useState<Slot | null>(null);
  const [message, setMessage] = useState('');
  // Imported timetable rows are reference data; moving them must happen in the import editor.
  const placed = courses.filter(
    (course) => isPlacedCourse(course, PERIOD_TIMES.length, WEEKDAY_LABELS.length) && !course.id.startsWith('import:'),
  );
  const moving = disabled ? null : dragged || (choosing ? selected : null);
  const original = moving && courses.find((course) => course.id === moving.course.id);
  const current = original && moving && !hasCourseChanges(moving.course, original) ? moving : null;
  const preview = current && target
    ? moveCourseToSlot(current.course, target.day, target.period - current.offset, PERIOD_TIMES.length, WEEKDAY_LABELS.length)
    : null;

  function cancelMove() {
    setChoosing(false);
    setSelected(null);
    setDragged(null);
    setTarget(null);
    setMessage('已取消移動，課表沒有變更。');
    triggerRef.current?.focus();
  }

  function placeAt(day: number, period: number) {
    if (disabled || !moving) return;
    if (!current) {
      setMessage('課程資料已變更，請重新選擇要移動的課程。');
      setDragged(null);
      setSelected(null);
      setTarget(null);
      return;
    }
    const next = moveCourseToSlot(current.course, day, period - current.offset, PERIOD_TIMES.length, WEEKDAY_LABELS.length);
    if (!next.ok) { setMessage(next.message); return; }
    if (!next.changed) { setMessage('這是原本的時段，課表沒有變更。'); return; }
    setChoosing(false);
    setSelected(null);
    setDragged(null);
    setTarget(null);
    // The editor owns the pending change; do not leave a stale hint after cancellation.
    setMessage('');
    triggerRef.current?.focus();
    onEdit(next.course);
  }

  return (
    <>
      <div className={movement.instructions}>
        <p id={hintId} className={styles.hint}>點選空白格新增，點選課程編輯。電腦可拖移手動課程；手機或鍵盤可用「移動課程」。匯入紀錄請到匯入頁修改，所有移動都要確認儲存。</p>
        {placed.length > 0 && <button ref={triggerRef} type="button" className="btn" disabled={disabled}
          aria-expanded={choosing} aria-controls={toolsId}
          onClick={() => { if (choosing) cancelMove(); else { setChoosing(true); setMessage('先選擇課程，再點選課表中的新起始節次。'); } }}>
          {choosing ? '取消移動' : '移動課程'}
        </button>}
      </div>
      {choosing && <div id={toolsId} className={movement.tools}>
        <label>要移動的課程
          <select value={selected?.course.id || ''} disabled={disabled} onChange={(event) => {
            const course = placed.find((item) => item.id === event.target.value);
            setSelected(course ? { course: { ...course }, offset: 0 } : null);
            setTarget(null);
            setMessage(course ? `請在課表選擇「${course.name}」的新起始節次。` : '先選擇要移動的課程。');
          }}>
            <option value="">選擇課程</option>
            {placed.map((course) => <option key={course.id} value={course.id}>{course.name} · {courseTimeLabel(course)}</option>)}
          </select>
        </label>
        <p>選課程 → 選新時段 → 確認儲存。連續節次會一起移動，按 Escape 可取消。</p>
      </div>}
      {(preview && !preview.ok ? preview.message : message) && (
        <p role="status" aria-live="polite" aria-atomic="true" className={movement.status}>
          {preview && !preview.ok ? preview.message : message}
        </p>
      )}
      <div className={styles.gridViewport} role="region" aria-label="課表捲動區" aria-describedby={hintId} tabIndex={0}
        onKeyDown={(event) => { if (event.key === 'Escape' && (choosing || dragged)) { event.preventDefault(); cancelMove(); } }}
        onPointerLeave={() => setTarget(null)}>
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
                    const highlighted = preview?.ok && preview.course.day === day && preview.course.start <= period && preview.course.end >= period;
                    const invalid = preview && !preview.ok && target?.day === day && target.period === period;
                    return (
                      <td key={day} data-day={day} data-period={period}
                        className={[entries.length > 1 ? styles.overlapCell : '', highlighted ? movement.destination : '', invalid ? movement.invalid : ''].filter(Boolean).join(' ')}
                        onDragOver={(event) => {
                          if (!dragged || disabled) return;
                          event.preventDefault();
                          event.dataTransfer.dropEffect = 'move';
                          setTarget({ day, period });
                        }}
                        onDrop={(event) => { if (dragged) { event.preventDefault(); placeAt(day, period); setDragged(null); setTarget(null); } }}>
                        {entries.length > 1 && <span className={styles.overlapLabel}>同時有 {entries.length} 門課</span>}
                        {entries.map((course) => {
                          const imported = course.id.startsWith('import:');
                          const content = <><strong>{course.name}</strong><span>{period > course.start ? '續堂' : courseTimeLabel(course)}</span>{course.room && period === course.start && <span>{course.room}</span>}</>;
                          return current && choosing && !dragged && !imported
                            ? <div key={course.id} className={`${styles.course} ${movement.stationary}`}>{content}</div>
                            : <button type="button" key={course.id}
                                className={`${styles.course} ${period > course.start ? styles.continuation : ''} ${movement.draggable}`}
                                disabled={disabled} draggable={!disabled && !choosing && !imported}
                                aria-label={`${imported ? '檢視匯入紀錄' : '編輯'} ${course.name}，${label}第 ${period} 節${period > course.start ? '，續堂' : ''}`}
                                onClick={() => onEdit(course)}
                                onDragStart={(event) => {
                                  if (disabled || choosing || imported) { event.preventDefault(); return; }
                                  event.dataTransfer.effectAllowed = 'move';
                                  event.dataTransfer.setData('text/plain', course.id);
                                  setDragged({ course: { ...course }, offset: period - course.start });
                                  setMessage(`正在移動「${course.name}」，放開後會開啟確認視窗。`);
                                }}
                                onDragEnd={() => { setDragged(null); setTarget(null); }}>
                                {content}
                              </button>;
                        })}
                        {current && choosing && !dragged ? (
                          <button type="button" className={movement.pickSlot} disabled={disabled}
                            aria-label={`移到${label}第 ${period} 節`}
                            onFocus={() => setTarget({ day, period })} onMouseEnter={() => setTarget({ day, period })}
                            onClick={() => placeAt(day, period)}>移到這裡</button>
                        ) : !entries.length && (
                          <button type="button" className={styles.addSlot} disabled={disabled}
                            aria-label={`${label}第 ${period} 節新增課程`}
                            onClick={() => onEdit({ ...cleanCourse({ day, start: period, end: period }), name: '' })}>
                            <span aria-hidden="true">＋</span>
                          </button>
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
      <p className={styles.hint}>這些課程仍保留在課表中。補齊時間後，才能可靠計算空堂或安排邀約。</p>
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
