'use client';

import { use, useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { SiteShell } from '@/components/SiteShell';
import { useAuth } from '@/components/AuthGuard';
import {
  loadCourseWork,
  submitCourseText,
  type CourseAssignment,
  type CourseWork,
} from '@/lib/courseWork';
import styles from '../../home.module.css';

function Assignment({
  assignment,
  courseId,
  uid,
  canTeach,
  onSaved,
}: {
  assignment: CourseAssignment;
  courseId: string;
  uid: string;
  canTeach: boolean;
  onSaved: () => void;
}) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, []);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const submitted = saved || !!assignment.submittedAt;
  const closed =
    assignment.closed ||
    (!!assignment.dueAt &&
      now !== null &&
      Date.parse(assignment.dueAt) < now &&
      !assignment.allowLateSubmission);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError('');
    try {
      await submitCourseText(courseId, assignment.id, uid, text);
      setSaved(true);
      onSaved();
    } catch {
      setError('未能確認繳交結果。內容已保留；請重新整理確認紀錄，或稍後重試。');
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  return (
    <section className={styles.section} id={`assignment-${assignment.id}`}>
      <div className={styles.sectionHeading}>
        <h2>{assignment.title}</h2>
        <span>
          {assignment.dueAt
            ? new Date(assignment.dueAt).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' })
            : '未設截止時間'}
        </span>
      </div>
      <p style={{ whiteSpace: 'pre-wrap' }}>{assignment.description || '教師尚未填寫作業說明。'}</p>
      {submitted ? (
        <div role="status">
          <p>
            已繳交
            {assignment.submittedAt
              ? ` · ${new Date(assignment.submittedAt).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' })}`
              : ''}
          </p>
          <p style={{ whiteSpace: 'pre-wrap' }}>{assignment.submittedText ?? text}</p>
          {assignment.grade ? (
            <div
              aria-label="作業評分"
              style={{ borderTop: '1px solid var(--border)', marginTop: 18, paddingTop: 16 }}
            >
              <strong>
                教師已評分：{assignment.grade.score}
                {assignment.points !== null ? ` / ${assignment.points}` : ''} 分
              </strong>
              {assignment.grade.revisionCount > 0 ? (
                <p>此筆評分已更正 {assignment.grade.revisionCount} 次，顯示目前已發布的結果。</p>
              ) : null}
              {assignment.grade.feedback ? (
                <p style={{ whiteSpace: 'pre-wrap' }}>{assignment.grade.feedback}</p>
              ) : null}
              {assignment.grade.publishedAt ? (
                <p>
                  發布時間：
                  {new Date(assignment.grade.publishedAt).toLocaleString('zh-TW', {
                    timeZone: 'Asia/Taipei',
                  })}
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : canTeach ? (
        <p>此為教師檢視。</p>
      ) : ['quiz', 'exam'].includes(assignment.type) ? (
        <p>請在 Campus One 手機版的課程評量中作答。</p>
      ) : closed ? (
        <p>作業已截止。如需補交，請聯絡授課教師。</p>
      ) : (
        <form onSubmit={submit}>
          <label htmlFor={`answer-${assignment.id}`}>文字作業內容</label>
          <textarea
            id={`answer-${assignment.id}`}
            value={text}
            onChange={(e) => setText(e.target.value)}
            required
            maxLength={20000}
            rows={7}
            disabled={busy}
            style={{
              display: 'block',
              width: '100%',
              margin: '12px 0',
              padding: 14,
              font: 'inherit',
              border: '1px solid var(--border-strong)',
              borderRadius: 'var(--radius-sm)',
              background: 'var(--surface)',
              color: 'var(--text)',
            }}
          />
          {error && <p role="alert">{error}</p>}
          <button type="submit" className={styles.primary} disabled={busy || !text.trim()}>
            {busy ? '繳交中…' : '繳交作業'}
          </button>
        </form>
      )}
    </section>
  );
}

export default function CoursePage({ params }: { params: Promise<{ courseId: string }> }) {
  const { courseId } = use(params);
  const { user, loading: authLoading } = useAuth();
  const uid = user?.uid;
  const [result, setResult] = useState<{ uid: string; course: CourseWork } | null>(null);
  const [error, setError] = useState('');
  const generation = useRef(0);
  const course = result?.uid === user?.uid && result?.course.id === courseId ? result.course : null;
  const load = useCallback(async () => {
    const request = ++generation.current;
    // A refresh must not leave previously authorized student records on screen.
    setResult(null);
    if (!uid) return;
    setError('');
    try {
      const next = await loadCourseWork(courseId, uid);
      if (request === generation.current) setResult({ uid, course: next });
    } catch {
      if (request === generation.current)
        setError('無法讀取課程。請確認連線與課程成員資格後重試。');
    }
  }, [courseId, uid]);
  useEffect(() => {
    void load();
    return () => {
      generation.current += 1;
    };
  }, [load]);
  const visibleCourse = authLoading ? null : course;
  return (
    <SiteShell
      title={visibleCourse?.name ?? '課程內容'}
      subtitle={visibleCourse?.description || '查看課程教材、作業與出席紀錄。'}
      schoolName={visibleCourse ? (visibleCourse.canTeach ? '教學課程' : '修習課程') : undefined}
    >
      {authLoading ? (
        <p role="status">確認登入狀態…</p>
      ) : !user ? (
        <section className={styles.section}>
          <h2>登入後查看課程</h2>
          <p>使用這門課的校園帳號登入，即可查看教材與繳交作業。</p>
          <Link
            className={styles.primary}
            href={`/login?redirect=${encodeURIComponent(`/course/${courseId}`)}`}
          >
            登入帳號
          </Link>
        </section>
      ) : (
        <>
          {error && (
            <div role="alert">
              {error}
              <button type="button" onClick={load}>
                重試
              </button>
            </div>
          )}
          {!course && !error && <p role="status">讀取課程…</p>}
          {course && (
            <>
              <div className={styles.heading}>
                <Link
                  href={`/course/${encodeURIComponent(courseId)}/attendance`}
                  className={styles.secondary}
                >
                  {course.canTeach ? '管理課堂點名' : '簽到與出席紀錄'}
                </Link>
                <button type="button" className={styles.secondary} onClick={load}>
                  重新整理
                </button>
              </div>
              <section className={styles.section}>
                <h2>課程單元</h2>
                {course.modules.length ? (
                  course.modules.map((module) => (
                    <article key={module.id} className={styles.section}>
                      <h3>{module.title}</h3>
                      <p style={{ whiteSpace: 'pre-wrap' }}>{module.description}</p>
                      {module.resourceUrl && (
                        <a
                          href={module.resourceUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={styles.secondary}
                        >
                          {module.resourceLabel} ↗
                        </a>
                      )}
                    </article>
                  ))
                ) : (
                  <p>尚未發布課程單元。</p>
                )}
              </section>
              <h2 id="assignments" className={styles.section}>
                作業與評量
              </h2>
              {course.assignments.length ? (
                course.assignments.map((assignment) => (
                  <Assignment
                    key={`${user.uid}-${courseId}-${assignment.id}`}
                    assignment={assignment}
                    courseId={courseId}
                    uid={user.uid}
                    canTeach={course.canTeach}
                    onSaved={() => void load()}
                  />
                ))
              ) : (
                <p>尚未發布作業。</p>
              )}
            </>
          )}
        </>
      )}
    </SiteShell>
  );
}
