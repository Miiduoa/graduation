import { normalizeAppEnvironment } from '@campus/shared/src/release';

export type WebAppEnv = 'development' | 'preview' | 'production';

function parseBoolean(value: string | undefined): boolean | null {
  if (!value || !value.trim()) return null;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return null;
}

export function getWebAppEnv(): WebAppEnv {
  return normalizeAppEnvironment(process.env.NEXT_PUBLIC_APP_ENV || process.env.NODE_ENV) as WebAppEnv;
}

/** 示範學校用原始環境字串。未設定、空字串都當關，不走 normalize 的 development 預設。 */
export function getAnnouncementVisibilityEnv(): string {
  return process.env.NEXT_PUBLIC_APP_ENV ?? '';
}

export function areUniversalDevAccountsEnabled(): boolean {
  if (getWebAppEnv() === 'production') return false;
  const override = parseBoolean(process.env.NEXT_PUBLIC_ENABLE_UNIVERSAL_DEV_ACCOUNTS);
  if (override != null) return override;
  return getWebAppEnv() !== 'production';
}
