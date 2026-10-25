/** Personal dormitory workspace. Records are user-entered and are not school acknowledgements. */
export type DormRepairStatus = 'draft' | 'reported' | 'resolved';
export type DormRepairCategory = 'water' | 'electric' | 'air' | 'furniture' | 'network' | 'other';
export type DormStage = 'prepare' | 'checkin' | 'checkout';

export type DormMilestone = {
  id: string;
  title: string;
  dueDate: string; // YYYY-MM-DD in the student's local calendar
  completed: boolean;
  createdAt: number;
};

export const DORM_MILESTONE_LIMIT = 30;

export const DORM_REPAIR_SHORTCUTS: ReadonlyArray<{
  category: DormRepairCategory;
  title: string;
}> = [
  { category: 'air', title: '冷氣無法正常運作' },
  { category: 'water', title: '浴室或水管漏水' },
  { category: 'electric', title: '插座或照明故障' },
  { category: 'network', title: '宿舍網路無法連線' },
  { category: 'furniture', title: '門窗或家具損壞' },
];

export type DormRepair = {
  id: string;
  category: DormRepairCategory;
  title: string;
  location: string;
  description: string;
  status: DormRepairStatus;
  createdAt: number;
  updatedAt: number;
};

export type DormParcel = {
  id: string;
  title: string;
  pickupPoint: string;
  dueDate: string; // Optional resident-entered date, not a school deadline
  collected: boolean;
  createdAt: number;
  collectedAt: number | null;
};

export const DORM_PARCEL_LIMIT = 50;

export type DormWorkspace = {
  version: 1;
  building: string;
  room: string;
  bed: string;
  checkmarks: Record<string, boolean>;
  repairs: DormRepair[];
  milestones: DormMilestone[];
  parcels: DormParcel[];
  laundryEndAt: number | null;
};

export const DORM_CHECKLISTS: ReadonlyArray<{
  stage: DormStage;
  title: string;
  items: ReadonlyArray<{ id: string; title: string; detail: string }>;
}> = [
  {
    stage: 'prepare',
    title: '申請與分配',
    items: [
      { id: 'read-announcement', title: '確認當學期住宿公告', detail: '截止日、資格與抽籤規則以校方公布為準。' },
      { id: 'apply-officially', title: '透過學校管道完成申請', detail: '在這裡打勾不代表已向校方申請。' },
      { id: 'check-result', title: '自行核對床位與繳費資訊', detail: '此應用不讀取個人校務資料。' },
    ],
  },
  {
    stage: 'checkin',
    title: '入住前後',
    items: [
      { id: 'pay-officially', title: '完成校方要求的繳費', detail: '留意繳費證明與收據。' },
      { id: 'entry-documents', title: '準備證件、門禁與入住文件', detail: '依所屬宿舍現場要求準備。' },
      { id: 'room-inspection', title: '確認房間設備及現況', detail: '如有損壞，照校方要求記錄或通報。' },
      { id: 'room-rules', title: '閱讀住宿及消防安全規範', detail: '確認門禁、用電與緊急聯絡方式。' },
    ],
  },
  {
    stage: 'checkout',
    title: '退宿',
    items: [
      { id: 'checkout-date', title: '確認退宿申請與期限', detail: '需向校方確認，非此處送出。' },
      { id: 'clean-room', title: '清空並清潔寢室', detail: '檢查個人物品及環境。' },
      { id: 'return-keys', title: '辦理門禁、鑰匙及財物點交', detail: '依服務台流程完成。' },
      { id: 'check-refund', title: '確認保證金或退費程序', detail: '實際結果以學校出納及宿舍紀錄為準。' },
    ],
  },
];

const repairCategories: readonly DormRepairCategory[] = ['water', 'electric', 'air', 'furniture', 'network', 'other'];
const repairStatuses: readonly DormRepairStatus[] = ['draft', 'reported', 'resolved'];

export const DORM_REPAIR_CATEGORIES: Record<DormRepairCategory, string> = {
  water: '水電與漏水',
  electric: '照明與電力',
  air: '冷氣與通風',
  furniture: '家具與門窗',
  network: '網路設備',
  other: '其他',
};

export const DORM_REPAIR_STATUSES: Record<DormRepairStatus, string> = {
  draft: '尚未向校方通報',
  reported: '已自行通報（未核實）',
  resolved: '已自行確認處理完成',
};

const taskIds = new Set(DORM_CHECKLISTS.flatMap((group) => group.items.map((item) => item.id)));

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function boundedText(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function integer(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : 0;
}

export function emptyDormWorkspace(): DormWorkspace {
  return {
    version: 1,
    building: '',
    room: '',
    bed: '',
    checkmarks: {},
    repairs: [],
    milestones: [],
    parcels: [],
    laundryEndAt: null;
  };
}

/** Reject impossible dates, including 2026-02-30 and month 13. */
export function isValidDormDate(raw: string): boolean {
  if (!/^(20\d{2})-(\d{2})-(\d{2})$/.test(raw)) return false;
  const [year, month, day] = raw.split('-').map(Number);
  const result = new Date(Date.UTC(year, month - 1, day));
  return result.getUTCFullYear() === year &&
    result.getUTCMonth() === month - 1 &&
    result.getUTCDate() === day;
}

export function localDormDate(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function sortedDormMilestones(value: DormWorkspace): DormMilestone[] {
  return [...value.milestones].sort((a, b) =>
    Number(a.completed) - Number(b.completed) ||
    a.dueDate.localeCompare(b.dueDate) ||
    a.createdAt - b.createdAt);
}

/** Pending parcels first, sorted by resident-entered pickup date. */
export function sortedDormParcels(value: DormWorkspace): DormParcel[] {
  return [...value.parcels].sort((a, b) =>
    Number(a.collected) - Number(b.collected) ||
    (a.collected
      ? (b.collectedAt ?? 0) - (a.collectedAt ?? 0)
      : (a.dueDate || '9999-12-31').localeCompare(b.dueDate || '9999-12-31')) ||
    b.createdAt - a.createdAt ||
    a.id.localeCompare(b.id));
}

export function normalizeDormWorkspace(raw: unknown): DormWorkspace {
  const value = asObject(raw);
  const blank = emptyDormWorkspace();
  const checkmarks: Record<string, boolean> = {};
  const checks = asObject(value.checkmarks);
  for (const id of taskIds) if (checks[id] === true) checkmarks[id] = true;
  const used = new Set<string>();
  const repairs: DormRepair[] = [];
  if (Array.isArray(value.repairs)) {
    for (const item of value.repairs.slice(0, 80)) {
      const row = asObject(item);
      const id = boundedText(row.id, 90);
      const title = boundedText(row.title, 90);
      if (!id || !/^[a-zA-Z0-9_-]+$/.test(id) || used.has(id) || !title) continue;
      used.add(id);
      repairs.push({
        id,
        category: repairCategories.includes(row.category as DormRepairCategory)
          ? (row.category as DormRepairCategory)
          : 'other',
        title,
        location: boundedText(row.location, 100),
        description: boundedText(row.description, 1200),
        status: repairStatuses.includes(row.status as DormRepairStatus)
          ? (row.status as DormRepairStatus)
          : 'draft',
        createdAt: integer(row.createdAt),
        updatedAt: integer(row.updatedAt),
      });
    }
  }
  const milestones: DormMilestone[] = [];
  const milestoneIds = new Set<string>();
  if (Array.isArray(value.milestones)) {
    for (const item of value.milestones.slice(0, DORM_MILESTONE_LIMIT)) {
      const row = asObject(item);
      const id = boundedText(row.id, 90);
      const title = boundedText(row.title, 90);
      const dueDate = boundedText(row.dueDate, 10);
      if (!id || !/^[a-zA-Z0-9_-]+$/.test(id) ||
          milestoneIds.has(id) || !title || !isValidDormDate(dueDate)) continue;
      milestoneIds.add(id);
      milestones.push({
        id,
        title,
        dueDate,
        completed: row.completed === true,
        createdAt: integer(row.createdAt),
      });
    }
  }
  const parcels: DormParcel[] = [];
  const parcelIds = new Set<string>();
  if (Array.isArray(value.parcels)) {
    for (const item of value.parcels.slice(0, DORM_PARCEL_LIMIT)) {
      const row = asObject(item);
      const id = boundedText(row.id, 90);
      const title = boundedText(row.title, 90);
      if (!id || !/^[a-zA-Z0-9_-]+$/.test(id) || parcelIds.has(id) || !title) continue;
      parcelIds.add(id);
      const dueDate = boundedText(row.dueDate, 10);
      const collected = row.collected === true;
      parcels.push({
        id,
        title,
        pickupPoint: boundedText(row.pickupPoint, 100),
        dueDate: isValidDormDate(dueDate) ? dueDate : '',
        collected,
        createdAt: integer(row.createdAt),
        collectedAt: collected ? (integer(row.collectedAt) || null) : null,
      });
    }
  }
  const laundryEndAt = integer(value.laundryEndAt);
  return {
    ...blank,
    building: boundedText(value.building, 70),
    room: boundedText(value.room, 50),
    bed: boundedText(value.bed, 40),
    checkmarks,
    repairs,
    milestones,
    parcels,
    laundryEndAt: laundryEndAt || null,
  };
}

export function dormStorageKey(owner: string, schoolId: string): string {
  return 'campus.dormitory.v1:' + encodeURIComponent(owner) + ':' + encodeURIComponent(schoolId);
}

export function dormChecklistProgress(value: DormWorkspace): { completed: number; total: number } {
  const all = DORM_CHECKLISTS.flatMap((group) => group.items);
  return { completed: all.filter((item) => value.checkmarks[item.id]).length, total: all.length };
}

export function formatDormRepairForCopy(repair: DormRepair): string {
  return [
    '宿舍設備問題（自行記錄，尚未透過此應用送出）',
    '項目：' + DORM_REPAIR_CATEGORIES[repair.category],
    '問題：' + repair.title,
    repair.location ? '位置：' + repair.location : '',
    repair.description ? '狀況：' + repair.description : '',
  ].filter(Boolean).join('\n');
}
