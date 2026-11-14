import { NuniError } from '@campus/shared/src/nuni';
import {
  parsePlatformAssistantPermissionState,
  parsePlatformAssistantPermissionUpdate,
  type PlatformAssistantPermissionState,
  type PlatformAssistantPermissions,
} from '@campus/shared/src/platformAssistantPermissions';

export type PlatformAssistantPermissionScope = {
  accountId: string;
  context: string;
  isCurrent(): boolean;
  request(path: string, expectedContext: string, input?: Record<string, unknown>): Promise<unknown>;
};

function requireCurrent(scope: PlatformAssistantPermissionScope) {
  if (!scope.isCurrent()) throw new NuniError(409, 'SESSION_CHANGED');
}

function checkedState(scope: PlatformAssistantPermissionScope, raw: unknown) {
  requireCurrent(scope);
  const state = parsePlatformAssistantPermissionState(raw);
  if (state.accountId !== scope.accountId) throw new NuniError(502, 'INVALID_RESPONSE');
  return state;
}

export async function loadPlatformAssistantPermissions(
  scope: PlatformAssistantPermissionScope,
): Promise<PlatformAssistantPermissionState> {
  requireCurrent(scope);
  return checkedState(scope, await scope.request('assistant-permissions', scope.context));
}

export async function savePlatformAssistantPermissions(
  scope: PlatformAssistantPermissionScope,
  state: PlatformAssistantPermissionState,
  permissions: PlatformAssistantPermissions,
): Promise<PlatformAssistantPermissionState> {
  requireCurrent(scope);
  if (state.accountId !== scope.accountId) throw new NuniError(409, 'SESSION_CHANGED');
  const input = parsePlatformAssistantPermissionUpdate({
    expectedRevision: state.revision,
    permissions,
  });
  const saved = checkedState(
    scope,
    await scope.request('assistant-permissions', scope.context, input),
  );
  if (
    saved.revision !== state.revision + 1 ||
    saved.permissions.createPersonalEvent !== input.permissions.createPersonalEvent ||
    saved.permissions.prepareFoodOrder !== input.permissions.prepareFoodOrder
  )
    throw new NuniError(502, 'INVALID_RESPONSE');
  return saved;
}
