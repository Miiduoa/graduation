import { DORM_TICKET_LABELS } from './dormWorkflow';
/** Student projection of the existing school packages and repairRequests collections.
 * No IDs used by school repair systems or staff-only notes leave this projection.
 */
export type DormCloudParcel = {
  id: string;
  title: string;
  arrivedAt: number | null;
  location: string;
  status: 'waiting' | 'collected' | 'returned';
  postal: boolean;
};
export const DORM_CLOUD_REPAIR_LABELS = {
  ...DORM_TICKET_LABELS,
  pending: '備忘待處理',
  assigned: '備忘標記：已指派',
  in_progress: '備忘標記：處理中',
  completed: '備忘標記：已完成',
  closed: '備忘標記：已結案',
  cancelled: '備忘標記：已取消',
} as const;
export type DormCloudRepairStatus = keyof typeof DORM_CLOUD_REPAIR_LABELS;
export type DormCloudRepair = {
  official?: boolean;
  id: string;
  title: string;
  location: string;
  status: DormCloudRepairStatus | null;
  steps: Array<{ status: DormCloudRepairStatus; at: number | null }>;
};
export type DormCloudState = {
  packages: DormCloudParcel[];
  repairs: DormCloudRepair[];
  packagesState: 'loading' | 'ready' | 'error' | 'guest';
  repairsState: 'loading' | 'ready' | 'error' | 'guest';
  identity: { studentId: string; name: string } | null;
};
export const DORM_PACKAGES_EMPTY = '這所學校的宿舍還沒用 nuni 登錄包裹。';
export function emptyDormCloud(guest = false): DormCloudState {
  return {
    packages: [],
    repairs: [],
    packagesState: guest ? 'guest' : 'loading',
    repairsState: guest ? 'guest' : 'loading',
    identity: null,
  };
}
function text(value: unknown, max = 120): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}
export function dormCloudTime(value: unknown): number | null {
  if (
    value &&
    typeof value === 'object' &&
    'toMillis' in value &&
    typeof value.toMillis === 'function'
  ) {
    const result: unknown = value.toMillis();
    return typeof result === 'number' && Number.isFinite(result) ? result : null;
  }
  if (value && typeof value === 'object' && 'seconds' in value && typeof value.seconds === 'number')
    return value.seconds * 1000;
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value;
  if (typeof value === 'string') {
    const result = Date.parse(value);
    return Number.isFinite(result) ? result : null;
  }
  return null;
}
export function projectDormParcel(id: string, row: Record<string, unknown>): DormCloudParcel {
  const location = text(row.location);
  const courier = text(row.courier || row.carrier);
  return {
    id,
    title:
      text(row.sender || row.description || row.item || row.itemName) ||
      (courier !== 'unknown' ? courier : '') ||
      '包裹',
    arrivedAt: dormCloudTime(row.arrivedAt || row.createdAt),
    location: location || '請向服務台確認',
    status: ['picked', 'picked_up'].includes(String(row.status))
      ? 'collected'
      : row.status === 'returned'
        ? 'returned'
        : 'waiting',
    postal: /郵局|掛號|收發室|中華郵政|post\s*office|registered\s*mail|chunghwa/i.test(
      location + ' ' + courier,
    ),
  };
}
export function projectDormRepair(id: string, row: Record<string, unknown>): DormCloudRepair {
  const official = row.workflow === 'dorm_staff';
  const raw = official ? row.dormStatus : row.status === 'inProgress' ? 'in_progress' : row.status;
  // Only workflow-tagged rows represent actual staff tickets; legacy states remain memo labels.
  const status =
    typeof raw === 'string' && Object.prototype.hasOwnProperty.call(DORM_CLOUD_REPAIR_LABELS, raw)
      ? (raw as DormCloudRepairStatus)
      : null;
  const order: DormCloudRepairStatus[] = [
    'pending',
    'assigned',
    'in_progress',
    'completed',
    'closed',
    'cancelled',
  ];
  const steps = order.flatMap((step) => {
    if (!status) return [];
    const at = dormCloudTime(row[step + 'At'] || (step === 'pending' ? row.createdAt : null));
    return at !== null || step === status ? [{ status: step, at }] : [];
  });
  return {
    id,
    ...(official ? { official: true } : {}),
    title: text(row.title || row.description, 1000) || '設備問題',
    location: [text(row.dormitory), text(row.room)].filter(Boolean).join(' '),
    status,
    steps:
      official && Array.isArray(row.history)
        ? row.history.flatMap((h) =>
            h &&
            typeof h.status === 'string' &&
            Object.prototype.hasOwnProperty.call(DORM_TICKET_LABELS, h.status)
              ? [{ status: h.status as DormCloudRepairStatus, at: dormCloudTime(h.at) }]
              : [],
          )
        : steps,
  };
}
export function dormCloudDate(value: number | null): string {
  return value === null ? '時間待確認' : new Date(value).toLocaleString('zh-TW', { hour12: false });
}
export function dormParcelReturnNotice(parcel: DormCloudParcel, now = Date.now()): boolean {
  return (
    parcel.status === 'waiting' &&
    parcel.arrivedAt !== null &&
    now - parcel.arrivedAt >= 3 * 86400000
  );
}
export type DormCloudTransport = {
  watch: (
    collection: 'packages' | 'repairRequests',
    field: 'recipientId' | 'userId',
    onRows: (rows: Array<{ id: string; data: Record<string, unknown> }>) => void,
    onError: () => void,
  ) => () => void;
  identity: (onIdentity: (value: { studentId: string; name: string } | null) => void) => () => void;
};
export function watchDormCloud(
  transport: DormCloudTransport,
  onChange: (value: DormCloudState) => void,
): () => void {
  let state = emptyDormCloud();
  let active = true;
  const change = (patch: Partial<DormCloudState>) => {
    if (active) {
      state = { ...state, ...patch };
      onChange(state);
    }
  };
  const stops: Array<() => void> = [];
  const register = (start: () => () => void, error: () => void) => {
    try {
      stops.push(start());
    } catch {
      error();
    }
  };
  register(
    () =>
      transport.watch(
        'packages',
        'recipientId',
        (rows) =>
          change({
            packagesState: 'ready',
            packages: rows
              .map((r) => projectDormParcel(r.id, r.data))
              .sort((a, b) => (a.arrivedAt ?? Infinity) - (b.arrivedAt ?? Infinity)),
          }),
        () => change({ packagesState: 'error' }),
      ),
    () => change({ packagesState: 'error' }),
  );
  register(
    () =>
      transport.watch(
        'repairRequests',
        'userId',
        (rows) =>
          change({
            repairsState: 'ready',
            repairs: rows
              .map((r) => projectDormRepair(r.id, r.data))
              .sort(
                (a, b) =>
                  Math.max(0, ...b.steps.map((s) => s.at ?? 0)) -
                  Math.max(0, ...a.steps.map((s) => s.at ?? 0)),
              ),
          }),
        () => change({ repairsState: 'error', repairs: [] }),
      ),
    () => change({ repairsState: 'error', repairs: [] }),
  );
  register(
    () => transport.identity((identity) => change({ identity })),
    () => change({ identity: null }),
  );
  return () => {
    active = false;
    stops.forEach((stop) => {
      if (typeof stop === 'function') stop();
    });
  };
}

/** Poll the recipient projection independently of staff workflow enablement. */
export function pollDormParcels(
  load: () => Promise<{ rows: Array<{ id: string; data: Record<string, unknown> }> }>,
  rows: (value: Array<{ id: string; data: Record<string, unknown> }>) => void,
  error: () => void,
): () => void {
  let active = true;
  let pending = false;
  const refresh = async () => {
    if (pending) return;
    pending = true;
    try {
      const result = await load();
      if (active) rows(result.rows);
    } catch {
      if (active) error();
    } finally {
      pending = false;
    }
  };
  void refresh();
  const timer = setInterval(() => void refresh(), 60000);
  return () => {
    active = false;
    clearInterval(timer);
  };
}

/** Keep the legacy subscription available even when the optional endpoint is unavailable. */
export function watchDormParcels(
  legacy: (rows: (value: ParcelRows) => void, error: () => void) => () => void,
  available: (change: (value: boolean) => void) => () => void,
  load: () => Promise<{ rows: ParcelRows }>,
  rows: (value: ParcelRows) => void,
  error: () => void,
): () => void {
  let cached: ParcelRows | undefined;
  let projected = false;
  let stopPoll: (() => void) | undefined;
  const fallback = () => {
    if (projected) {
      error();
    } else if (cached) rows(cached);
    else error();
  };
  const stopLegacy = legacy(
    (value) => {
      cached = value;
      if (!projected) rows(value);
    },
    () => {
      if (!projected) error();
    },
  );
  const stopAvailable = available((value) => {
    if (!value) {
      stopPoll?.();
      stopPoll = undefined;
      if (projected) error();
      else if (cached) rows(cached);
    } else if (!stopPoll) {
      stopPoll = pollDormParcels(
        load,
        (value) => {
          projected = true;
          rows(value);
        },
        fallback,
      );
    }
  });
  return () => {
    stopPoll?.();
    stopAvailable();
    stopLegacy();
  };
}
type ParcelRows = Array<{ id: string; data: Record<string, unknown> }>;
