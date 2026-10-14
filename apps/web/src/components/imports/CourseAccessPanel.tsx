'use client';

import { useEffect, useRef, useState } from 'react';
import { createPersonalImportId, type PersonalImportRow } from '@campus/shared';
import { courseHints, courseAccessErrorMessage, courseRequestCopy, type CourseMatch, type CourseRequest } from '@campus/shared/src/courseAccess';
import { createCourseAccess } from '@campus/shared/src/courseAccessClient';
import { type NuniWorkspace } from '@campus/shared/src/nuni';
import { browserRequest, useOptionalNuniSession } from '@/features/nuni/Session';
import styles from './PersonalImport.module.css';

type Props = { row: PersonalImportRow; workspaces: NuniWorkspace[] };
export function CourseAccessPanel(props: Props) {
  const auth = useOptionalNuniSession();
  if (props.row.kind !== 'timetable') return null;
  if (!auth?.session || auth.loading || auth.pendingLogout) return <p>登入課班帳號後，可查找經管理員核對的課班。個人匯入不受影響。</p>;
  const { context, isPlatformOperator } = auth.session;
  // An account, school or metadata change invalidates selections and in-flight callbacks.
  const scopeKey = JSON.stringify([context, props.row.id, props.row.schoolId, props.row.academicYear,
    props.row.semester, props.row.title, props.row.courseCode, props.row.teacher, props.row.className]);
  return <CourseAccessSession key={scopeKey} {...props} context={context} operator={isPlatformOperator} />;
}

function CourseAccessSession({ row, workspaces, context, operator }: Props & { context: string; operator: boolean }) {
  const client = createCourseAccess((path, input) => browserRequest(path, context, input));
  const alive = useRef(true), locked = useRef(false), retryKeys = useRef(new Map<string, string>());
  const [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  const [matches, setMatches] = useState<CourseMatch[] | null>(null), [selected, setSelected] = useState('');
  const [confirmed, setConfirmed] = useState(false), [truncated, setTruncated] = useState(false);
  const [requests, setRequests] = useState<CourseRequest[]>([]), [cursor, setCursor] = useState<string | null>(null);
  const [workspace, setWorkspace] = useState(''), [statement, setStatement] = useState(''), [teacherConfirmed, setTeacherConfirmed] = useState(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  function retryKey(operation: string) {
    if (!retryKeys.current.has(operation)) retryKeys.current.set(operation, createPersonalImportId());
    return retryKeys.current.get(operation)!;
  }
  async function run(action: () => Promise<void>) {
    if (locked.current) return;
    locked.current = true; setBusy(true); setMessage('');
    try { await action(); } catch (error) { if (alive.current) setMessage(courseAccessErrorMessage(error)); }
    finally { locked.current = false; if (alive.current) setBusy(false); }
  }
  function receipt(value: CourseRequest) {
    if (!alive.current) return;
    setRequests(items => [value, ...items.filter(item => item.id !== value.id)]);
    setMessage(`${courseRequestCopy[value.state]}。${value.membershipActive ? '課班成員資格有效；重新載入課班清單後再建立個人連結。' : '尚未取得有效課班成員資格。'}`);
  }
  const candidate = matches?.find(item => item.course.id === selected)?.course;
  const already = candidate && requests.some(item => item.courseId === candidate.id && ['pending', 'approved'].includes(item.state));
  const owners = workspaces.filter(item => item.memberRole === 'owner-teacher' && item.state === 'active');
  return <details className={styles.source}>
    <summary>查找課班與申請加入</summary>
    <p>只查詢管理員已核對、已連結學校正式班次的課班。比對不代表修課資格或教師身分已獲認證。</p>
    <p>學校代號：{row.schoolId} · {row.academicYear} 學年度 · {row.semester} 學期。僅傳送課程欄位，不傳截圖、成績或整份課表。</p>
    <button type="button" disabled={busy} onClick={() => void run(async () => {
      const result = await client.match(courseHints(row));
      if (alive.current) { setMatches(result.matches); setSelected(''); setConfirmed(false); setTruncated(result.truncated); }
    })}>查找可能對應課班</button>
    {matches?.length === 0 && <p>目前沒有可推薦的已核對課班。請核對學校代號、學期與課號，或向老師詢問；不會替你建立或加入課班。</p>}
    {truncated && <p role="status">候選數量過多，以下不是完整清單；請先補齊課號與課名再查詢。此時不能送出加入申請。</p>}
    {!!matches?.length && <fieldset disabled={busy}>
      <legend>請逐一核對後選擇，系統不會自動選取</legend>
      {matches.map(({ course, reasons, conflicts }) => <label className={styles.field} key={course.id}>
        <span><input type="radio" name={`course-${row.id}`} checked={selected === course.id} onChange={() => { setSelected(course.id); setConfirmed(false); }} /> {course.title} · {course.courseCode || '課號未提供'}</span>
        <span>{course.teacher || '教師欄位未提供'} · {course.className || '班別未提供'} · {reasons.join('、')}</span>
        {!!conflicts.length && <strong>請特別確認：{conflicts.join('、')}</strong>}
        <small>平台管理員人工核對；非校方單一登入認證。</small>
      </label>)}
      <label className={styles.check}><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />我已核對學校、學期、課號、教師及班別；缺漏或差異已向授課者確認。</label>
      <button type="button" disabled={!candidate || !confirmed || truncated || !!already} onClick={() => void run(async () => {
        if (!candidate) return;
        receipt(await client.student({ courseId: candidate.id, version: candidate.version, metadata: courseHints(row), confirmed: true,
          idempotencyKey: retryKey(`student:${candidate.id}:${candidate.version}`) }));
      })}>{already ? '已有申請，請查詢狀態' : '送出加入申請（不會立即加入）'}</button>
    </fieldset>}
    <details>
      <summary>我是授課者：申請人工核對</summary>
      <p>僅可申請自己管理的課班。須先完成既有的學校／正式班次掛靠審核，再由不同的管理員核對身分及授課授權。課表姓名與學校信箱本身都不是證明。</p>
      <label className={styles.field}>我管理的課班<select disabled={busy} value={workspace} onChange={event => { setWorkspace(event.target.value); setTeacherConfirmed(false); }}>
        <option value="">請選擇；沒有課班時先到課班頁建立</option>
        {owners.map(item => <option key={item.id} value={item.id}>{item.title}（管理者，未代表教師認證）</option>)}
      </select></label>
      <label className={styles.field}>核對說明（20–1000 字；請勿填身分證號或密碼）<textarea value={statement} maxLength={1000} disabled={busy} onChange={event => { setStatement(event.target.value.replace(/[\r\n\t]+/g, ' ')); setTeacherConfirmed(false); }} /></label>
      <label className={styles.check}><input type="checkbox" checked={teacherConfirmed} disabled={busy} onChange={event => setTeacherConfirmed(event.target.checked)} />我確認這是我的授課申請，並了解必須經獨立審核，不會直接取得校務權限。</label>
      <button type="button" disabled={busy || !workspace || statement.trim().length < 20 || !teacherConfirmed || !row.courseCode || !row.teacher}
        onClick={() => void run(async () => receipt(await client.teacher({ workspaceId: workspace, metadata: courseHints(row), statement,
          confirmed: true, idempotencyKey: retryKey(`teacher:${workspace}:${statement}`) })))}>送出教師核對申請</button>
    </details>
    <h4>我的申請</h4>
    <button type="button" disabled={busy} onClick={() => void run(async () => {
      const result = await client.mine(); if (alive.current) { setRequests(result.requests); setCursor(result.nextCursor); }
    })}>重新查詢申請狀態</button>
    {requests.map(item => <div key={item.id}>
      <p>{item.metadata.title} · {item.metadata.schoolId} · {item.metadata.academicYear}/{item.metadata.semester} · {item.kind === 'teacher' ? '教師核對' : '加入申請'}：{courseRequestCopy[item.state]}</p>
      <p>{item.decisionReason || '尚無審核說明'} · {item.membershipActive ? '成員資格有效；請重新載入課班清單' : '目前沒有有效成員資格'}</p>
      {item.state === 'pending' && <button type="button" disabled={busy} onClick={() => void run(async () => receipt(await client.withdraw(item.id, item.version, retryKey(`withdraw:${item.id}:${item.version}`))))}>撤回「{item.metadata.title}」申請</button>}
    </div>)}
    {cursor && <button type="button" disabled={busy} onClick={() => void run(async () => { const result = await client.mine(cursor); if (alive.current) { setRequests(items => [...items, ...result.requests]); setCursor(result.nextCursor); } })}>載入較後面的申請</button>}
    {message && <p role="status" aria-live="polite">{message}</p>}
    {busy && <p role="status">正在確認伺服器狀態…</p>}
    {operator && <CourseReviewPanel context={context} schoolId={row.schoolId} />}
  </details>;
}

function CourseReviewPanel({ context, schoolId }: { context: string; schoolId: string }) {
  const client = createCourseAccess((path, input) => browserRequest(path, context, input));
  const alive = useRef(true), lock = useRef(false), keys = useRef(new Map<string, string>());
  const [requests, setRequests] = useState<CourseRequest[]>([]), [cursor, setCursor] = useState<string | null>(null);
  const [selected, setSelected] = useState(''), [reason, setReason] = useState(''), [evidence, setEvidence] = useState('');
  const [checked, setChecked] = useState(false), [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  async function run(action: () => Promise<void>) { if (lock.current) return; lock.current = true; setBusy(true); setMessage('');
    try { await action(); } catch (error) { if (alive.current) setMessage(courseAccessErrorMessage(error)); }
    finally { lock.current = false; if (alive.current) setBusy(false); } }
  const request = requests.find(item => item.id === selected);
  async function decide(decision: 'approve' | 'reject' | 'revoke') {
    if (!request) return;
    const operation = JSON.stringify([request.id, request.version, decision, reason, evidence, checked]);
    if (!keys.current.has(operation)) keys.current.set(operation, createPersonalImportId());
    const updated = await client.decide(request.id, { version: request.version, decision, reason, evidenceReference: evidence,
      independentlyVerified: checked, idempotencyKey: keys.current.get(operation)! });
    if (alive.current) { setRequests(items => items.map(item => item.id === updated.id ? updated : item)); setSelected(''); setChecked(false); setMessage('審核結果已由伺服器儲存。'); }
  }
  return <details><summary>管理員審核（{schoolId}）</summary>
    <p>須獨立核對申請帳號、本人身分、學校及本學期授課／修課授權。不得只比對姓名、截圖或電子郵件網域；不得審核自己的申請。</p>
    <button type="button" disabled={busy} onClick={() => void run(async () => { const result = await client.queue(schoolId); if (alive.current) { setRequests(result.requests); setCursor(result.nextCursor); setSelected(''); } })}>讀取本校審核佇列</button>
    <label className={styles.field}>選擇申請<select value={selected} disabled={busy} onChange={event => { setSelected(event.target.value); setReason(''); setEvidence(''); setChecked(false); }}><option value="">請選擇</option>
      {requests.map(item => <option key={item.id} value={item.id}>{item.metadata.title} · {item.kind} · {courseRequestCopy[item.state]}</option>)}
    </select></label>
    {cursor && <button type="button" disabled={busy} onClick={() => void run(async () => { const result = await client.queue(schoolId, cursor); if (alive.current) { setRequests(items => [...items, ...result.requests]); setCursor(result.nextCursor); } })}>載入下一頁</button>}
    {request && <>
      <p>申請帳號：{request.applicantId || '請重新載入佇列'}</p><p>{request.metadata.academicYear}/{request.metadata.semester} · {request.metadata.courseCode} · {request.metadata.teacher} · {request.metadata.className}</p><p>{request.statement}</p>
      <label className={styles.field}>審核說明<input value={reason} maxLength={1000} disabled={busy} onChange={event => setReason(event.target.value)} /></label>
      <label className={styles.field}>已核對證據的內部案件編號（不填公開文件或密碼）<input value={evidence} maxLength={500} disabled={busy} onChange={event => setEvidence(event.target.value)} /></label>
      <label className={styles.check}><input type="checkbox" checked={checked} disabled={busy} onChange={event => setChecked(event.target.checked)} />已透過獨立管道核對帳號本人、學校及本學期授課／修課授權。</label>
      {request.state === 'pending' && <><button type="button" disabled={busy || reason.trim().length < 5 || evidence.trim().length < 8 || !checked} onClick={() => void run(() => decide('approve'))}>核對通過並核准</button>
        <button type="button" disabled={busy || reason.trim().length < 5} onClick={() => void run(() => decide('reject'))}>拒絕申請</button></>}
      {request.state === 'approved' && <><p>撤銷教師授權會封存整個課班；撤銷學生申請會移除該學生資格。</p><button type="button" disabled={busy || reason.trim().length < 5} onClick={() => void run(() => decide('revoke'))}>撤銷此項授權</button></>}
    </>}
    {message && <p role="status">{message}</p>}
  </details>;
}
