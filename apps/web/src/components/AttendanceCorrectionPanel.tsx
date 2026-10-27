'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  attendanceError,
  correctCourseAttendance,
  loadAttendanceCorrections,
  loadCourseAttendanceRoster,
  type AttendanceCorrection,
  type AttendanceCorrectionStatus,
  type AttendanceStudent,
} from '@/lib/courseAttendance';
import { Button } from './ui/Button';
import styles from './course-attendance-correction.module.css';

const statuses: { status: AttendanceCorrectionStatus; label: string }[] = [
  { status: 'present', label: '出席' },
  { status: 'late', label: '遲到' },
  { status: 'absent', label: '缺席' },
  { status: 'excused', label: '請假' },
];
const titleFor = (status: string | null) =>
  statuses.find((entry) => entry.status === status)?.label ?? '尚無紀錄';
const timestamp = (value: string | null) =>
  value ? new Date(value).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' }) : '時間待確認';

export function AttendanceCorrectionPanel({
  courseId,
  sessionId,
  onUpdated,
}: {
  courseId: string;
  sessionId: string;
  onUpdated: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [students, setStudents] = useState<AttendanceStudent[]>([]);
  const [audits, setAudits] = useState<AttendanceCorrection[]>([]);
  const [selectedUid, setSelectedUid] = useState('');
  const [status, setStatus] = useState<AttendanceCorrectionStatus>('present');
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const operationId = useRef<string | null>(null);
  const mounted = useRef(true);
  const revision = useRef(0);
  const submitting = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      revision.current += 1;
    };
  }, []);

  async function showPanel() {
    if (open) {
      revision.current += 1;
      setOpen(false);
      setStudents([]);
      setAudits([]);
      setSelectedUid('');
      setError('');
      setNotice('');
      return;
    }
    const current = ++revision.current;
    setOpen(true);
    setLoading(true);
    setError('');
    setNotice('');
    try {
      const [roster, history] = await Promise.all([
        loadCourseAttendanceRoster(courseId),
        loadAttendanceCorrections(courseId, sessionId),
      ]);
      if (!mounted.current || revision.current !== current) return;
      setStudents(roster);
      setAudits(history);
      // An instructor must deliberately choose the person being corrected.
      setSelectedUid('');
    } catch (problem) {
      if (mounted.current && revision.current === current) {
        setStudents([]);
        setAudits([]);
        setError(attendanceError(problem));
      }
    } finally {
      if (mounted.current && revision.current === current) setLoading(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current || !selectedUid || reason.trim().length < 6 || loading) return;
    submitting.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    operationId.current ??= crypto.randomUUID();
    const requestIdentity = revision.current;
    try {
      const result = await correctCourseAttendance({
        groupId: courseId,
        sessionId,
        studentUid: selectedUid,
        status,
        reason,
        requestId: operationId.current,
      });
      if (!mounted.current || requestIdentity !== revision.current) return;
      operationId.current = null;
      setNotice(result.reused ? '這筆更正已保存，已確認先前操作結果。' : '已保存更正，並建立操作稽核紀錄。');
      setReason('');
      try {
        await onUpdated();
        const refreshed = await loadAttendanceCorrections(courseId, sessionId);
        if (mounted.current && revision.current === requestIdentity) setAudits(refreshed);
      } catch {
        if (mounted.current && revision.current === requestIdentity) {
          setNotice('更正已由伺服器確認，但重新整理紀錄失敗，請再試一次更新。');
        }
      }
    } catch (problem) {
      if (mounted.current && revision.current === requestIdentity) setError(attendanceError(problem));
    } finally {
      submitting.current = false;
      if (mounted.current && revision.current === requestIdentity) setBusy(false);
    }
  }

  function invalidatePendingRetry() {
    operationId.current = null;
    setNotice('');
    setError('');
  }

  return (
    <section className={styles.shell} aria-label="教師更正出席紀錄">
      <div className={styles.header}>
        <div>
          <h4>出席更正</h4>
          <p>僅授課教師可操作。每筆更正都會記錄修改前後狀態、操作人員及原因。</p>
        </div>
        <Button variant="outline" disabled={busy} onClick={() => void showPanel()}>
          {open ? '收合更正' : '管理出席更正'}
        </Button>
      </div>
      {open && (
        <>
          {loading ? <p role="status" className={styles.note}>正在確認教師權限與課程名冊…</p> : null}
          {!loading && students.length > 0 && (
            <form className={styles.form} onSubmit={(event) => void submit(event)}>
              <label htmlFor={`correction-user-${sessionId}`}>選擇學生</label>
              <select
                id={`correction-user-${sessionId}`}
                value={selectedUid}
                disabled={busy}
                required
                onChange={(event) => { setSelectedUid(event.target.value); invalidatePendingRetry(); }}
              >
                <option value="" disabled>請選擇要更正的學生</option>
                {students.map((student) => (
                  <option key={student.uid} value={student.uid}>
                    {student.displayName}{student.studentId ? `（${student.studentId}）` : ''}
                  </option>
                ))}
              </select>
              <label htmlFor={`correction-status-${sessionId}`}>核定狀態</label>
              <select
                id={`correction-status-${sessionId}`}
                value={status}
                disabled={busy}
                onChange={(event) => {
                  setStatus(event.target.value as AttendanceCorrectionStatus);
                  invalidatePendingRetry();
                }}
              >
                {statuses.map((entry) => (
                  <option key={entry.status} value={entry.status}>{entry.label}</option>
                ))}
              </select>
              <label htmlFor={`correction-reason-${sessionId}`}>更正原因</label>
              <textarea
                id={`correction-reason-${sessionId}`}
                rows={3}
                minLength={6}
                maxLength={300}
                required
                disabled={busy}
                value={reason}
                placeholder="例如：授課教師現場確認出席、已核准請假或核對點名紀錄"
                onChange={(event) => { setReason(event.target.value); invalidatePendingRetry(); }}
              />
              <p className={styles.note}>學生沒有簽到，不代表缺席。選擇「缺席」將建立一筆由教師正式確認的紀錄。</p>
              <div className={styles.actions}>
                <Button type="submit" variant="primary" disabled={busy || !selectedUid || reason.trim().length < 6}>
                  {busy ? '正在儲存…' : '確認並保存更正'}
                </Button>
              </div>
            </form>
          )}
          {!loading && students.length === 0 && !error && (
            <p className={styles.note}>這門課目前沒有符合資格的學生名冊。</p>
          )}
          {error && <p role="alert" className={styles.error}>{error}</p>}
          {notice && <p role="status" className={styles.success}>{notice}</p>}
          {audits.length > 0 && (
            <div className={styles.audit}>
              <h5>最近更正紀錄</h5>
              <ul>
                {audits.map((record) => {
                  const student = students.find((member) => member.uid === record.studentUid);
                  return (
                    <li key={record.id}>
                      <strong>{student?.displayName || record.studentUid}</strong>
                      <span>{titleFor(record.previousStatus)} → {titleFor(record.nextStatus)}</span>
                      <span className={styles.note}>{record.reason} · {timestamp(record.correctedAt)}</span>
                    </li>
                  );
                })}
              </ul>
              <p className={styles.note}>僅顯示最近 20 筆；完整稽核紀錄會保留在伺服器。</p>
            </div>
          )}
        </>
      )}
    </section>
  );
}
