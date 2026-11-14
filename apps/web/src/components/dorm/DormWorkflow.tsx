'use client';
import { projectDormRepair, type DormCloudRepair } from '@campus/shared/src/dormitoryCloud';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { toPublicSchoolId } from '@campus/shared/src/schoolIds';
import {
  DORM_TICKET_LABELS,
  DORM_LEAVE_LABELS,
  dormTicketOverdue,
  dormRequestKey,
  parseDormResidentsCsv,
  dormWorkflowSummary,
  type DormWorkflowConfig,
  type DormWorkflowRows,
  type DormTicket,
  type DormLeave,
  type DormTicketStatus,
} from '@campus/shared/src/dormWorkflow';
import { getFunctionsInstance, getDb } from '@/lib/firebase';
import { getStorage, ref, uploadBytes, getDownloadURL } from 'firebase/storage';
type FocusTarget = HTMLInputElement;
const invoke = async <T,>(data: Record<string, unknown>) =>
  (await httpsCallable<Record<string, unknown>, T>(getFunctionsInstance(), 'dormWorkflow')(data))
    .data;
function Box({ children }: { children: React.ReactNode }) {
  return (
    <section
      style={{
        display: 'grid',
        gap: 10,
        padding: 14,
        marginBlock: 10,
        border: '1px solid var(--border, #ddd)',
        borderRadius: 12,
        minWidth: 0,
      }}
    >
      {children}
    </section>
  );
}
function Label({
  children,
  strong,
  accent,
}: {
  children: React.ReactNode;
  strong?: boolean;
  accent?: boolean;
}) {
  return (
    <div
      role={typeof children === 'string' && /失敗|已更新/.test(children) ? 'status' : undefined}
      style={{
        whiteSpace: 'pre-wrap',
        overflowWrap: 'anywhere',
        fontWeight: strong ? 700 : 400,
        color: accent ? 'var(--primary, #355e52)' : undefined,
      }}
    >
      {children}
    </div>
  );
}
function Btn({
  label,
  disabled,
  onPress,
}: {
  label: string;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onPress}
      style={{ minHeight: 44, padding: 10, cursor: 'pointer' }}
    >
      {label}
    </button>
  );
}
function Field({
  label,
  value,
  onChange,
  multiline,
  focusRef,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  multiline?: boolean;
  focusRef?: React.RefObject<FocusTarget | null>;
}) {
  return (
    <label style={{ display: 'grid', gap: 4 }}>
      {label}
      {multiline ? (
        <textarea
          value={value}
          maxLength={50000}
          onChange={(e) => onChange(e.target.value)}
          style={{ minHeight: 88 }}
        />
      ) : (
        <input
          ref={focusRef}
          value={value}
          maxLength={2000}
          onChange={(e) => onChange(e.target.value)}
          style={{ minHeight: 44, minWidth: 0 }}
        />
      )}
    </label>
  );
}
function Photo({ url, label }: { url: string; label: string }) {
  return (
    <a href={url} target="_blank" rel="noreferrer">
      <img
        src={url}
        alt={label}
        style={{ width: '100%', maxWidth: 280, maxHeight: 200, objectFit: 'contain' }}
      />
    </a>
  );
}
async function exportSummary(text: string) {
  const url = URL.createObjectURL(new Blob(['\uFEFF' + text], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = '宿舍統計.csv';
  a.click();
  URL.revokeObjectURL(url);
}
async function pickPhotos(uid: string, remaining: number): Promise<string[]> {
  const files = await new Promise<File[]>((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.multiple = true;
    input.onchange = () => resolve(Array.from(input.files || []));
    input.oncancel = () => resolve([]);
    input.click();
  });
  if (
    files.length > remaining ||
    files.some((f) => !f.type.startsWith('image/') || f.size > 10 * 1024 * 1024)
  )
    throw new Error('照片最多三張，每張 10MB');
  return Promise.all(
    files.map(async (file) => {
      const target = ref(getStorage(getDb().app), `temp/${uid}/dorm_${dormRequestKey()}`);
      await uploadBytes(target, file, { contentType: file.type });
      return getDownloadURL(target);
    }),
  );
}
export function DormWorkflow({
  schoolId,
  uid,
  building = '',
  room = '',
  draft,
  submitOnly = false,
  initialStaff = false,
  onTonightLeaveChange,
  onOwnRepairsChange,
}: {
  schoolId: string;
  uid?: string | null;
  submitOnly?: boolean;
  initialStaff?: boolean;
  onOwnRepairsChange?: (repairs: DormCloudRepair[]) => void;
  onTonightLeaveChange?: (approved: boolean) => void;
  building?: string;
  room?: string;
  draft?: { title: string; description: string; category: string; location: string };
}) {
  const capabilityKey = JSON.stringify([uid, schoolId]);
  const [capability, setCapability] = useState<{ key: string; config: DormWorkflowConfig } | null>(
    null,
  );
  // Unknown capabilities keep the service visible; the callable still enforces access.
  const config =
    capability?.key === capabilityKey
      ? capability.config
      : {
          enabled: true,
          repairs: false,
          packages: false,
          admin: false,
          role: 'student' as const,
        };
  const [rows, setRows] = useState<DormWorkflowRows>({
    repairs: [],
    leaves: [],
    packages: [],
    residents: [],
  });
  const [staffMode, setStaffMode] = useState(false);
  const [tab, setTab] = useState('repairs');
  const [values, setValues] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [images, setImages] = useState<string[]>([]);
  const [requestKey, setRequestKey] = useState(dormRequestKey);
  const [preview, setPreview] = useState(false);
  const generation = useRef(0);
  const rowGeneration = useRef(0);
  const selectedStudentId = useRef('');
  const inputRef = useRef<FocusTarget | null>(null);
  const set = (key: string, value: string) => {
    setValues((old) => ({ ...old, [key]: value }));
    setPreview(false);
  };
  const call = useCallback(
    async <T,>(data: Record<string, unknown>): Promise<T> =>
      invoke<T>({ ...data, schoolId: toPublicSchoolId(schoolId) ?? schoolId }),
    [schoolId],
  );
  const refresh = useCallback(
    async (staff = staffMode) => {
      const token = generation.current;
      const rowToken = rowGeneration.current;
      const result = await call<Partial<DormWorkflowRows>>({
        action: staff ? 'workspace' : 'mine',
      });
      if (token === generation.current && rowToken === rowGeneration.current)
        setRows({ repairs: [], leaves: [], packages: [], residents: [], ...result });
    },
    [call, staffMode],
  );
  useEffect(() => {
    generation.current++;
    const token = generation.current;
    setCapability(null);
    selectedStudentId.current = '';
    setRows({ repairs: [], leaves: [], packages: [], residents: [] });
    setValues({});
    setImages([]);
    setRequestKey(dormRequestKey());
    setStaffMode(false);
    if (!uid) return;
    void call<DormWorkflowConfig>({ action: 'config' })
      .then((c) => {
        if (token === generation.current) {
          setCapability({ key: capabilityKey, config: c });
          if (c.enabled && initialStaff && (c.repairs || c.packages)) {
            setStaffMode(true);
            setTab(c.admin ? 'summary' : c.repairs ? 'repairs' : 'packages');
          }
        }
      })
      .catch(() => {
        if (token === generation.current) setNotice('宿舍服務暫時無法連線。');
      });
    return () => {
      generation.current++;
    };
  }, [call, uid, initialStaff, capabilityKey]);
  useEffect(() => {
    if (capability?.key !== capabilityKey || submitOnly) return;
    let active = true;
    const load = () => {
      void refresh().catch(() => {
        if (active) setNotice('讀取失敗，請重試。');
      });
    };
    load();
    const timer = setInterval(load, 15000);
    return () => {
      active = false;
      clearInterval(timer);
      rowGeneration.current++;
    };
  }, [capability, capabilityKey, refresh, submitOnly]);
  useEffect(() => {
    const today = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
    onTonightLeaveChange?.(rows.leaves.some((r) => r.date === today && r.status === 'approved'));
  }, [rows.leaves, onTonightLeaveChange]);
  useEffect(() => {
    if (!staffMode)
      onOwnRepairsChange?.(
        rows.repairs.map((r) => projectDormRepair(r.id, { ...r, workflow: 'dorm_staff' })),
      );
  }, [rows.repairs, staffMode, onOwnRepairsChange]);
  async function act(data: Record<string, unknown>, done?: () => void) {
    if (busy) return;
    if (
      data.action === 'registerPackage' &&
      (!selectedStudentId.current ||
        data.studentId !== selectedStudentId.current ||
        !rows.residents.some((r) => r.studentId === selectedStudentId.current))
    )
      return;
    setBusy(true);
    setNotice('');
    const token = generation.current;
    try {
      const result = await call<{ delivered?: number; recipients?: number }>(data);
      if (token !== generation.current) return;
      done?.();
      setNotice(
        result.recipients !== undefined
          ? `公告已發布，推播 ${result.delivered}/${result.recipients} 人。`
          : '紀錄已更新。',
      );
      await refresh();
    } catch (error) {
      if (token === generation.current)
        setNotice(error instanceof Error ? error.message : '操作失敗，請重試。');
    } finally {
      setBusy(false);
    }
  }
  if (!uid || !config || (!config.enabled && submitOnly)) return null;
  const f = (key: string, label: string, initial = '', multiline = false) => (
    <Field
      key={key}
      label={label}
      value={values[key] ?? initial}
      multiline={multiline}
      onChange={(value) => set(key, value)}
    />
  );
  const get = (key: string, fallback = '') => values[key] ?? fallback;
  const button = (title: string, data: Record<string, unknown>, done?: () => void) => (
    <Btn
      label={title}
      disabled={
        busy ||
        (data.action === 'registerPackage' &&
          !rows.residents.some((r) => r.studentId === data.studentId))
      }
      onPress={() => void act(data, done)}
    />
  );
  const ticket = (r: DormTicket, staff: boolean) => (
    <Box key={r.id}>
      <Label strong>
        {r.title} · {r.dormitory} {r.room}
      </Label>
      <Label>{r.description}</Label>
      <Label strong>{DORM_TICKET_LABELS[r.dormStatus]}</Label>
      {dormTicketOverdue(r) && (
        <Label strong accent>
          超過 3 天
        </Label>
      )}
      {r.history.map((h, i) => (
        <Label key={i}>
          {DORM_TICKET_LABELS[h.status]} ·{' '}
          {new Date(h.at).toLocaleString('zh-TW', { hour12: false })}
        </Label>
      ))}
      {r.schoolReference && <Label>學校單號 {r.schoolReference}（輔導員填）</Label>}
      {!!r.vendor && staff && <Label>廠商：{r.vendor}</Label>}
      {!!r.expectedDate && <Label>預計日期：{r.expectedDate}</Label>}
      {r.images?.map((url, i) => (
        <Photo key={url} url={url} label={'報修照片 ' + (i + 1)} />
      ))}
      {staff ? (
        <>
          {button('儲存維修安排', {
            action: 'repairDetails',
            id: r.id,
            schoolReference: get(r.id + 'ref', r.schoolReference),
            vendor: get(r.id + 'vendor', r.vendor),
            expectedDate: get(r.id + 'date', r.expectedDate),
          })}
          {f(r.id + 'ref', '學校單號（選填）', r.schoolReference)}
          {f(r.id + 'vendor', '廠商（選填）', r.vendor)}
          {f(r.id + 'date', '預計日期 YYYY-MM-DD（選填）', r.expectedDate)}
          {(['sent', 'received', 'scheduled'] as string[]).includes(r.dormStatus) &&
            button(
              { sent: '輔導員已收到', received: '已安排維修', scheduled: '已修好，請確認' }[
                r.dormStatus as 'sent' | 'received' | 'scheduled'
              ],
              {
                action: 'repairStatus',
                id: r.id,
                status: { sent: 'received', received: 'scheduled', scheduled: 'fixed' }[
                  r.dormStatus as 'sent' | 'received' | 'scheduled'
                ],
                schoolReference: get(r.id + 'ref', r.schoolReference),
                vendor: get(r.id + 'vendor', r.vendor),
                expectedDate: get(r.id + 'date', r.expectedDate),
              },
            )}
        </>
      ) : (
        <>
          {config.enabled &&
            r.dormStatus === 'fixed' &&
            button('確認修好並結案', { action: 'repairStatus', id: r.id, status: 'closed' })}
          {config.enabled &&
            ['fixed', 'closed'].includes(r.dormStatus) &&
            button('還沒修好', { action: 'repairStatus', id: r.id, status: 'sent' })}
        </>
      )}
    </Box>
  );
  const leave = (r: DormLeave, staff: boolean) => (
    <Box key={r.id}>
      <Label strong>
        {r.date} · {r.building} {r.room} · {DORM_LEAVE_LABELS[r.status]}
      </Label>
      <Label>{r.reason}</Label>
      {r.history.map((h, i) => (
        <Label key={i}>
          {DORM_LEAVE_LABELS[h.status]} · {new Date(h.at).toLocaleString('zh-TW')}
        </Label>
      ))}
      {staff && r.status === 'pending' && (
        <>
          {button('核可外宿', { action: 'decideLeave', id: r.id, status: 'approved' })}
          {button('不核可', { action: 'decideLeave', id: r.id, status: 'rejected' })}
        </>
      )}
    </Box>
  );
  if (!config.enabled && !rows.repairs.length && !rows.leaves.length && !notice) return null;
  if (!config.enabled)
    return (
      <Box>
        <Label strong>宿舍歷史紀錄（唯讀）</Label>
        <Label>{notice}</Label>
        {rows.repairs.map((r) => ticket(r, false))}
        {rows.leaves.map((r) => leave(r, false))}
      </Box>
    );
  return (
    <Box>
      <Label strong>{staffMode ? '輔導員工作台' : '宿舍輔導員服務'}</Label>
      <Label>{notice}</Label>
      {!submitOnly && (
        <Btn
          label="重新整理"
          disabled={busy}
          onPress={() => void refresh().catch(() => setNotice('讀取失敗，請重試。'))}
        />
      )}
      {!submitOnly && (config.repairs || config.packages) && (
        <Btn
          label={staffMode ? '回學生服務' : '開啟輔導員工作台'}
          disabled={busy}
          onPress={() => {
            setStaffMode(!staffMode);
            setTab(config.admin ? 'summary' : config.repairs ? 'repairs' : 'packages');
            setRows({ repairs: [], leaves: [], packages: [], residents: [] });
          }}
        />
      )}
      {!staffMode ? (
        <>
          {!!draft && (
            <Box>
              <Label strong>將這份備忘送給輔導員</Label>
              {f('building', '棟別', building)}
              {f('room', '房間', room)}
              <Label>請先確認問題名稱、位置及描述。漏水、斷電、受困請直接打服務台。</Label>
              {images.map((url, i) => (
                <Box key={url}>
                  <Photo url={url} label={'待送照片 ' + (i + 1)} />
                  <Btn
                    label={'移除照片 ' + (i + 1)}
                    disabled={busy}
                    onPress={() => setImages((old) => old.filter((x) => x !== url))}
                  />
                </Box>
              ))}
              <Btn
                label={`新增照片（${images.length}/3）`}
                disabled={busy || images.length >= 3}
                onPress={() => {
                  const photoGeneration = generation.current;
                  setBusy(true);
                  void pickPhotos(uid, 3 - images.length)
                    .then((photos) => {
                      if (photoGeneration === generation.current)
                        setImages((old) => [...old, ...photos].slice(0, 3));
                    })
                    .catch(() => setNotice('照片上傳失敗，請重試。'))
                    .finally(() => setBusy(false));
                }}
              />
              {button(
                '送給宿舍輔導員',
                {
                  action: 'submitRepair',
                  key: requestKey,
                  building: get('building', building),
                  room: get('room', room),
                  title: draft.title,
                  description: [draft.location, draft.description].filter(Boolean).join('\n'),
                  category: draft.category,
                  images,
                },
                () => {
                  setRequestKey(dormRequestKey());
                  setImages([]);
                },
              )}
            </Box>
          )}
          {!submitOnly && (
            <>
              <Label strong>本棟公告</Label>
              {rows.announcements?.map((a) => (
                <Box key={a.id}>
                  <Label strong>
                    {a.title} · {a.building}
                  </Label>
                  <Label>{a.body}</Label>
                </Box>
              ))}
              <Label strong>報修處理進度</Label>
              {!rows.repairs.length && <Label>目前沒有送給輔導員的工單。</Label>}
              {rows.repairs.map((r) => ticket(r, false))}
              <Box>
                <Label strong>外宿卡</Label>
                {f('leaveBuilding', '外宿棟別', building)}
                {f('leaveRoom', '外宿房間', room)}
                {f('leaveDate', '外宿日期 YYYY-MM-DD')}
                {f('reason', '外宿原因', '', true)}
                {button(
                  '送給輔導員核可',
                  {
                    action: 'requestLeave',
                    key: requestKey,
                    building: get('leaveBuilding', building),
                    room: get('leaveRoom', room),
                    date: get('leaveDate'),
                    reason: get('reason'),
                  },
                  () => {
                    setRequestKey(dormRequestKey());
                    set('reason', '');
                  },
                )}
                {rows.leaves.map((r) => leave(r, false))}
              </Box>
            </>
          )}
        </>
      ) : (
        <>
          {config.admin && (
            <Box>
              <Label strong>住服組總覽（不含學生個資）</Label>
              <Label>{dormWorkflowSummary(rows)}</Label>
              <Btn
                label="匯出宿舍統計"
                disabled={busy}
                onPress={() =>
                  void exportSummary(dormWorkflowSummary(rows)).catch(() => setNotice('匯出失敗。'))
                }
              />
              {f('targetUid', '輔導員帳號 UID')}
              {f('buildings', '值班棟別（逗號分隔，留空代表全棟）')}
              {button('授予包裹及報修權限', {
                action: 'setStaff',
                targetUid: get('targetUid'),
                buildings: get('buildings')
                  .split(',')
                  .map((s) => s.trim())
                  .filter(Boolean),
                packages: true,
                repairs: true,
              })}
              {button('移除宿舍服務權限', {
                action: 'setStaff',
                targetUid: get('targetUid'),
                buildings: [],
                packages: false,
                repairs: false,
              })}
            </Box>
          )}
          <Box>
            <Btn label="包裹" disabled={!config.packages} onPress={() => setTab('packages')} />
            <Btn label="報修" disabled={!config.repairs} onPress={() => setTab('repairs')} />
            <Btn label="住宿生" disabled={!config.packages} onPress={() => setTab('residents')} />
          </Box>
          {tab === 'repairs' && config.repairs && (
            <>
              {(Object.keys(DORM_TICKET_LABELS) as DormTicketStatus[]).map((status) => (
                <Box key={status}>
                  <Label strong>
                    {DORM_TICKET_LABELS[status]}（
                    {rows.repairs.filter((r) => r.dormStatus === status).length}）
                  </Label>
                  {rows.repairs.filter((r) => r.dormStatus === status).map((r) => ticket(r, true))}
                </Box>
              ))}
              <Label strong>外宿卡審核</Label>
              {rows.leaves.map((r) => leave(r, true))}
            </>
          )}
          {tab === 'packages' && config.packages && (
            <>
              <Label strong>連續登錄包裹</Label>
              <Field
                focusRef={inputRef}
                label="學號或姓名（本棟住宿生）"
                value={get('search')}
                onChange={(value) => {
                  selectedStudentId.current = '';
                  setValues((old) => ({ ...old, search: value, studentId: '' }));
                  setPreview(false);
                }}
              />
              {!!get('search') &&
                rows.residents
                  .filter(
                    (r) => r.studentId.includes(get('search')) || r.name.includes(get('search')),
                  )
                  .slice(0, 8)
                  .map((r) => (
                    <Btn
                      key={r.id}
                      label={`${r.studentId} ${r.name} ${r.building} ${r.room}`}
                      onPress={() => {
                        selectedStudentId.current = r.studentId;
                        setValues((old) => ({
                          ...old,
                          studentId: r.studentId,
                          search: r.studentId,
                        }));
                        setPreview(false);
                      }}
                    />
                  ))}
              <Label>已選學號：{get('studentId')}</Label>
              {f('item', '品名（可使用鍵盤語音輸入）')}
              {f('location', '領取地點')}
              {button(
                '登錄並通知學生',
                {
                  action: 'registerPackage',
                  key: requestKey,
                  studentId: get('studentId'),
                  description: get('item'),
                  location: get('location'),
                },
                () => {
                  setRequestKey(dormRequestKey());
                  selectedStudentId.current = '';
                  setValues((old) => ({ ...old, search: '', studentId: '' }));
                  set('item', '');
                  inputRef.current?.focus();
                },
              )}
              {f('collectStudent', '核對學生領取碼上的學號')}
              {rows.packages
                .filter((p) => p.studentId === get('collectStudent') && p.status === 'waiting')
                .map((p) => (
                  <Label key={p.id}>
                    {p.description} · {p.location}
                  </Label>
                ))}
              {button('已核對姓名與學號・全部核銷', {
                action: 'collectPackages',
                studentId: get('collectStudent'),
              })}
              <Label strong>逾期清單（每日 21:00 值班檢查）</Label>
              {rows.packages
                .filter(
                  (p) =>
                    p.status === 'waiting' && Date.now() - parcelTime(p.arrivedAt) >= 3 * 86400000,
                )
                .map((p) => (
                  <Box key={p.id}>
                    <Label>
                      {p.studentId} · {p.description} · {p.location}
                    </Label>
                    {button('標記退件', { action: 'returnPackage', id: p.id })}
                  </Box>
                ))}
            </>
          )}
          {tab === 'residents' && config.packages && (
            <>
              <Label>CSV：學號、棟、房、床。每批最多 400 位；學號必須對應本校已啟用帳號。</Label>
              {f('csv', '貼上住宿生 CSV', '', true)}
              <Btn
                label="驗證並匯入住宿生"
                disabled={busy}
                onPress={() => {
                  try {
                    void act({
                      action: 'importResidents',
                      rows: parseDormResidentsCsv(get('csv')),
                    });
                  } catch (e) {
                    setNotice(e instanceof Error ? e.message : 'CSV 格式錯誤');
                  }
                }}
              />
              {rows.residents.map((r) => (
                <Box key={r.id}>
                  <Label>
                    {r.studentId} {r.name} · {r.building} {r.room} {r.bed}
                  </Label>
                  {button('移出住宿名冊', { action: 'deactivateResident', studentId: r.studentId })}
                </Box>
              ))}
              <Label strong>本棟公告</Label>
              {f('announceBuilding', '公告棟別')}
              {f('announceTitle', '公告標題')}
              {f('announceBody', '公告內容', '', true)}
              <Btn label="預覽公告" disabled={busy} onPress={() => setPreview(true)} />
              {preview && (
                <Box>
                  <Label strong>{get('announceTitle')}</Label>
                  <Label>{get('announceBody')}</Label>
                  <Label>只通知 {get('announceBuilding')} 住宿生名冊內的人。</Label>
                  {button(
                    '確認發布本棟公告',
                    {
                      action: 'announce',
                      building: get('announceBuilding'),
                      title: get('announceTitle'),
                      body: get('announceBody'),
                    },
                    () => setPreview(false),
                  )}
                </Box>
              )}
            </>
          )}
        </>
      )}
    </Box>
  );
}
function parcelTime(value: number | { _seconds: number }): number {
  return typeof value === 'number' ? value : value?._seconds * 1000;
}
