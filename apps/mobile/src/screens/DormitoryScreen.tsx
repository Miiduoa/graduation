import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import {
  Alert,
  Linking,
  Pressable,
  ScrollView,
  Share,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  readDormitoryWorkspaceStorage,
  writeDormitoryWorkspaceStorage,
} from '../services/dormitoryStorage';
import {
  DORM_CHECKLISTS,
  DORM_MILESTONE_LIMIT,
  DORM_PARCEL_LIMIT,
  DORM_REPAIR_SHORTCUTS,
  DORM_REPAIR_CATEGORIES,
  DORM_REPAIR_STATUSES,
  dormChecklistProgress,
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
import { resolveSchoolPublicServices } from '@campus/shared/src/schoolPublicServices';
import { resolveDormitoryPublicGuide } from '@campus/shared/src/dormitoryGuide';
import { AIDetailScreen, AICard, AIButton, aiTokens } from '../ui/aiFirst';
import { getThemeVersion, subscribeToTheme } from '../ui/theme';
import { useSchool } from '../state/school';
import { useAuth } from '../state/auth';
import { useOptionalNuniSession } from '../state/nuniSession';

type ViewName = 'home' | 'guide' | 'repairs' | 'parcels' | 'dates' | 'checklist' | 'laundry';
const NAV: Array<{ id: ViewName; name: string }> = [
  { id: 'home', name: '總覽' },
  { id: 'guide', name: '宿舍指南' },
  { id: 'repairs', name: '設備問題' },
  { id: 'parcels', name: '包裹領取' },
  { id: 'dates', name: '重要日期' },
  { id: 'checklist', name: '入住退宿' },
  { id: 'laundry', name: '洗衣計時' },
];

const REPAIR_INITIAL = {
  title: '',
  location: '',
  description: '',
  category: 'other' as DormRepairCategory,
};

function Body({ children, muted = false }: { children: React.ReactNode; muted?: boolean }) {
  return <Text style={{ color: muted ? aiTokens.muted : aiTokens.text, fontSize: 14, lineHeight: 23 }}>{children}</Text>;
}

function Field({
  label, value, onChangeText, placeholder, maxLength, multiline, keyboardType,
}: {
  label: string;
  value: string;
  onChangeText: (next: string) => void;
  placeholder: string;
  maxLength: number;
  multiline?: boolean;
  keyboardType?: 'default' | 'numbers-and-punctuation';
}) {
  return (
    <View style={{ gap: 7, marginTop: 14 }}>
      <Text style={{ color: aiTokens.text, fontWeight: '600', fontSize: 14 }}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={aiTokens.muted}
        maxLength={maxLength}
        multiline={multiline}
        keyboardType={keyboardType}
        textAlignVertical={multiline ? 'top' : 'center'}
        style={{
          minHeight: multiline ? 100 : 48,
          paddingVertical: 11,
          paddingHorizontal: 14,
          borderColor: aiTokens.border,
          borderWidth: 1,
          borderRadius: aiTokens.radius.sm,
          color: aiTokens.text,
          backgroundColor: aiTokens.surface,
          fontSize: 16,
        }}
      />
    </View>
  );
}

export function DormitoryScreen({ navigation }: { navigation?: { goBack?: () => void } }) {
  const { school } = useSchool();
  const { user, loading } = useAuth();
  const nuni = useOptionalNuniSession();
  if (loading || nuni?.loading || nuni?.pendingLogout) {
    return <AIDetailScreen title="宿舍" onBack={() => navigation?.goBack?.()}><AICard><Body>正在確認使用者…</Body></AICard></AIDetailScreen>;
  }
  const owner = user?.uid
    ? 'firebase:' + user.uid
    : nuni?.session
      ? 'platform:' + nuni.session.platformAccountId
      : 'guest';
  const key = dormStorageKey(owner, school.id);
  return (
    <DormitoryBody
      key={key}
      storageKey={key}
      schoolId={school.id}
      schoolName={school.name}
      guest={owner === 'guest'}
      onBack={() => navigation?.goBack?.()}
    />
  );
}

function DormitoryBody({
  storageKey, schoolId, schoolName, guest, onBack,
}: {
  storageKey: string;
  schoolId: string;
  schoolName: string;
  guest: boolean;
  onBack: () => void;
}) {
  useSyncExternalStore(subscribeToTheme, getThemeVersion, getThemeVersion);
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState('');
  const [notice, setNotice] = useState('');
  const [conflict, setConflict] = useState(false);
  const [data, setData] = useState<DormWorkspace>(() => emptyDormWorkspace());
  const [view, setView] = useState<ViewName>('home');
  const [room, setRoom] = useState({ building: '', room: '', bed: '' });
  const [repair, setRepair] = useState({ ...REPAIR_INITIAL });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [editor, setEditor] = useState(false);
  const [filter, setFilter] = useState<'all' | DormRepairStatus>('all');
  const [dateDraft, setDateDraft] = useState({ title: '', dueDate: '' });
  const [editingDateId, setEditingDateId] = useState<string | null>(null);
  const [pendingDateId, setPendingDateId] = useState<string | null>(null);
  const [dateEditorOpen, setDateEditorOpen] = useState(false);
  const [parcelDraft, setParcelDraft] = useState({ title: '', pickupPoint: '', dueDate: '' });
  const [parcelEditorOpen, setParcelEditorOpen] = useState(false);
  const [editingParcelId, setEditingParcelId] = useState<string | null>(null);
  const [pendingParcelId, setPendingParcelId] = useState<string | null>(null);
  const [parcelFilter, setParcelFilter] = useState<'all' | 'waiting' | 'collected'>('waiting');
  const [duration, setDuration] = useState(45);
  const [clock, setClock] = useState(() => Date.now());
  const activeRef = useRef(true);
  const rawRef = useRef<string | null>(null);
  const busy = useRef(false);
  const official = resolveSchoolPublicServices(schoolId)?.services.dormitory ?? null;
  const guide = resolveDormitoryPublicGuide(schoolId);

  useEffect(() => {
    activeRef.current = true;
    let active = true;
    readDormitoryWorkspaceStorage(storageKey)
      .then((raw) => {
        if (!active) return;
        let next: DormWorkspace;
        try {
          next = normalizeDormWorkspace(raw ? JSON.parse(raw) : emptyDormWorkspace());
        } catch {
          setFailure('這台裝置的宿舍紀錄格式無法讀取，請先備份資料後再處理。');
          setLoading(false);
          return;
        }
        rawRef.current = raw;
        setData(next);
        setRoom({ building: next.building, room: next.room, bed: next.bed });
        setLoading(false);
      })
      .catch(() => {
        if (active) {
          setFailure('無法讀取此裝置的宿舍紀錄。請確認手機儲存空間及權限。');
          setLoading(false);
        }
      });
    return () => {
      active = false;
      activeRef.current = false;
    };
  }, [storageKey]);

  useEffect(() => {
    const timer = setInterval(() => setClock(Date.now()), 15000);
    return () => clearInterval(timer);
  }, []);

  async function save(next: DormWorkspace): Promise<boolean> {
    if (busy.current || !activeRef.current || loading || failure) return false;
    busy.current = true;
    try {
      const currentRaw = await readDormitoryWorkspaceStorage(storageKey);
      if (!activeRef.current) return false;
      if (currentRaw !== rawRef.current) {
        setConflict(true);
        setNotice('另一個操作已修改紀錄。為避免覆蓋，請重新開啟此頁後再編輯。');
        return false;
      }
      const raw = JSON.stringify(normalizeDormWorkspace(next));
      await writeDormitoryWorkspaceStorage(storageKey, raw);
      if (!activeRef.current) return false;
      rawRef.current = raw;
      setData(normalizeDormWorkspace(next));
      setNotice('已儲存在此裝置');
      setConflict(false);
      return true;
    } catch {
      if (activeRef.current) setNotice('儲存失敗，已保留表單內容。請檢查空間與權限後重試。');
      return false;
    } finally {
      busy.current = false;
    }
  }

  function editRepair(row?: DormRepair, shortcut?: { title: string; category: DormRepairCategory }) {
    setRepair(row
      ? { title: row.title, category: row.category, description: row.description, location: row.location }
      : {
        ...REPAIR_INITIAL,
        title: shortcut?.title ?? '',
        category: shortcut?.category ?? 'other',
        location: data.room ? '寢室 ' + data.room : '',
      });
    setEditingId(row?.id ?? null);
    setPendingId(null);
    setEditor(true);
    setView('repairs');
    setNotice('');
  }

  async function saveRepair() {
    if (repair.title.trim().length < 2) {
      setNotice('請輸入至少兩個字的問題名稱。');
      return;
    }
    if (!editingId && data.repairs.length >= 80) {
      setNotice('本裝置最多保留 80 筆紀錄，請先整理舊資料。');
      return;
    }
    const original = data.repairs.find((r) => r.id === editingId);
    const id = editingId ?? pendingId ?? ('repair_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 9));
    setPendingId(id);
    const row: DormRepair = {
      ...repair,
      id,
      title: repair.title.trim(),
      location: repair.location.trim(),
      description: repair.description.trim(),
      status: original?.status ?? 'draft',
      createdAt: original?.createdAt ?? Date.now(),
      updatedAt: Date.now(),
    };
    if (await save({ ...data, repairs: [row, ...data.repairs.filter((r) => r.id !== id)] })) {
      setEditor(false);
      setEditingId(null);
      setPendingId(null);
      setRepair({ ...REPAIR_INITIAL });
    }
  }

  function editDate(entry?: DormMilestone) {
    setDateDraft({ title: entry?.title ?? '', dueDate: entry?.dueDate ?? '' });
    setEditingDateId(entry?.id ?? null);
    setPendingDateId(null);
    setDateEditorOpen(true);
    setView('dates');
    setNotice('');
  }

  async function saveDate() {
    const title = dateDraft.title.trim();
    const dueDate = dateDraft.dueDate.trim();
    if (title.length < 2 || !isValidDormDate(dueDate)) {
      setNotice('請輸入至少兩個字的事項名稱及有效日期（YYYY-MM-DD）。');
      return;
    }
    if (!editingDateId && data.milestones.length >= DORM_MILESTONE_LIMIT) {
      setNotice('最多記錄 30 筆重要日期，請先整理已完成的紀錄。');
      return;
    }
    const original = data.milestones.find((entry) => entry.id === editingDateId);
    const id = editingDateId ?? pendingDateId ??
      ('date_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 9));
    setPendingDateId(id);
    const entry: DormMilestone = {
      id,
      title,
      dueDate,
      completed: original?.completed ?? false,
      createdAt: original?.createdAt ?? Date.now(),
    };
    if (await save({ ...data, milestones: [entry, ...data.milestones.filter((item) => item.id !== id)] })) {
      setDateEditorOpen(false);
      setEditingDateId(null);
      setPendingDateId(null);
      setDateDraft({ title: '', dueDate: '' });
    }
  }

  function editParcel(entry?: DormParcel, preset = '') {
    setParcelDraft(entry
      ? { title: entry.title, pickupPoint: entry.pickupPoint, dueDate: entry.dueDate }
      : { title: preset, pickupPoint: '', dueDate: '' });
    setEditingParcelId(entry?.id ?? null);
    setPendingParcelId(null);
    setParcelEditorOpen(true);
    setView('parcels');
    setNotice('');
  }

  async function saveParcel() {
    const title = parcelDraft.title.trim();
    const dueDate = parcelDraft.dueDate.trim();
    if (title.length < 2 || (dueDate && !isValidDormDate(dueDate))) {
      setNotice('請填寫至少兩個字的包裹名稱；日期若有填寫，格式為 YYYY-MM-DD。');
      return;
    }
    if (!editingParcelId && data.parcels.length >= DORM_PARCEL_LIMIT) {
      setNotice('包裹清單最多保留 50 筆，請先整理舊紀錄。');
      return;
    }
    const previous = data.parcels.find((item) => item.id === editingParcelId);
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
    if (await save({ ...data, parcels: [entry, ...data.parcels.filter((item) => item.id !== id)] })) {
      setParcelDraft({ title: '', pickupPoint: '', dueDate: '' });
      setParcelEditorOpen(false);
      setEditingParcelId(null);
      setPendingParcelId(null);
    }
  }

  async function updateRepairStatus(id: string, status: DormRepairStatus) {
    await save({
      ...data,
      repairs: data.repairs.map((r) => r.id === id ? { ...r, status, updatedAt: Date.now() } : r),
    });
  }

  async function shareRepair(row: DormRepair) {
    try {
      await Share.share({ message: formatDormRepairForCopy(row), title: '宿舍設備問題' });
    } catch {
      setNotice('無法開啟分享選單，請手動複製問題細節。');
    }
  }

  async function openOfficial() {
    if (!official) return;
    try {
      await Linking.openURL(official.url);
    } catch {
      Alert.alert('暫時無法開啟', '請確認網路連線，或從學校官網尋找住宿服務單位。');
    }
  }

  async function openPublicLink(url: string) {
    try {
      await Linking.openURL(url);
    } catch {
      Alert.alert('無法開啟', url.startsWith('tel:')
        ? '此裝置無法直接撥號，請使用可通話的電話撥打畫面上的號碼。'
        : '請檢查網路連線，或從校方住宿服務網站查詢。');
    }
  }

  const progress = dormChecklistProgress(data);
  const remaining = data.laundryEndAt ? Math.max(0, Math.ceil((data.laundryEndAt - clock) / 60000)) : 0;
  const today = localDormDate(new Date(clock));
  const milestones = sortedDormMilestones(data);
  const nextMilestone = milestones.find((entry) => !entry.completed);
  const parcels = sortedDormParcels(data);
  const pendingParcels = parcels.filter((entry) => !entry.collected);
  const overdueParcels = pendingParcels.filter((entry) => entry.dueDate && entry.dueDate < today);
  const visibleParcels = parcels.filter((entry) =>
    parcelFilter === 'all' || (parcelFilter === 'waiting' ? !entry.collected : entry.collected));
  const repairs = data.repairs.filter((r) => filter === 'all' || r.status === filter);
  const flexRow: object = { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' };
  const pad: object = { paddingHorizontal: 16, marginTop: 16 };

  return (
    <AIDetailScreen title="宿舍" subtitle={schoolName} onBack={onBack}
      keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
      <View style={{ ...pad, gap: 12 }}>
        <AICard title={data.building || '住得安心，事情好處理'}>
          <Body>{data.room ? ('寢室 ' + data.room + (data.bed ? ' · ' + data.bed : '')) : '把入住事項、設備問題與重要日期放在一起。'}</Body>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 9, marginTop: 16 }}>
            {([
              { id: 'parcels' as const, count: String(pendingParcels.length), label: '待領包裹' },
              { id: 'repairs' as const, count: String(data.repairs.filter((r) => r.status !== 'resolved').length), label: '待追蹤問題' },
              { id: 'dates' as const, count: String(milestones.filter((entry) => !entry.completed).length), label: '待辦日期' },
              { id: 'checklist' as const, count: progress.completed + '/' + progress.total, label: '準備進度' },
            ]).map((item) => (
              <Pressable key={item.id} accessibilityRole="button"
                accessibilityLabel={item.label + ' ' + item.count}
                onPress={() => setView(item.id)}
                style={{
                  flexGrow: 1, flexBasis: '44%', minHeight: 80,
                  borderWidth: 1, borderColor: aiTokens.border,
                  backgroundColor: aiTokens.panel, borderRadius: aiTokens.radius.sm,
                  paddingHorizontal: 14, paddingVertical: 13, justifyContent: 'center', gap: 3,
                }}>
                <Text style={{ color: aiTokens.text, fontSize: 24, fontWeight: '700', fontVariant: ['tabular-nums'] }}>{item.count}</Text>
                <Text style={{ color: aiTokens.muted, fontSize: 13 }}>{item.label}</Text>
              </Pressable>
            ))}
          </View>
          <View style={{ ...flexRow, marginTop: 16 }}>
            <AIButton label="記錄設備問題" onPress={() => editRepair()} />
            <AIButton label="記錄包裹" variant="ghost" onPress={() => editParcel()} />
            <AIButton label="宿舍指南" variant="ghost" onPress={() => setView('guide')} />
          </View>
        </AICard>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} accessibilityLabel="宿舍功能"
          contentContainerStyle={{ flexDirection: 'row', gap: 8, paddingVertical: 3, paddingRight: 16 }}>
          {NAV.map((item) => (
            <Pressable key={item.id} accessibilityRole="tab"
              accessibilityState={{ selected: view === item.id }}
              onPress={() => { setView(item.id); setNotice(''); }}
              style={{
                paddingHorizontal: 15, paddingVertical: 12, minHeight: 44, justifyContent: 'center',
                borderWidth: 1, borderColor: view === item.id ? aiTokens.text : aiTokens.border,
                borderRadius: 24, backgroundColor: view === item.id ? aiTokens.panel : aiTokens.surface,
              }}>
              <Text style={{ color: aiTokens.text, fontWeight: view === item.id ? '700' : '500', fontSize: 14 }}>{item.name}</Text>
            </Pressable>
          ))}
        </ScrollView>
        <Body muted>{guest
          ? '訪客紀錄只存在此裝置，不會在登入後自動移到帳號，也不會同步到其他裝置。'
          : '個人紀錄只儲存在此裝置，會依帳號及校園分開。正式住宿申請、報修和繳費不會從這裡送出。'}</Body>
        {loading && <AICard><Body>正在讀取住宿紀錄…</Body></AICard>}
        {!!failure && <AICard badge="讀取失敗" badgeTone="danger"><Body>{failure}</Body></AICard>}
        {!!notice && <Text accessibilityRole="alert" style={{ color: aiTokens.text, lineHeight: 22 }}>{notice}</Text>}
        {conflict && <AICard title="資料已在別處更新"><Body>為避免覆蓋，請返回後重新開啟宿舍頁面。</Body></AICard>}

        {!loading && !failure && view === 'home' && (
          <>
            <AICard title="我的住宿備忘">
              <Body muted>此處資料由你自行填寫，不代表實際床位分配結果。</Body>
              <Field label="宿舍／學苑" value={room.building} maxLength={70} placeholder="例如：○○學苑" onChangeText={(value) => setRoom({ ...room, building: value })} />
              <Field label="寢室" value={room.room} maxLength={50} placeholder="自行記錄房號" onChangeText={(value) => setRoom({ ...room, room: value })} />
              <Field label="床位" value={room.bed} maxLength={40} placeholder="例如：A 床" onChangeText={(value) => setRoom({ ...room, bed: value })} />
              <View style={{ marginTop: 16 }}><AIButton label="儲存備忘" disabled={conflict} onPress={() => void save({ ...data, ...room })} /></View>
            </AICard>
            <AICard title="接下來可以做">
              <Body>{nextMilestone
                ? (nextMilestone.dueDate < today ? '已過期，請確認：' : '下一個日期：') + nextMilestone.title
                : '目前沒有尚未完成的重要日期。'}</Body>
              {!!nextMilestone && <Body muted>{nextMilestone.dueDate.replaceAll('-', '/')} · 個人紀錄</Body>}
              {!!overdueParcels.length && <Text style={{ color: aiTokens.text, fontSize: 13, marginTop: 8 }}>
                {overdueParcels.length} 件包裹超過你設定的取件日期，請確認是否已領取。
              </Text>}
              <View style={{ ...flexRow, marginTop: 14 }}>
                <AIButton label="新增重要日期" variant="ghost" onPress={() => editDate()} />
                <AIButton label="待領包裹" variant="ghost" onPress={() => setView('parcels')} />
                <AIButton label="查看入住清單" variant="ghost" onPress={() => setView('checklist')} />
              </View>
            </AICard>
            <AICard title="學校正式入口">
              <Body>床位、抽籤、繳費、退宿和正式報修，請以校方公告或指定平台為準。</Body>
              {official ? (
                <>
                  <View style={{ marginTop: 14 }}><AIButton variant="ghost" label={official.label + ' ↗'} onPress={() => void openOfficial()} /></View>
                  <View style={{ marginTop: 10 }}><Body muted>來源：{official.sourceLabel}</Body></View>
                </>
              ) : <Body muted>這所學校目前沒有已核實的住宿專屬網站。請從學校官網查詢。</Body>}
            </AICard>
          </>
        )}


        {!loading && !failure && view === 'guide' && (
          <>
            <AICard title={schoolName + '住宿指南'}>
              <Body muted>房型、費用與規則是公開參考資訊，不是即時床位、個人住宿申請或繳費紀錄。</Body>
              {official ? (
                <View style={{ marginTop: 14 }}>
                  <AIButton variant="ghost" label={official.label + ' ↗'} onPress={() => void openOfficial()} />
                </View>
              ) : <Body muted>這所學校的住宿專屬網站尚未核實，請從學校官網查詢。</Body>}
            </AICard>
            {guide ? (
              <>
                <AICard title="住宿服務與緊急聯絡">
                  <Body>住服組 {guide.officePhone} 分機 {guide.officeExtensions}</Body>
                  <Body muted>{guide.serviceHours}</Body>
                  <View style={{ ...flexRow, marginTop: 12 }}>
                    <AIButton variant="ghost" label="撥打住宿服務電話" onPress={() => void openPublicLink('tel:' + guide.officePhone)} />
                  </View>
                  <View style={{ marginTop: 15 }}><Body>24 小時校安專線：{guide.emergencyPhone}</Body></View>
                  <View style={{ ...flexRow, marginTop: 12 }}>
                    <AIButton variant="ghost" label="撥打校安專線" onPress={() => void openPublicLink('tel:' + guide.emergencyPhone)} />
                  </View>
                </AICard>
                {guide.halls.map((hall) => (
                  <AICard key={hall.id} title={hall.name}>
                    <Body muted>{hall.summary}</Body>
                    {hall.roomTypes.map((room) => (
                      <View key={room.name} style={{ borderBottomWidth: 1, borderBottomColor: aiTokens.border, paddingVertical: 13, gap: 5 }}>
                        <Text style={{ fontSize: 15, color: aiTokens.text, fontWeight: '600' }}>{room.name}</Text>
                        <Body>每學期住宿費 NT$ {room.semesterFee.toLocaleString('zh-TW')} · 保證金 NT$ {room.deposit.toLocaleString('zh-TW')}</Body>
                        {!!room.note && <Body muted>{room.note}</Body>}
                      </View>
                    ))}
                  </AICard>
                ))}
                <AICard title="資料來源與使用提醒">
                  <Body muted>以上費用不含另計冷氣電費；資料核對日 {guide.checkedAt}。床位是否開放及實際金額，請以當學期校方公告為準。</Body>
                  <View style={{ marginTop: 12 }}><AIButton variant="ghost" label="查看校方房型與收費表 ↗" onPress={() => void openPublicLink(guide.feeSource)} /></View>
                </AICard>
              </>
            ) : (
              <AICard title="尚無可核實的房型資訊">
                <Body>此校的房型和住宿費尚未核實，不會顯示其他學校的資料。個人設備、日期及清單仍可使用。</Body>
              </AICard>
            )}
          </>
        )}

        {!loading && !failure && view === 'repairs' && (
          <>
            <AICard title="設備問題">
              <Body muted>這是個人問題清單，不會傳給校方。「已通報」是自行註記，非校方已受理。</Body>
              <View style={{ marginTop: 14 }}><AIButton label="＋ 記錄問題" onPress={() => editRepair()} /></View>
              {!editor && <View style={{ marginTop: 16, gap: 10 }}>
                <Body muted>常見狀況，點一下就能先填好：</Body>
                <View style={flexRow}>
                  {DORM_REPAIR_SHORTCUTS.map((shortcut) => (
                    <Pressable key={shortcut.title} accessibilityRole="button" onPress={() => editRepair(undefined, shortcut)}
                      style={{ minHeight: 44, paddingVertical: 11, paddingHorizontal: 13, borderRadius: aiTokens.radius.sm, borderWidth: 1, borderColor: aiTokens.border, backgroundColor: aiTokens.surface }}>
                      <Text style={{ fontSize: 13, color: aiTokens.text }}>{shortcut.title}</Text>
                    </Pressable>
                  ))}
                </View>
              </View>}
              {editor && (
                <View style={{ marginTop: 20, borderTopWidth: 1, borderTopColor: aiTokens.border, paddingTop: 12 }}>
                  <Text style={{ fontWeight: '700', color: aiTokens.text, fontSize: 16 }}>{editingId ? '編輯問題' : '新增問題'}</Text>
                  <Field label="問題名稱" value={repair.title} maxLength={90} placeholder="例如：冷氣無法啟動" onChangeText={(text) => setRepair({ ...repair, title: text })} />
                  <Text style={{ color: aiTokens.text, marginTop: 14, fontWeight: '600' }}>類別</Text>
                  <View style={{ ...flexRow, marginTop: 8 }}>
                    {(Object.entries(DORM_REPAIR_CATEGORIES) as Array<[DormRepairCategory, string]>).map(([id, title]) =>
                      <Pressable key={id} onPress={() => setRepair({ ...repair, category: id })}
                        accessibilityRole="radio" accessibilityState={{ checked: repair.category === id }}
                        style={{ minHeight: 44, paddingVertical: 11, paddingHorizontal: 13, borderWidth: 1, borderRadius: 18, borderColor: repair.category === id ? aiTokens.text : aiTokens.border, backgroundColor: aiTokens.surface }}>
                        <Text style={{ color: aiTokens.text }}>{title}</Text>
                      </Pressable>,
                    )}
                  </View>
                  <Field label="位置" value={repair.location} maxLength={100} placeholder="例如：浴室洗手台" onChangeText={(text) => setRepair({ ...repair, location: text })} />
                  <Field label="詳細狀況" value={repair.description} maxLength={1200} multiline placeholder="詳細描述問題，方便向服務台通報" onChangeText={(text) => setRepair({ ...repair, description: text })} />
                  <View style={{ ...flexRow, marginTop: 16 }}>
                    <AIButton label="儲存紀錄" disabled={conflict} onPress={() => void saveRepair()} />
                    <AIButton label="取消" variant="ghost" onPress={() => { setEditor(false); setEditingId(null); setPendingId(null); }} />
                  </View>
                </View>
              )}
            </AICard>
            <View style={flexRow}>
              {(['all', 'draft', 'reported', 'resolved'] as const).map((s) => (
                <Pressable key={s} accessibilityRole="button" accessibilityState={{ selected: s === filter }}
                  onPress={() => setFilter(s)} style={{ paddingVertical: 10, paddingHorizontal: 13, minHeight: 44, borderRadius: 20, borderWidth: 1, borderColor: s === filter ? aiTokens.text : aiTokens.border }}>
                  <Text style={{ color: aiTokens.text, fontSize: 13 }}>{s === 'all' ? '全部' : DORM_REPAIR_STATUSES[s]}</Text>
                </Pressable>
              ))}
            </View>
            {!repairs.length && <AICard><Body>目前沒有符合此狀態的問題。</Body></AICard>}
            {repairs.map((item) => (
              <AICard key={item.id} title={item.title} badge={DORM_REPAIR_CATEGORIES[item.category]}>
                <Body muted>{DORM_REPAIR_STATUSES[item.status]}</Body>
                {!!item.location && <Body>位置：{item.location}</Body>}
                {!!item.description && <Body>{item.description}</Body>}
                <View style={{ ...flexRow, marginTop: 12 }}>
                  <AIButton variant="ghost" label="編輯" onPress={() => editRepair(item)} />
                  <AIButton variant="ghost" label="分享通報文字" onPress={() => void shareRepair(item)} />
                  {item.status === 'draft' && <AIButton variant="ghost" label="我已自行通報" disabled={conflict} onPress={() => void updateRepairStatus(item.id, 'reported')} />}
                  {item.status !== 'resolved' && <AIButton variant="ghost" label="我已確認修復" disabled={conflict} onPress={() => void updateRepairStatus(item.id, 'resolved')} />}
                  <AIButton variant="danger" label="刪除" disabled={conflict} onPress={() => {
                    Alert.alert('刪除此筆紀錄？', '只刪除此裝置上的備忘，不影響校方系統。', [
                      { text: '取消', style: 'cancel' },
                      { text: '刪除', style: 'destructive', onPress: () => void save({ ...data, repairs: data.repairs.filter((r) => r.id !== item.id) }) },
                    ]);
                  }} />
                </View>
              </AICard>
            ))}
          </>
        )}


        {!loading && !failure && view === 'parcels' && (
          <>
            <AICard title="包裹與郵件">
              <Body muted>自行記錄待領包裹與掛號郵件。這裡沒有連接宿舍收發室、物流狀態或自動通知；請勿儲存取件驗證碼。</Body>
              <View style={{ marginTop: 15 }}><AIButton label="＋ 記錄包裹" onPress={() => editParcel()} /></View>
              {!parcelEditorOpen && (
                <View style={{ ...flexRow, marginTop: 14 }}>
                  {['網購包裹', '掛號郵件', '其他物品'].map((title) => (
                    <Pressable key={title} accessibilityRole="button" onPress={() => editParcel(undefined, title)}
                      style={{ minHeight: 44, justifyContent: 'center', paddingHorizontal: 14,
                        borderWidth: 1, borderColor: aiTokens.border, borderRadius: aiTokens.radius.sm }}>
                      <Text style={{ color: aiTokens.text, fontSize: 14 }}>{title}</Text>
                    </Pressable>
                  ))}
                </View>
              )}
              {parcelEditorOpen && (
                <View style={{ marginTop: 18, borderTopWidth: 1, borderTopColor: aiTokens.border, paddingTop: 4 }}>
                  <Field label="包裹名稱" value={parcelDraft.title} maxLength={90}
                    placeholder="例如：網購包裹" onChangeText={(title) => setParcelDraft({ ...parcelDraft, title })} />
                  <Field label="領取地點（選填）" value={parcelDraft.pickupPoint} maxLength={100}
                    placeholder="例如：宿舍服務台" onChangeText={(pickupPoint) => setParcelDraft({ ...parcelDraft, pickupPoint })} />
                  <Field label="取件日期（選填，YYYY-MM-DD）" value={parcelDraft.dueDate} maxLength={10}
                    keyboardType="numbers-and-punctuation" placeholder="例如：2026-11-15"
                    onChangeText={(dueDate) => setParcelDraft({ ...parcelDraft, dueDate })} />
                  <View style={{ ...flexRow, marginTop: 12 }}>
                    {[{ label: '明天', days: 1 }, { label: '三天後', days: 3 }, { label: '一週後', days: 7 }].map((option) => (
                      <Pressable key={option.days} accessibilityRole="button"
                        onPress={() => {
                          const next = new Date();
                          next.setDate(next.getDate() + option.days);
                          setParcelDraft((old) => ({ ...old, dueDate: localDormDate(next) }));
                        }}
                        style={{ minHeight: 44, justifyContent: 'center', paddingHorizontal: 14,
                          borderWidth: 1, borderColor: aiTokens.border, borderRadius: 20 }}>
                        <Text style={{ color: aiTokens.text, fontSize: 13 }}>{option.label}</Text>
                      </Pressable>
                    ))}
                  </View>
                  <View style={{ ...flexRow, marginTop: 16 }}>
                    <AIButton label="儲存包裹" disabled={conflict} onPress={() => void saveParcel()} />
                    <AIButton label="取消" variant="ghost" onPress={() => {
                      setParcelEditorOpen(false);
                      setEditingParcelId(null);
                      setPendingParcelId(null);
                    }} />
                  </View>
                </View>
              )}
            </AICard>
            <View style={flexRow}>
              {([{ id: 'waiting', label: '待領取' }, { id: 'collected', label: '已領取' }, { id: 'all', label: '全部' }] as const).map((item) => (
                <Pressable key={item.id} accessibilityRole="button"
                  accessibilityState={{ selected: parcelFilter === item.id }}
                  onPress={() => setParcelFilter(item.id)}
                  style={{ minHeight: 44, paddingVertical: 11, paddingHorizontal: 14, borderRadius: 22,
                    borderWidth: 1, borderColor: parcelFilter === item.id ? aiTokens.text : aiTokens.border,
                    backgroundColor: parcelFilter === item.id ? aiTokens.panel : aiTokens.surface }}>
                  <Text style={{ color: aiTokens.text, fontSize: 14 }}>{item.label}</Text>
                </Pressable>
              ))}
            </View>
            {!visibleParcels.length && <AICard title="目前沒有相符的包裹紀錄">
              <Body muted>收到領件通知後，只要記下物品和領取地點即可。</Body>
            </AICard>}
            {visibleParcels.map((entry) => {
              const overdue = !entry.collected && !!entry.dueDate && entry.dueDate < today;
              return <AICard key={entry.id} title={entry.title}
                badge={entry.collected ? '已自行標記領取' : overdue ? '自訂日期已過' : '待領取'}
                badgeTone={overdue ? 'danger' : 'muted'}>
                {!!entry.pickupPoint && <Body>領取地點：{entry.pickupPoint}</Body>}
                {!!entry.dueDate && <Body muted>自訂取件日期：{entry.dueDate.replaceAll('-', '/')}</Body>}
                <View style={{ ...flexRow, marginTop: 14 }}>
                  <AIButton variant="ghost" disabled={conflict}
                    label={entry.collected ? '恢復待領' : '標記已領取'}
                    onPress={() => void save({ ...data, parcels: data.parcels.map((p) =>
                      p.id === entry.id ? {
                        ...p, collected: !p.collected,
                        collectedAt: p.collected ? null : Date.now(),
                      } : p) })} />
                  <AIButton variant="ghost" label="編輯" onPress={() => editParcel(entry)} />
                  <AIButton variant="danger" label="刪除" disabled={conflict} onPress={() => {
                    Alert.alert('刪除這筆包裹紀錄？', '只會刪除此裝置的備忘，不會影響學校收發室。', [
                      { text: '取消', style: 'cancel' },
                      { text: '刪除', style: 'destructive',
                        onPress: () => void save({ ...data, parcels: data.parcels.filter((p) => p.id !== entry.id) }) },
                    ]);
                  }} />
                </View>
              </AICard>;
            })}
          </>
        )}

        {!loading && !failure && view === 'dates' && (
          <>
            <AICard title="重要日期">
              <Body muted>自行記錄入住、繳費、退宿等日期，不代表校方已處理，也不會自動推播提醒。</Body>
              <View style={{ marginTop: 14 }}><AIButton label="＋ 新增日期" onPress={() => editDate()} /></View>
              {dateEditorOpen && (
                <View style={{ marginTop: 18, borderTopWidth: 1, borderTopColor: aiTokens.border, paddingTop: 4 }}>
                  <Field label="事項名稱" value={dateDraft.title} maxLength={90} placeholder="例如：住宿繳費截止" onChangeText={(text) => setDateDraft({ ...dateDraft, title: text })} />
                  <Field label="日期（YYYY-MM-DD）" value={dateDraft.dueDate} maxLength={10} keyboardType="numbers-and-punctuation" placeholder="例如：2026-11-15" onChangeText={(text) => setDateDraft({ ...dateDraft, dueDate: text })} />
                  <View style={{ ...flexRow, marginTop: 12 }}>
                    {[{ label: '明天', days: 1 }, { label: '一週後', days: 7 }, { label: '一個月後', days: 30 }].map((option) => (
                      <Pressable accessibilityRole="button" key={option.days} onPress={() => {
                        const date = new Date(); date.setDate(date.getDate() + option.days);
                        setDateDraft((old) => ({ ...old, dueDate: localDormDate(date) }));
                      }} style={{ borderWidth: 1, borderColor: aiTokens.border, borderRadius: 18, paddingVertical: 10, paddingHorizontal: 12, minHeight: 44 }}>
                        <Text style={{ fontSize: 13, color: aiTokens.text }}>{option.label}</Text>
                      </Pressable>
                    ))}
                  </View>
                  <View style={{ ...flexRow, marginTop: 18 }}>
                    <AIButton label="儲存日期" disabled={conflict} onPress={() => void saveDate()} />
                    <AIButton label="取消" variant="ghost" onPress={() => { setDateEditorOpen(false); setEditingDateId(null); setPendingDateId(null); }} />
                  </View>
                </View>
              )}
            </AICard>
            {!milestones.length && <AICard><Body muted>還沒有記下重要日期。確認校方公告後，就能建立自己的待辦清單。</Body></AICard>}
            {milestones.map((entry) => (
              <AICard key={entry.id} title={entry.title}
                badge={entry.completed ? '已完成（自行註記）' : entry.dueDate < today ? '日期已過' : '待確認'}
                badgeTone={entry.completed ? 'success' : entry.dueDate < today ? 'danger' : 'muted'}>
                <Body muted>{entry.dueDate.replaceAll('-', '/')}</Body>
                <View style={{ ...flexRow, marginTop: 14 }}>
                  <AIButton variant="ghost" disabled={conflict} label={entry.completed ? '恢復待辦' : '標記完成'}
                    onPress={() => void save({ ...data, milestones: data.milestones.map((m) =>
                      m.id === entry.id ? { ...m, completed: !m.completed } : m) })} />
                  <AIButton variant="ghost" label="編輯" onPress={() => editDate(entry)} />
                  <AIButton variant="danger" disabled={conflict} label="刪除" onPress={() => {
                    Alert.alert('刪除此重要日期？', '這只會刪除本裝置上的個人紀錄。', [
                      { text: '取消', style: 'cancel' },
                      { text: '刪除', style: 'destructive', onPress: () => void save({ ...data, milestones: data.milestones.filter((m) => m.id !== entry.id) }) },
                    ]);
                  }} />
                </View>
              </AICard>
            ))}
          </>
        )}

        {!loading && !failure && view === 'checklist' && (
          <>
            <AICard title="入住與退宿清單">
              <Body>已完成 {progress.completed} / {progress.total} 項</Body>
              <Body muted>勾選只會保存在此裝置，不代表校方已收到申請。</Body>
            </AICard>
            {DORM_CHECKLISTS.map((group) => (
              <AICard key={group.stage} title={group.title}>
                {group.items.map((item) => (
                  <Pressable key={item.id} accessibilityRole="checkbox"
                    accessibilityState={{ checked: !!data.checkmarks[item.id], disabled: conflict }}
                    onPress={() => { if (!conflict) void save({ ...data, checkmarks: { ...data.checkmarks, [item.id]: !data.checkmarks[item.id] } }); }}
                    style={{ flexDirection: 'row', gap: 12, minHeight: 60, paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: aiTokens.border }}>
                    <Text style={{ fontSize: 22, color: aiTokens.text }}>{data.checkmarks[item.id] ? '☑' : '☐'}</Text>
                    <View style={{ flex: 1, gap: 5 }}>
                      <Text style={{ fontSize: 15, color: aiTokens.text, fontWeight: '600' }}>{item.title}</Text>
                      <Text style={{ fontSize: 13, color: aiTokens.muted, lineHeight: 19 }}>{item.detail}</Text>
                    </View>
                  </Pressable>
                ))}
              </AICard>
            ))}
          </>
        )}

        {!loading && !failure && view === 'laundry' && (
          <AICard title="個人洗衣計時">
            <Body muted>這是依自己設定的倒數計時，不是機台連線或即時空機查詢。</Body>
            <View style={{ alignItems: 'center', gap: 8, marginTop: 24, marginBottom: 22, padding: 22, borderRadius: 18, backgroundColor: aiTokens.panel }}>
              <Text style={{ fontSize: 29, fontWeight: '700', color: aiTokens.text }}>
                {data.laundryEndAt ? remaining ? remaining + ' 分鐘' : '預估已完成' : '尚未開始'}
              </Text>
              <Body muted>{data.laundryEndAt ? '預估結束：' + new Date(data.laundryEndAt).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' }) : '可依洗衣機標示選擇時間'}</Body>
            </View>
            <Body>預估運轉時間</Body>
            <View style={{ ...flexRow, marginTop: 12 }}>
              {[30, 45, 60, 90].map((n) => (
                <Pressable key={n} accessibilityRole="radio" accessibilityState={{ checked: duration === n }}
                  onPress={() => setDuration(n)} style={{ minHeight: 44, paddingHorizontal: 14, paddingVertical: 12, borderRadius: 22, borderWidth: 1, borderColor: n === duration ? aiTokens.text : aiTokens.border }}>
                  <Text style={{ color: aiTokens.text }}>{n} 分鐘</Text>
                </Pressable>
              ))}
            </View>
            <View style={{ ...flexRow, marginTop: 20 }}>
              <AIButton label="開始計時" disabled={conflict} onPress={() => { void save({ ...data, laundryEndAt: Date.now() + duration * 60000 }); setClock(Date.now()); }} />
              {!!data.laundryEndAt && remaining > 0 && <AIButton variant="ghost" label="延長 10 分鐘" disabled={conflict} onPress={() => void save({ ...data, laundryEndAt: data.laundryEndAt! + 10 * 60000 })} />}
              {!!data.laundryEndAt && <AIButton variant="ghost" label="清除計時" disabled={conflict} onPress={() => void save({ ...data, laundryEndAt: null })} />}
            </View>
          </AICard>
        )}
        <View style={{ height: 18 }} />
      </View>
    </AIDetailScreen>
  );
}
