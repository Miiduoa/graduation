'use client';

import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { PERIOD_TIMES, WEEKDAY_LABELS, type PersonalCourse } from '@campus/shared';
import { ConfirmModal, Modal } from '@/components/ui/Modal';
import { draftConflicts, hasCourseChanges, validateCourseDraft, type CourseIssues } from './courseEditorModel';
import styles from './timetable.module.css';

type CourseEditorProps = {
  course: PersonalCourse;
  courses: PersonalCourse[];
  existing: boolean;
  busy: boolean;
  feedback: string;
  onChange: (course: PersonalCourse) => void;
  onSave: () => void;
  onRemove: () => void;
  onCancel: () => void;
};

export function CourseEditor({ course, courses, existing, busy, feedback, onChange, onSave, onRemove, onCancel }: CourseEditorProps) {
  const [initial] = useState(course);
  const [submitted, setSubmitted] = useState(false);
  const [confirmation, setConfirmation] = useState<'delete' | 'discard' | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const id = useId();
  const dirty = hasCourseChanges(initial, course);
  const issues = validateCourseDraft(course, PERIOD_TIMES.length, WEEKDAY_LABELS.length);
  const conflicts = draftConflicts(course, courses, PERIOD_TIMES.length, WEEKDAY_LABELS.length);
  const visibleIssues: CourseIssues = submitted ? issues : {};

  useEffect(() => {
    if (!dirty && !busy) return;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [dirty, busy]);

  function requestClose() {
    if (busy) return;
    if (dirty) setConfirmation('discard');
    else onCancel();
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || confirmation) return;
    setSubmitted(true);
    const field = Object.keys(issues)[0];
    if (field) {
      const control = formRef.current?.elements.namedItem(field);
      if (control instanceof HTMLElement) control.focus();
      return;
    }
    onSave();
  }

  return (
    <>
      <Modal
        isOpen
        title={existing ? '編輯課程' : '新增課程'}
        description="這裡只編輯個人課表，不會變更學校的選課紀錄。"
        onClose={requestClose}
        initialFocusRef={nameRef}
        closeOnEsc={!busy && !confirmation}
        closeOnOverlayClick={false}
        showCloseButton={!busy}
        size="lg"
      >
        <section aria-label="編輯課程">
          <form ref={formRef} onSubmit={submit} noValidate className={styles.editor}>
            <fieldset disabled={busy} className={styles.fields}>
              <legend className={styles.srOnly}>課程資料</legend>
              <label className={`${styles.field} ${styles.fullWidth}`}>
                課名
                <input ref={nameRef} disabled={busy} name="name" value={course.name} required maxLength={100} autoComplete="off"
                  aria-invalid={Boolean(visibleIssues.name)} aria-describedby={visibleIssues.name ? `${id}-name-error` : undefined}
                  placeholder="例如：資料庫管理"
                  onChange={(event) => onChange({ ...course, name: event.target.value })} />
                {visibleIssues.name && <span id={`${id}-name-error`} className={styles.error}>{visibleIssues.name}</span>}
              </label>
              <label className={`${styles.field} ${styles.fullWidth}`}>
                星期
                <select name="day" value={course.day} aria-invalid={Boolean(visibleIssues.day)}
                  aria-describedby={visibleIssues.day ? `${id}-day-error` : undefined}
                  onChange={(event) => onChange({ ...course, day: Number(event.target.value), start: course.start || 1, end: course.end || course.start || 1 })}>
                  <option value={0}>未排定</option>
                  {WEEKDAY_LABELS.map((label, index) => <option key={label} value={index + 1}>{label}</option>)}
                </select>
                {visibleIssues.day && <span id={`${id}-day-error`} className={styles.error}>{visibleIssues.day}</span>}
              </label>
              <label className={styles.field}>
                開始節次
                <select name="start" disabled={course.day === 0} value={course.start || 1}
                  aria-invalid={Boolean(visibleIssues.start)} aria-describedby={visibleIssues.start ? `${id}-start-error` : undefined}
                  onChange={(event) => onChange({ ...course, start: Number(event.target.value) })}>
                  {PERIOD_TIMES.map((time, index) => <option key={time[0]} value={index + 1}>第 {index + 1} 節 · {time[0]}</option>)}
                </select>
                {visibleIssues.start && <span id={`${id}-start-error`} className={styles.error}>{visibleIssues.start}</span>}
              </label>
              <label className={styles.field}>
                結束節次
                <select name="end" disabled={course.day === 0} value={course.end || course.start || 1}
                  aria-invalid={Boolean(visibleIssues.end)} aria-describedby={visibleIssues.end ? `${id}-end-error` : undefined}
                  onChange={(event) => onChange({ ...course, end: Number(event.target.value) })}>
                  {PERIOD_TIMES.map((time, index) => <option key={time[1]} value={index + 1}>第 {index + 1} 節 · {time[1]}</option>)}
                </select>
                {visibleIssues.end && <span id={`${id}-end-error`} className={styles.error}>{visibleIssues.end}</span>}
              </label>
              <label className={styles.field}>老師<input name="teacher" maxLength={80} value={course.teacher} onChange={(event) => onChange({ ...course, teacher: event.target.value })} /></label>
              <label className={styles.field}>教室<input name="room" maxLength={80} value={course.room} placeholder="例如：主顧303" onChange={(event) => onChange({ ...course, room: event.target.value })} /></label>
            </fieldset>
            {course.day === 0 && <p className={styles.hint}>儲存後會保留在「待排時間」，不會排入格子課表。</p>}
            {conflicts.length > 0 && <div className={styles.warning} aria-live="polite"><strong>這個時段已有其他課程</strong><p>{conflicts.map((item) => item.name).join('、')}。仍可儲存，原有課程不會被取代。</p></div>}
            {submitted && Object.keys(issues).length > 0 && <p role="alert" className={styles.error}>請先修正標示的欄位，再儲存課程。</p>}
            {feedback && <p role="status" className={styles.feedback}>{feedback}</p>}
            {busy && <p className={styles.hint} aria-live="polite">正在儲存，請勿重複送出。</p>}
            <div className={styles.editorActions}>
              {existing && <button type="button" className={styles.deleteButton} disabled={busy} onClick={() => setConfirmation('delete')}>刪除</button>}
              <div className={styles.saveActions}>
                <button type="button" className="btn" disabled={busy} onClick={requestClose}>取消</button>
                <button type="submit" className="btn primary" disabled={busy}>儲存</button>
              </div>
            </div>
          </form>
        </section>
      </Modal>
      <ConfirmModal
        isOpen={confirmation !== null}
        title={confirmation === 'delete' ? '刪除這門課？' : '放棄這次修改？'}
        message={confirmation === 'delete' ? `「${initial.name}」會從個人課表移除，不會辦理學校退選。` : '尚未儲存的內容會被捨棄，原有課表不變。'}
        confirmText={confirmation === 'delete' ? '確認刪除' : '放棄修改'}
        cancelText={confirmation === 'delete' ? '保留課程' : '繼續編輯'}
        variant="danger"
        loading={busy}
        onClose={() => { if (!busy) setConfirmation(null); }}
        onConfirm={() => {
          if (busy) return;
          if (confirmation === 'delete') { setConfirmation(null); onRemove(); }
          else if (confirmation === 'discard') onCancel();
        }}
      />
    </>
  );
}
