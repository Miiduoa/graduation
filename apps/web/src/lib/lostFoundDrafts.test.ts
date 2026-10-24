import { beforeEach, expect, it, vi } from 'vitest';
import {
  LostFoundStorageError,
  clearDamagedCreateLocalMetadata,
  clearLostFoundDraft,
  clearLostFoundPending,
  emptyLostFoundFields,
  fieldsEqual,
  forgetCreateDocumentId,
  listRecoverableCreateSessions,
  loadLostFoundDraft,
  loadLostFoundPending,
  lostFoundDraftStorageKey,
  lostFoundPendingStorageKey,
  rememberCreateDocumentId,
  saveLostFoundDraft,
  saveLostFoundPending,
} from './lostFoundDrafts';

const scope = {
  uid: 'alice',
  schoolId: 'pu',
  mode: 'create' as const,
  itemKey: 'draft-1',
};

const draft = {
  version: 1 as const,
  documentId: 'draft-1',
  type: 'lost' as const,
  title: '學生證',
  description: '活動中心遺失',
  category: 'cards',
  location: '活動中心',
  date: '2026-10-21',
  contactInfo: '',
};

beforeEach(() => {
  localStorage.clear();
});

it('scopes drafts by exact uid, school, and item key', () => {
  saveLostFoundDraft(scope, draft);
  expect(loadLostFoundDraft(scope)?.title).toBe('學生證');
  expect(
    loadLostFoundDraft({ ...scope, uid: 'bob' }),
  ).toBeNull();
  expect(
    loadLostFoundDraft({ ...scope, schoolId: 'ntu' }),
  ).toBeNull();
  expect(localStorage.getItem(lostFoundDraftStorageKey({ ...scope, uid: 'bob' }))).toBeNull();
});

it('refuses to replace a different unresolved pending intent', () => {
  saveLostFoundPending(scope, {
    version: 1,
    action: 'create',
    documentId: 'draft-1',
    fields: draft,
  });
  expect(() =>
    saveLostFoundPending(scope, {
      version: 1,
      action: 'create',
      documentId: 'draft-1',
      fields: { ...draft, title: '另一則' },
    }),
  ).toThrow(LostFoundStorageError);
  expect(loadLostFoundPending(scope)?.fields?.title).toBe('學生證');
});

it('allows retrying the identical pending intent', () => {
  const intent = {
    version: 1 as const,
    action: 'create' as const,
    documentId: 'draft-1',
    fields: draft,
  };
  saveLostFoundPending(scope, intent);
  saveLostFoundPending(scope, intent);
  expect(loadLostFoundPending(scope)?.fields?.title).toBe('學生證');
  clearLostFoundPending(scope);
  expect(loadLostFoundPending(scope)).toBeNull();
});

it('reports corruption without clearing unrelated in-memory-capable keys', () => {
  const key = lostFoundDraftStorageKey(scope);
  localStorage.setItem(key, '{broken');
  expect(() => loadLostFoundDraft(scope)).toThrow(/損毀/);
  localStorage.setItem(
    lostFoundDraftStorageKey({ ...scope, uid: 'bob' }),
    JSON.stringify({
      ...draft,
      uid: 'bob',
      schoolId: 'pu',
      title: 'bob draft',
    }),
  );
  expect(loadLostFoundDraft({ ...scope, uid: 'bob' })?.title).toBe('bob draft');
});

it('surfaces storage denial while leaving callers able to keep memory state', () => {
  const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('quota');
  });
  expect(() => saveLostFoundDraft(scope, draft)).toThrow(LostFoundStorageError);
  set.mockRestore();
  expect(fieldsEqual(draft, draft)).toBe(true);
  clearLostFoundDraft(scope);
});

it('recovers all scoped unresolved create sessions independently of a single latest pointer', () => {
  rememberCreateDocumentId('alice', 'pu', 'draft-a');
  rememberCreateDocumentId('alice', 'pu', 'draft-b');
  saveLostFoundPending(
    { uid: 'alice', schoolId: 'pu', mode: 'create', itemKey: 'draft-a' },
    {
      version: 1,
      action: 'create',
      documentId: 'draft-a',
      fields: { ...draft, title: 'A 未確認刊登' },
    },
  );
  saveLostFoundDraft(
    { uid: 'alice', schoolId: 'pu', mode: 'create', itemKey: 'draft-b' },
    { ...draft, documentId: 'draft-b', title: 'B 尚未送出草稿' },
  );
  // Ordinary draft write for B must not hide A's pending.
  rememberCreateDocumentId('alice', 'pu', 'draft-b');
  const sessions = listRecoverableCreateSessions('alice', 'pu');
  expect(sessions.map((row) => row.documentId)).toEqual(['draft-a', 'draft-b']);
  expect(sessions[0]?.pending?.fields?.title).toBe('A 未確認刊登');
  expect(sessions[1]?.fields.title).toBe('B 尚未送出草稿');
  // Cleanup of B's index entry must not orphan or delete A's pending metadata.
  forgetCreateDocumentId('alice', 'pu', 'draft-b');
  clearLostFoundDraft({ uid: 'alice', schoolId: 'pu', mode: 'create', itemKey: 'draft-b' });
  const remaining = listRecoverableCreateSessions('alice', 'pu');
  expect(remaining.map((row) => row.documentId)).toEqual(['draft-a']);
  expect(remaining[0]?.pending?.fields?.title).toBe('A 未確認刊登');
});

it('uses the Taiwan calendar day for empty form defaults', () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-23T16:30:00.000Z'));
  expect(emptyLostFoundFields().date).toBe('2026-10-24');
  vi.useRealTimers();
});

it('surfaces corrupt unresolved create with the same document id instead of skipping it', () => {
  const key = lostFoundPendingStorageKey({
    uid: 'alice',
    schoolId: 'pu',
    mode: 'create',
    itemKey: 'unknown-outcome-id',
  });
  localStorage.setItem(key, '{broken');
  const sessions = listRecoverableCreateSessions('alice', 'pu');
  expect(sessions).toHaveLength(1);
  expect(sessions[0]?.documentId).toBe('unknown-outcome-id');
  expect(sessions[0]?.corrupt).toBe(true);
  expect(sessions[0]?.corruptionMessage).toMatch(/損毀/);
  // Raw bytes and key must remain until explicit cleanup.
  expect(localStorage.getItem(key)).toBe('{broken');
});

it('clears damaged create metadata only for the confirmed same document id', () => {
  const damagedScope = {
    uid: 'alice',
    schoolId: 'pu',
    mode: 'create' as const,
    itemKey: 'unknown-outcome-id',
  };
  const siblingScope = {
    uid: 'alice',
    schoolId: 'pu',
    mode: 'create' as const,
    itemKey: 'sibling-draft',
  };
  localStorage.setItem(lostFoundPendingStorageKey(damagedScope), '{broken');
  saveLostFoundDraft(siblingScope, { ...draft, documentId: 'sibling-draft', title: '完好草稿' });
  clearDamagedCreateLocalMetadata(damagedScope);
  expect(localStorage.getItem(lostFoundPendingStorageKey(damagedScope))).toBeNull();
  expect(loadLostFoundDraft(siblingScope)?.title).toBe('完好草稿');
});
