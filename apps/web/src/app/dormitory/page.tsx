'use client';

import { useEffect, useRef, useState } from 'react';
import { resolveSchoolPublicServices } from '@campus/shared/src/schoolPublicServices';
import {
  DORM_CHECKLISTS,
  DORM_REPAIR_CATEGORIES,
  DORM_REPAIR_STATUSES,
  dormChecklistProgress,
  dormStorageKey,
  emptyDormWorkspace,
  formatDormRepairForCopy,
  normalizeDormWorkspace,
  type DormRepair,
  type DormRepairCategory,
  type DormRepairStatus,
  type DormWorkspace,
} from '@campus/shared/src/dormitory';
import { useAuth } from '@/components/AuthGuard';
import { SiteShell } from '@/components/SiteShell';
import { useOptionalNuniSession } from '@/features/nuni/Session';
import { useCampusBrowseContext } from '@/lib/useCampusBrowseContext';
import styles from './dormitory.module.css';

type View = 'overview' | 'repairs' | 'checklist' | 'laundry';
type StorageState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: DormWorkspace };
type RepairDraft = {
  category: DormRepairCategory;
  title: string;
  location: string;
  description: string;
};

const EMPTY_REPAIR: RepairDraft = { category: 'other', title: '', location: '', description: '' };
const VIEWS: ReadonlyArray<{ id: View; label: string }> = [
  { id: 'overview', label: '總覽' },
  { id: 'repairs', label: '設備問題' },
  { id: 'checklist', label: '入住與退宿' },
  { id: 'laundry', label: '洗衣計時' },
];

function DormitoryWorkspace({ scope, schoolId, schoolName, guest }: {
  scope: string;
  schoolId: string;
  schoolName: string;
  guest: boolean;
}) {
  const [storage, setStorage] = useState<StorageState>({ status: 'loading' });
  const [view, setView] = useState<View>('overview');
  const [notice, setNotice] = useState('');
  const [saveError, setSaveError] = useState('');
  const [conflict, setConflict] = useState(false);
  const [infoDraft, setInfoDraft] = useState({ building: '', room: '', bed: '' });
  const [repairDraft, setRepairDraft] = useState<RepairDraft>(EMPTY_REPAIR);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [repairFilter, setRepairFilter] = useState<'all' | DormRepairStatus>('all');
  const [laundryMinutes, setLaundryMinutes] = useState(45);
  const [now, setNow] = useState(() => Date.now());
  const savedRaw = useRef<string | null>(null);
  const official = resolveSchoolPublicServices(schoolId)?.services.dormitory ?? null;

  const reload = () => {
    try {
      const raw = localStorage.getItem(scope);
      const data = normalizeDormWorkspace(raw ? JSON.parse(raw) : emptyDormWorkspace());
      savedRaw.current = raw;
      setStorage({ status: 'ready', data });
      setInfoDraft({ building: data.building, room: data.room, bed: data.bed });
      setConflict(false);
      setSaveError('');
      setNotice('');
    } catch {
      setStorage({ status: 'error', message: '無法讀取這台裝置的宿舍紀錄。請檢查瀏覽器的儲存權限。' });
    }
  };

  useEffect(() => {
    // Read after hydration. The keyed workspace prevents cross-school/account reuse.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    reload();
    const onStorage = (event: StorageEvent) => {
      if (event.key === scope || event.key === null) setConflict(true);
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
    // Only bind the active, immutable workspace identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 15000);
    return () => window.clearInterval(timer);
  }, []);

  function save(next: DormWorkspace): boolean {
    try {
      if (localStorage.getItem(scope) !== savedRaw.current) {
        setConflict(true);
        setSaveError('另一個分頁已修改紀錄。為了避免覆蓋資料，請先重新載入本裝置最新紀錄。');
        return false;
      }
      const cleaned = normalizeDormWorkspace(next);
      const raw = JSON.stringify(cleaned);
      localStorage.setItem(scope, raw);
      savedRaw.current = raw;
      setStorage({ status: 'ready', data: cleaned });
      setSaveError('');
      setNotice('已儲存在這台裝置');
      return true;
    } catch {
      setSaveError('儲存失敗。請檢查瀏覽器儲存空間及權限後重試，表單內容已保留。');
      return false;
    }
  }

  function beginRepair(repair?: DormRepair) {
    setEditingId(repair?.id ?? null);
    setPendingId(null);
    setRepairDraft(repair
      ? { title: repair.title, category: repair.category, location: repair.location, description: repair.description }
      : { ...EMPTY_REPAIR });
    setEditorOpen(true);
    setDeleteId(null);
    setNotice('');
    setView('repairs');
  }

  async function copyRepair(repair: DormRepair) {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(formatDormRepairForCopy(repair));
      setNotice('已複製問題說明，請依該校正式管道通報。');
    } catch {
      setSaveError('無法自動複製。請選取問題文字，手動複製後交給住宿服務單位。');
    }
  }

  function saveRepair(data: DormWorkspace) {
    const title = repairDraft.title.trim();
    if (title.length < 2) {
      setSaveError('請填寫至少兩個字的問題名稱。');
      return;
    }
    if (!editingId && data.repairs.length >= 80) {
      setSaveError('本裝置最多保留 80 筆紀錄，請先整理舊資料。');
      return;
    }
    const current = data.repairs.find((item) => item.id === editingId);
    const id = editingId ?? pendingId ?? ('repair_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 9));
    setPendingId(id);
    const next: DormRepair = {
      id,
      title,
      category: repairDraft.category,
      location: repairDraft.location.trim(),
      description: repairDraft.description.trim(),
      status: current?.status ?? 'draft',
      createdAt: current?.createdAt ?? Date.now(),
      updatedAt: Date.now(),
    };
    if (save({ ...data, repairs: [next, ...data.repairs.filter((item) => item.id !== id)] })) {
      setEditorOpen(false);
      setRepairDraft({ ...EMPTY_REPAIR });
      setEditingId(null);
      setPendingId(null);
    }
  }

  if (storage.status !== 'ready') {
    return (
      <SiteShell title="宿舍" subtitle={schoolName}>
        <section className={styles.panel} role={storage.status === 'error' ? 'alert' : 'status'}>
          <h2>{storage.status === 'loading' ? '正在開啟你的住宿工作區…' : '宿舍紀錄暫時無法載入'}</h2>
          {storage.status === 'error' && <><p>{storage.message}</p><button type="button" onClick={reload}>重新讀取</button></>}
        </section>
      </SiteShell>
    );
  }

  const data = storage.data;
  const progress = dormChecklistProgress(data);
  const openRepairs = data.repairs.filter((item) => item.status !== 'resolved');
  const visibleRepairs = data.repairs.filter((item) => repairFilter === 'all' || item.status === repairFilter);
  const remaining = data.laundryEndAt ? Math.max(0, Math.ceil((data.laundryEndAt - now) / 60000)) : 0;

  return (
    <SiteShell title="宿舍" subtitle="住宿安排與生活紀錄，依目前選擇的學校顯示。" schoolName={schoolName}>
      <div className={styles.stack}>
        <section className={styles.hero}>
          <div>
            <p className={styles.eyebrow}>{schoolName} · 個人住宿工作區</p>
            <h2>{data.building ? data.building : '先把住宿大小事安排好'}</h2>
            <p>{data.room ? '寢室 ' + data.room + (data.bed ? ' · ' + data.bed : '') : '房間資訊可自行記下，校方分配與繳費狀態仍以正式系統為準。'}</p>
          </div>
          <div className={styles.heroStats} aria-label="個人紀錄摘要">
            <div><strong>{openRepairs.length}</strong><span>待追蹤問題</span></div>
            <div><strong>{progress.completed}/{progress.total}</strong><span>準備事項</span></div>
          </div>
        </section>

        <nav className={styles.tabs} aria-label="宿舍功能">
          {VIEWS.map((item) => (
            <button key={item.id} type="button" aria-pressed={view === item.id}
              onClick={() => { setView(item.id); setNotice(''); setSaveError(''); }}>
              {item.label}
            </button>
          ))}
        </nav>

        {guest && (
          <p className={styles.note}>目前是訪客模式。紀錄只保存在此瀏覽器，不會在登入後自動轉到其他帳號，也不會同步到手機。</p>
        )}
        {!guest && (
          <p className={styles.note}>此處是個人管理工具，資料僅保存在這台裝置；切換帳號或校園後會使用不同紀錄，不代表學校正式申請資料。</p>
        )}
        {conflict && (
          <section className={styles.warning} role="alert">
            <strong>有另一處修改了這份紀錄</strong>
            <p>目前的表單文字仍在畫面上，但不會覆蓋另一分頁的內容。先複製未儲存的文字，再重新讀取。</p>
            <button type="button" onClick={reload}>重新讀取最新紀錄</button>
          </section>
        )}
        {saveError && <p role="alert" className={styles.error}>{saveError}</p>}
        {notice && <p role="status" className={styles.success}>{notice}</p>}

        {view === 'overview' && (
          <div className={styles.columns}>
            <section className={styles.panel}>
              <div className={styles.sectionTitle}><div><p className={styles.eyebrow}>MY ROOM</p><h3>我的住宿資訊</h3></div></div>
              <p className={styles.muted}>這是自己保存的備忘，不會變更校方床位或住宿資格。</p>
              <div className={styles.formGrid}>
                <label>宿舍或學苑名稱<input maxLength={70} value={infoDraft.building} onChange={(e) => setInfoDraft({ ...infoDraft, building: e.target.value })} placeholder="例如：○○學苑" /></label>
                <label>寢室<input maxLength={50} value={infoDraft.room} onChange={(e) => setInfoDraft({ ...infoDraft, room: e.target.value })} placeholder="自行記錄房號" /></label>
                <label>床位<input maxLength={40} value={infoDraft.bed} onChange={(e) => setInfoDraft({ ...infoDraft, bed: e.target.value })} placeholder="例如：A 床" /></label>
              </div>
              <button className={styles.primary} type="button" onClick={() => save({ ...data, ...infoDraft })}>儲存住宿備忘</button>
            </section>
            <div className={styles.side}>
              <section className={styles.panel}>
                <div className={styles.sectionTitle}><h3>接下來可以做</h3></div>
                <p>已勾選 {progress.completed} / {progress.total} 項準備事項。</p>
                <button type="button" className={styles.secondary} onClick={() => setView('checklist')}>查看入住與退宿清單</button>
                <p className={styles.muted}>{openRepairs.length ? '還有 ' + openRepairs.length + ' 筆設備問題待追蹤。' : '目前沒有待追蹤的設備問題。'}</p>
                <button type="button" className={styles.secondary} onClick={() => setView('repairs')}>查看設備問題</button>
              </section>
              <section className={styles.panel}>
                <div className={styles.sectionTitle}><h3>學校正式入口</h3></div>
                {official ? (
                  <>
                    <p>抽籤、床位、繳費、退宿與正式報修，請從校方指定管道確認。</p>
                    <a className={styles.external} href={official.url} target="_blank" rel="noopener noreferrer">{official.label} ↗</a>
                    <p className={styles.source}>來源：{official.sourceLabel}</p>
                  </>
                ) : <p>目前尚未核實這所學校的住宿專屬入口，請使用學校官方網站或詢問住宿服務單位。</p>}
              </section>
            </div>
          </div>
        )}

        {view === 'repairs' && (
          <section className={styles.panel}>
            <div className={styles.sectionTitle}>
              <div><p className={styles.eyebrow}>MAINTENANCE NOTES</p><h3>設備問題紀錄</h3></div>
              <button type="button" className={styles.primary} onClick={() => beginRepair()}>＋ 記錄問題</button>
            </div>
            <p className={styles.muted}>儲存只是個人備忘，不會送出報修。已向校方通報的狀態由你自行註記，不是校方系統回覆。</p>
            {editorOpen && (
              <form className={styles.editor} aria-label="設備問題表單" onSubmit={(e) => { e.preventDefault(); saveRepair(data); }}>
                <h4>{editingId ? '編輯問題' : '新增問題'}</h4>
                <div className={styles.formGrid}>
                  <label>問題名稱 *<input required minLength={2} maxLength={90} value={repairDraft.title} onChange={(e) => setRepairDraft({ ...repairDraft, title: e.target.value })} placeholder="例如：浴室水龍頭持續滴水" /></label>
                  <label>類別<select value={repairDraft.category} onChange={(e) => setRepairDraft({ ...repairDraft, category: e.target.value as DormRepairCategory })}>{Object.entries(DORM_REPAIR_CATEGORIES).map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select></label>
                  <label>位置<input maxLength={100} value={repairDraft.location} onChange={(e) => setRepairDraft({ ...repairDraft, location: e.target.value })} placeholder="例如：浴室洗手台" /></label>
                  <label className={styles.wide}>詳細狀況<textarea rows={4} maxLength={1200} value={repairDraft.description} onChange={(e) => setRepairDraft({ ...repairDraft, description: e.target.value })} placeholder="故障情況、開始時間、需要注意的事項" /></label>
                </div>
                <div className={styles.actions}><button type="submit" className={styles.primary}>儲存紀錄</button><button type="button" className={styles.secondary} onClick={() => { setEditorOpen(false); setEditingId(null); setPendingId(null); }}>取消</button></div>
              </form>
            )}
            <div className={styles.filters} role="group" aria-label="問題狀態篩選">
              {(['all', 'draft', 'reported', 'resolved'] as const).map((status) => (
                <button type="button" key={status} aria-pressed={repairFilter === status}
                  onClick={() => setRepairFilter(status)}>{status === 'all' ? '全部' : DORM_REPAIR_STATUSES[status]}</button>
              ))}
            </div>
            {visibleRepairs.length ? (
              <ul className={styles.repairs}>
                {visibleRepairs.map((item) => (
                  <li key={item.id}>
                    <div className={styles.repairHead}><div><span className={styles.category}>{DORM_REPAIR_CATEGORIES[item.category]}</span><h4>{item.title}</h4></div><span className={styles.status}>{DORM_REPAIR_STATUSES[item.status]}</span></div>
                    {item.location && <p>位置：{item.location}</p>}
                    {item.description && <p className={styles.description}>{item.description}</p>}
                    <p className={styles.source}>最後更新：{item.updatedAt ? new Date(item.updatedAt).toLocaleDateString('zh-TW') : '未記錄'}</p>
                    <div className={styles.actions}>
                      <button type="button" onClick={() => beginRepair(item)}>編輯</button>
                      <button type="button" onClick={() => void copyRepair(item)}>複製通報文字</button>
                      {item.status === 'draft' && <button type="button" onClick={() => save({ ...data, repairs: data.repairs.map((r) => r.id === item.id ? { ...r, status: 'reported', updatedAt: Date.now() } : r) })}>我已自行通報</button>}
                      {item.status !== 'resolved' && <button type="button" onClick={() => save({ ...data, repairs: data.repairs.map((r) => r.id === item.id ? { ...r, status: 'resolved', updatedAt: Date.now() } : r) })}>我已確認修復</button>}
                      {deleteId === item.id ? (
                        <><button className={styles.danger} type="button" onClick={() => { if (save({ ...data, repairs: data.repairs.filter((r) => r.id !== item.id) })) setDeleteId(null); }}>確認刪除</button><button type="button" onClick={() => setDeleteId(null)}>保留</button></>
                      ) : <button type="button" onClick={() => setDeleteId(item.id)}>刪除</button>}
                    </div>
                  </li>
                ))}
              </ul>
            ) : <div className={styles.empty}><h4>這個狀態還沒有紀錄</h4><p>遇到設備問題時可以先記下細節，再到校方正式管道辦理。</p></div>}
          </section>
        )}

        {view === 'checklist' && (
          <div className={styles.checklist}>
            <div className={styles.panel}><p className={styles.eyebrow}>PERSONAL CHECKLIST</p><h3>入住與退宿清單</h3><p>勾選只記錄自己的準備進度，不會建立校方申請。總進度：{progress.completed} / {progress.total}</p><progress max={progress.total} value={progress.completed} aria-label="準備事項完成進度" /></div>
            {DORM_CHECKLISTS.map((group) => (
              <section className={styles.panel} key={group.stage}>
                <div className={styles.sectionTitle}><h3>{group.title}</h3><span className={styles.status}>{group.items.filter((item) => data.checkmarks[item.id]).length} / {group.items.length}</span></div>
                <ul className={styles.tasks}>
                  {group.items.map((item) => (
                    <li key={item.id}><label><input type="checkbox" checked={Boolean(data.checkmarks[item.id])} onChange={(e) => save({ ...data, checkmarks: { ...data.checkmarks, [item.id]: e.target.checked } })} /><span><strong>{item.title}</strong><small>{item.detail}</small></span></label></li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}

        {view === 'laundry' && (
          <div className={styles.columns}>
            <section className={styles.panel}>
              <p className={styles.eyebrow}>LAUNDRY TIMER</p><h3>個人洗衣計時</h3>
              <p>手動記錄這次洗衣或烘衣的預估完成時間。沒有連線洗衣機，也不顯示即時空機狀態。</p>
              <div className={styles.clock} role="status" aria-live="off">
                <strong>{data.laundryEndAt ? (remaining ? remaining + ' 分鐘' : '預估已完成') : '尚未開始'}</strong>
                <span>{data.laundryEndAt ? '預估結束：' + new Date(data.laundryEndAt).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' }) : '可依機台標示選擇時間'}</span>
              </div>
              <label className={styles.timerSelect}>預估運轉時間
                <select value={laundryMinutes} onChange={(e) => setLaundryMinutes(Number(e.target.value))}>
                  {[30, 40, 45, 60, 75, 90].map((m) => <option value={m} key={m}>{m} 分鐘</option>)}
                </select>
              </label>
              <div className={styles.actions}><button className={styles.primary} type="button" onClick={() => { if (save({ ...data, laundryEndAt: Date.now() + laundryMinutes * 60000 })) setNow(Date.now()); }}>開始計時</button>{data.laundryEndAt && <button className={styles.secondary} type="button" onClick={() => save({ ...data, laundryEndAt: null })}>清除計時</button>}</div>
            </section>
            <section className={styles.panel}>
              <h3>使用提醒</h3><p>實際機台運作、開放時段、費用與故障處理，以宿舍現場與承包廠商公告為準。</p>
              {official && <a className={styles.external} href={official.url} target="_blank" rel="noopener noreferrer">查看校方住宿資訊 ↗</a>}
            </section>
          </div>
        )}
      </div>
    </SiteShell>
  );
}

export default function DormitoryPage() {
  const { user, loading } = useAuth();
  const nuni = useOptionalNuniSession();
  const campus = useCampusBrowseContext();
  if (loading || nuni?.loading || campus.status === 'loading') {
    return <SiteShell title="宿舍"><p role="status">正在確認帳號與校園…</p></SiteShell>;
  }
  if (campus.status !== 'ready' || !campus.schoolId) {
    return (
      <SiteShell title="宿舍">
        <section className={styles.panel} role={campus.status === 'error' ? 'alert' : 'status'}>
          <h2>{campus.status === 'error' ? '目前無法取得學校名錄' : '請先選擇學校'}</h2>
          <p>從頁首選擇要查詢的校園，才能開啟該校的住宿入口與個人紀錄。</p>
        </section>
      </SiteShell>
    );
  }
  const owner = user
    ? 'firebase:' + user.uid
    : nuni?.session
      ? 'platform:' + nuni.session.platformAccountId
      : 'guest';
  const scope = dormStorageKey(owner, campus.schoolId);
  return (
    <DormitoryWorkspace
      key={scope}
      scope={scope}
      schoolId={campus.schoolId}
      schoolName={campus.schoolName}
      guest={owner === 'guest'}
    />
  );
}
