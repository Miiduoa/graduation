import type { LostFoundItem } from './types';

/** Firestore Timestamp components — avoid lossy ISO for optimistic concurrency. */
export type LostFoundRevision = {
  seconds: number;
  nanoseconds: number;
};

export type LostFoundWriteFields = {
  type: 'lost' | 'found';
  title: string;
  description: string;
  category: string;
  location: string;
  date: string;
  contactInfo?: string;
};

export type LostFoundWriteOptions = {
  /** Stable create document id (never allocate a new id on retry). */
  documentId?: string;
  /** Original base revision captured before the mutation intent. */
  expectedRevision?: LostFoundRevision | null;
  /** Predicate checked at async boundaries (uid + school + generation/focus). */
  assertCurrentScope?: () => boolean | Promise<boolean>;
};

export type LostFoundViewItem = LostFoundItem & {
  /** Canonical owner field. Absent on reporterId-only legacy docs. */
  userId?: string;
  canonical: boolean;
  updatedAtRevision: LostFoundRevision | null;
  /** True when rules cannot authorize mutations (reporterId-only legacy). */
  migrationReadOnly: boolean;
};

export class LostFoundError extends Error {
  readonly code: string;
  constructor(message: string, code = 'lost-found') {
    super(message);
    this.name = 'LostFoundError';
    this.code = code;
  }
}

export class LostFoundWriteUnconfirmedError extends LostFoundError {
  constructor(
    message = '資料已送出，但無法讀回確認。請先返回列表重新整理，再以同一則內容重試，避免重複刊登。',
  ) {
    super(message, 'lost-found-write-unconfirmed');
    this.name = 'LostFoundWriteUnconfirmedError';
  }
}

export class LostFoundConflictError extends LostFoundError {
  constructor(message: string) {
    super(message, 'lost-found-conflict');
    this.name = 'LostFoundConflictError';
  }
}

export class LostFoundScopeChangedError extends LostFoundError {
  constructor(message = '帳號或校園已切換，請重新操作。') {
    super(message, 'lost-found-scope-changed');
    this.name = 'LostFoundScopeChangedError';
  }
}

export const CONTACT_VISIBILITY_NOTE =
  '聯絡方式會顯示給任何已登入的使用者；請勿填寫證件號碼或其他不必要的個資。';

export const LEGACY_MIGRATION_NOTE =
  '這則刊登仍是舊版資料，目前只能查看。若要編輯或結案，請以目前帳號重新刊登一則新的資訊。';

/** Rules authorize userId only — never infer permission from reporterId. */
export function canManageLostFoundItem(
  item: Pick<LostFoundViewItem, 'userId'> | Pick<LostFoundItem, 'reporterId'> | null | undefined,
  uid: string | null | undefined,
): boolean {
  if (!uid || !item || typeof item !== 'object') return false;
  const userId = 'userId' in item ? item.userId : undefined;
  return typeof userId === 'string' && userId.length > 0 && userId === uid;
}

export function asLostFoundViewItem(item: LostFoundItem | null | undefined): LostFoundViewItem | null {
  if (!item) return null;
  const row = item as LostFoundViewItem;
  const userId = typeof row.userId === 'string' && row.userId ? row.userId : undefined;
  return {
    ...item,
    userId,
    canonical: row.canonical === true,
    updatedAtRevision: row.updatedAtRevision ?? null,
    migrationReadOnly: row.migrationReadOnly === true || !userId,
  };
}

export function revisionsEqual(
  a: LostFoundRevision | null | undefined,
  b: LostFoundRevision | null | undefined,
): boolean {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  return a.seconds === b.seconds && a.nanoseconds === b.nanoseconds;
}

export function encodeRevision(revision: LostFoundRevision | null | undefined): string | null {
  if (revision == null) return null;
  return `${revision.seconds}:${revision.nanoseconds}`;
}

export function decodeRevision(value: string | null | undefined): LostFoundRevision | null {
  if (value == null || value === '') return null;
  const match = /^(-?\d+):(\d+)$/.exec(value);
  if (!match) return null;
  return { seconds: Number(match[1]), nanoseconds: Number(match[2]) };
}

export function readRevision(value: unknown): LostFoundRevision | null {
  if (value == null) return null;
  if (typeof value === 'object') {
    const row = value as {
      seconds?: unknown;
      nanoseconds?: unknown;
      _seconds?: unknown;
      _nanoseconds?: unknown;
    };
    const seconds = row.seconds ?? row._seconds;
    const nanoseconds = row.nanoseconds ?? row._nanoseconds;
    if (
      typeof seconds === 'number' &&
      Number.isFinite(seconds) &&
      typeof nanoseconds === 'number' &&
      Number.isFinite(nanoseconds)
    ) {
      return { seconds, nanoseconds };
    }
  }
  return null;
}

export function fieldsEqual(a: LostFoundWriteFields, b: LostFoundWriteFields): boolean {
  return (
    a.type === b.type &&
    a.title === b.title &&
    a.description === b.description &&
    a.category === b.category &&
    a.location === b.location &&
    a.date === b.date &&
    (a.contactInfo ?? '') === (b.contactInfo ?? '')
  );
}
