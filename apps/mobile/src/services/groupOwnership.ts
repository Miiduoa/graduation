import { httpsCallable } from 'firebase/functions';
import { getAuthInstance, getFunctionsInstance } from '../firebase';

export type TransferGroupOwnershipInput = {
  groupId: string;
  targetUid: string;
  operationId: string;
  expectedCurrentOwnerUid: string;
};

export type TransferGroupOwnershipResult = {
  success: true;
  reused: boolean;
  groupId: string;
  schoolId: string;
  fromUid: string;
  toUid: string;
  actorNewRole: string;
  operationId: string;
};

export type GroupOwnershipOrigin = {
  generation: number;
  uid: string;
  schoolId: string;
  groupId: string;
  targetUid: string;
  operationId: string;
};

export function createGroupOwnershipOperationId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `own-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function createGroupOwnershipOrigin(input: {
  generation: number;
  uid: string;
  schoolId: string;
  groupId: string;
  targetUid: string;
  operationId?: string;
}): GroupOwnershipOrigin {
  return {
    generation: input.generation,
    uid: input.uid,
    schoolId: input.schoolId,
    groupId: input.groupId,
    targetUid: input.targetUid,
    operationId: input.operationId ?? createGroupOwnershipOperationId(),
  };
}

export function isGroupOwnershipOriginCurrent(
  origin: GroupOwnershipOrigin,
  live: {
    generation: number;
    uid: string | null | undefined;
    schoolId: string;
    groupId: string | null | undefined;
  },
): boolean {
  return (
    origin.generation === live.generation &&
    Boolean(origin.uid) &&
    origin.uid === live.uid &&
    origin.schoolId === live.schoolId &&
    origin.groupId === live.groupId
  );
}

export async function transferGroupOwnership(
  input: TransferGroupOwnershipInput,
): Promise<TransferGroupOwnershipResult> {
  const auth = getAuthInstance();
  const currentUid = auth.currentUser?.uid;
  if (!currentUid) throw new Error('請先登入後再轉讓擁有權。');
  if (currentUid !== input.expectedCurrentOwnerUid) {
    throw new Error('目前登入身分與轉讓發起者不符，請重新確認後再試。');
  }

  const callable = httpsCallable<TransferGroupOwnershipInput, TransferGroupOwnershipResult>(
    getFunctionsInstance(),
    'transferGroupOwnership',
  );
  const response = await callable(input);
  const result = response.data;
  if (!result || result.success !== true) {
    throw new Error('未能確認轉讓結果，請更新成員列表後再決定是否重試。');
  }
  return result;
}

export function transferGroupOwnershipErrorMessage(error: unknown): string {
  const code =
    error && typeof error === 'object' && 'code' in error
      ? String((error as { code?: unknown }).code ?? '')
      : '';
  const message =
    error instanceof Error
      ? error.message
      : error && typeof error === 'object' && 'message' in error
        ? String((error as { message?: unknown }).message ?? '')
        : '';

  if (code.includes('unauthenticated') || /登入/.test(message)) {
    return '請先登入學校帳號後再轉讓擁有權。';
  }
  if (code.includes('permission-denied')) {
    return '目前沒有轉讓權限，或接收對象不符合此校／此群組資格。';
  }
  if (code.includes('failed-precondition') || code.includes('already-exists')) {
    return message && !/INTERNAL|HTTP/.test(message)
      ? message
      : '目前無法完成轉讓，請更新成員列表確認擁有者後再試。';
  }
  if (message) return message;
  return '轉讓失敗，請確認連線後重試。';
}
