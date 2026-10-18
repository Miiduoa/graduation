import React, { useEffect, useRef, useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import { createPersonalImportId, type PersonalImportRow } from '@campus/shared';
import { approvedCourseLinks, courseHints, courseAccessErrorMessage, courseRequestCopy, type CourseMatch, type CourseRequest, type CourseWorkspace } from '@campus/shared/src/courseAccess';
import { createCourseAccess, type CourseTransport } from '@campus/shared/src/courseAccessClient';
import { type NuniWorkspace } from '@campus/shared/src/nuni';
import { useNuniSession } from '../state/nuniSession';
import { Button } from '../ui/components';
import { theme } from '../ui/theme';

type Props = { row: PersonalImportRow; workspaces: NuniWorkspace[]; disabled?: boolean;
  onRefreshWorkspaces?: () => void;
  onSelectLinkedCourse?: (workspaceId: string) => void;
};
const textStyle = { color: theme.colors.text, lineHeight: 23 };
const inputStyle = { borderWidth: 1, borderColor: theme.colors.border, borderRadius: 8, padding: 12, color: theme.colors.text };
export function CourseAccessPanel(props: Props) {
  const auth = useNuniSession();
  if (!auth.session || auth.loading || auth.pendingLogout || props.disabled)
    return <Text style={textStyle}>登入課班帳號且完成目前操作後，可查找已核對的課班。</Text>;
  const context = auth.session.context;
  const scopeKey = JSON.stringify([context, props.row.id, props.row.schoolId, props.row.academicYear,
    props.row.semester, props.row.title, props.row.courseCode, props.row.teacher, props.row.className]);
  return <CourseAccessSession key={scopeKey} {...props} request={(path, input) => auth.request(path, context, input)} />;
}
function CourseAccessSession({ row, workspaces, request, onRefreshWorkspaces, onSelectLinkedCourse }: Props & { request: CourseTransport }) {
  const client = createCourseAccess(request);
  const alive = useRef(true), lock = useRef(false), retryKeys = useRef(new Map<string, string>());
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  const [matches, setMatches] = useState<CourseMatch[] | null>(null), [selected, setSelected] = useState('');
  const [confirmed, setConfirmed] = useState(false), [truncated, setTruncated] = useState(false);
  const [requests, setRequests] = useState<CourseRequest[]>([]), [cursor, setCursor] = useState<string | null>(null);
  const [teacherOpen, setTeacherOpen] = useState(false), [workspace, setWorkspace] = useState('');
  const [statement, setStatement] = useState(''), [teacherConfirmed, setTeacherConfirmed] = useState(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  function retryKey(operation: string) { if (!retryKeys.current.has(operation)) retryKeys.current.set(operation, createPersonalImportId()); return retryKeys.current.get(operation)!; }
  async function run(action: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setMessage('');
    try { await action(); } catch (error) { if (alive.current) setMessage(courseAccessErrorMessage(error)); }
    finally { lock.current = false; if (alive.current) setBusy(false); }
  }
  function receipt(value: CourseRequest) {
    if (!alive.current) return;
    setRequests(items => [value, ...items.filter(item => item.id !== value.id)]);
    if (value.kind === 'student' && value.state === 'approved' && value.membershipActive) onRefreshWorkspaces?.();
    setMessage(`${courseRequestCopy[value.state]}。${value.membershipActive ? '成員資格有效；重新開啟匯入頁後再連結課班。' : '尚未取得有效課班成員資格。'}`);
  }
  const candidate = matches?.find(item => item.course.id === selected)?.course;
  const already = candidate && requests.some(item => item.courseId === candidate.id && ['pending', 'approved'].includes(item.state));
  const approvedLinks = approvedCourseLinks(row, requests, workspaces);
  const hasApprovedMembership = requests.some(item => item.kind === 'student' && item.state === 'approved' && item.membershipActive);
  return <View style={{ gap: 12 }}>
    <Button text={open ? '收合課班申請' : '查找課班與申請加入'} disabled={busy} onPress={() => setOpen(!open)} />
    {open && <>
      {row.linkedCourseId && <LinkedCourseDetails key={`${row.linkedCourseId}:${row.schoolId}`} request={request} workspaceId={row.linkedCourseId} schoolId={row.schoolId} />}
      <Text style={textStyle}>學校代號 {row.schoolId} · {row.academicYear}/{row.semester}。只傳送課程欄位，不傳截圖、成績或整份課表；推薦不代表身分已認證。</Text>
      {row.kind === 'events' && <Text style={textStyle}>活動也可連結授課課班。請先補上學年度、學期與課號；活動名稱會保留，不會改成課程名稱。</Text>}
      <Button text="查找可能對應課班" disabled={busy} onPress={() => void run(async () => {
        const result = await client.match(courseHints(row)); if (alive.current) { setMatches(result.matches); setSelected(''); setConfirmed(false); setTruncated(result.truncated); }
      })} />
      {matches?.length === 0 && <Text style={textStyle}>目前沒有可推薦的已核對課班。請核對學校代號、學期及課號，或向老師詢問；不會自動建立或加入課班。</Text>}
      {truncated && <Text style={textStyle}>候選過多，這不是完整清單；請補齊課號與課名再查詢，目前不能送出申請。</Text>}
      {matches?.map(({ course, reasons, conflicts }) => <View key={course.id} style={{ gap: 8, padding: 12, borderWidth: 1, borderColor: theme.colors.border, borderRadius: 8 }}>
        <Text style={textStyle}>{course.title} · {course.courseCode || '課號未提供'} · {course.teacher || '教師未提供'} · {course.className || '班別未提供'}</Text>
        <Text style={textStyle}>{reasons.join('、')}{conflicts.length ? `；請特別確認：${conflicts.join('、')}` : ''}</Text>
        <Text style={textStyle}>平台管理員人工核對；非校方單一登入認證。</Text>
        <Button text={selected === course.id ? '已選擇這個課班' : '選擇這個課班'} kind={selected === course.id ? 'primary' : 'outline'} disabled={busy}
          onPress={() => { setSelected(course.id); setConfirmed(false); }} />
      </View>)}
      {!!matches?.length && <>
        <Button text={confirmed ? '已確認課班資料與缺漏差異' : '我已核對學校、學期、課號、教師及班別，並向授課者確認缺漏與差異'} disabled={busy || !candidate} onPress={() => setConfirmed(!confirmed)} />
        <Button text={already ? '已有申請，請查詢狀態' : '送出加入申請（不會立即加入）'} disabled={busy || !candidate || !confirmed || truncated || !!already} onPress={() => void run(async () => {
          if (candidate) receipt(await client.student({ courseId: candidate.id, version: candidate.version, metadata: courseHints(row), confirmed: true,
            idempotencyKey: retryKey(`student:${candidate.id}:${candidate.version}`) }));
        })} />
      </>}
      <Button text={teacherOpen ? '收合教師申請' : '我是授課者：申請人工核對'} disabled={busy} onPress={() => setTeacherOpen(!teacherOpen)} />
      {teacherOpen && <>
        <Text style={textStyle}>須先完成既有學校／正式班次掛靠審核，再由不同管理員獨立核對本人及授課授權。僅可選擇自己管理的課班；姓名或信箱網域不能作為認證。</Text>
        {workspaces.filter(item => item.memberRole === 'owner-teacher' && item.state === 'active').map(item => <Button key={item.id}
          text={`${workspace === item.id ? '已選：' : ''}${item.title}（管理者，未代表教師認證）`} disabled={busy} onPress={() => { setWorkspace(item.id); setTeacherConfirmed(false); }} />)}
        <Text style={textStyle}>核對說明（20–1000 字，不填身分證號或密碼）。沒有課班時，先到課班頁建立。</Text>
        <TextInput accessibilityLabel="教師核對說明" style={inputStyle} value={statement} maxLength={1000} editable={!busy}
          onChangeText={value => { setStatement(value.replace(/[\r\n\t]+/g, ' ')); setTeacherConfirmed(false); }} />
        <Button text={teacherConfirmed ? '已確認：這是我的授課申請' : '確認：這是我的授課申請，且了解須經獨立審核，不會直接取得校務權限'} disabled={busy} onPress={() => setTeacherConfirmed(!teacherConfirmed)} />
        <Button text="送出教師核對申請" disabled={busy || !workspace || !teacherConfirmed || statement.trim().length < 20 || !row.teacher || !row.courseCode}
          onPress={() => void run(async () => receipt(await client.teacher({ workspaceId: workspace, metadata: courseHints(row), statement, confirmed: true,
            idempotencyKey: retryKey(`teacher:${workspace}:${statement}`) })))} />
      </>}
      <Button text="重新查詢我的申請" disabled={busy} onPress={() => void run(async () => {
        const result = await client.mine(); if (alive.current) { setRequests(result.requests); setCursor(result.nextCursor);
          if (result.requests.some(item => item.kind === 'student' && item.state === 'approved' && item.membershipActive)) onRefreshWorkspaces?.(); }
      })} />
      {hasApprovedMembership && <View style={{ gap: 10 }}>
        <Text style={textStyle}>已有核准的課班申請。重新核對目前的成員資格後，才能選擇連結到這筆個人紀錄。</Text>
        {onRefreshWorkspaces && <Button text="更新已加入的課班" disabled={busy} onPress={onRefreshWorkspaces} />}
        {approvedLinks.map(item => <Button key={item.id} disabled={busy || !onSelectLinkedCourse || row.linkedCourseId === item.id}
          text={row.linkedCourseId === item.id ? `已選：${item.title}（尚未儲存）` : `選擇已核准課班：${item.title}`}
          onPress={() => onSelectLinkedCourse?.(item.id)} />)}
        {!approvedLinks.length && <Text style={textStyle}>尚未核對到可直接連結的課班。課號、教師或班別不同時，請在下方自行核對；系統不會自動連結。</Text>}
      </View>}
      {requests.map(item => <View key={item.id} style={{ gap: 6 }}>
        <Text style={textStyle}>{item.metadata.title} · {item.metadata.schoolId} · {item.metadata.academicYear}/{item.metadata.semester} · {item.kind === 'teacher' ? '教師核對' : '加入申請'}：{courseRequestCopy[item.state]}</Text>
        <Text style={textStyle}>{item.decisionReason || '尚無審核說明'}。{item.membershipActive ? '成員資格有效；重新開啟匯入頁後可連結課班。' : '目前沒有有效成員資格。'}</Text>
        {item.state === 'pending' && <Button text={`撤回「${item.metadata.title}」申請`} disabled={busy} onPress={() => void run(async () => receipt(await client.withdraw(item.id, item.version, retryKey(`withdraw:${item.id}:${item.version}`))))} />}
      </View>)}
      {cursor && <Button text="載入下一頁申請" disabled={busy} onPress={() => void run(async () => { const result = await client.mine(cursor); if (alive.current) { setRequests(items => [...items, ...result.requests]); setCursor(result.nextCursor); } })} />}
      <Text style={textStyle}>管理員請使用 Web 的審核介面；App 不會提供自行切換教師或管理員身分的功能。</Text>
      {busy && <Text style={textStyle} accessibilityLiveRegion="polite">正在確認伺服器狀態…</Text>}
      {!!message && <Text style={textStyle} accessibilityLiveRegion="polite">{message}</Text>}
    </>}
  </View>;
}

function LinkedCourseDetails({ request, workspaceId, schoolId }: { request: CourseTransport; workspaceId: string; schoolId: string }) {
  const alive = useRef(true), locked = useRef(false);
  const [result, setResult] = useState<CourseWorkspace | null>(null);
  const [message, setMessage] = useState(''), [busy, setBusy] = useState(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  async function refresh() {
    if (locked.current) return;
    locked.current = true; setBusy(true); setResult(null); setMessage('');
    try {
      const value = await createCourseAccess(request).workspace(workspaceId, schoolId);
      if (alive.current) setResult(value);
    } catch (error) { if (alive.current) setMessage(courseAccessErrorMessage(error)); }
    finally { locked.current = false; if (alive.current) setBusy(false); }
  }
  return <View style={{ gap: 8 }}>
    <Text style={textStyle}>已連結的課班</Text>
    <Button text={busy ? '正在核對課班資料…' : '核對目前課班與教師資料'} disabled={busy} onPress={() => void refresh()} />
    <Text style={textStyle}>以下資料由伺服器重新確認；匯入的教師姓名仍是個人提示，不會改寫授課者身分。</Text>
    {result?.status === 'reviewed' && <>
      <Text style={textStyle}>{result.course.title} · 課號 {result.course.courseCode} · 班別 {result.course.className || '未提供'}</Text>
      <Text style={textStyle}>學校 {result.course.schoolId} · {result.course.academicYear} 學年度 · {result.course.semester} 學期</Text>
      <Text style={textStyle}>經管理員核對的授課者：{result.course.teacher}</Text>
      <Text style={textStyle}>目前成員資格有效；這是平台管理員核對結果，不是校方單一登入認證。</Text>
    </>}
    {result?.status === 'unreviewed' && <Text style={textStyle}>目前仍是此工作區的成員，但課班與教師資料尚未經獨立核對。個人連結不代表授課或修課認證。</Text>}
    {!!message && <Text style={textStyle} accessibilityLiveRegion="polite">{message}</Text>}
  </View>;
}
