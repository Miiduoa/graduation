'use client';

import { useEffect, useState } from 'react';
import { loadCorrectionReview, type CorrectionReview } from '@/lib/attendanceCorrectionReview';
import { REGISTER_LABELS } from '@/lib/attendanceRegister';
import { Button } from './ui/Button';
import styles from './attendance-correction-review.module.css';

type Props = {
  courseId: string;
  sessionId: string;
  studentUid: string;
  proposedStatus: string;
  disabled: boolean;
  onReview: (value: CorrectionReview | null) => void;
};

export function AttendanceCorrectionReview({
  courseId, sessionId, studentUid, proposedStatus, disabled, onReview,
}: Props) {
  const [review, setReview] = useState<CorrectionReview | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let current = true;
    void loadCorrectionReview(courseId, sessionId, studentUid).then((value) => {
      if (!current) return;
      setReview(value);
      onReview(value);
    }, () => {
      if (!current) return;
      setError(true);
      onReview(null);
    });
    return () => { current = false; };
  }, [courseId, sessionId, studentUid, attempt, onReview]);
  if (error) return <div className={styles.card}>
    <p role="alert">目前紀錄無法核實，暫不送出更正。請確認連線與修課資格後重試。</p>
    <Button type="button" variant="outline" disabled={disabled} onClick={() => {
      setReview(null); setError(false); onReview(null); setAttempt((value) => value + 1);
    }}>重新核對紀錄</Button>
  </div>;
  if (!review) return <p role="status" className={styles.loading}>正在核對這位學生的目前紀錄…</p>;
  const currentLabel = REGISTER_LABELS[review.row.status];
  const source = review.row.source === 'manual' ? '教師核定' : review.row.source === 'qr' ? 'QR 簽到' : '課堂紀錄';
  const updatedAt = review.row.correctedAt ?? review.row.checkedInAt;
  return <section className={styles.card} aria-label="更正前核對">
    <p className={styles.person}>{review.row.displayName}<span>{review.row.studentId || review.row.uid}</span></p>
    <div className={styles.comparison}>
      <div><small>目前已保存</small><strong>{currentLabel}</strong></div>
      <span className={styles.arrow} aria-hidden="true">→</span>
      <div><small>本次將核定</small><strong>{proposedStatus}</strong></div>
    </div>
    <p className={styles.note}>{updatedAt
      ? `${source} · ${new Date(updatedAt).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' })}`
      : '尚無紀錄不代表缺席，請依實際情況核定。'}</p>
    <p className={styles.note}>送出時會再次比對版本；若紀錄已改變，請重新核對後再確認，不會自動覆寫。</p>
  </section>;
}
