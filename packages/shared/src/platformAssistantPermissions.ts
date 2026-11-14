import { NuniError } from './nuni';

/** These preferences govern platform-account actions, never school membership. */
export const PLATFORM_ASSISTANT_PERMISSION_KEYS = [
  'createPersonalEvent',
  'prepareFoodOrder',
] as const;
export type PlatformAssistantPermissionKey = (typeof PLATFORM_ASSISTANT_PERMISSION_KEYS)[number];
export type PlatformAssistantPermissions = Record<PlatformAssistantPermissionKey, boolean>;
export type PlatformAssistantPermissionState = {
  scope: 'platform-account';
  accountId: string;
  revision: number;
  permissions: PlatformAssistantPermissions;
};

export const PLATFORM_ASSISTANT_PERMISSION_DEFINITIONS: readonly {
  key: PlatformAssistantPermissionKey;
  label: string;
  description: string;
}[] = [
  {
    key: 'createPersonalEvent',
    label: '新增個人行程',
    description: '讓助理整理讀書計畫與個人行程；每次確認後才會加入你的行事曆。',
  },
  {
    key: 'prepareFoodOrder',
    label: '整理訂餐草稿',
    description: '讓助理依菜單整理訂餐草稿；下單與付款仍須依點餐頁流程確認。',
  },
] as const;

export const PLATFORM_ASSISTANT_MAX_REVISION = 2147483647;
const ACCOUNT = /^pa_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function isPlatformAssistantAccountId(value: unknown): value is string {
  return typeof value === 'string' && ACCOUNT.test(value);
}

export function createDefaultPlatformAssistantPermissions(): PlatformAssistantPermissions {
  return { createPersonalEvent: true, prepareFoodOrder: true };
}

function exactObject(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new NuniError(422, 'INVALID_INPUT');
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null)
    throw new NuniError(422, 'INVALID_INPUT');
  const names = Reflect.ownKeys(value);
  if (
    names.length !== keys.length ||
    names.some((key) => typeof key !== 'string' || !keys.includes(key))
  )
    throw new NuniError(422, 'INVALID_INPUT');
  const result: Record<string, unknown> = {};
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !('value' in descriptor)) throw new NuniError(422, 'INVALID_INPUT');
    result[key] = descriptor.value;
  }
  return result;
}

/** Settings writes accept both explicit booleans; missing or unknown fields never grant access. */
export function parsePlatformAssistantPermissions(value: unknown): PlatformAssistantPermissions {
  const input = exactObject(value, PLATFORM_ASSISTANT_PERMISSION_KEYS);
  if (PLATFORM_ASSISTANT_PERMISSION_KEYS.some((key) => typeof input[key] !== 'boolean'))
    throw new NuniError(422, 'INVALID_INPUT');
  return {
    createPersonalEvent: input.createPersonalEvent as boolean,
    prepareFoodOrder: input.prepareFoodOrder as boolean,
  };
}

export function parsePlatformAssistantPermissionUpdate(value: unknown): {
  expectedRevision: number;
  permissions: PlatformAssistantPermissions;
} {
  const input = exactObject(value, ['expectedRevision', 'permissions']);
  if (
    !Number.isSafeInteger(input.expectedRevision) ||
    (input.expectedRevision as number) < 0 ||
    (input.expectedRevision as number) >= PLATFORM_ASSISTANT_MAX_REVISION
  )
    throw new NuniError(422, 'INVALID_INPUT');
  return {
    expectedRevision: input.expectedRevision as number,
    permissions: parsePlatformAssistantPermissions(input.permissions),
  };
}

export function parsePlatformAssistantPermissionState(
  value: unknown,
): PlatformAssistantPermissionState {
  try {
    const input = exactObject(value, ['scope', 'accountId', 'revision', 'permissions']);
    if (
      input.scope !== 'platform-account' ||
      !isPlatformAssistantAccountId(input.accountId) ||
      !Number.isSafeInteger(input.revision) ||
      (input.revision as number) < 0 ||
      (input.revision as number) > PLATFORM_ASSISTANT_MAX_REVISION
    )
      throw new NuniError(422, 'INVALID_INPUT');
    const permissions = parsePlatformAssistantPermissions(input.permissions);
    return {
      scope: 'platform-account',
      accountId: input.accountId,
      revision: input.revision as number,
      permissions,
    };
  } catch {
    throw new NuniError(502, 'INVALID_RESPONSE');
  }
}
