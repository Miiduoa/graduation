import { createHash, randomBytes } from 'node:crypto';
import { NuniError } from '@campus/shared/src/nuni';
import {
  TRONCLASS_AGENT_SCOPES, emptyTronClassAgentPermissions,
  type TronClassAgentGrant, type TronClassAgentPermissions, type TronClassAgentScope,
  type TronClassRequiredAgentGrant,
} from '@campus/shared/src/tronClassAgentPermissions';
import { createTronClassBindingService, type TronClassBindingStore } from './tronClassBinding';
import { getFirebaseAdmin } from './firebaseAdmin';

type BindingReader = Pick<ReturnType<typeof createTronClassBindingService>, 'requireBinding'>;
type Row = Record<string, unknown>;
const VERSION = /^[a-f0-9]{32}$/;

function fail(status: number, code: string): never { throw new NuniError(status, code); }

function permissionSet(value: unknown): TronClassAgentPermissions | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Row;
  if (Object.keys(record).length !== TRONCLASS_AGENT_SCOPES.length ||
    TRONCLASS_AGENT_SCOPES.some((key) => typeof record[key] !== 'boolean') ||
    (!record.readCourseData && (record.downloadMaterials || record.prepareHomework))) return null;
  return {
    readCourseData: record.readCourseData as boolean,
    downloadMaterials: record.downloadMaterials as boolean,
    prepareHomework: record.prepareHomework as boolean,
  };
}

function publicGrant(row: Row, revision: string): TronClassAgentGrant {
  const raw = row.agentGrant;
  const grant = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Row : {};
  const permissions = permissionSet(grant.permissions);
  if (!permissions || typeof grant.version !== 'string' || !VERSION.test(grant.version) ||
    typeof grant.updatedAt !== 'number' || !Number.isSafeInteger(grant.updatedAt) || grant.updatedAt < 0 ||
    !Number.isFinite(new Date(grant.updatedAt).getTime())) {
    return { revision, version: null, permissions: emptyTronClassAgentPermissions(), updatedAt: null };
  }
  return { revision, version: grant.version, permissions, updatedAt: new Date(grant.updatedAt).toISOString() };
}

/** Grants live inside the encrypted-session owner's binding record, without cookies in their public shape.
 * Connecting again, unlinking, and account deletion replace this record and revoke every Agent grant.
 */
export function createTronClassAgentGrantService(dependencies: {
  bindings?: BindingReader;
  db?: TronClassBindingStore;
  getStore?: () => Promise<TronClassBindingStore | null>;
  now?: () => number;
} = {}) {
  const bindings = dependencies.bindings ?? createTronClassBindingService();
  const now = dependencies.now ?? Date.now;
  const store = async () => {
    const db = dependencies.db ?? await (dependencies.getStore ?? (async () =>
      (await getFirebaseAdmin())?.db as unknown as TronClassBindingStore ?? null))();
    if (!db) fail(503, 'TRONCLASS_AGENT_UNAVAILABLE');
    return db;
  };
  const path = (ownerKey: string) => {
    if (typeof ownerKey !== 'string' || ownerKey.length > 200 ||
      !/^(?:platform:pa_[A-Za-z0-9_-]+|firebase:[^\s/\x00-\x1f\x7f]{1,128})$/.test(ownerKey)) fail(401, 'SIGN_IN_REQUIRED');
    return `_tronClassBindings/${createHash('sha256').update(ownerKey).digest('hex')}`;
  };
  const currentRow = (value: Row | undefined, ownerKey: string, revision: string): Row => {
    if (!value || value.ownerKey !== ownerKey || value.schoolId !== 'pu' ||
      value.state !== 'connected' || value.revision !== revision) fail(409, 'TRONCLASS_BINDING_CHANGED');
    if (typeof value.expiresAt !== 'number' || !Number.isSafeInteger(value.expiresAt) || value.expiresAt <= now()) {
      fail(401, 'TRONCLASS_RECONNECT_REQUIRED');
    }
    return value;
  };
  const get = async (ownerKey: string): Promise<TronClassAgentGrant> => {
    const documentPath = path(ownerKey);
    const binding = await bindings.requireBinding(ownerKey);
    const db = await store();
    const row = currentRow((await db.doc(documentPath).get()).data(), ownerKey, binding.revision);
    return publicGrant(row, binding.revision);
  };
  const set = async (ownerKey: string, input: {
    revision: string; expectedVersion: string | null; permissions: TronClassAgentPermissions;
  }): Promise<TronClassAgentGrant> => {
    const documentPath = path(ownerKey);
    if (!input || Object.keys(input).some((key) => !['revision', 'expectedVersion', 'permissions'].includes(key)) ||
      typeof input.revision !== 'string' || !VERSION.test(input.revision) ||
      !(input.expectedVersion === null || (typeof input.expectedVersion === 'string' && VERSION.test(input.expectedVersion)))) {
      fail(422, 'TRONCLASS_INVALID_INPUT');
    }
    const permissions = permissionSet(input.permissions);
    if (!permissions) fail(422, 'TRONCLASS_INVALID_INPUT');
    const binding = await bindings.requireBinding(ownerKey);
    if (binding.revision !== input.revision) fail(409, 'TRONCLASS_BINDING_CHANGED');
    const db = await store();
    const ref = db.doc(documentPath);
    const timestamp = now();
    if (!Number.isSafeInteger(timestamp) || timestamp < 0 || !Number.isFinite(new Date(timestamp).getTime())) {
      fail(503, 'TRONCLASS_AGENT_UNAVAILABLE');
    }
    const version = randomBytes(16).toString('hex');
    await db.runTransaction(async (tx) => {
      // Grant updates and unlink/closure contend on the same document. A delayed
      // consent response can never restore a replaced school login.
      const row = currentRow((await tx.get(ref)).data(), ownerKey, input.revision);
      const previous = publicGrant(row, input.revision);
      if (previous.version !== input.expectedVersion) fail(409, 'TRONCLASS_AGENT_PERMISSION_CHANGED');
      tx.set(ref, { ...row, agentGrant: { version, permissions, updatedAt: timestamp } });
    });
    const result = await get(ownerKey);
    if (result.version !== version) fail(409, 'TRONCLASS_AGENT_PERMISSION_CHANGED');
    return result;
  };
  const requireGrant = async (ownerKey: string, scope: TronClassAgentScope): Promise<TronClassRequiredAgentGrant> => {
    if (!TRONCLASS_AGENT_SCOPES.includes(scope)) fail(422, 'TRONCLASS_INVALID_INPUT');
    const grant = await get(ownerKey);
    if (!grant.version || !grant.permissions.readCourseData || !grant.permissions[scope]) {
      fail(403, 'TRONCLASS_AGENT_PERMISSION_REQUIRED');
    }
    return { ...grant, version: grant.version };
  };
  const assertCurrent = async (ownerKey: string, expected: TronClassAgentGrant, scope: TronClassAgentScope): Promise<void> => {
    if (!expected || typeof expected.revision !== 'string' || !VERSION.test(expected.revision) ||
      typeof expected.version !== 'string' || !VERSION.test(expected.version)) fail(403, 'TRONCLASS_AGENT_PERMISSION_REQUIRED');
    const grant = await requireGrant(ownerKey, scope);
    if (grant.revision !== expected.revision || grant.version !== expected.version) {
      fail(409, 'TRONCLASS_AGENT_PERMISSION_CHANGED');
    }
  };
  return { get, set, require: requireGrant, assertCurrent };
}

export type TronClassAgentGrantService = ReturnType<typeof createTronClassAgentGrantService>;
