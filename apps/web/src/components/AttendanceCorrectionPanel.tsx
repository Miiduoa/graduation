'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  attendanceActorUid,
  attendanceError,
  correctCourseAttendance,
  loadAttendanceCorrections,
  loadCourseAttendanceRoster,
  type AttendanceCorrection,
  type AttendanceCorrectionCommand,
  type AttendanceCorrectionStatus,
  type AttendanceStudent,
} from '@/lib/courseAttendance';
import { Button } from './ui/Button';
import { AttendanceRegisterPanel } from './AttendanceRegisterPanel';
import { AttendanceCorrectionReview } from './AttendanceCorrectionReview';
import { AttendanceCorrectionResume } from './AttendanceCorrectionResume';
import { rememberCorrectionBookmark, clearCorrectionBookmark } from '@/lib/attendanceCorrectionBookmark';
import { correctionReviewScope, type CorrectionReview } from '@/lib/attendanceCorrectionReview';
import { isAttendanceResultUncertain } from '@/lib/attendanceRequest';
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

type Props = {
  courseId: string;
  sessionId: string;
  active?: boolean;
  onUpdated: () => Promise<void>;
};
type CorrectionAttempt = {
  command: Readonly<AttendanceCorrectionCommand>;
  studentLabel: string;
};

export function AttendanceCorrectionPanel(props: Props) {
  // Route changes must unmount old reads, drafts and pending results together.
  const actorUid = attendanceActorUid();
  return <AttendanceCorrectionResume
    key={JSON.stringify([props.courseId, props.sessionId, actorUid])}
    scope={{ actorUid: actorUid ?? '', courseId: props.courseId, sessionId: props.sessionId }}
    currentActor={attendanceActorUid}
  >
    <AttendanceCorrectionEditor {...props} />
  </AttendanceCorrectionResume>;
}

function AttendanceCorrectionEditor({ courseId, sessionId, active = false, onUpdated }: Props) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [students, setStudents] = useState<AttendanceStudent[]>([]);
  const [studentQuery, setStudentQuery] = useState('');
  const [audits, setAudits] = useState<AttendanceCorrection[]>([]);
  const [selectedUid, setSelectedUid] = useState('');
  const [status, setStatus] = useState<AttendanceCorrectionStatus>('present');
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [registerRevision, setRegisterRevision] = useState(0);
  const [review, setReview] = useState<CorrectionReview | null>(null);
  const [reviewAttempt, setReviewAttempt] = useState(0);
  const scope = correctionReviewScope(courseId, sessionId, selectedUid);
  const reviewed = review?.scope === scope ? review : null;
  const isActive = active || reviewed?.active === true;
  const reasonInput = useRef<HTMLTextAreaElement>(null);
  const attempt = useRef<CorrectionAttempt | null>(null);
  const [pendingRetry, setPendingRetry] = useState<CorrectionAttempt | null>(null);
  const [bookmarkSaved, setBookmarkSaved] = useState(false);
  const recoveryButton = useRef<HTMLButtonElement>(null);
  const locked = busy || pendingRetry !== null;
  const mounted = useRef(true);
  const revision = useRef(0);
  const submitting = useRef(false);
  const matchingStudents = students.filter((student) => {
    const query = studentQuery.trim().toLocaleLowerCase('zh-TW');
    return !query ||
      student.displayName.toLocaleLowerCase('zh-TW').includes(query) ||
      student.studentId.toLocaleLowerCase('zh-TW').includes(query);
  }).slice(0, 80);
  const selectedStudent = students.find((student) => student.uid === selectedUid);
  // 名冊直接選到第 80 位之後的學生時，仍須保留對應選項。
  const selectableStudents = selectedStudent && !matchingStudents.some((student) => student.uid === selectedUid)
    ? [selectedStudent, ...matchingStudents]
    : matchingStudents;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      revision.current += 1;
    };
  }, []);

  useEffect(() => {
    if (pendingRetry && !busy) recoveryButton.current?.focus();
  }, [pendingRetry, busy]);

  async function showPanel(studentUid?: string) {
    if (submitting.current || attempt.current) return;
    if (open && !studentUid) {
      revision.current += 1;
      setOpen(false);
      setStudents([]);
      setAudits([]);
      setSelectedUid('');
      setStudentQuery('');
      setError('');
      setNotice('');
      return;
    }
    setReview(null);
    const current = ++revision.current;
    setOpen(true);
    setLoading(true);
    setError('');
    setNotice('');
    setStudentQuery('');
    setReason('');
    setStatus('present');
    attempt.current = null;
    try {
      const [roster, history] = await Promise.all([
        loadCourseAttendanceRoster(courseId),
        loadAttendanceCorrections(courseId, sessionId),
      ]);
      if (!mounted.current || revision.current !== current) return;
      setStudents(roster);
      setAudits(history);
      // 必須主動選擇更正對象；全班名冊選到的人也需重新確認修課資格。
      setSelectedUid(studentUid && roster.some((student) => student.uid === studentUid) ? studentUid : '');
      if (studentUid) window.setTimeout(() => {
        if (mounted.current && revision.current === current) reasonInput.current?.focus();
      }, 0);
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

  async function save(current: CorrectionAttempt, recovering: boolean) {
    if (submitting.current) return;
    const actorUid = current.command.actorUid;
    if (!actorUid || actorUid !== attendanceActorUid()) {
      setError('登入帳號已變更，請重新登入原帳號核對紀錄。');
      return;
    }
    const bookmarkScope = { actorUid, courseId, sessionId };
    const stored = rememberCorrectionBookmark(bookmarkScope, current.command.requestId);
    if (stored === 'conflict') {
      setError('此場次已有其他待確認操作，請重新整理後先查核原收據。沒有送出新的更正。');
      return;
    }
    setBookmarkSaved(stored === 'saved');
    submitting.current = true;
    attempt.current = current;
    setBusy(true);
    setError('');
    setNotice('');
    const requestIdentity = revision.current;
    try {
      const result = await correctCourseAttendance(current.command);
      clearCorrectionBookmark(bookmarkScope, current.command.requestId);
      if (!mounted.current || requestIdentity !== revision.current) return;
      attempt.current = null;
      setPendingRetry(null);
      setNotice(result.reused ? '這筆更正已保存，已確認先前操作結果。' : '已保存更正，並建立操作稽核紀錄。');
      setReason('');
      setReview(null);
      setReviewAttempt((value) => value + 1);
      setRegisterRevision((value) => value + 1);
      try {
        await onUpdated();
        if (!mounted.current || revision.current !== requestIdentity) return;
        const refreshed = await loadAttendanceCorrections(courseId, sessionId);
        if (mounted.current && revision.current === requestIdentity) setAudits(refreshed);
      } catch {
        if (mounted.current && revision.current === requestIdentity) {
          setNotice('更正已由伺服器確認，但重新整理紀錄失敗，請再試一次更新。');
        }
      }
    } catch (problem) {
      const code = (problem as { code?: string })?.code?.replace('functions/', '');
      if (code === 'aborted' || (!recovering && !isAttendanceResultUncertain(problem))) {
        clearCorrectionBookmark(bookmarkScope, current.command.requestId);
      }
      if (mounted.current && revision.current === requestIdentity) {
        if (code === 'aborted') {
          attempt.current = null;
          setPendingRetry(null);
          setReview(null);
          setReviewAttempt((value) => value + 1);
          setError('紀錄可能已由其他操作更新，本次沒有覆寫。正在重新核對；請比較目前狀態，再按確認送出。');
        } else {
          // A later permission rejection cannot disprove an earlier ambiguous commit.
          if (recovering || isAttendanceResultUncertain(problem)) setPendingRetry(current);
          else attempt.current = null;
          setError(attendanceError(problem));
        }
      }
    } finally {
      submitting.current = false;
      if (mounted.current && revision.current === requestIdentity) setBusy(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (
      submitting.current || attempt.current || !selectedStudent || !reviewed ||
      reason.trim().length < 6 || reason.trim().length > 300 || loading ||
      (isActive && (status === 'absent' || status === 'excused'))
    ) return;
    const actorUid = attendanceActorUid();
    if (!actorUid) { setError('登入已失效，請重新登入後核對紀錄。'); return; }
    await save({
      command: Object.freeze({
        groupId: courseId,
        sessionId,
        studentUid: selectedUid,
        status,
        reason: reason.trim(),
        requestId: crypto.randomUUID(),
        expectedRevision: reviewed.revision,
        actorUid,
      }),
      studentLabel: `${selectedStudent.displayName}${selectedStudent.studentId ? `（${selectedStudent.studentId}）` : ''}`,
    }, false);
  }

  function invalidatePendingRetry() {
    // Only editable before submission or after a definite rejection.
    if (attempt.current) return;
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
        <Button type="button" variant="outline" disabled={locked} onClick={() => void showPanel()}>
          {open ? '收合更正' : '管理出席更正'}
        </Button>
      </div>
      <AttendanceRegisterPanel key={`${courseId}:${sessionId}`}
        courseId={courseId} sessionId={sessionId} revision={registerRevision}
        disabled={locked || loading} onCorrect={(uid) => void showPanel(uid)} />
      {open && (
        <>
          {loading ? <p role="status" className={styles.note}>正在確認教師權限與課程名冊…</p> : null}
          {!loading && students.length > 0 && (
            <form className={styles.form} onSubmit={(event) => void submit(event)}>
              <label htmlFor={`correction-search-${sessionId}`}>搜尋學生</label>
              <input
                id={`correction-search-${sessionId}`}
                type="search"
                value={studentQuery}
                placeholder="輸入姓名或學號"
                disabled={locked}
                onChange={(event) => {
                  if (attempt.current) return;
                  setStudentQuery(event.target.value);
                  setSelectedUid('');
                  setReview(null);
                  invalidatePendingRetry();
                }}
              />
              <label htmlFor={`correction-user-${sessionId}`}>選擇學生</label>
              <select
                id={`correction-user-${sessionId}`}
                value={selectedUid}
                disabled={locked}
                required
                onChange={(event) => { if (attempt.current) return; setSelectedUid(event.target.value); setReview(null); invalidatePendingRetry(); }}
              >
                <option value="" disabled>請選擇要更正的學生</option>
                {selectableStudents.map((student) => (
                  <option key={student.uid} value={student.uid}>
                    {student.displayName}{student.studentId ? `（${student.studentId}）` : ''}
                  </option>
                ))}
              </select>
              {matchingStudents.length === 0 && (
                <p role="status" className={styles.note}>沒有符合的學生，請調整姓名或學號搜尋條件。</p>
              )}
              <label htmlFor={`correction-status-${sessionId}`}>核定狀態</label>
              <select
                id={`correction-status-${sessionId}`}
                value={status}
                disabled={locked}
                onChange={(event) => {
                  if (attempt.current) return;
                  setStatus(event.target.value as AttendanceCorrectionStatus);
                  invalidatePendingRetry();
                }}
              >
                {statuses.map((entry) => (
                  <option
                    key={entry.status}
                    value={entry.status}
                    disabled={isActive && (entry.status === 'absent' || entry.status === 'excused')}
                  >
                    {entry.label}
                  </option>
                ))}
              </select>
              {selectedUid && <AttendanceCorrectionReview
                key={`${scope}:${reviewAttempt}`}
                courseId={courseId} sessionId={sessionId} studentUid={selectedUid}
                proposedStatus={titleFor(status)} disabled={locked} onReview={setReview}
              />}
              <label htmlFor={`correction-reason-${sessionId}`}>更正原因</label>
              <textarea
                ref={reasonInput}
                id={`correction-reason-${sessionId}`}
                rows={3}
                minLength={6}
                maxLength={300}
                required
                disabled={locked}
                value={reason}
                placeholder="例如：授課教師現場確認出席、已核准請假或核對點名紀錄"
                onChange={(event) => { if (attempt.current) return; setReason(event.target.value); invalidatePendingRetry(); }}
              />
              <p className={styles.note}>
                {isActive
                  ? '點名仍在進行中，可以補登出席或遲到。必須結束點名後才能核定缺席或請假。'
                  : '學生沒有簽到，不代表缺席。選擇「缺席」將建立一筆由教師正式確認的紀錄。'}
              </p>
              {!pendingRetry && <div className={styles.actions}>
                <Button type="submit" variant="primary" disabled={busy || !selectedUid || !reviewed || reason.trim().length < 6 || (isActive && (status === 'absent' || status === 'excused'))}>
                  {busy ? '正在儲存…' : '確認並保存更正'}
                </Button>
              </div>}
            </form>
          )}
          {!loading && students.length === 0 && !error && (
            <p className={styles.note}>這門課目前沒有符合資格的學生名冊。</p>
          )}
          {pendingRetry && (
            <section className={styles.recovery} aria-label="確認原更正結果" aria-busy={busy}>
              <div role="status">
                <h5>這筆更正的結果還沒確認</h5>
                <p>伺服器可能已保存。先確認這一筆，再進行其他更正。</p>
                <dl>
                  <div><dt>學生</dt><dd>{pendingRetry.studentLabel}</dd></div>
                  <div><dt>核定狀態</dt><dd>{titleFor(pendingRetry.command.status)}</dd></div>
                  <div><dt>原因</dt><dd>{pendingRetry.command.reason}</dd></div>
                </dl>
              </div>
              <button ref={recoveryButton} type="button" className={styles.recoveryAction}
                disabled={busy} onClick={() => void save(pendingRetry, true)}>
                {busy ? '正在確認原更正…' : '確認原更正結果'}
              </button>
              <p className={styles.note}>沿用原請求編號與核對版本，不會另建一筆。</p>
              <p className={styles.note}>{bookmarkSaved
                ? '已在此分頁保留操作識別碼；重新整理後可唯讀查核收據，不會自動重送更正。'
                : '瀏覽器無法保留操作識別碼；請先留在本頁確認結果。離開後須自行查核名冊與更正歷程。'}</p>
            </section>
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
