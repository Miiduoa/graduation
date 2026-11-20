import { httpsCallable } from 'firebase/functions';

import { getAuthInstance, getFunctionsInstance } from '../firebase';

export function isPrivacyAccountCurrent(uid: string): boolean {
  try {
    return getAuthInstance().currentUser?.uid === uid;
  } catch {
    return false;
  }
}

export type ExportUserDataRequest = {
  expectedUserId: string;
  categories: string[];
  schoolId?: string | null;
};

export type ExportUserDataResponse = {
  exportedAt: string;
  schoolId?: string | null;
  userId: string;
  coverage: {
    truncated: boolean;
    truncatedSections: string[];
    scope: 'selected-categories';
    categories: string[];
  };
  [key: string]: unknown;
};

export async function exportUserData(
  request: ExportUserDataRequest,
): Promise<ExportUserDataResponse> {
  const callable = httpsCallable<ExportUserDataRequest, ExportUserDataResponse>(
    getFunctionsInstance(),
    'exportUserData',
  );
  const result = await callable(request);
  return result.data;
}

export type DeleteUserAccountRequest = {
  expectedUserId: string;
  confirmation: 'DELETE_MY_ACCOUNT';
  schoolId?: string | null;
};

export async function deleteUserAccount(
  request: DeleteUserAccountRequest,
): Promise<{ success: boolean; userId: string }> {
  const callable = httpsCallable<DeleteUserAccountRequest, { success: boolean; userId: string }>(
    getFunctionsInstance(),
    'deleteUserAccount',
  );
  const result = await callable(request);
  return result.data;
}
