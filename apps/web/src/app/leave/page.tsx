'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { type PersonalCourse } from '@campus/shared';
import { SiteShell } from '@/components/SiteShell';
import { SchoolAccountRequired } from '@/components/SchoolAccountRequired';
import { SchoolScopePlaceholder } from '@/components/SchoolScopePlaceholder';
import { useAuth } from '@/components/AuthGuard';
import { useSelectedSchool } from '@/components/SelectedSchoolProvider';
import { useDemoRole } from '@/lib/demoRole';
import { ensureTimetableIndex, loadPersonalTimetable } from '@/lib/timetable/store';
import { areFunctionsConfigured } from '@/lib/functionsUrl';
import {
  LEAVE_KINDS, LEAVE_PERIODS, LEAVE_REVIEWS, LEAVE_STATUSES,
  countLeaveReviews, formatLeaveRange, leaveCourseOptions, leaveKindLabel,
  leaveRequestError, listMyLeaveRequests, shiftLeaveDay, submitLeaveRequest,
  suggestedLeaveCourses, taipeiToday, validLeaveDates, withdrawLeaveRequest,
  type LeaveKind, type LeavePeriod, type LeaveRequest,
} from '@/lib/leaveRequests';
import styles from './leave.module.css';

const PROVIDENCE_GUIDE = 'https://osasa.pu.edu.tw/p/412-1063-5627.php?Lang=zh-tw';
type Filter = 'all' | 'open' | 'completed' | 'withdrawn';

function newId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'leave-' + Date.now() + '-' + Math.random().toString(36).slice(2, 12);
}

function createdLabel(value: unknown) {
  if (!value) return '等待時間確認';
  const item = value as { toDate?: () => Date; seconds?: number };
  const date = typeof item.toDate === 'function'
    ? item.toDate()
    : typeof item.seconds === 'number'
      ? new Date(item.seconds * 1000)
      : new Date(String(value));
  if (Number.isNaN(date.getTime())) return '等待時間確認';
  return new Intl.DateTimeFormat('zh-TW', {
    timeZone: 'Asia/Taipei', year: 'numeric', month: 'numeric', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  }).format(date);
}

export default function LeavePage() {
  const { user, loading: authLoading } = useAuth();
  const school = useSelectedSchool();
  const [demoRole] = useDemoRole();
  if (authLoading) {
    return <SiteShell title="請假"><p role="status">正在確認學校帳號…</p></SiteShell>;
  }
  if (school.loading || !school.selectedSchoolId) {
    return <SiteShell title="請假"><SchoolScopePlaceholder /></SiteShell>;
  }
  if (!user) {
    return (
      <SiteShell title="請假" schoolName={school.selectedSchool?.name}>
        <SchoolAccountRequired returnUrl="/leave" alternative="可先使用學校正式請假管道辦理。" />
        {school.selectedSchoolId === 'pu' && (
          <p><a href={PROVIDENCE_GUIDE} target="_blank" rel="noopener noreferrer">靜宜大學學生請假說明 ↗</a></p>
        )}
      </SiteShell>
    );
  }
  return (
    <LeaveWorkspace
      key={user.uid + ':' + school.selectedSchoolId + ':' + demoRole}
      uid={user.uid}
      schoolId={school.selectedSchoolId}
      schoolName={school.selectedSchool?.name || '目前學校'}
    />
  );
}

function LeaveWorkspace({ uid, schoolId, schoolName }: {
  uid: string; schoolId: string; schoolName: string;
}) {
  const today = useMemo(taipeiToday, []);
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);
  const [period, setPeriod] = useState<LeavePeriod>('all');
  const [kind, setKind] = useState<LeaveKind>('sick');
  const [detail, setDetail] = useState('');
  const [timetable, setTimetable] = useState<PersonalCourse[] | null>(null);
  const [records, setRecords] = useState<LeaveRequest[] | null>(null);
  const [selection, setSelection] = useState<string[] | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [loadError, setLoadError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const idRef = useRef(newId());
  const busyRef = useRef(false);
  const activeRef = useRef(true);

  const load = useCallback(async (initial = false) => {
    try {
      const [myTimetable, myRecords] = await Promise.all([
        initial ? loadPersonalTimetable(uid, schoolId) : Promise.resolve(null),
        listMyLeaveRequests(uid, schoolId),
      ]);
      if (!activeRef.current) return;
      if (myTimetable) setTimetable(leaveCourseOptions(myTimetable.courses));
      setRecords(myRecords);
      setLoadError('');
    } catch {
      if (activeRef.current) setLoadError('目前無法讀取課表或請假紀錄，請確認連線後重試。');
    }
  }, [uid, schoolId]);

  useEffect(() => {
    activeRef.current = true;
    void Promise.resolve().then(() => load(true));
    return () => { activeRef.current = false; };
  }, [load]);

  const suggested = useMemo(() =>
    suggestedLeaveCourses(timetable || [], startDate, endDate, period, schoolId),
  [timetable, startDate, endDate, period, schoolId]);
  const selectedIds = selection ?? suggested.map((item) => item.id);
  const suggestedSet = new Set(suggested.map((item) => item.id));
  const available = useMemo(() => {
    const matching = new Set(suggested.map((course) => course.id));
    return [...(timetable || [])].sort((a, b) =>
      Number(matching.has(b.id)) - Number(matching.has(a.id)) ||
      a.day - b.day || a.start - b.start || a.name.localeCompare(b.name, 'zh-TW'),
    );
  }, [timetable, suggested]);
  const datesOk = validLeaveDates(startDate, endDate);
  const openCount = (records || []).filter((item) => item.status === 'pending' || item.status === 'partial').length;
  const completedCount = (records || []).filter((item) => item.status === 'completed').length;
  const visible = (records || []).filter((item) => {
    if (filter === 'open') return item.status === 'pending' || item.status === 'partial';
    if (filter === 'completed') return item.status === 'completed';
    if (filter === 'withdrawn') return item.status === 'withdrawn';
    return true;
  });
  function setQuickDate(day: string) {
    setStartDate(day);
    setEndDate(day);
    setSelection(null);
  }
  function toggleCourse(id: string) {
    const next = selectedIds.includes(id)
      ? selectedIds.filter((item) => item !== id)
      : [...selectedIds, id];
    setSelection(next);
  }
  async function submit() {
    if (busyRef.current || !timetable) return;
    if (!datesOk || selectedIds.length === 0) {
      setNotice('請選擇有效日期與至少一門課。');
      return;
    }
    if (selectedIds.length > 20) {
      setNotice('一次最多選擇 20 門課，請分開申請。');
      return;
    }
    const duplicate = (records || []).some((record) =>
      record.status !== 'withdrawn' &&
      record.startDate === startDate &&
      record.endDate === endDate &&
      record.period === period &&
      record.courses.some((course) => selectedIds.includes(course.courseId)),
    );
    if (duplicate) {
      setNotice('這段日期有同一門課的申請紀錄。請先查看下方紀錄，避免重複送出。');
      return;
    }
    busyRef.current = true;
    setBusy(true);
    setNotice('');
    try {
      // Mirrors the existing appeal flow: the server checks a school-scoped timetable.
      await ensureTimetableIndex(uid, schoolId, timetable);
      await submitLeaveRequest(uid, {
        schoolId, requestId: idRef.current, startDate, endDate, kind, period,
        detail: detail.trim(), courseIds: selectedIds,
      });
      idRef.current = newId();
      setDetail('');
      setSelection(null);
      setNotice('已建立 Campus One 請假紀錄。請記得另外完成校方正式請假程序。');
      await load();
    } catch (error) {
      if (activeRef.current) setNotice(leaveRequestError(error));
    } finally {
      if (activeRef.current) {
        busyRef.current = false;
        setBusy(false);
      }
    }
  }
  async function withdraw(id: string) {
    if (busyRef.current || !window.confirm('確定撤回這份尚未核閱的請假紀錄？')) return;
    busyRef.current = true;
    setBusy(true);
    setNotice('');
    try {
      await withdrawLeaveRequest(uid, id);
      if (!activeRef.current) return;
      setNotice('這份站內請假紀錄已撤回。若曾在學校系統申請，仍須另外處理。');
      await load();
    } catch (error) {
      if (activeRef.current) setNotice(leaveRequestError(error));
    } finally {
      if (activeRef.current) {
        setBusy(false);
        busyRef.current = false;
      }
    }
  }

  return (
    <SiteShell title="請假" schoolName={schoolName} subtitle="選日期、帶入課表、查看老師回覆。">
      <div className={styles.workspace}>
        <section className={styles.intro} aria-label="請假說明">
          <div>
            <p className={styles.kicker}>LEAVE REQUESTS</p>
            <h2>一次整理，不再逐門重填。</h2>
            <p>Campus One 幫你整理缺課日期、課程與站內核閱進度。學校正式准假與出缺席紀錄仍以校方系統為準。</p>
          </div>
          <div className={styles.official}>
            <span>正式請假</span>
            <strong>需至學校管道完成</strong>
            {schoolId === 'pu'
              ? <a href={PROVIDENCE_GUIDE} target="_blank" rel="noopener noreferrer">查看靜宜學生請假說明 ↗</a>
              : <span>請依 {schoolName} 規定辦理</span>}
          </div>
        </section>

        <div className={styles.stats} aria-label="請假紀錄概況">
          <div><span>全部紀錄</span><strong>{records?.length ?? '—'}</strong></div>
          <div><span>待處理</span><strong>{records ? openCount : '—'}</strong></div>
          <div><span>站內核閱完成</span><strong>{records ? completedCount : '—'}</strong></div>
        </div>

        {!areFunctionsConfigured() && (
          <section className={styles.alert} role="alert">
            <strong>目前無法使用站內請假流程</strong>
            <p>請假服務尚未接通，這裡不能代為送出。請直接使用學校正式系統。</p>
          </section>
        )}
        {loadError && <section className={styles.alert} role="alert"><p>{loadError}</p><button type="button" onClick={() => void load(true)}>重新讀取</button></section>}
        {notice && <p role="status" aria-live="polite" className={styles.notice}>{notice}</p>}

        <div className={styles.layout}>
          <section className={styles.panel} aria-labelledby="leave-new-title">
            <div className={styles.sectionHead}>
              <div><p className={styles.kicker}>NEW REQUEST</p><h2 id="leave-new-title">新增請假</h2></div>
              <span className={styles.step}>01 — 03</span>
            </div>
            <div className={styles.form}>
              <fieldset className={styles.fieldset}>
                <legend>1. 請哪一天？</legend>
                <div className={styles.quickDates}>
                  <button type="button" aria-pressed={startDate === today && endDate === today} onClick={() => setQuickDate(today)}>今天</button>
                  <button type="button" aria-pressed={startDate === shiftLeaveDay(today, 1) && endDate === shiftLeaveDay(today, 1)} onClick={() => setQuickDate(shiftLeaveDay(today, 1))}>明天</button>
                  <button type="button" aria-pressed={startDate !== endDate} onClick={() => {
                    setEndDate(shiftLeaveDay(startDate, 1)); setSelection(null);
                  }}>多天</button>
                </div>
                <div className={styles.twoColumns}>
                  <label className={styles.field}>開始日期
                    <input type="date" value={startDate} onChange={(event) => {
                      setStartDate(event.target.value); setSelection(null);
                    }} />
                  </label>
                  <label className={styles.field}>結束日期
                    <input type="date" min={startDate} value={endDate} onChange={(event) => {
                      setEndDate(event.target.value); setSelection(null);
                    }} />
                  </label>
                </div>
                {!datesOk && <p role="alert" className={styles.invalid}>結束日不可早於開始日，一次最多 31 天。</p>}
                <div className={styles.periods} role="group" aria-label="請假時段">
                  {LEAVE_PERIODS.map((item) => (
                    <button key={item.id} type="button" aria-pressed={period === item.id} onClick={() => { setPeriod(item.id); setSelection(null); }}>{item.label}</button>
                  ))}
                </div>
              </fieldset>

              <fieldset className={styles.fieldset}>
                <legend>2. 會缺哪幾門課？</legend>
                <p className={styles.help}>根據所選日期，預先勾選課表裡星期相符的課程；可以自行增減。</p>
                {timetable === null
                  ? <p role="status" className={styles.help}>正在讀取課表…</p>
                  : available.length === 0
                    ? <div className={styles.emptySmall}><strong>目前沒有可選的課程</strong><p>先匯入或新增這所學校的課表，回來就能直接選課。</p><Link href="/timetable" className={styles.textLink}>前往我的課表 ↗</Link></div>
                    : <>
                        <div className={styles.selectionSummary}>
                          <span>{selectedIds.length} 門已選</span>
                          <button type="button" onClick={() => setSelection(available.map((course) => course.id).slice(0, 20))}>全選</button>
                          <button type="button" onClick={() => setSelection([])}>清除</button>
                        </div>
                        <div className={styles.courseList}>
                          {available.map((course) => (
                            <label key={course.id} className={styles.courseRow}>
                              <input type="checkbox" checked={selectedIds.includes(course.id)} onChange={() => toggleCourse(course.id)} />
                              <span><strong>{course.name}</strong><small>{course.teacher || '未填教師'} · {course.day ? '週' + '一二三四五六日'.charAt((course.day + 6) % 7) : '時間待定'}{suggestedSet.has(course.id) ? ' · 日期相符' : ''}</small></span>
                            </label>
                          ))}
                        </div>
                      </>}
              </fieldset>

              <fieldset className={styles.fieldset}>
                <legend>3. 假別與補充說明</legend>
                <div className={styles.kindGrid} role="group" aria-label="請假類型">
                  {LEAVE_KINDS.map((item) => (
                    <button type="button" key={item.id} aria-pressed={kind === item.id} onClick={() => setKind(item.id)}>{item.label}</button>
                  ))}
                </div>
                <label className={styles.field}>補充說明 <span className={styles.optional}>選填</span>
                  <textarea rows={3} maxLength={500} value={detail} onChange={(event) => setDetail(event.target.value)} placeholder="可簡短說明需要請假的情況" />
                </label>
                <p className={styles.help}>請勿在這裡輸入診斷證明、病歷或身分證件等敏感資料。各校假別與應附證明可能不同。</p>
              </fieldset>
              <div className={styles.submitArea}>
                <div><strong>{formatLeaveRange(startDate, endDate)} · {selectedIds.length} 門課</strong><p>送出的是 Campus One 站內請假紀錄，非校方正式核假。</p></div>
                <button className={styles.primary} type="button" disabled={busy || !datesOk || !selectedIds.length || !timetable || !areFunctionsConfigured()} onClick={() => void submit()}>{busy ? '處理中…' : '建立請假紀錄'}</button>
              </div>
            </div>
          </section>

          <section className={styles.history} aria-labelledby="leave-history-title">
            <div className={styles.sectionHead}>
              <div><p className={styles.kicker}>YOUR REQUESTS</p><h2 id="leave-history-title">我的請假紀錄</h2></div>
              <button type="button" className={styles.refresh} disabled={busy} onClick={() => void load()}>更新</button>
            </div>
            <div className={styles.filters} role="group" aria-label="篩選請假紀錄">
              {([
                ['all', '全部'], ['open', '處理中'],
                ['completed', '已核閱'], ['withdrawn', '已撤回'],
              ] as const).map(([id, label]) => (
                <button key={id} type="button" aria-pressed={filter === id} onClick={() => setFilter(id)}>{label}</button>
              ))}
            </div>
            {records === null
              ? <div className={styles.empty}>正在讀取你的申請紀錄…</div>
              : visible.length === 0
                ? <div className={styles.empty}><strong>{filter === 'all' ? '還沒有請假紀錄' : '這個狀態沒有紀錄'}</strong><p>建立後，會在這裡看到每門課的站內核閱狀態。</p></div>
                : <ul className={styles.requests}>
                    {visible.map((record) => {
                      const counts = countLeaveReviews(record.courses || []);
                      const isExpanded = expanded === record.id;
                      return <li className={styles.request} key={record.id}>
                        <div className={styles.requestHead}>
                          <span className={record.status === 'withdrawn' ? styles.mutedBadge : styles.statusBadge}>{LEAVE_STATUSES[record.status] || '處理中'}</span>
                          <span>{createdLabel(record.createdAt)}</span>
                        </div>
                        <h3>{leaveKindLabel(record.kind)} · {formatLeaveRange(record.startDate, record.endDate)}</h3>
                        <p>{record.courses.length} 門課 · {LEAVE_PERIODS.find((item) => item.id === record.period)?.label || '全天'} · {counts.approved + counts.rejected}/{counts.total} 門已核閱</p>
                        <div className={styles.progress} aria-label={'已核閱 ' + (counts.approved + counts.rejected) + ' / ' + counts.total}>
                          <span style={{ width: (counts.total ? (counts.approved + counts.rejected) / counts.total * 100 : 0) + '%' }} />
                        </div>
                        <div className={styles.requestActions}>
                          <button type="button" aria-expanded={isExpanded} onClick={() => setExpanded(isExpanded ? null : record.id)}>{isExpanded ? '收合明細' : '查看明細'}</button>
                          {record.status === 'pending' && <button type="button" disabled={busy} onClick={() => void withdraw(record.id)}>撤回</button>}
                        </div>
                        {isExpanded && (
                          <div className={styles.details}>
                            {record.detail && <p className={styles.description}>你的說明：{record.detail}</p>}
                            <ul>
                              {record.courses.map((course) => <li key={course.courseId}>
                                <div><strong>{course.courseName}</strong><span>{LEAVE_REVIEWS[course.reviewStatus] || '待核閱'}</span></div>
                                {course.reviewerNote && <p>師長回覆：{course.reviewerNote}</p>}
                              </li>)}
                            </ul>
                            <p>站內結果不等於學校正式核假。正式出缺勤仍請向學校確認。</p>
                          </div>
                        )}
                      </li>;
                    })}
                  </ul>}
          </section>
        </div>
      </div>
    </SiteShell>
  );
}
