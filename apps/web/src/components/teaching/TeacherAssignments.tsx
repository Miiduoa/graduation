'use client';

import { useRef, useState, type FormEvent } from 'react';
import { useAuth } from '@/components/AuthGuard';
import {
  loadTeacherSubmissions,
  newTeacherAssignmentId,
  publishSubmissionGrade,
  publishTeacherAssignment,
  type AssignmentReview,
} from '@/lib/teacherAssignments';
import type { TeacherScope } from '@/lib/teacherCourse';
import styles from './TeacherAssignments.module.css';

type Props = {
  schoolId: string;
  courseId: string;
  assignments: { id: string; title: string }[];
  refresh: () => void;
};

function timeLabel(value: string | null) {
  return value
    ? new Date(value).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' })
    : '時間未提供';
}

function message(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

export function TeacherAssignments({ schoolId, courseId, assignments, refresh }: Props) {
  const { user } = useAuth();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [dueAt, setDueAt] = useState('');
  const [points, setPoints] = useState('100');
  const [allowLateSubmission, setAllowLateSubmission] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [saveSuccess, setSaveSuccess] = useState('');
  const assignmentIdRef = useRef<string | null>(null);
  const savingRef = useRef(false);
  const [reviewId, setReviewId] = useState<string | null>(null);
  const [review, setReview] = useState<AssignmentReview | null>(null);
  const [reviewError, setReviewError] = useState('');
  const [loadingReview, setLoadingReview] = useState(false);
  const [gradeValues, setGradeValues] = useState<Record<string, { score: string; feedback: string }>>({});
  const [gradingUid, setGradingUid] = useState<string | null>(null);
  const [gradeError, setGradeError] = useState('');
  const reviewGeneration = useRef(0);
  const scope: TeacherScope = { uid: user?.uid ?? '', schoolId, courseId };

  async function publish(event: FormEvent) {
    event.preventDefault();
    if (!user || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setSaveError('');
    setSaveSuccess('');
    try {
      assignmentIdRef.current ??= newTeacherAssignmentId(courseId);
      await publishTeacherAssignment(scope, assignmentIdRef.current, {
        title,
        description,
        dueAt,
        points: Number(points),
        allowLateSubmission,
      });
      assignmentIdRef.current = null;
      setTitle('');
      setDescription('');
      setDueAt('');
      setPoints('100');
      setAllowLateSubmission(false);
      setSaveSuccess('作業已發布，學生可從課程頁查看與繳交。');
      refresh();
    } catch (error) {
      setSaveError(message(error, '尚未確認發布成功，請先更新作業列表。'));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  async function openReview(id: string) {
    if (reviewId === id) {
      reviewGeneration.current += 1;
      setReviewId(null);
      setReview(null);
      return;
    }
    const generation = ++reviewGeneration.current;
    setReviewId(id);
    setReview(null);
    setReviewError('');
    setGradeError('');
    setGradeValues({});
    setLoadingReview(true);
    try {
      const data = await loadTeacherSubmissions(scope, id);
      if (reviewGeneration.current === generation) setReview(data);
    } catch (error) {
      if (reviewGeneration.current === generation)
        setReviewError(message(error, '無法確認作業繳交紀錄。'));
    } finally {
      if (reviewGeneration.current === generation) setLoadingReview(false);
    }
  }

  async function grade(event: FormEvent, studentUid: string) {
    event.preventDefault();
    if (!reviewId || gradingUid || !user) return;
    const input = gradeValues[studentUid];
    if (!input || !input.score.trim()) {
      setGradeError('請輸入分數。');
      return;
    }
    setGradingUid(studentUid);
    setGradeError('');
    const generation = reviewGeneration.current;
    try {
      await publishSubmissionGrade(scope, reviewId, studentUid, Number(input.score), input.feedback);
      const updated = await loadTeacherSubmissions(scope, reviewId);
      if (generation === reviewGeneration.current) setReview(updated);
    } catch (error) {
      if (generation === reviewGeneration.current)
        setGradeError(message(error, '評分尚未確認，請重新讀取紀錄。'));
    } finally {
      setGradingUid(null);
    }
  }

  return (
    <section className={styles.panel} aria-label="作業管理">
      <header className={styles.heading}>
        <div>
          <h2>作業管理</h2>
          <p>教師發布文字作業、查看繳交並個別評分。評分結果與學期總成績分開記錄。</p>
        </div>
      </header>
      <details className={styles.compose}>
        <summary>新增文字作業</summary>
        <form onSubmit={(event) => void publish(event)} className={styles.form}>
          <label>
            作業標題
            <input value={title} onChange={(event) => setTitle(event.target.value)}
              maxLength={120} required disabled={saving} placeholder="例如：資料結構分析報告" />
          </label>
          <label>
            作業說明
            <textarea value={description} onChange={(event) => setDescription(event.target.value)}
              rows={5} maxLength={10000} disabled={saving}
              placeholder="說明繳交內容、格式及評分重點" />
          </label>
          <div className={styles.fields}>
            <label>
              配分
              <input type="number" min={1} max={1000} step={1} required
                value={points} onChange={(event) => setPoints(event.target.value)}
                disabled={saving} />
            </label>
            <label>
              截止時間（可留空）
              <input type="datetime-local" value={dueAt}
                onChange={(event) => setDueAt(event.target.value)} disabled={saving} />
            </label>
          </div>
          <label className={styles.check}>
            <input type="checkbox" checked={allowLateSubmission}
              onChange={(event) => setAllowLateSubmission(event.target.checked)}
              disabled={saving} />
            允許截止後繳交
          </label>
          <p className={styles.note}>送出後即正式發布，請先確認作業內容；目前不提供線上撤回。</p>
          <button className={styles.action} type="submit" disabled={saving || !title.trim()}>
            {saving ? '發布中…' : '發布作業'}
          </button>
        </form>
      </details>
      {saveError && <p role="alert" className={styles.error}>{saveError}</p>}
      {saveSuccess && <p role="status" className={styles.success}>{saveSuccess}</p>}
      <div className={styles.reviews}>
        <h3>繳交與評分</h3>
        {assignments.length === 0 ? (
          <p className={styles.note}>尚無已發布的作業。</p>
        ) : assignments.map((assignment) => (
          <div key={assignment.id} className={styles.reviewItem}>
            <div className={styles.reviewHeading}>
              <span>{assignment.title}</span>
              <button type="button" className={styles.secondary}
                onClick={() => void openReview(assignment.id)}>
                {reviewId === assignment.id ? '收起' : '查看繳交'}
              </button>
            </div>
            {reviewId === assignment.id && (
              <div className={styles.submissions}>
                {loadingReview ? <p role="status">讀取繳交紀錄…</p> : null}
                {reviewError ? (
                  <p role="alert">{reviewError} <button type="button" className={styles.secondary}
                    onClick={() => void openReview(assignment.id)}>收起後重試</button></p>
                ) : null}
                {review && !loadingReview ? (
                  review.submissions.length === 0 ? <p>尚無學生繳交。</p> : (
                    <div className={styles.submissionList}>
                      {review.submissions.map((submission) => {
                        const input = gradeValues[submission.uid] ?? { score: '', feedback: '' };
                        return (
                          <article key={submission.uid} className={styles.submission}>
                            <p className={styles.note}>
                              學生編號：{submission.uid} · {timeLabel(submission.submittedAt)}
                            </p>
                            <p className={styles.answer}>{submission.content || '本次繳交未包含文字內容。'}</p>
                            {submission.score !== null ? (
                              <div className={styles.published}>
                                <strong>已發布：{submission.score} / {review.points} 分</strong>
                                {submission.feedback ? <p>{submission.feedback}</p> : null}
                                <p className={styles.note}>{timeLabel(submission.gradedAt)}</p>
                              </div>
                            ) : review.points <= 0 ? (
                              <p className={styles.note}>此作業未設定有效配分，暫時無法評分。</p>
                            ) : (
                              <form className={styles.form} onSubmit={(event) => void grade(event, submission.uid)}>
                                <label>
                                  分數（滿分 {review.points} 分）
                                  <input type="number" min={0} max={review.points} step={0.01}
                                    value={input.score} required disabled={gradingUid !== null}
                                    onChange={(event) => setGradeValues((previous) => ({
                                      ...previous,
                                      [submission.uid]: { ...input, score: event.target.value },
                                    }))} />
                                </label>
                                <label>
                                  評語（選填）
                                  <textarea rows={3} maxLength={4000} value={input.feedback}
                                    disabled={gradingUid !== null}
                                    onChange={(event) => setGradeValues((previous) => ({
                                      ...previous,
                                      [submission.uid]: { ...input, feedback: event.target.value },
                                    }))} />
                                </label>
                                <button className={styles.action} type="submit" disabled={gradingUid !== null}>
                                  {gradingUid === submission.uid ? '發布中…' : '發布此筆評分'}
                                </button>
                              </form>
                            )}
                          </article>
                        );
                      })}
                    </div>
                  )
                ) : null}
                {gradeError ? <p role="alert" className={styles.error}>{gradeError}</p> : null}
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
