import { beforeEach, expect, it, vi } from 'vitest';

type Row = Record<string, unknown>;
type Change = { path: string; row?: Row };
const state = vi.hoisted(() => ({
  rows: new Map<string, Row>(),
  revision: 0,
  failCommit: false,
  failRead: '',
  commits: [] as Change[][],
}));

vi.mock('firebase/firestore', () => ({
  collection: vi.fn(),
  doc: (_db: unknown, ...parts: string[]) => parts.join('/'),
  deleteDoc: vi.fn(),
  getDoc: vi.fn(),
  getDocs: vi.fn(),
  query: vi.fn(),
  serverTimestamp: () => 'server-time',
  setDoc: vi.fn(),
  updateDoc: vi.fn(),
  where: vi.fn(),
  runTransaction: async (_db: unknown, callback: (transaction: unknown) => Promise<unknown>) => {
    // Retry on an intervening commit, as Firestore does. Writes only become
    // visible together after the callback and commit both succeed.
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const revision = state.revision;
      const snapshot = new Map(state.rows);
      const changes: Change[] = [];
      const value = await callback({
        get: async (path: string) => {
          if (state.failRead === path) throw new Error('unavailable');
          const row = snapshot.get(path);
          return { exists: () => row !== undefined, data: () => row };
        },
        set: (path: string, row: Row) => changes.push({ path, row }),
        delete: (path: string) => changes.push({ path }),
      });
      if (state.revision !== revision) continue;
      if (changes.length) {
        if (state.failCommit) throw new Error('unavailable');
        for (const change of changes) {
          if (change.row) state.rows.set(change.path, change.row);
          else state.rows.delete(change.path);
        }
        state.revision += 1;
        state.commits.push(changes);
      }
      return value;
    }
    throw new Error('transaction-conflict');
  },
}));
vi.mock('@/lib/firebase', () => ({ getDb: () => ({}) }));

import { loadMyHandle, publishHandle, unpublishHandle } from './friends';

const pointer = (school: string) => `users/alice/settings/friendHandle:${school}`;
const alias = (school: string, handle: string) => `schools/${school}/handles/${handle}`;
const legacy = 'users/alice/settings/friendHandle';
function seed(school: string, handle: string) {
  state.rows.set(pointer(school), { handle });
  state.rows.set(alias(school, handle), { uid: 'alice', handle, name: 'Alice' });
}

beforeEach(() => {
  state.rows.clear();
  state.rows.set('users/alice', { displayName: 'Alice' });
  state.revision = 0;
  state.failCommit = false;
  state.failRead = '';
  state.commits = [];
});

it('keeps the public alias and its retry pointer when removal fails', async () => {
  seed('pu', 'alice_old');
  state.failCommit = true;
  await expect(unpublishHandle('pu', 'alice')).rejects.toThrow('unavailable');
  expect(state.rows.has(alias('pu', 'alice_old'))).toBe(true);
  expect(state.rows.get(pointer('pu'))?.handle).toBe('alice_old');
  state.failCommit = false;
  await unpublishHandle('pu', 'alice');
  expect(state.rows.has(alias('pu', 'alice_old'))).toBe(false);
  expect(state.rows.get(pointer('pu'))?.handle).toBe('');
});

it('renames atomically and leaves the prior alias usable if committing fails', async () => {
  seed('pu', 'alice_old');
  state.failCommit = true;
  await expect(publishHandle('pu', 'alice', '@alice_new')).rejects.toThrow('unavailable');
  expect(state.rows.has(alias('pu', 'alice_old'))).toBe(true);
  expect(state.rows.has(alias('pu', 'alice_new'))).toBe(false);
  state.failCommit = false;
  await expect(publishHandle('pu', 'alice', '@alice_new')).resolves.toBe('alice_new');
  expect(state.rows.has(alias('pu', 'alice_old'))).toBe(false);
  expect(state.rows.get(alias('pu', 'alice_new'))).toMatchObject({ uid: 'alice', name: 'Alice' });
  expect(state.rows.get(pointer('pu'))?.handle).toBe('alice_new');
  expect(state.commits[0]).toHaveLength(3);
});

it('rejects a taken alias without changing either owner’s current alias', async () => {
  seed('pu', 'alice_old');
  state.rows.set(alias('pu', 'bob_name'), { uid: 'bob', handle: 'bob_name' });
  await expect(publishHandle('pu', 'alice', 'bob_name')).rejects.toThrow('handle-taken');
  expect(state.rows.get(alias('pu', 'bob_name'))?.uid).toBe('bob');
  expect(state.rows.get(pointer('pu'))?.handle).toBe('alice_old');
  expect(state.commits).toEqual([]);
});

it('keeps school aliases independent when changing or removing one of them', async () => {
  seed('pu', 'alice_pu');
  seed('nthu', 'alice_nthu');
  await publishHandle('pu', 'alice', 'alice_new');
  await unpublishHandle('pu', 'alice');
  expect(await loadMyHandle('nthu', 'alice')).toEqual({ handle: 'alice_nthu', name: 'Alice' });
  expect(state.rows.has(alias('nthu', 'alice_nthu'))).toBe(true);
});

it('recovers a legacy pointer only from a public alias owned by this account in this school', async () => {
  state.rows.set(legacy, { handle: 'old_alias' });
  state.rows.set(alias('pu', 'old_alias'), { uid: 'alice', handle: 'old_alias' });
  state.rows.set(alias('nthu', 'old_alias'), { uid: 'bob', handle: 'old_alias' });
  expect((await loadMyHandle('pu', 'alice')).handle).toBe('old_alias');
  expect((await loadMyHandle('nthu', 'alice')).handle).toBe('');
  await publishHandle('nthu', 'alice', 'new_alias');
  expect(state.rows.get(alias('nthu', 'old_alias'))?.uid).toBe('bob');
  expect(state.rows.get(alias('pu', 'old_alias'))?.uid).toBe('alice');
  await unpublishHandle('pu', 'alice');
  expect(state.rows.has(legacy)).toBe(true);
  // Keeping a legacy pointer for other campuses must not reopen this campus.
  expect((await loadMyHandle('pu', 'alice')).handle).toBe('');
});

it('does not report a closed alias when reading its pointer fails', async () => {
  seed('pu', 'alice_old');
  state.failRead = pointer('pu');
  await expect(loadMyHandle('pu', 'alice')).rejects.toThrow('unavailable');
  await expect(unpublishHandle('pu', 'alice')).rejects.toThrow('unavailable');
  expect(state.rows.has(alias('pu', 'alice_old'))).toBe(true);
  expect(state.commits).toEqual([]);
});

it('serializes competing tab renames without leaving a second searchable alias', async () => {
  seed('pu', 'alice_old');
  await Promise.all([
    publishHandle('pu', 'alice', 'alice_first'),
    publishHandle('pu', 'alice', 'alice_second'),
  ]);
  const current = state.rows.get(pointer('pu'))?.handle;
  const publicAliases = [...state.rows.keys()].filter((path) =>
    path.startsWith('schools/pu/handles/'),
  );
  expect(publicAliases).toEqual([alias('pu', String(current))]);
});
