import Constants from 'expo-constants';
import { signInWithCustomToken } from 'firebase/auth';

import {
  authenticateUniversalDevAccount,
  type UniversalDevAccount,
} from '@campus/shared/src/devUniversalAccounts';

import { getAuthInstance, hasUsableFirebaseConfig } from '../firebase';
import { saveMockAuthSession } from './mockAuth';

import type { UserRole } from '../state/auth';

type UniversalDevAuthResponse = {
  customToken?: string;
  uid?: string;
  isNewUser?: boolean;
  error?: string;
};

export type UniversalDevSignInResult = UniversalDevAccount & {
  isMock: boolean;
  isNewUser: boolean;
};

async function parseFunctionJsonResponse(
  response: Response,
  fallbackMessage: string,
): Promise<UniversalDevAuthResponse> {
  const text = await response.text();
  if (!text.trim()) {
    return {};
  }

  try {
    return JSON.parse(text) as UniversalDevAuthResponse;
  } catch {
    return {
      error: response.ok ? fallbackMessage : `${fallbackMessage}（HTTP ${response.status}）`,
    };
  }
}

function getCloudFunctionUrl(functionName: string): string {
  const extra = (Constants.expoConfig?.extra ?? {}) as {
    firebase?: { projectId?: string };
    cloudFunctionRegion?: string;
  };
  const projectId = extra.firebase?.projectId;
  const region = extra.cloudFunctionRegion ?? 'asia-east1';

  if (!projectId) {
    throw new Error('Firebase projectId not configured. 無法使用通用測試帳號登入。');
  }

  return `https://${region}-${projectId}.cloudfunctions.net/${functionName}`;
}

export async function signInWithUniversalDevAccount(params: {
  email: string;
  password: string;
  schoolId: string;
}): Promise<UniversalDevSignInResult> {
  const account = authenticateUniversalDevAccount(params.email, params.password);
  if (!account) {
    throw new Error('測試帳號或密碼錯誤');
  }

  if (!hasUsableFirebaseConfig()) {
    await saveMockAuthSession({
      uid: account.uid,
      email: account.email,
      schoolId: params.schoolId,
      displayName: account.displayName,
      role: account.role as UserRole,
    });

    return {
      ...account,
      isMock: true,
      isNewUser: false,
    };
  }

  const response = await fetch(getCloudFunctionUrl('signInUniversalDevAccount'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email: account.email,
      password: params.password,
      schoolId: params.schoolId,
    }),
  });

  const data = await parseFunctionJsonResponse(
    response,
    '通用測試帳號登入端點回傳了無法解析的內容',
  );
  if (!response.ok || typeof data.customToken !== 'string' || typeof data.uid !== 'string') {
    throw new Error(data.error || '通用測試帳號登入失敗');
  }

  await signInWithCustomToken(getAuthInstance(), data.customToken);

  return {
    ...account,
    uid: data.uid,
    isMock: false,
    isNewUser: data.isNewUser === true,
  };
}
