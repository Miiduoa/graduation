import { requireOptionalNativeModule } from 'expo';
import { Platform } from 'react-native';

export interface NuniGoogleNativeAdapter {
  isConfigured(): boolean;
  getIdToken(serverClientId: string, nonce: string): Promise<{ idToken?: unknown }>;
  clearCredentialState(): Promise<boolean>;
}

export type NuniGoogleErrorCode =
  | 'CANCELLED'
  | 'UNAVAILABLE'
  | 'NOT_CONFIGURED'
  | 'NO_CREDENTIAL'
  | 'BUSY'
  | 'INVALID_REQUEST'
  | 'INVALID_RESPONSE'
  | 'FAILED';

export class NuniGoogleError extends Error {
  constructor(
    public readonly code: NuniGoogleErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'NuniGoogleError';
  }
}

export type GoogleCredentialCapability =
  | { available: true }
  | {
      available: false;
      reason: 'unsupported-platform' | 'native-module-unavailable' | 'ios-not-configured';
    };

function nativeErrorCode(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? code.replace(/^ERR_/, '') : '';
}

export function createNuniGoogleClient(adapter: NuniGoogleNativeAdapter | null, platform: string) {
  let busy = false;

  function capability(): GoogleCredentialCapability {
    if (platform !== 'ios' && platform !== 'android') {
      return { available: false, reason: 'unsupported-platform' };
    }
    if (!adapter) return { available: false, reason: 'native-module-unavailable' };
    try {
      if (!adapter.isConfigured()) {
        return { available: false, reason: 'ios-not-configured' };
      }
    } catch {
      return { available: false, reason: 'native-module-unavailable' };
    }
    return { available: true };
  }

  async function request(serverClientId: string, nonce: string): Promise<string> {
    if (
      !/^[0-9]+-[a-z0-9-]+\.apps\.googleusercontent\.com$/.test(serverClientId) ||
      !/^[A-Za-z0-9_-]{32,128}$/.test(nonce)
    ) {
      throw new NuniGoogleError('INVALID_REQUEST', '登入資料無法確認，請重新開始。');
    }
    const available = capability();
    if (available.available === false) {
      throw new NuniGoogleError(
        available.reason === 'ios-not-configured' ? 'NOT_CONFIGURED' : 'UNAVAILABLE',
        '這個 App 版本目前無法使用 Google 登入，請更新 App 或使用網頁版。',
      );
    }
    if (busy) throw new NuniGoogleError('BUSY', '登入正在處理中，請稍候。');
    busy = true;
    try {
      const result = await adapter!.getIdToken(serverClientId, nonce);
      const idToken = result?.idToken;
      if (
        typeof idToken !== 'string' ||
        idToken.length > 32_768 ||
        !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(idToken)
      ) {
        throw new NuniGoogleError('INVALID_RESPONSE', 'Google 登入驗證沒有完成，請重新再試。');
      }
      return idToken;
    } catch (error) {
      if (error instanceof NuniGoogleError) throw error;
      const code = nativeErrorCode(error);
      if (code === 'GOOGLE_CREDENTIAL_CANCELLED') {
        throw new NuniGoogleError('CANCELLED', '已取消登入。');
      }
      if (code === 'GOOGLE_CREDENTIAL_NOT_FOUND') {
        throw new NuniGoogleError(
          'NO_CREDENTIAL',
          '這台裝置目前無法取得 Google 帳號，請稍後再試。',
        );
      }
      if (code === 'GOOGLE_CREDENTIAL_ACTIVITY_UNAVAILABLE') {
        throw new NuniGoogleError('UNAVAILABLE', '請回到 App 後重新登入。');
      }
      if (code === 'GOOGLE_CREDENTIAL_CONFIGURATION') {
        throw new NuniGoogleError(
          'NOT_CONFIGURED',
          '這個 App 版本的登入尚未準備完成，請使用網頁版。',
        );
      }
      if (code === 'GOOGLE_CREDENTIAL_BUSY') {
        throw new NuniGoogleError('BUSY', '登入正在處理中，請稍候。');
      }
      // Native errors may contain provider/account details; never expose or log them.
      throw new NuniGoogleError('FAILED', 'Google 登入沒有完成，請稍後再試。');
    } finally {
      busy = false;
    }
  }

  return {
    capability,
    request,
    async getIdToken(input: {
      clientId: string;
      nonce: string;
    }): Promise<{ kind: 'success'; idToken: string } | { kind: 'cancelled' }> {
      try {
        return { kind: 'success', idToken: await request(input.clientId, input.nonce) };
      } catch (error) {
        if (error instanceof NuniGoogleError && error.code === 'CANCELLED') {
          return { kind: 'cancelled' };
        }
        throw error;
      }
    },
    async clearCredentialState(): Promise<void> {
      if (!adapter) return;
      if (busy) throw new NuniGoogleError('BUSY', '登入正在處理中，請稍候。');
      busy = true;
      try {
        if ((await adapter.clearCredentialState()) !== true) throw new Error('not-cleared');
      } catch {
        throw new NuniGoogleError(
          'FAILED',
          'Google 帳號選擇狀態沒有清除，下次登入時請確認使用的帳號。',
        );
      } finally {
        busy = false;
      }
    },
  };
}

const native = requireOptionalNativeModule<NuniGoogleNativeAdapter>('CampusGoogleCredential');
const client = createNuniGoogleClient(native, Platform.OS);

export const getGoogleCredentialCapability = client.capability;
export const requestGoogleCredential = client.request;
export const getNuniGoogleIdToken = client.getIdToken;
export const clearGoogleCredentialState = client.clearCredentialState;
