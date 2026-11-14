// @vitest-environment node
import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { emptyTronClassAgentPermissions } from '@campus/shared/src/tronClassAgentPermissions';
import { createTronClassBindingService, type TronClassBindingStore } from './tronClassBinding';
import { createTronClassAgentGrantService } from './tronClassAgentGrants';

const OWNER = 'platform:pa_grant_fixture';
const NOW = Date.parse('2026-11-13T09:00:00Z');
const ALL = { readCourseData: true, downloadMaterials: true, prepareHomework: true };
const NONE = emptyTronClassAgentPermissions();
function bindingPath(owner = OWNER) { return `_tronClassBindings/${createHash('sha256').update(owner).digest('hex')}`; }

async function setup() {
  const rows = new Map<string, Record<string, unknown>>();
  const clock = { now: NOW };
  let tail: Promise<unknown> = Promise.resolve();
  const hooks = { beforeTransaction: null as (() => void) | null };
  const snapshot = (path: string) => { const row = structuredClone(rows.get(path)); return { exists: !!row, data: () => row }; };
  const db: TronClassBindingStore = {
    doc: (path) => ({ path, get: async () => snapshot(path) }),
    runTransaction: (work) => {
      const operation = tail.then(async () => {
        const hook = hooks.beforeTransaction; hooks.beforeTransaction = null; hook?.();
        const writes = new Map<string, Record<string, unknown>>();
        const value = await work({ get: async (ref) => snapshot(ref.path), set: (ref, row) => writes.set(ref.path, structuredClone(row)) });
        writes.forEach((row, path) => rows.set(path, row));
        return value;
      });
      tail = operation.catch(() => {});
      return operation;
    },
  };
  const bindings = createTronClassBindingService({ db, now: () => clock.now,
    encryptionSecret: 'grant-tests-only-secret-longer-than-thirty-two',
    login: vi.fn(async () => ({ cookies: { session: 'private-school-cookie' }, userId: 42, userName: '測試同學', role: 'student' })),
  });
  const linked = await bindings.connect(OWNER, { schoolId: 'pu', account: '410123456', password: 'private-password', expectedRevision: null });
  const grants = createTronClassAgentGrantService({ db, bindings, now: () => clock.now });
  return { rows, clock, hooks, bindings, grants, db, revision: linked.revision! };
}

describe('TronClass Agent grants', () => {
  it('requires separate consent and never returns school credentials or account fields', async () => {
    const { grants, revision } = await setup();
    const result = await grants.get(OWNER);
    expect(result).toEqual({ revision, version: null, permissions: NONE, updatedAt: null });
    for (const scope of ['readCourseData', 'downloadMaterials', 'prepareHomework'] as const) {
      await expect(grants.require(OWNER, scope)).rejects.toMatchObject({ status: 403, code: 'TRONCLASS_AGENT_PERMISSION_REQUIRED' });
    }
    expect(JSON.stringify(result)).not.toMatch(/cookie|410123456|private-password|測試同學/);
  });

  it('preserves encrypted login and expiry while saving exactly the allowed capabilities', async () => {
    const { grants, rows, revision } = await setup();
    const before = structuredClone(rows.get(bindingPath()));
    const result = await grants.set(OWNER, { revision, expectedVersion: null, permissions: ALL });
    expect(result).toMatchObject({ revision, permissions: ALL, updatedAt: new Date(NOW).toISOString() });
    expect(result.version).toMatch(/^[a-f0-9]{32}$/);
    expect(rows.get(bindingPath())).toEqual({ ...before, agentGrant: { version: result.version, permissions: ALL, updatedAt: NOW } });
    expect(await grants.require(OWNER, 'downloadMaterials')).toEqual(result);
    await grants.assertCurrent(OWNER, result, 'prepareHomework');
  });

  it('isolates owners across providers and rejects another account before writing', async () => {
    const { grants, revision, rows } = await setup();
    await grants.set(OWNER, { revision, expectedVersion: null, permissions: ALL });
    const before = JSON.stringify([...rows]);
    await expect(grants.get(OWNER.replace('platform:', 'firebase:'))).rejects.toMatchObject({ status: 401 });
    await expect(grants.set('firebase:another-user', { revision, expectedVersion: null, permissions: ALL })).rejects.toMatchObject({ status: 401 });
    expect(JSON.stringify([...rows])).toBe(before);
  });

  it('lets only one simultaneous consent edit win its expected version', async () => {
    const { grants, revision } = await setup();
    const results = await Promise.allSettled([
      grants.set(OWNER, { revision, expectedVersion: null, permissions: ALL }),
      grants.set(OWNER, { revision, expectedVersion: null, permissions: { ...NONE, readCourseData: true } }),
    ]);
    expect(results.filter((value) => value.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((value) => value.status === 'rejected') as PromiseRejectedResult;
    expect(rejected.reason).toMatchObject({ status: 409, code: 'TRONCLASS_AGENT_PERMISSION_CHANGED' });
  });

  it('revokes an in-flight grant immediately and treats reapproval as a new version', async () => {
    const { grants, revision } = await setup();
    const first = await grants.set(OWNER, { revision, expectedVersion: null, permissions: ALL });
    const denied = await grants.set(OWNER, { revision, expectedVersion: first.version, permissions: NONE });
    await expect(grants.assertCurrent(OWNER, first, 'readCourseData')).rejects.toMatchObject({ status: 403 });
    const reopened = await grants.set(OWNER, { revision, expectedVersion: denied.version, permissions: ALL });
    expect(reopened.version).not.toBe(first.version);
    await expect(grants.assertCurrent(OWNER, first, 'readCourseData')).rejects.toMatchObject({ status: 409 });
  });

  it('does not allow read-only consent to prepare or download', async () => {
    const { grants, revision } = await setup();
    await grants.set(OWNER, { revision, expectedVersion: null, permissions: { ...NONE, readCourseData: true } });
    await grants.require(OWNER, 'readCourseData');
    await expect(grants.require(OWNER, 'downloadMaterials')).rejects.toMatchObject({ status: 403 });
    await expect(grants.require(OWNER, 'prepareHomework')).rejects.toMatchObject({ status: 403 });
  });

  it('resets consent when the same student reconnects and blocks the old revision', async () => {
    const { grants, bindings, revision } = await setup();
    const previous = await grants.set(OWNER, { revision, expectedVersion: null, permissions: ALL });
    const linked = await bindings.connect(OWNER, { schoolId: 'pu', account: '410123456', password: 'private-password', expectedRevision: revision });
    expect(await grants.get(OWNER)).toEqual({ revision: linked.revision, version: null, permissions: NONE, updatedAt: null });
    await expect(grants.set(OWNER, { revision, expectedVersion: previous.version, permissions: ALL })).rejects.toMatchObject({ status: 409 });
  });

  it('does not resurrect a binding closed after the session check', async () => {
    const { grants, hooks, rows, revision } = await setup();
    const closed = { state: 'closed', ownerHash: createHash('sha256').update(OWNER).digest('hex'), revision: 'b'.repeat(32), updatedAt: NOW };
    hooks.beforeTransaction = () => rows.set(bindingPath(), closed);
    await expect(grants.set(OWNER, { revision, expectedVersion: null, permissions: ALL })).rejects.toMatchObject({ status: 409 });
    expect(rows.get(bindingPath())).toEqual(closed);
  });

  it('rejects expired or disconnected bindings without extending their lifetime', async () => {
    const { grants, bindings, clock, revision } = await setup();
    const first = await grants.set(OWNER, { revision, expectedVersion: null, permissions: ALL });
    clock.now += 12 * 3600_000;
    await expect(grants.require(OWNER, 'readCourseData')).rejects.toMatchObject({ status: 401 });
    clock.now = NOW;
    await bindings.disconnect(OWNER, revision);
    await expect(grants.assertCurrent(OWNER, first, 'readCourseData')).rejects.toMatchObject({ status: 401 });
  });

  it.each([
    { readCourseData: false, downloadMaterials: true, prepareHomework: false },
    { readCourseData: false, downloadMaterials: false, prepareHomework: true },
    { ...ALL, submitHomework: true },
    { readCourseData: 'true', downloadMaterials: true, prepareHomework: true },
  ])('rejects inconsistent or expanded capability input %#', async (permissions) => {
    const { grants, revision, rows } = await setup();
    const before = JSON.stringify([...rows]);
    await expect(grants.set(OWNER, { revision, expectedVersion: null, permissions: permissions as typeof ALL })).rejects.toMatchObject({ status: 422 });
    expect(JSON.stringify([...rows])).toBe(before);
  });

  it('treats malformed stored consent as no permission', async () => {
    const { grants, rows } = await setup();
    rows.get(bindingPath())!.agentGrant = { version: 'a'.repeat(32), permissions: { ...ALL, submitHomework: true }, updatedAt: NOW };
    expect((await grants.get(OWNER)).permissions).toEqual(NONE);
    await expect(grants.require(OWNER, 'readCourseData')).rejects.toMatchObject({ status: 403 });
  });
});
