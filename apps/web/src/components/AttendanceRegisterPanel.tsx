'use client';

import { useEffect, useState } from 'react';
import { attendanceError } from '@/lib/courseAttendance';
import { loadAttendanceRegister } from '@/lib/loadAttendanceRegister';
import { watchAttendanceRegister, type LiveAttendanceRegister, type RegisterSyncState } from '@/lib/watchAttendanceRegister';
import {
  REGISTER_LABELS, attendanceRegisterCsv, filterAttendanceRegister, summarizeAttendanceRegister,
  type AttendanceRegister, type RegisterFilter, type RegisterStatus,
} from '@/lib/attendanceRegister';
import { Button } from './ui/Button';
import styles from './attendance-register.module.css';
import liveStyles from './attendance-register-live.module.css';

const PAGE_SIZE = 30;
const filters: RegisterFilter[] = ['all', 'unconfirmed', 'present', 'late', 'absent', 'excused', 'unavailable'];
const time = (value: string | null) => value
  ? new Date(value).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  : '—';

type Props = {
  courseId: string;
  sessionId: string;
  revision?: number;
  disabled?: boolean;
  onCorrect: (uid: string) => void;
};

export function AttendanceRegisterPanel(props: Props) {
  const [open, setOpen] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [filter, setFilter] = useState<RegisterFilter>('all');
  const [search, setSearch] = useState('');
  const [shown, setShown] = useState(PAGE_SIZE);
  const [liveMode, setLiveMode] = useState(false);
  return (
    <section className={styles.register} aria-label="全班出席名冊">
      <div className={styles.heading}>
        <div><h4>全班出席</h4><p>對照目前修課名冊，不把未簽到當成缺席。</p></div>
        <Button variant="outline" disabled={props.disabled} aria-expanded={open}
          aria-controls={`register-${props.sessionId}`}
          onClick={() => setOpen((value) => !value)}>
          {open ? '收合全班名冊' : '查看全班名冊'}
        </Button>
      </div>
      {open && (
        <div id={`register-${props.sessionId}`}>
          <div className={liveStyles.control}>
            <div>
              <strong>{liveMode ? '即時名冊已開啟' : '手動查核名冊'}</strong>
              <p id={`register-live-hint-${props.sessionId}`}>
                {liveMode
                  ? '學生簽到、教師更正與修課異動會自動更新；背景與離線時暫停。'
                  : '開啟後不用反覆重新整理；會使用資料庫讀取額度，收合名冊即停止。'}
              </p>
            </div>
            <Button type="button" variant="outline" role="switch"
              aria-label="自動更新全班名冊" aria-checked={liveMode}
              aria-describedby={`register-live-hint-${props.sessionId}`} disabled={props.disabled}
              onClick={() => setLiveMode((value) => !value)}>
              {liveMode ? '關閉自動更新' : '開啟自動更新'}
            </Button>
          </div>
          <RegisterContents key={`${props.courseId}:${props.sessionId}:${liveMode ? 'live' : props.revision ?? 0}:${attempt}`}
            {...props} liveMode={liveMode} filter={filter} search={search} shown={shown}
            onFilter={(value) => { setFilter(value); setShown(PAGE_SIZE); }}
            onSearch={(value) => { setSearch(value); setShown(PAGE_SIZE); }}
            onMore={() => setShown((value) => value + PAGE_SIZE)}
            onRefresh={() => setAttempt((value) => value + 1)} />
        </div>
      )}
    </section>
  );
}

function RegisterContents({
  courseId, sessionId, disabled, onCorrect, liveMode, filter, search, shown,
  onFilter, onSearch, onMore, onRefresh,
}: Props & {
  liveMode: boolean; filter: RegisterFilter; search: string; shown: number;
  onFilter: (value: RegisterFilter) => void;
  onSearch: (value: string) => void;
  onMore: () => void; onRefresh: () => void;
}) {
  const [data, setData] = useState<(AttendanceRegister & Partial<Pick<LiveAttendanceRegister, 'membersComplete' | 'receiptsComplete'>>) | null>(null);
  const [syncState, setSyncState] = useState<RegisterSyncState>('connecting');
  const [error, setError] = useState('');
  const [exportError, setExportError] = useState('');
  useEffect(() => {
    let current = true;
    if (liveMode) {
      const stop = watchAttendanceRegister({
        courseId, sessionId,
        onData: (value) => { if (current) setData(value); },
        onState: (state) => {
          if (!current) return;
          setSyncState(state);
          // 網路恢復不代表已向伺服器核實；不保留可供誤用的舊名冊。
          if (state !== 'live') setData(null);
        },
      });
      return () => { current = false; stop(); };
    }
    void loadAttendanceRegister(courseId, sessionId).then(
      (value) => { if (current) setData(value); },
      (problem: unknown) => { if (current) setError(attendanceError(problem)); },
    );
    return () => { current = false; };
  }, [courseId, sessionId, liveMode]);
  if (liveMode && syncState !== 'live') {
    const copy: Record<Exclude<RegisterSyncState, 'live'>, string> = {
      connecting: '正在向伺服器核對完整名冊；確認前不顯示舊資料。',
      paused: '名冊自動更新已暫停，返回此頁後會重新核對。',
      offline: '目前離線，已隱藏名冊並停止匯出與更正；連線後會重新核對。',
      error: '名冊同步中斷或授課資格已變更。請重新連線確認，不沿用舊資料。',
    };
    return <div className={styles.message}>
      <p role={syncState === 'error' ? 'alert' : 'status'}>{copy[syncState]}</p>
      {(syncState === 'error' || syncState === 'offline') &&
        <Button type="button" onClick={onRefresh} disabled={disabled}>重新連線名冊</Button>}
    </div>;
  }
  if (error) return (
    <div className={styles.message}>
      <p role="alert">名冊暫時無法核實。{error}</p>
      <Button onClick={onRefresh} disabled={disabled}>重新讀取名冊</Button>
    </div>
  );
  if (!data) return <p role="status" className={styles.message}>正在核對全班名冊與出席紀錄…</p>;
  const counts = summarizeAttendanceRegister(data.rows);
  const visible = filterAttendanceRegister(data.rows, filter, search);
  const hasUnverified = counts.unavailable > 0;
  function download() {
    if (!data || !data.complete || !visible.length || disabled) return;
    setExportError('');
    let url: string | null = null;
    try {
      url = URL.createObjectURL(new Blob([attendanceRegisterCsv(visible, data.checkedAt)], {
        type: 'text/csv;charset=utf-8',
      }));
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `attendance-register-${sessionId}.csv`;
      anchor.click();
      const created = url;
      window.setTimeout(() => URL.revokeObjectURL(created), 1000);
    } catch {
      if (url) URL.revokeObjectURL(url);
      setExportError('無法匯出檔案，請改用一般瀏覽器重試。');
    }
  }
  return (
    <div className={styles.content}>
      <div className={styles.toolbar}>
        <p>{data.membersComplete === false ? '已讀取修課' : '目前修課'} {data.rows.length} 人 · {data.active ? '點名進行中' : '點名已結束'}<br />
          <small>查核於 {time(data.checkedAt)}；{liveMode ? '自動更新中，匯出仍為當下快照。' : '不是自動更新的即時名單。'}</small></p>
        <div className={styles.actions}>
          <Button onClick={onRefresh} disabled={disabled}>更新全班名冊</Button>
          <Button onClick={download} disabled={disabled || !data.complete || !visible.length}>匯出篩選名冊</Button>
        </div>
      </div>
      <div className={styles.filters} role="group" aria-label="篩選全班出席狀態">
        {filters.map((value) => (
          <button key={value} type="button" aria-pressed={filter === value} onClick={() => onFilter(value)}>
            {value === 'all' ? '全部' : REGISTER_LABELS[value as RegisterStatus]}
            <span>{value === 'all' ? data.rows.length : counts[value as RegisterStatus]}</span>
          </button>
        ))}
      </div>
      <label className={styles.search} htmlFor={`register-search-${sessionId}`}>
        搜尋全班名冊
        <input id={`register-search-${sessionId}`} type="search" value={search}
          placeholder="姓名、學號或帳號" autoComplete="off" onChange={(event) => onSearch(event.target.value)} />
      </label>
      {!data.complete && <p role="status" className={styles.warning}>
        {data.membersComplete === false
          ? '即時模式最多核對 500 筆有效成員，這不是完整班級名冊。請關閉自動更新，使用手動查核；目前不開放匯出。'
          : '本次最多核對 500 筆出席紀錄，尚未讀取的資料一律標為待核實；不會推定為缺席，也不開放匯出不完整名冊。'}
      </p>}
      {data.complete && hasUnverified && <p role="status" className={styles.warning}>
        部分紀錄的身分或時間無法核實，暫不開放直接更正；請由管理者檢查資料。
      </p>}
      <p className={styles.result} role="status">符合條件 {visible.length} 人</p>
      {visible.length ? <ul className={styles.rows} aria-label="學生出席明細">
        {visible.slice(0, shown).map((row) => (
          <li key={row.uid}>
            <div className={styles.person}><strong>{row.displayName}</strong><small>{row.studentId || row.uid}</small></div>
            <div className={styles.state}>
              <span className={styles.badge} data-status={row.status}>{REGISTER_LABELS[row.status]}</span>
              <small>{row.source === 'manual' ? `教師核定 ${time(row.correctedAt)}` :
                row.source === 'qr' ? `QR 簽到 ${time(row.checkedInAt)}` :
                row.status === 'unconfirmed' ? '尚未找到個人紀錄' : row.status === 'unavailable' ? '資料需要重新核對' : '已核實紀錄'}</small>
            </div>
            <Button variant="outline" disabled={disabled || row.status === 'unavailable'}
              aria-label={`更正 ${row.displayName} ${row.studentId || row.uid}`}
              onClick={() => onCorrect(row.uid)}>更正紀錄</Button>
          </li>
        ))}
      </ul> : <p className={styles.message}>{data.rows.length ? '沒有符合條件的學生。' : '目前沒有有效修課學生。'}</p>}
      {visible.length > shown && <Button onClick={onMore}>顯示更多學生（剩餘 {visible.length - shown} 人）</Button>}
      {exportError && <p role="alert" className={styles.warning}>{exportError}</p>}
      <p className={styles.footnote}>依目前有效修課成員顯示，不代表學期初名冊；尚無紀錄與待核實都不是缺席。匯出包含所有符合篩選條件的學生，不限於目前展開的列數。</p>
    </div>
  );
}
