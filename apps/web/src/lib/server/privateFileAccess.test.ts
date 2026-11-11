// @vitest-environment node
import { expect, it } from 'vitest';
import {
  authorizePrivateFile,
  isAllowedPrivateFileContentType,
  privateGroupAssignmentPath,
  parsePrivateFilePath,
  parsePrivateGroupFilePath,
  privateAssignmentPath,
  privateGroupCoverPath,
  privateGroupPostPath,
  privateStoryPath,
} from '@campus/shared/src/privateFileAccess';

const COVER = 'groups/course/cover.jpg';
const POST = 'groups/course/posts/one/notes.pdf';
const ANSWER = 'assignments/work/submissions/alice/answer.pdf';
const STORY = 'schools/pu/stories/story-1/image';

it.each([
  ['', null],
  [COVER, 'group-cover'],
  [POST, 'group-post'],
  [ANSWER, 'assignment'],
  [STORY, 'story'],
  ['groups/course', null],
  ['groups/course/posts/one/nested/file.pdf', null],
  ['groups/course/posts/one/../file.pdf', null],
  ['groups/course/cover.jpg/', null],
  ['assignments/work/submissions/alice', null],
  ['avatars/alice.jpg', null],
] as const)('parses %s as %s', (path, kind) => {
  expect(parsePrivateFilePath(path)?.kind || null).toBe(kind);
});

it('keeps the Functions privateGroupFile parser off story paths', () => {
  expect(parsePrivateGroupFilePath(STORY)).toBeNull();
  expect(parsePrivateGroupFilePath(POST)?.kind).toBe('group-post');
});

it('builds canonical object paths', () => {
  expect(privateGroupCoverPath('course', 'jpg')).toBe(COVER);
  expect(privateGroupPostPath('course', 'one', 'notes.pdf')).toBe(POST);
  expect(privateAssignmentPath('work', 'alice', 'answer.pdf')).toBe(ANSWER);
  expect(privateStoryPath('pu', 'story-1', 'image')).toBe(STORY);
  expect(privateGroupCoverPath('course', '../x')).toBeNull();
});

import { createMemoryGroupStore } from './memoryGroupStore';

function fileStore(extra: [string, Record<string, unknown>][] = []) {
  return createMemoryGroupStore([
    ['users/alice', {}], ['users/bob', {}], ['users/teacher', {}],
    ['groups/course', { schoolId: 'pu' }],
    ['groups/course/assignments/work', { published: true }],
    ...['alice', 'bob', 'teacher'].flatMap((uid): [string, Record<string, unknown>][] => [
      [`groups/course/members/${uid}`, { status: 'active', role: uid === 'teacher' ? 'instructor' : 'member' }],
      [`schools/pu/members/${uid}`, { status: 'active' }],
    ]), ...extra,
  ]);
}
const GROUP_ANSWER = 'groups/course/assignments/work/submissions/alice/answer.pdf';
function authorize(store: ReturnType<typeof fileStore>, path = GROUP_ANSWER, uid = 'alice', writing = true) {
  return authorizePrivateFile(store.db, parsePrivateFilePath(path)!, uid, writing);
}
it('uses the canonical group assignment without a global mirror', async () => {
  expect(privateGroupAssignmentPath('course', 'work', 'alice', 'answer.pdf')).toBe(GROUP_ANSWER);
  await expect(authorize(fileStore())).resolves.toBeUndefined();
});
it.each(['left', 'inactive', 'missing'])('rejects group membership %s', async (status) => {
  const store = fileStore([['groups/course/members/alice', { status }]]);
  await expect(authorize(store)).rejects.toMatchObject({ statusCode: 403 });
});
it('rejects a nonmember and another user uploading to the owner path', async () => {
  await expect(authorize(fileStore(), GROUP_ANSWER, 'stranger')).rejects.toMatchObject({ statusCode: 403 });
  const nonmember = fileStore();
  nonmember.docs.delete('groups/course/members/alice');
  await expect(authorize(nonmember)).rejects.toMatchObject({ statusCode: 403 });
  await expect(authorize(nonmember, GROUP_ANSWER, 'alice', false)).rejects.toMatchObject({ statusCode: 403 });
  await expect(authorize(fileStore(), GROUP_ANSWER, 'bob')).rejects.toMatchObject({ statusCode: 403 });
});
it('rejects missing canonical assignments even with a global mirror', async () => {
  const store = fileStore([['assignments/missing', { groupId: 'course' }]]);
  await expect(authorize(store, GROUP_ANSWER.replace('/work/', '/missing/'))).rejects.toMatchObject({ statusCode: 403 });
});
it.each([
  { published: false }, { status: 'draft' }, { status: 'closed' },
  { dueAt: '2020-01-01T00:00:00Z' }, { dueAt: 'invalid' }, { dueAt: Date.now() + 1000000 },
])('mirrors acceptsStudentSubmission for %j', async (assignment) => {
  await expect(authorize(fileStore([['groups/course/assignments/work', assignment]]))).rejects.toMatchObject({ statusCode: 403 });
});
it('allows late submissions only when explicitly enabled and refuses already submitted edits', async () => {
  await expect(authorize(fileStore([['groups/course/assignments/work', { dueAt: '2020-01-01', allowLateSubmission: true }]]))).resolves.toBeUndefined();
  await expect(authorize(fileStore([['groups/course/assignments/work/submissions/alice', { userId: 'alice', submittedAt: '2020-01-01' }]]))).rejects.toMatchObject({ statusCode: 403 });
});
it('allows managers and owners to read, but refuses another student', async () => {
  const store = fileStore();
  store.docs.delete('groups/course/members/bob');
  await expect(authorize(store, GROUP_ANSWER, 'bob')).rejects.toMatchObject({ statusCode: 403 });
  store.docs.set('groups/course/members/bob', { status: 'active', role: 'member' });
  // Merely uploading a private draft is not evidence of a submission.
  await expect(authorize(store, GROUP_ANSWER, 'teacher', false)).rejects.toMatchObject({ statusCode: 403 });
  await expect(authorize(store, GROUP_ANSWER, 'alice', false)).resolves.toBeUndefined();
  const receipt = 'groups/course/assignments/work/submissions/alice';
  // Historical submitted receipts without an attachments array remain accessible.
  store.docs.set(receipt, { userId: 'alice', submittedAt: Date.now() });
  await expect(authorize(store, GROUP_ANSWER, 'teacher', false)).resolves.toBeUndefined();
  store.docs.set(receipt, { userId: 'alice', submittedAt: null });
  await expect(authorize(store, GROUP_ANSWER, 'teacher', false)).rejects.toMatchObject({ statusCode: 403 });
  store.docs.set(receipt, { userId: 'alice', attachments: [{ url: GROUP_ANSWER }], submittedAt: Date.now() });
  await expect(authorize(store, GROUP_ANSWER, 'teacher', false)).resolves.toBeUndefined();
  await expect(authorize(store, GROUP_ANSWER.replace('answer.pdf', 'draft.pdf'), 'teacher', false)).rejects.toMatchObject({ statusCode: 403 });
  store.docs.set(receipt, { userId: 'alice', attachments: [GROUP_ANSWER], submittedAt: null });
  await expect(authorize(store, GROUP_ANSWER, 'teacher', false)).rejects.toMatchObject({ statusCode: 403 });
  await expect(authorize(store, GROUP_ANSWER, 'alice', false)).resolves.toBeUndefined();
  await expect(authorize(store, GROUP_ANSWER, 'bob', false)).rejects.toMatchObject({ statusCode: 403 });
});
it('legacy assignment URLs also require a submitted receipt with an exact file reference', async () => {
  const store = fileStore([['assignments/work', { groupId: 'course' }]]);
  const receiptPath = 'groups/course/assignments/work/submissions/alice';
  // The owner may preview a draft; a teacher needs a real submission receipt
  // even when the legacy attachments list was never stored.
  await expect(authorize(store, ANSWER, 'alice', false)).resolves.toBeUndefined();
  await expect(authorize(store, ANSWER, 'teacher', false)).rejects.toMatchObject({ statusCode: 403 });
  await expect(authorize(store, ANSWER, 'bob', false)).rejects.toMatchObject({ statusCode: 403 });
  store.docs.set(receiptPath, { userId: 'alice', submittedAt: null });
  await expect(authorize(store, ANSWER, 'teacher', false)).rejects.toMatchObject({ statusCode: 403 });
  store.docs.set(receiptPath, { userId: 'alice', submittedAt: Date.now() });
  await expect(authorize(store, ANSWER, 'teacher', false)).resolves.toBeUndefined();
  store.docs.set(receiptPath, { userId: 'alice', submittedAt: Date.now(), attachments: [] });
  await expect(authorize(store, ANSWER, 'teacher', false)).rejects.toMatchObject({ statusCode: 403 });
  store.docs.set(receiptPath, { userId: 'bob', submittedAt: Date.now(), attachments: [ANSWER] });
  await expect(authorize(store, ANSWER, 'teacher', false)).rejects.toMatchObject({ statusCode: 403 });
  store.docs.set(receiptPath, { userId: 'alice', submittedAt: Date.now(), attachments: [{ path: ANSWER }] });
  await expect(authorize(store, ANSWER, 'teacher', false)).resolves.toBeUndefined();
  await expect(authorize(store, ANSWER.replace('answer.pdf', 'private-draft.pdf'), 'teacher', false)).rejects.toMatchObject({ statusCode: 403 });
  store.docs.set(receiptPath, { userId: 'alice', submittedAt: null, attachments: [ANSWER] });
  await expect(authorize(store, ANSWER, 'teacher', false)).rejects.toMatchObject({ statusCode: 403 });
  store.docs.set(receiptPath, { userId: 'alice', submittedAt: Date.now(), attachments: [ANSWER] });
  store.docs.set('schools/pu/members/teacher', { status: 'inactive' });
  await expect(authorize(store, ANSWER, 'teacher', false)).rejects.toMatchObject({ statusCode: 403 });
});

it.each([GROUP_ANSWER, ANSWER])('rejects malformed submitted-receipt attachment fields for %s', async (path) => {
  const store = fileStore([['assignments/work', { groupId: 'course' }]]);
  const receipt = 'groups/course/assignments/work/submissions/alice';
  for (const attachments of [null, {}, 'invalid', false]) {
    store.docs.set(receipt, { userId: 'alice', submittedAt: Date.now(), attachments });
    await expect(authorize(store, path, 'teacher', false)).rejects.toMatchObject({ statusCode: 403 });
    await expect(authorize(store, path, 'alice', false)).resolves.toBeUndefined();
  }
});

it.each([GROUP_ANSWER, ANSWER])('requires a meaningful submittedAt timestamp for teacher GET on %s', async (path) => {
  const store = fileStore([['assignments/work', { groupId: 'course' }]]);
  const receipt = 'groups/course/assignments/work/submissions/alice';
  for (const submittedAt of [false, 0, -1, '', 'not-a-date', {}, { seconds: 123 }, Number.NaN]) {
    store.docs.set(receipt, { userId: 'alice', submittedAt, attachments: [path] });
    await expect(authorize(store, path, 'teacher', false)).rejects.toMatchObject({ statusCode: 403 });
    await expect(authorize(store, path, 'alice', false)).resolves.toBeUndefined();
  }

  const submitted = new Date('2026-11-11T00:00:00.000Z');
  for (const submittedAt of [
    submitted, submitted.getTime(), submitted.toISOString(), { toMillis: () => submitted.getTime() },
  ]) {
    store.docs.set(receipt, { userId: 'alice', submittedAt, attachments: [path] });
    await expect(authorize(store, path, 'teacher', false)).resolves.toBeUndefined();
    store.docs.set('schools/pu/members/teacher', { status: 'inactive' });
    await expect(authorize(store, path, 'teacher', false)).rejects.toMatchObject({ statusCode: 403 });
    store.docs.set('schools/pu/members/teacher', { status: 'active' });
  }
});

it('legacy uploads require a live open assignment and an unsubmitted receipt', async () => {
  const store = fileStore([['assignments/work', { groupId: 'course' }]]);
  await expect(authorize(store, ANSWER, 'alice', true)).resolves.toBeUndefined();
  await expect(authorize(store, ANSWER, 'bob', true)).rejects.toMatchObject({ statusCode: 403 });
  for (const invalid of [
    { published: false }, { status: 'draft' }, { status: 'closed' },
    { dueAt: '2020-01-01T00:00:00Z' }, { dueAt: 'invalid' },
  ]) {
    store.docs.set('groups/course/assignments/work', invalid);
    await expect(authorize(store, ANSWER, 'alice', true)).rejects.toMatchObject({ statusCode: 403 });
  }
  store.docs.set('groups/course/assignments/work', { dueAt: '2020-01-01T00:00:00Z', allowLateSubmission: true });
  await expect(authorize(store, ANSWER, 'alice', true)).resolves.toBeUndefined();
  store.docs.set('groups/course/assignments/work/submissions/alice', { userId: 'alice', submittedAt: Date.now() });
  await expect(authorize(store, ANSWER, 'alice', true)).rejects.toMatchObject({ statusCode: 403 });
  store.docs.set('groups/course/assignments/work/submissions/alice', { userId: 'bob', submittedAt: null });
  await expect(authorize(store, ANSWER, 'alice', true)).rejects.toMatchObject({ statusCode: 403 });
  store.docs.delete('groups/course/assignments/work/submissions/alice');
  store.docs.delete('groups/course/assignments/work');
  // A live global-only legacy assignment remains writable without its group copy.
  await expect(authorize(store, ANSWER, 'alice', true)).resolves.toBeUndefined();
  for (const invalid of [
    { groupId: 'course', published: false },
    { groupId: 'course', status: 'closed' },
    { groupId: 'course', status: 'draft' },
    { groupId: 'course', dueAt: '2020-01-01T00:00:00Z' },
    { groupId: 'course', dueAt: 'invalid' },
    { groupId: 'another-school' },
  ]) {
    store.docs.set('assignments/work', invalid);
    await expect(authorize(store, ANSWER, 'alice', true)).rejects.toMatchObject({ statusCode: 403 });
  }
  store.docs.set('assignments/work', { groupId: 'course', dueAt: '2020-01-01T00:00:00Z', allowLateSubmission: true });
  await expect(authorize(store, ANSWER, 'alice', true)).resolves.toBeUndefined();
  store.docs.set('assignments/work/submissions/alice', { userId: 'alice', submittedAt: Date.now() });
  await expect(authorize(store, ANSWER, 'alice', true)).rejects.toMatchObject({ statusCode: 403 });
  store.docs.set('assignments/work/submissions/alice', { userId: 'bob', submittedAt: null });
  await expect(authorize(store, ANSWER, 'alice', true)).rejects.toMatchObject({ statusCode: 403 });
  store.docs.set('assignments/work/submissions/alice', { userId: 'alice', submittedAt: null });
  await expect(authorize(store, ANSWER, 'alice', true)).resolves.toBeUndefined();
  // A previously uploaded private draft remains previewable by its owner.
  await expect(authorize(store, ANSWER, 'alice', false)).resolves.toBeUndefined();
});

it('requires an existing live post for downloads and author ownership for existing uploads', async () => {
  const store = fileStore();
  await expect(authorize(store, POST, 'alice', false)).rejects.toMatchObject({ statusCode: 403 });
  await expect(authorize(store, POST)).resolves.toBeUndefined();
  const existing = fileStore([['groups/course/posts/one', { authorId: 'alice', attachments: [POST] }]]);
  await expect(authorize(existing, POST, 'bob', true)).rejects.toMatchObject({ statusCode: 403 });
  await expect(authorize(existing, POST, 'teacher', true)).rejects.toMatchObject({ statusCode: 403 });
  await expect(authorize(existing, POST, 'alice', true)).resolves.toBeUndefined();
  await expect(authorize(existing, POST, 'bob', false)).resolves.toBeUndefined();
});
it('does not turn a finalized but unreferenced post attachment into a group-wide download', async () => {
  const store = fileStore([['groups/course/posts/one', { authorId: 'alice' }]]);
  const sibling = POST.replace('notes.pdf', 'unpublished.pdf');
  // Historical posts without an attachments list keep previous member access.
  await expect(authorize(store, POST, 'alice', false)).resolves.toBeUndefined();
  await expect(authorize(store, POST, 'bob', false)).resolves.toBeUndefined();
  store.docs.set('groups/course/posts/one', { authorId: 'alice', attachments: [{ url: POST }] });
  await expect(authorize(store, POST, 'bob', false)).resolves.toBeUndefined();
  await expect(authorize(store, sibling, 'bob', false)).rejects.toMatchObject({ statusCode: 403 });
  // Even a manager cannot browse a file absent from the post's attachment list.
  await expect(authorize(store, sibling, 'teacher', false)).rejects.toMatchObject({ statusCode: 403 });
  store.docs.set('schools/pu/members/bob', { status: 'inactive' });
  await expect(authorize(store, POST, 'bob', false)).rejects.toMatchObject({ statusCode: 403 });
  store.docs.set('schools/pu/members/bob', { status: 'active' });
  await expect(authorize(store, POST, 'bob', false)).resolves.toBeUndefined();
});

it('rejects malformed attachment fields instead of treating them as legacy shared posts', async () => {
  const postPath = 'groups/course/posts/one';
  const store = fileStore([[postPath, { authorId: 'alice' }]]);
  for (const attachments of [null, {}, 'invalid', false]) {
    store.docs.set(postPath, { authorId: 'alice', attachments });
    await expect(authorize(store, POST, 'bob', false)).rejects.toMatchObject({ statusCode: 403 });
    await expect(authorize(store, POST, 'teacher', false)).rejects.toMatchObject({ statusCode: 403 });
    await expect(authorize(store, POST, 'alice', false)).resolves.toBeUndefined();
  }
});

it.each([{ deletedAt: '2026-01-01' }, { deleted: true }, { isDeleted: true }, { status: 'deleted' }])('rejects post tombstones %j', async (tombstone) => {
  await expect(authorize(fileStore([['groups/course/posts/one', { authorId: 'alice', ...tombstone }]]), POST, 'alice', false)).rejects.toMatchObject({ statusCode: 403 });
});
it('rejects stamped school-member replay for group files after profile recreation', async () => {
  const store = fileStore([
    ['assignments/work', { groupId: 'course' }],
    ['groups/course/posts/one', { authorId: 'alice', attachments: [POST] }],
    ['users/alice', { schoolId: 'pu', bindingGeneration: 'trusted-generation' }],
    ['schools/pu/members/alice', {
      status: 'active',
      profileBoundSchoolId: 'pu',
      profileBoundGeneration: 'trusted-generation',
    }],
  ]);
  const checks: [string, boolean][] = [
    [COVER, false], [POST, false], [GROUP_ANSWER, true], [ANSWER, true],
  ];
  const expectAll = async (permitted: boolean) => {
    for (const [path, writing] of checks) {
      if (permitted) await expect(authorize(store, path, 'alice', writing)).resolves.toBeUndefined();
      else await expect(authorize(store, path, 'alice', writing)).rejects.toMatchObject({ statusCode: 403 });
    }
  };
  await expectAll(true);

  // A stale active school and group membership must not authorize a new profile.
  store.docs.delete('users/alice');
  await expectAll(false);
  store.docs.set('users/alice', { displayName: 'self-recreated' });
  await expectAll(false);
  store.docs.set('users/alice', { schoolId: 'another-school', bindingGeneration: 'trusted-generation' });
  await expectAll(false);
  store.docs.set('users/alice', { schoolId: 'pu', bindingGeneration: 'new-generation' });
  await expectAll(false);

  // Half-stamps fail closed instead of silently falling back to legacy access.
  store.docs.set('users/alice', { schoolId: 'pu', bindingGeneration: 'trusted-generation' });
  store.docs.set('schools/pu/members/alice', { status: 'active', profileBoundGeneration: 'trusted-generation' });
  await expectAll(false);
  store.docs.set('schools/pu/members/alice', { status: 'active', profileBoundSchoolId: 'pu' });
  await expectAll(false);

  store.docs.set('schools/pu/members/alice', {
    status: 'active', profileBoundSchoolId: 'pu', profileBoundGeneration: 'trusted-generation',
  });
  await expectAll(true);
  store.docs.set('schools/pu/members/alice', {
    status: 'inactive', profileBoundSchoolId: 'pu', profileBoundGeneration: 'trusted-generation',
  });
  await expectAll(false);
});

it('preserves legacy unstamped group-member access until migration is verified', async () => {
  const store = fileStore();
  await expect(authorize(store, COVER, 'alice', false)).resolves.toBeUndefined();
  await expect(authorize(store, GROUP_ANSWER, 'alice', true)).resolves.toBeUndefined();
});

it('rejects stale campus story stamps after profile deletion, recreation and school change', async () => {
  const store = fileStore([
    ['users/alice', { schoolId: 'pu', primarySchoolId: 'pu', bindingGeneration: 'generation-one' }],
    ['schools/pu/members/alice', {
      status: 'active', profileBoundSchoolId: 'pu', profileBoundGeneration: 'generation-one',
    }],
  ]);
  const tryStory = (writing: boolean) => authorizePrivateFile(
    store.db, parsePrivateFilePath(STORY)!, 'alice', writing,
  );
  await expect(tryStory(true)).resolves.toBeUndefined();
  await expect(tryStory(false)).resolves.toBeUndefined();

  // The same already-issued identity and active membership are not enough.
  store.docs.delete('users/alice');
  await expect(tryStory(false)).rejects.toMatchObject({ statusCode: 403 });
  store.docs.set('users/alice', { displayName: 'self recreated' });
  for (const writing of [true, false]) {
    await expect(tryStory(writing)).rejects.toMatchObject({ statusCode: 403 });
  }
  store.docs.set('users/alice', {
    schoolId: 'other-school', bindingGeneration: 'generation-one',
  });
  await expect(tryStory(false)).rejects.toMatchObject({ statusCode: 403 });
  store.docs.set('users/alice', {
    schoolId: 'pu', bindingGeneration: 'generation-two',
  });
  await expect(tryStory(false)).rejects.toMatchObject({ statusCode: 403 });

  // Server-controlled school-login transaction restores matching generations.
  store.docs.set('users/alice', {
    schoolId: 'pu', bindingGeneration: 'generation-one',
  });
  await expect(tryStory(false)).resolves.toBeUndefined();
  store.docs.set('schools/pu/members/alice', {
    status: 'inactive', profileBoundSchoolId: 'pu', profileBoundGeneration: 'generation-one',
  });
  await expect(tryStory(false)).rejects.toMatchObject({ statusCode: 403 });
});

it.each(['group-cover', 'group-post', 'story'] as const)('restricts %s image MIME types', (kind) => {
  for (const mime of ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif']) expect(isAllowedPrivateFileContentType(kind, mime)).toBe(true);
  for (const mime of ['image/svg+xml', 'image/bmp', 'text/html']) expect(isAllowedPrivateFileContentType(kind, mime)).toBe(false);
});

it.each([
  '%2e%2e', '%2E%2E', '%252e%252e', '..%2f', '?x', '#x', '\\', '．．',
  'a b', 'a\t', 'a\n', 'a\u007f', '中文', '.', '..', 'a..b', 'a'.repeat(129),
])('rejects unsafe path component %j', (segment) => {
  expect(parsePrivateFilePath(`groups/g/posts/${segment}/cover.png`)).toBeNull();
  expect(parsePrivateFilePath(`groups/g/posts/p/${segment}`)).toBeNull();
});

it('bounds and sanitizes generated names while preserving extensions', async () => {
  const { safePrivateFileName, validPrivateFileName } = await import('@campus/shared/src/privateFileAccess');
  for (const name of ['1-中文..報告.pdf', `1-${'a'.repeat(200)}.png`, '1-?x#\\.webp']) {
    const safe = safePrivateFileName('1-random', name);
    expect(validPrivateFileName(safe)).toBe(true);
    expect(safe.startsWith('1-random.')).toBe(true);
    expect(safe.split('.').at(-1)).toBe(name.split('.').at(-1));
  }
});

it('matches the bucket migration MIME whitelist exactly', async () => {
  const { readFileSync } = await import('node:fs');
  const { PRIVATE_IMAGE_TYPES, PRIVATE_VIDEO_TYPES, PRIVATE_DOCUMENT_TYPES } = await import('@campus/shared/src/privateFileAccess');
  const sql = readFileSync(new URL('../../../../../supabase/migrations/20261109170000_create_private_files_bucket.sql', import.meta.url), 'utf8');
  const array = sql.match(/array\[([\s\S]*?)\]/)![1];
  const types = [...array.matchAll(/'([^']+)'/g)].map((match) => match[1]);
  expect(types.sort()).toEqual([...PRIVATE_IMAGE_TYPES, ...PRIVATE_VIDEO_TYPES, ...PRIVATE_DOCUMENT_TYPES].sort());
  for (const kind of ['assignment', 'group-post', 'group-cover', 'story'] as const) {
    for (const mime of PRIVATE_IMAGE_TYPES) expect(isAllowedPrivateFileContentType(kind, mime)).toBe(true);
    for (const mime of ['image/avif', 'image/svg+xml', 'image/bmp', 'video/ogg', 'video/avi']) {
      expect(isAllowedPrivateFileContentType(kind, mime)).toBe(false);
    }
    for (const mime of PRIVATE_VIDEO_TYPES) expect(isAllowedPrivateFileContentType(kind, mime)).toBe(kind === 'story');
    for (const mime of PRIVATE_DOCUMENT_TYPES) expect(isAllowedPrivateFileContentType(kind, mime)).toBe(kind === 'assignment' || kind === 'group-post');
  }
});
