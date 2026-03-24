import { httpsCallable } from 'firebase/functions';

import { getFunctionsInstance } from '../firebase';

export type ExportUserDataRequest = {
  categories: string[];
  schoolId?: string | null;
};

export type ExportUserDataResponse = {
  exportedAt: string;
  schoolId?: string | null;
  userId: string;
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
  confirmation: 'DELETE_MY_ACCOUNT';
  schoolId?: string | null;
};

export async function deleteUserAccount(
  request: DeleteUserAccountRequest,
): Promise<{ success: boolean }> {
  const callable = httpsCallable<DeleteUserAccountRequest, { success: boolean }>(
    getFunctionsInstance(),
    'deleteUserAccount',
  );
  const result = await callable(request);
  return result.data;
}
