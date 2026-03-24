import { normalizeAppEnvironment } from "@campus/shared/src/release";

export type WebAppEnv = "development" | "preview" | "production";

function parseBoolean(value: string | undefined): boolean | null {
  if (!value || !value.trim()) return null;
  if (value === "true") return true;
  if (value === "false") return false;
  return null;
}

export function getWebAppEnv(): WebAppEnv {
  return normalizeAppEnvironment(process.env.NEXT_PUBLIC_APP_ENV) as WebAppEnv;
}

export function areUniversalDevAccountsEnabled(): boolean {
  const override = parseBoolean(process.env.NEXT_PUBLIC_ENABLE_UNIVERSAL_DEV_ACCOUNTS);
  if (override != null) return override;
  return getWebAppEnv() !== "production";
}
