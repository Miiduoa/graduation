'use client';

import { useEffect, useRef, useState } from 'react';
import { resolveSchoolPublicServices } from '@campus/shared/src/schoolPublicServices';
import {
  DORM_CHECKLISTS,
  DORM_INSPECTION_ITEMS,
  DORM_MILESTONE_LIMIT,
  DORM_PARCEL_LIMIT,
  DORM_REPAIR_SHORTCUTS,
  DORM_REPAIR_CATEGORIES,
  DORM_REPAIR_STATUSES,
  dormChecklistProgress,
  dormInspectionProgress,
  dormStorageKey,
  emptyDormWorkspace,
  formatDormRepairForCopy,
  isValidDormDate,
  localDormDate,
  normalizeDormWorkspace,
  sortedDormMilestones,
  sortedDormParcels,
  type DormMilestone,
  type DormParcel,
  type DormRepair,
  type DormRepairCategory,
  type DormRepairStatus,
  type DormWorkspace,
} from '@campus/shared/src/dormitory';
import { resolveDormitoryPublicGuide } from '@campus/shared/src/dormitoryGuide';
import { useAuth } from '@/components/AuthGuard';
import { SiteShell } from '@/components/SiteShell';
import { VoiceDictationButton } from '@/components/VoiceDictationButton';
import { parseDormRepairDictation } from '@/lib/dormRepairDictation';
import { useOptionalNuniSession } from '@/features/nuni/Session';
import { useCampusBrowseContext } from '@/lib/useCampusBrowseContext';
import styles from './dormitory.module.css';

type View = 'overview' | 'guide' | 'repairs' | 'parcels' | 'dates' | 'checklist' | 'laundry';
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

type ParcelDraft = { title: string; pickupPoint: string; dueDate: string };
const EMPTY_REPAIR: RepairDraft = { category: 'other', title: '', location: '', description: '' };
const EMPTY_PARCEL: ParcelDraft = { title: '', pickupPoint: '', dueDate: '' };
const VIEWS: ReadonlyArray<{ id: View; label: string }> = [
  { id: 'overview', label: '總覽' },
  { id: 'guide', label: '宿舍指南' },
  { id: 'repairs', label: '設備問題' },
  { id: 'parcels', label: '包裹領取' },
  { id: 'dates', label: '重要日期' },
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
  const [milestoneDraft, setMilestoneDraft] = useState({ title: '', dueDate: '' });
  const [milestoneEditorOpen, setMilestoneEditorOpen] = useState(false);
  const [editingMilestoneId, setEditingMilestoneId] = useState<string | null>(null);
  const [pendingMilestoneId, setPendingMilestoneId] = useState<string | null>(null);
  const [deleteMilestoneId, setDeleteMilestoneId] = useState<string | null>(null);
  const [parcelDraft, setParcelDraft] = useState<ParcelDraft>(EMPTY_PARCEL);
  const [parcelEditorOpen, setParcelEditorOpen] = useState(false);
  const [editingParcelId, setEditingParcelId] = useState<string | null>(null);
  const [pendingParcelId, setPendingParcelId] = useState<string | null>(null);
  const [deleteParcelId, setDeleteParcelId] = useState<string | null>(null);
  const [parcelFilter, setParcelFilter] = useState<'all' | 'waiting' | 'collected'>('waiting');
  const [laundryMinutes, setLaundryMinutes] = useState(45);
  const [now, setNow] = useState(() => Date.now());
  const savedRaw = useRef<string | null>(null);
  const tabsRef = useRef<HTMLElement>(null);
  const [reloadVersion, setReloadVersion] = useState(0);
  const official = resolveSchoolPublicServices(schoolId)?.services.dormitory ?? null;
  const guide = resolveDormitoryPublicGuide(schoolId);

  const reload = (requested = false) => {
    try {
      const raw = localStorage.getItem(scope);
      const data = normalizeDormWorkspace(raw ? JSON.parse(raw) : emptyDormWorkspace());
      savedRaw.current = raw;
      setStorage({ status: 'ready', data });
      setInfoDraft({ building: data.building, room: data.room, bed: data.bed });
      setEditorOpen(false);
      setEditingId(null);
      setPendingId(null);
      setDeleteId(null);
      setRepairDraft({ ...EMPTY_REPAIR });
      setMilestoneEditorOpen(false);
      setEditingMilestoneId(null);
      setPendingMilestoneId(null);
      setDeleteMilestoneId(null);
      setMilestoneDraft({ title: '', dueDate: '' });
      setParcelEditorOpen(false);
      setEditingParcelId(null);
      setPendingParcelId(null);
      setDeleteParcelId(null);
      setParcelDraft({ ...EMPTY_PARCEL });
      setConflict(false);
      setSaveError('');
      setNotice(requested ? '已重新讀取最新紀錄。請依更新後的內容重新編輯或確認刪除。' : '');
      if (requested) setReloadVersion((version) => version + 1);
    } catch {
      setStorage({ status: 'error', message: '無法讀取這台裝置的宿舍紀錄。請檢查瀏覽器的儲存權限。' });
    }
  };

  useEffect(() => {
    if (reloadVersion > 0) {
      const activeTab = tabsRef.current?.querySelector<HTMLButtonElement>('button[aria-pressed="true"]');
      activeTab?.scrollIntoView?.({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
      activeTab?.focus({ preventScroll: true });
    }
  }, [reloadVersion]);

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
        setSaveError('');
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

  function beginRepair(repair?: DormRepair, shortcut?: { category: DormRepairCategory; title: string }) {
    setEditingId(repair?.id ?? null);
    setPendingId(null);
    const currentRoom = storage.status === 'ready' ? storage.data.room : '';
    setRepairDraft(repair
      ? { title: repair.title, category: repair.category, location: repair.location, description: repair.description }
      : {
        ...EMPTY_REPAIR,
        category: shortcut?.category ?? 'other',
        title: shortcut?.title ?? '',
        location: currentRoom ? '寢室 ' + currentRoom : '',
      });
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

  function beginMilestone(entry?: DormMilestone) {
    setMilestoneDraft({ title: entry?.title ?? '', dueDate: entry?.dueDate ?? '' });
    setEditingMilestoneId(entry?.id ?? null);
    setPendingMilestoneId(null);
    setDeleteMilestoneId(null);
    setMilestoneEditorOpen(true);
    setSaveError('');
    setNotice('');
    setView('dates');
  }

  function saveMilestone(data: DormWorkspace) {
    const title = milestoneDraft.title.trim();
    const dueDate = milestoneDraft.dueDate.trim();
    if (title.length < 2 || !isValidDormDate(dueDate)) {
      setSaveError('請填寫至少兩個字的事項名稱，並選擇有效日期。');
      return;
    }
    if (!editingMilestoneId && data.milestones.length >= DORM_MILESTONE_LIMIT) {
      setSaveError('重要日期最多可記錄 30 筆，請先整理已完成的事項。');
      return;
    }
    const previous = data.milestones.find((entry) => entry.id === editingMilestoneId);
    const id = editingMilestoneId ?? pendingMilestoneId ??
      ('date_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 9));
    setPendingMilestoneId(id);
    const entry: DormMilestone = {
      id,
      title,
      dueDate,
      completed: previous?.completed ?? false,
      createdAt: previous?.createdAt ?? Date.now(),
    };
    if (save({ ...data, milestones: [entry, ...data.milestones.filter((item) => item.id !== id)] })) {
      setMilestoneEditorOpen(false);
      setEditingMilestoneId(null);
      setPendingMilestoneId(null);
      setMilestoneDraft({ title: '', dueDate: '' });
    }
  }

  function beginParcel(entry?: DormParcel, preset = '') {
    setParcelDraft(entry
      ? { title: entry.title, pickupPoint: entry.pickupPoint, dueDate: entry.dueDate }
      : { ...EMPTY_PARCEL, title: preset });
    setEditingParcelId(entry?.id ?? null);
    setPendingParcelId(null);
    setDeleteParcelId(null);
    setParcelEditorOpen(true);
    setSaveError('');
    setNotice('');
    setView('parcels');
  }

  function saveParcel(data: DormWorkspace) {
    const title = parcelDraft.title.trim();
    const dueDate = parcelDraft.dueDate.trim();
    if (title.length < 2 || (dueDate && !isValidDormDate(dueDate))) {
      setSaveError('請填寫至少兩個字的包裹名稱；取件日期若有填寫，必須是有效日期。');
      return;
    }
    if (!editingParcelId && data.parcels.length >= DORM_PARCEL_LIMIT) {
      setSaveError('包裹清單最多保留 50 筆，請先刪除不需要的舊紀錄。');
      return;
    }
    const previous = data.parcels.find((entry) => entry.id === editingParcelId);
    const id = editingParcelId ?? pendingParcelId ??
      ('parcel_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 9));
    setPendingParcelId(id);
    const entry: DormParcel = {
      id, title,
      pickupPoint: parcelDraft.pickupPoint.trim(),
      dueDate,
      collected: previous?.collected ?? false,
      createdAt: previous?.createdAt ?? Date.now(),
      collectedAt: previous?.collectedAt ?? null,
    };
    if (save({ ...data, parcels: [entry, ...data.parcels.filter((item) => item.id !== id)] })) {
      setParcelEditorOpen(false);
      setEditingParcelId(null);
      setPendingParcelId(null);
      setParcelDraft(EMPTY_PARCEL);
    }
  }

  if (storage.status !== 'ready') {
    return (
      <SiteShell title="宿舍" subtitle={schoolName}>
        <section className={styles.panel} role={storage.status === 'error' ? 'alert' : 'status'}>
          <h2>{storage.status === 'loading' ? '正在開啟你的住宿工作區…' : '宿舍紀錄暫時無法載入'}</h2>
          {storage.status === 'error' && <><p>{storage.message}</p><button type="button" onClick={() => reload(true)}>重新讀取</button></>}
        </section>
      </SiteShell>
    );
  }

  const data = storage.data;
  const progress = dormChecklistProgress(data);
  const inspectionProgress = dormInspectionProgress(data);
  const openRepairs = data.repairs.filter((item) => item.status !== 'resolved');
  const visibleRepairs = data.repairs.filter((item) => repairFilter === 'all' || item.status === repairFilter);
  const remaining = data.laundryEndAt ? Math.max(0, Math.ceil((data.laundryEndAt - now) / 60000)) : 0;
  const today = localDormDate(new Date(now));
  const milestones = sortedDormMilestones(data);
  const nextMilestone = milestones.find((entry) => !entry.completed);
  const overdueCount = milestones.filter((entry) => !entry.completed && entry.dueDate < today).length;
  const nextChecklistItem = DORM_CHECKLISTS.flatMap((group) => group.items)
    .find((item) => !data.checkmarks[item.id]);
  const parcels = sortedDormParcels(data);
  const pendingParcels = parcels.filter((item) => !item.collected);
  const overdueParcels = pendingParcels.filter((item) => item.dueDate && item.dueDate < today);
  const visibleParcels = parcels.filter((item) =>
    parcelFilter === 'all' || (parcelFilter === 'waiting' ? !item.collected : item.collected));

  return (
    <SiteShell title="宿舍" subtitle="住宿安排與生活紀錄，依目前選擇的學校顯示。" schoolName={schoolName}>
      <div className={styles.stack}>
        <section className={styles.hero}>
          <div className={styles.heroIntro}>
            <p className={styles.eyebrow}>{schoolName} / 住宿生活</p>
            <h2>{data.building || '住得安心，事情好處理'}</h2>
            <p>{data.room
              ? '寢室 ' + data.room + (data.bed ? ' · ' + data.bed : '') + '｜你自己的住宿紀錄'
              : '把要辦的事、需要修的設備和重要日期放在一起。住宿資格仍以校方系統為準。'}</p>
            <div className={styles.heroActions}>
              <button type="button" className={styles.heroPrimary} onClick={() => beginRepair()}>記錄設備問題</button>
              <button type="button" className={styles.heroSecondary} onClick={() => setView('guide')}>查看宿舍指南</button>
               <button type="button" className={styles.heroSecondary} onClick={() => beginParcel()}>記錄待領包裹</button>
            </div>
          </div>
          <div className={styles.heroStats} aria-label="個人紀錄快捷入口">
            <button type="button" onClick={() => setView('parcels')}><strong>{pendingParcels.length}</strong><span>待領包裹</span></button>
             <button type="button" onClick={() => setView('repairs')}><strong>{openRepairs.length}</strong><span>待追蹤問題</span></button>
            <button type="button" onClick={() => setView('dates')}><strong>{milestones.filter((item) => !item.completed).length}</strong><span>待辦日期</span></button>
            <button type="button" onClick={() => setView('checklist')}><strong>{progress.completed}/{progress.total}</strong><span>準備進度</span></button>
          </div>
        </section>

        <nav ref={tabsRef} className={styles.tabs} aria-label="宿舍功能">
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
            <p>目前的表單文字仍在畫面上，但不會覆蓋另一分頁的內容。重新讀取會關閉未儲存的紀錄表單並取消刪除確認，需要的文字請先複製。</p>
            <button type="button" onClick={() => reload(true)}>重新讀取最新紀錄</button>
          </section>
        )}
        {saveError && <p role="alert" className={styles.error}>{saveError}</p>}
        {notice && <p role="status" className={styles.success}>{notice}</p>}

        {view === 'overview' && (
          <div className={styles.columns}>
            <section className={styles.panel}>
              <div className={styles.sectionTitle}><div><p className={styles.eyebrow}>個人資料</p><h3>我的住宿資訊</h3></div><span className={styles.status}>僅此裝置</span></div>
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
                <div className={styles.sectionTitle}><div><p className={styles.eyebrow}>下一步</p><h3>{nextMilestone?.title || nextChecklistItem?.title || '住宿安排已整理好'}</h3></div></div>
                <p>{nextMilestone
                  ? (nextMilestone.dueDate < today ? '這項日期已過，記得確認是否完成。' : '個人設定日期：' + nextMilestone.dueDate.replaceAll('-', '/'))
                  : nextChecklistItem ? nextChecklistItem.detail : '目前沒有尚未完成的準備事項。'}</p>
                <button type="button" className={styles.secondary} onClick={() => setView(nextMilestone ? 'dates' : 'checklist')}>查看{nextMilestone ? '重要日期' : '入住退宿清單'}</button>
                {overdueCount > 0 && <p className={styles.overdueText}>{overdueCount} 項個人日期已過，建議先確認。</p>}
                 {overdueParcels.length > 0 && <p className={styles.overdueText}>{overdueParcels.length} 件包裹已超過自訂取件日期。</p>}
                <div className={styles.nextLinks}>
                  <button type="button" onClick={() => beginMilestone()}>＋ 新增重要日期</button>
                  <button type="button" onClick={() => setView('repairs')}>設備問題 {openRepairs.length} 筆</button>
                   <button type="button" onClick={() => setView('parcels')}>待領包裹 {pendingParcels.length} 件</button>
                </div>
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


        {view === 'guide' && (
          <div className={styles.guideLayout}>
            <section className={styles.panel}>
              <div className={styles.sectionTitle}>
                <div><p className={styles.eyebrow}>校方公開資訊</p><h3>{schoolName}住宿指南</h3></div>
                {official && <a className={styles.external} href={official.url} target="_blank" rel="noopener noreferrer">前往住宿服務單位 ↗</a>}
              </div>
              <p className={styles.muted}>房型、規則及收費為公開參考資訊，並非即時床位、個人申請或繳費查詢。請以校方當學期公告及正式系統為準。</p>
              {guide ? (
                <>
                  <div className={styles.contactGrid}>
                    <div><span>住宿服務電話</span><a href={'tel:' + guide.officePhone}>{guide.officePhone}</a><small>分機 {guide.officeExtensions}</small></div>
                    <div><span>服務時間</span><strong>{guide.serviceHours}</strong></div>
                    <div><span>24 小時校安專線</span><a href={'tel:' + guide.emergencyPhone}>{guide.emergencyPhone}</a><small>緊急事件請優先聯繫現場人員或緊急服務</small></div>
                  </div>
                  <div className={styles.hallGrid}>
                    {guide.halls.map((hall) => (
                      <article className={styles.hallCard} key={hall.id}>
                        <div className={styles.hallHeader}><h4>{hall.name}</h4><p>{hall.summary}</p></div>
                        <table className={styles.feeTable}>
                          <caption>每學期公開參考費用（新臺幣）</caption>
                          <thead><tr><th scope="col">房型</th><th scope="col">住宿費</th><th scope="col">保證金</th></tr></thead>
                          <tbody>{hall.roomTypes.map((room) => (
                            <tr key={room.name}><th scope="row">{room.name}{room.note && <small>{room.note}</small>}</th>
                              <td>{room.semesterFee.toLocaleString('zh-TW')}</td><td>{room.deposit.toLocaleString('zh-TW')}</td></tr>
                          ))}</tbody>
                        </table>
                      </article>
                    ))}
                  </div>
                  <p className={styles.source}>資料核對：{guide.checkedAt}。以上費用不含另計冷氣電費，亦不代表有空床或可直接申請。<a href={guide.feeSource} target="_blank" rel="noopener noreferrer">校方房型與收費表 ↗</a></p>
                </>
              ) : (
                <div className={styles.empty}>
                  <h4>這所學校尚無可核實的房型與費用清單</h4>
                  <p>不會借用其他學校的資訊；你仍可使用設備、重要日期與入住清單等個人工具。</p>
                  {official && <a className={styles.external} href={official.url} target="_blank" rel="noopener noreferrer">{official.label} ↗</a>}
                </div>
              )}
            </section>
          </div>
        )}

        {view === 'repairs' && (
          <section className={styles.panel}>
            <div className={styles.sectionTitle}>
              <div><p className={styles.eyebrow}>MAINTENANCE NOTES</p><h3>設備問題紀錄</h3></div>
              <button type="button" className={styles.primary} onClick={() => beginRepair()}>＋ 記錄問題</button>
            </div>
            <p className={styles.muted}>儲存只是個人備忘，不會送出報修。已向校方通報的狀態由你自行註記，不是校方系統回覆。</p>
            {!editorOpen && <div className={styles.shortcutBar} aria-label="常見設備問題">
              <span>快速記錄</span>
              {DORM_REPAIR_SHORTCUTS.map((shortcut) => <button type="button" key={shortcut.title}
                onClick={() => beginRepair(undefined, shortcut)}>{shortcut.title}</button>)}
            </div>}
            {editorOpen && (
              <form className={styles.editor} aria-label="設備問題表單" onSubmit={(e) => { e.preventDefault(); saveRepair(data); }}>
                <h4>{editingId ? '編輯問題' : '新增問題'}</h4>
                <div className={styles.voiceRepair}>
                  <div>
                    <strong>不想逐欄輸入？</strong>
                    <p>直接說明故障狀況，先產生可以修改的草稿。確認後才儲存個人紀錄，不會自動向校方通報。</p>
                  </div>
                  <VoiceDictationButton
                    onTranscript={(speech) => {
                      const suggestion = parseDormRepairDictation(speech);
                      if (!suggestion) return;
                      setRepairDraft((previous) => ({
                        ...previous,
                        title: suggestion.title,
                        description: suggestion.description,
                        location: suggestion.location || previous.location,
                        category: suggestion.category,
                      }));
                      setSaveError('');
                      setNotice('已填入語音草稿，請核對名稱、類別、位置與狀況後再儲存。');
                    }}
                  />
                </div>
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


        {view === 'parcels' && (
          <section className={styles.panel}>
            <div className={styles.sectionTitle}>
              <div><p className={styles.eyebrow}>取件備忘</p><h3>包裹與郵件</h3></div>
              <button type="button" className={styles.primary} onClick={() => beginParcel()}>＋ 記錄包裹</button>
            </div>
            <p className={styles.muted}>自行記下要領的包裹或掛號郵件。此處沒有接入學校收發室、物流追蹤或自動取件通知；請勿儲存取件驗證碼。</p>
            {!parcelEditorOpen && <div className={styles.shortcutBar} aria-label="快速記錄包裹">
              <span>快速開始</span>
              {['網購包裹', '掛號郵件', '其他物品'].map((title) =>
                <button key={title} type="button" onClick={() => beginParcel(undefined, title)}>{title}</button>)}
            </div>}
            {parcelEditorOpen && (
              <form className={styles.editor} aria-label="包裹紀錄表單" onSubmit={(e) => { e.preventDefault(); saveParcel(data); }}>
                <h4>{editingParcelId ? '編輯包裹' : '新增待領包裹'}</h4>
                <div className={styles.formGrid}>
                  <label>包裹名稱 *<input required minLength={2} maxLength={90} value={parcelDraft.title}
                    placeholder="例如：網購包裹、掛號郵件" onChange={(e) => setParcelDraft({ ...parcelDraft, title: e.target.value })} /></label>
                  <label>領取地點<input maxLength={100} value={parcelDraft.pickupPoint}
                    placeholder="例如：宿舍服務台" onChange={(e) => setParcelDraft({ ...parcelDraft, pickupPoint: e.target.value })} /></label>
                  <label>預計取件日期（選填）<input type="date" min="2000-01-01" max="2099-12-31"
                    value={parcelDraft.dueDate} onChange={(e) => setParcelDraft({ ...parcelDraft, dueDate: e.target.value })} /></label>
                </div>
                <div className={styles.actions}><button type="submit" className={styles.primary}>儲存包裹</button>
                  <button type="button" className={styles.secondary} onClick={() => { setParcelEditorOpen(false); setEditingParcelId(null); setPendingParcelId(null); }}>取消</button></div>
              </form>
            )}
            <div className={styles.filters} role="group" aria-label="包裹狀態篩選">
              {([{ id: 'waiting', label: '待領取' }, { id: 'collected', label: '已領取' }, { id: 'all', label: '全部' }] as const).map((item) =>
                <button type="button" key={item.id} aria-pressed={parcelFilter === item.id}
                  onClick={() => setParcelFilter(item.id)}>{item.label}</button>)}
            </div>
            {visibleParcels.length ? (
              <ul className={styles.milestones}>
                {visibleParcels.map((entry) => {
                  const overdue = !entry.collected && !!entry.dueDate && entry.dueDate < today;
                  return <li key={entry.id} className={entry.collected ? styles.milestoneDone : ''}>
                    <div className={styles.milestoneInfo}>
                      <span className={overdue ? styles.overdueText : styles.milestoneDate}>
                        {entry.collected ? '已自行標記領取' : overdue ? '自訂日期已過' : '待領取'}
                        {entry.dueDate ? ' · ' + entry.dueDate.replaceAll('-', '/') : ''}
                      </span>
                      <h4>{entry.title}</h4>
                      {entry.pickupPoint && <span className={styles.source}>地點：{entry.pickupPoint}</span>}
                    </div>
                    <div className={styles.actions}>
                      <button type="button" onClick={() => save({ ...data, parcels: data.parcels.map((p) =>
                        p.id === entry.id ? { ...p, collected: !p.collected, collectedAt: p.collected ? null : Date.now() } : p) })}>
                        {entry.collected ? '恢復待領' : '標記已領取'}
                      </button>
                      <button type="button" onClick={() => beginParcel(entry)}>編輯</button>
                      {deleteParcelId === entry.id ? (
                        <><button className={styles.danger} type="button" onClick={() => {
                          if (save({ ...data, parcels: data.parcels.filter((p) => p.id !== entry.id) })) setDeleteParcelId(null);
                        }}>確認刪除</button><button type="button" onClick={() => setDeleteParcelId(null)}>保留</button></>
                      ) : <button type="button" onClick={() => setDeleteParcelId(entry.id)}>刪除</button>}
                    </div>
                  </li>;
                })}
              </ul>
            ) : <div className={styles.empty}><h4>目前沒有{parcelFilter === 'collected' ? '已領取' : parcelFilter === 'all' ? '' : '待領取'}的紀錄</h4>
              <p>收到領件通知後，簡單記下物品與領取地點即可。</p></div>}
          </section>
        )}

        {view === 'dates' && (
          <section className={styles.panel}>
            <div className={styles.sectionTitle}>
              <div><p className={styles.eyebrow}>個人行程</p><h3>重要日期</h3></div>
              <button type="button" className={styles.primary} onClick={() => beginMilestone()}>＋ 新增日期</button>
            </div>
            <p className={styles.muted}>自行記下申請、繳費、搬入與退宿日期。這裡不會自動讀取校方期限，也不會送出申請或通知。</p>
            {milestoneEditorOpen && (
              <form className={styles.editor} aria-label="重要日期表單" onSubmit={(e) => { e.preventDefault(); saveMilestone(data); }}>
                <h4>{editingMilestoneId ? '編輯重要日期' : '新增重要日期'}</h4>
                <div className={styles.formGrid}>
                  <label>事項名稱 *<input required minLength={2} maxLength={90} value={milestoneDraft.title}
                    placeholder="例如：住宿繳費截止" onChange={(e) => setMilestoneDraft({ ...milestoneDraft, title: e.target.value })} /></label>
                  <label>日期 *<input required type="date" value={milestoneDraft.dueDate}
                    min="2000-01-01" max="2099-12-31" onChange={(e) => setMilestoneDraft({ ...milestoneDraft, dueDate: e.target.value })} /></label>
                </div>
                <div className={styles.actions}><button type="submit" className={styles.primary}>儲存日期</button>
                  <button type="button" className={styles.secondary} onClick={() => { setMilestoneEditorOpen(false); setEditingMilestoneId(null); setPendingMilestoneId(null); }}>取消</button></div>
              </form>
            )}
            {milestones.length ? (
              <ul className={styles.milestones}>
                {milestones.map((entry) => {
                  const overdue = !entry.completed && entry.dueDate < today;
                  return <li key={entry.id} className={entry.completed ? styles.milestoneDone : ''}>
                    <div className={styles.milestoneInfo}>
                      <span className={overdue ? styles.overdueText : styles.milestoneDate}>{entry.dueDate.replaceAll('-', '/')} {overdue ? ' · 日期已過' : ''}</span>
                      <h4>{entry.title}</h4>
                      <span className={styles.source}>{entry.completed ? '已完成（自行註記）' : '待確認'}</span>
                    </div>
                    <div className={styles.actions}>
                      <button type="button" onClick={() => save({ ...data, milestones: data.milestones.map((m) =>
                        m.id === entry.id ? { ...m, completed: !m.completed } : m) })}>{entry.completed ? '恢復待辦' : '標記完成'}</button>
                      <button type="button" onClick={() => beginMilestone(entry)}>編輯</button>
                      {deleteMilestoneId === entry.id ? (
                        <><button className={styles.danger} type="button" onClick={() => {
                          if (save({ ...data, milestones: data.milestones.filter((m) => m.id !== entry.id) })) setDeleteMilestoneId(null);
                        }}>確認刪除</button><button type="button" onClick={() => setDeleteMilestoneId(null)}>保留</button></>
                      ) : <button type="button" onClick={() => setDeleteMilestoneId(entry.id)}>刪除</button>}
                    </div>
                  </li>;
                })}
              </ul>
            ) : <div className={styles.empty}><h4>還沒有記下重要日期</h4><p>從校方公告確認期限後，手動加入這份清單。</p></div>}
          </section>
        )}

        {view === 'checklist' && (
          <div className={styles.checklist}>
            <div className={styles.panel}><p className={styles.eyebrow}>PERSONAL CHECKLIST</p><h3>入住與退宿清單</h3><p>勾選只記錄自己的準備進度，不會建立校方申請。總進度：{progress.completed} / {progress.total}</p><progress max={progress.total} value={progress.completed} aria-label="準備事項完成進度" /></div>
            <section className={styles.panel}>
              <div className={styles.sectionTitle}>
                <div><p className={styles.eyebrow}>入住檢查</p><h3>房況與設備點檢</h3></div>
                <span className={styles.status}>{inspectionProgress.checked}/{inspectionProgress.total} 已確認</span>
              </div>
              <p className={styles.muted}>入住時逐項確認房況；這是你的個人記錄，不是校方驗收。發現異常，可直接預填設備問題，再依學校正式方式通報。</p>
              <p className={styles.source}>{inspectionProgress.issues
                ? inspectionProgress.issues + ' 項待處理，請盡快確認校方正式通報方式。'
                : '未發現已標記的設備問題。未檢查項目不代表正常。'}</p>
              <ul className={styles.inspectionList}>
                {DORM_INSPECTION_ITEMS.map((item) => {
                  const status = data.inspection[item.id];
                  return <li key={item.id}>
                    <div>
                      <h4>{item.title}</h4>
                      <span className={styles.source}>{
                        status === 'ok' ? '自行檢查：正常'
                          : status === 'issue' ? '自行檢查：待處理' : '尚未檢查'
                      }</span>
                    </div>
                    <div className={styles.actions} role="group" aria-label={item.title + '狀態'}>
                      <button type="button" aria-pressed={!status} onClick={() => {
                        const next = { ...data.inspection };
                        delete next[item.id];
                        save({ ...data, inspection: next });
                      }}>未檢查</button>
                      <button type="button" aria-pressed={status === 'ok'}
                        onClick={() => save({ ...data, inspection: { ...data.inspection, [item.id]: 'ok' } })}>正常</button>
                      <button type="button" aria-pressed={status === 'issue'}
                        onClick={() => save({ ...data, inspection: { ...data.inspection, [item.id]: 'issue' } })}>待處理</button>
                      {status === 'issue' && <button type="button"
                        onClick={() => beginRepair(undefined, { category: item.category, title: item.repairTitle })}>記錄問題</button>}
                    </div>
                  </li>;
                })}
              </ul>
            </section>
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
              <div className={styles.actions}><button className={styles.primary} type="button" onClick={() => { if (save({ ...data, laundryEndAt: Date.now() + laundryMinutes * 60000 })) setNow(Date.now()); }}>開始計時</button>{data.laundryEndAt && remaining > 0 && <button className={styles.secondary} type="button" onClick={() => save({ ...data, laundryEndAt: data.laundryEndAt! + 10 * 60000 })}>延長 10 分鐘</button>}{data.laundryEndAt && <button className={styles.secondary} type="button" onClick={() => save({ ...data, laundryEndAt: null })}>清除計時</button>}</div>
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
