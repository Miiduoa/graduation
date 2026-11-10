/** Private file path parser and canonical authorization for #517 / #557. */

export const PRIVATE_FILE_MANAGER_ROLES = new Set([
  'owner',
  'admin',
  'instructor',
  'moderator',
]);

export const PRIVATE_DOCUMENT_TYPES = new Set([
  'application/pdf',
  'text/plain',
  'application/msword',
  'application/vnd.ms-excel',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
]);

export const PRIVATE_FILE_MAX_BYTES = {
  'group-cover': 5 * 1024 * 1024,
  'group-post': 20 * 1024 * 1024,
  assignment: 25 * 1024 * 1024,
  'story-image': 10 * 1024 * 1024,
  'story-video': 45 * 1024 * 1024,
} as const;

export const GROUP_COVER_FILENAME = /^cover\.[A-Za-z0-9]+$/;

const CLOSED_ACCOUNT_STATUSES = new Set(['deleted', 'disabled', 'suspended', 'inactive']);

export type PrivateFileKind = 'group-cover' | 'group-post' | 'assignment' | 'story';

export type PrivateFileScope = {
  path: string;
  filename: string;
  kind: PrivateFileKind;
  maxBytes: number;
  groupId?: string;
  postId?: string;
  assignmentId?: string;
  userId?: string;
  schoolId?: string;
  storyId?: string;
};

export class PrivateFileAccessError extends Error {
  readonly statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.name = 'PrivateFileAccessError';
    this.statusCode = statusCode;
  }
}

export type PrivateFileDocSnap = {
  exists: boolean;
  data: () => Record<string, unknown> | undefined;
};

export type PrivateFileDocRef = {
  path?: string;
  collection: (name: string) => PrivateFileCollectionRef;
};

export type PrivateFileCollectionRef = {
  doc: (id: string) => PrivateFileDocRef;
};

export type PrivateFileTransaction = {
  get: (ref: PrivateFileDocRef) => Promise<PrivateFileDocSnap>;
  getAll: (...refs: PrivateFileDocRef[]) => Promise<PrivateFileDocSnap[]>;
};

export type PrivateFileDb = {
  collection: (name: string) => PrivateFileCollectionRef;
  runTransaction: <T>(
    fn: (tx: PrivateFileTransaction) => Promise<T>,
    options?: { readOnly: boolean },
  ) => Promise<T>;
};

export type StoryObjectInfo = {
  ownerUid?: string;
  contentType?: string;
};

function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code <= 0x7f) bytes += 1;
    else if (code <= 0x7ff) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff) {
      bytes += 4;
      i += 1;
    } else bytes += 3;
  }
  return bytes;
}

export function validPrivateFileSegment(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
}

export function validPrivateFileName(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value) && !value.includes('..');
}

/** Original names belong in display metadata, never in object keys. */
export function safePrivateFileName(prefix: string, originalName: string): string {
  const extension = originalName.match(/\.([A-Za-z0-9]{1,16})$/)?.[1] || '';
  const stem = prefix.replace(/[^A-Za-z0-9_-]/g, '_').replace(/^[^A-Za-z0-9]+/, '') || 'file';
  return stem.slice(0, 128 - (extension ? extension.length + 1 : 0)) + (extension ? `.${extension}` : '');
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function deny(): never {
  throw new PrivateFileAccessError(403, 'File access denied');
}

/** Exact published/submitted attachment reference, never merely a known object path. */
function referencesPrivateFile(attachments: unknown, path: string): boolean {
  return Array.isArray(attachments) && attachments.some((item: unknown) =>
    item === path || (
      item !== null && typeof item === 'object' && !Array.isArray(item) &&
      ((item as { path?: unknown }).path === path || (item as { url?: unknown }).url === path)
    ));
}

function accountBlocked(data: Record<string, unknown>): boolean {
  return (
    data.accountDeletionInProgress === true ||
    CLOSED_ACCOUNT_STATUSES.has(String(data.status || ''))
  );
}

export const PRIVATE_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif']);
export const PRIVATE_VIDEO_TYPES = new Set(['video/mp4', 'video/quicktime', 'video/webm']);

export function isPrivateFileImage(contentType: string): boolean {
  return PRIVATE_IMAGE_TYPES.has(contentType);
}

export function isPrivateFileVideo(contentType: string): boolean {
  return PRIVATE_VIDEO_TYPES.has(contentType);
}

export function privateFileMaxBytes(kind: PrivateFileKind, contentType?: string): number {
  if (kind === 'story') {
    if (contentType && isPrivateFileVideo(contentType)) return PRIVATE_FILE_MAX_BYTES['story-video'];
    return PRIVATE_FILE_MAX_BYTES['story-image'];
  }
  if (kind === 'group-cover') return PRIVATE_FILE_MAX_BYTES['group-cover'];
  if (kind === 'group-post') return PRIVATE_FILE_MAX_BYTES['group-post'];
  return PRIVATE_FILE_MAX_BYTES.assignment;
}

export function isAllowedPrivateFileContentType(kind: PrivateFileKind, contentType: string): boolean {
  if (kind === 'assignment') return isPrivateFileImage(contentType) || PRIVATE_DOCUMENT_TYPES.has(contentType);
  if (kind === 'group-cover') return isPrivateFileImage(contentType);
  if (kind === 'story') return isPrivateFileImage(contentType) || isPrivateFileVideo(contentType);
  return isPrivateFileImage(contentType) || PRIVATE_DOCUMENT_TYPES.has(contentType);
}

/** Returns a private namespace scope, or null for any other path. */
export function parsePrivateFilePath(value: unknown): PrivateFileScope | null {
  if (typeof value !== 'string' || utf8ByteLength(value) > 1024) return null;
  const parts = value.split('/');
  if (!parts.slice(0, -1).every(validPrivateFileSegment) || !validPrivateFileName(parts.at(-1))) return null;
  const common = { path: value, filename: parts[parts.length - 1] };
  if (parts[0] === 'groups' && parts.length === 3) {
    return {
      ...common,
      kind: 'group-cover',
      groupId: parts[1],
      maxBytes: PRIVATE_FILE_MAX_BYTES['group-cover'],
    };
  }
  if (parts[0] === 'groups' && parts[2] === 'posts' && parts.length === 5) {
    return {
      ...common,
      kind: 'group-post',
      groupId: parts[1],
      postId: parts[3],
      maxBytes: PRIVATE_FILE_MAX_BYTES['group-post'],
    };
  }
  if (parts[0] === 'groups' && parts[2] === 'assignments' && parts[4] === 'submissions' && parts.length === 7) {
    return { ...common, kind: 'assignment', groupId: parts[1], assignmentId: parts[3], userId: parts[5], maxBytes: PRIVATE_FILE_MAX_BYTES.assignment };
  }
  if (parts[0] === 'assignments' && parts[2] === 'submissions' && parts.length === 5) {
    return {
      ...common,
      kind: 'assignment',
      assignmentId: parts[1],
      userId: parts[3],
      maxBytes: PRIVATE_FILE_MAX_BYTES.assignment,
    };
  }
  if (parts[0] === 'schools' && parts[2] === 'stories' && parts.length === 5) {
    return {
      ...common,
      kind: 'story',
      schoolId: parts[1],
      storyId: parts[3],
      maxBytes: PRIVATE_FILE_MAX_BYTES['story-video'],
    };
  }
  return null;
}

/** Legacy privateGroupFile namespaces only (covers, post attachments, assignment files). */
export function parsePrivateGroupFilePath(value: unknown): PrivateFileScope | null {
  const scope = parsePrivateFilePath(value);
  if (!scope || scope.kind === 'story') return null;
  return scope;
}

export function isCoverFilenameAllowed(filename: string): boolean {
  return GROUP_COVER_FILENAME.test(filename);
}

export function privateGroupCoverPath(groupId: string, extension: string): string | null {
  const filename = `cover.${extension}`;
  if (!validPrivateFileSegment(groupId) || !isCoverFilenameAllowed(filename)) return null;
  return `groups/${groupId}/${filename}`;
}

export function privateGroupPostPath(groupId: string, postId: string, filename: string): string | null {
  if (![groupId, postId].every(validPrivateFileSegment) || !validPrivateFileName(filename)) return null;
  return `groups/${groupId}/posts/${postId}/${filename}`;
}

export function privateAssignmentPath(
  assignmentId: string,
  userId: string,
  filename: string,
): string | null {
  if (![assignmentId, userId].every(validPrivateFileSegment) || !validPrivateFileName(filename)) return null;
  return `assignments/${assignmentId}/submissions/${userId}/${filename}`;
}

export function privateGroupAssignmentPath(groupId: string, assignmentId: string, userId: string, filename: string): string | null {
  if (![groupId, assignmentId, userId].every(validPrivateFileSegment) || !validPrivateFileName(filename)) return null;
  return `groups/${groupId}/assignments/${assignmentId}/submissions/${userId}/${filename}`;
}

export function privateStoryPath(schoolId: string, storyId: string, filename: string): string | null {
  if (![schoolId, storyId].every(validPrivateFileSegment) || !validPrivateFileName(filename)) return null;
  return `schools/${schoolId}/stories/${storyId}/${filename}`;
}

function storyExpiresAtMs(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (value instanceof Date) return value.getTime();
  if (value && typeof value === 'object') {
    const record = value as { toMillis?: unknown; toDate?: unknown };
    if (typeof record.toMillis === 'function') {
      const ms = (record.toMillis as () => unknown)();
      return typeof ms === 'number' && Number.isFinite(ms) ? ms : null;
    }
    if (typeof record.toDate === 'function') {
      const date = (record.toDate as () => unknown)();
      return date instanceof Date ? date.getTime() : null;
    }
  }
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function assertStoryMediaRead(input: {
  schoolId: string;
  uid: string;
  story: Record<string, unknown> | null;
  path: string;
  object: StoryObjectInfo;
  nowMs?: number;
}): void {
  const ownerUid = typeof input.object.ownerUid === 'string' ? input.object.ownerUid : '';
  const contentType = String(input.object.contentType || '').split(';')[0].trim().toLowerCase();
  if (!input.story) {
    if (ownerUid !== input.uid) deny();
    return;
  }
  const nowMs = input.nowMs ?? Date.now();
  const expiresAt = storyExpiresAtMs(input.story.expiresAt);
  const mediaUrl = input.story.mediaUrl;
  const kind = input.story.kind;
  if (
    input.story.schoolId !== input.schoolId ||
    input.story.authorUid !== ownerUid ||
    typeof mediaUrl !== 'string' ||
    mediaUrl !== input.path ||
    expiresAt === null ||
    expiresAt <= nowMs ||
    !((kind === 'image' && isPrivateFileImage(contentType)) ||
      (kind === 'video' && isPrivateFileVideo(contentType)))
  ) {
    deny();
  }
}

/**
 * Live canonical account, school and group membership. Story paths also require
 * the #557 campus-story binding stamp (profileBoundSchoolId + generation).
 */
export async function authorizePrivateFile(
  db: PrivateFileDb,
  scope: PrivateFileScope,
  uid: string,
  writing: boolean | 'claim',
): Promise<void> {
  await db.runTransaction(
    async (tx) => {
      if (scope.kind === 'story') {
        const schoolId = scope.schoolId;
        if (!validPrivateFileSegment(schoolId)) deny();
        const [account, schoolMember] = await tx.getAll(
          db.collection('users').doc(uid),
          db.collection('schools').doc(schoolId).collection('members').doc(uid),
        );
        const accountData = asRecord(account.data());
        if (
          !account.exists ||
          accountBlocked(accountData) ||
          !schoolMember.exists ||
          asRecord(schoolMember.data()).status !== 'active'
        ) {
          deny();
        }
        const memberData = asRecord(schoolMember.data());
        // A stale membership stamp must never authorize a recreated user profile.
        // Only the trusted school-login writer can bind both records in one transaction.
        if (
          memberData.profileBoundSchoolId !== schoolId ||
          typeof memberData.profileBoundGeneration !== 'string' ||
          memberData.profileBoundGeneration.length === 0 ||
          memberData.profileBoundGeneration !== accountData.bindingGeneration ||
          (accountData.schoolId !== schoolId && accountData.primarySchoolId !== schoolId)
        ) {
          deny();
        }
        if (writing) {
          const story = await tx.get(db.collection('campusStories').doc(scope.storyId || ''));
          if (story.exists && !(writing === 'claim' &&
            asRecord(story.data()).authorUid === uid &&
            asRecord(story.data()).schoolId === scope.schoolId &&
            asRecord(story.data()).mediaUrl === scope.path)) deny();
        }
        return;
      }

      let groupId = scope.groupId;
      if (scope.kind === 'assignment' && !scope.groupId) {
        const assignment = await tx.get(db.collection('assignments').doc(scope.assignmentId || ''));
        groupId = asRecord(assignment.data()).groupId as string | undefined;
        if (!assignment.exists || !validPrivateFileSegment(groupId)) deny();
      }
      if (!validPrivateFileSegment(groupId)) deny();
      const groupRef = db.collection('groups').doc(groupId);
      const [account, group, member] = await tx.getAll(
        db.collection('users').doc(uid),
        groupRef,
        groupRef.collection('members').doc(uid),
      );
      const accountData = asRecord(account.data());
      const schoolId = asRecord(group.data()).schoolId;
      if (
        !account.exists ||
        accountBlocked(accountData) ||
        !group.exists ||
        !validPrivateFileSegment(schoolId) ||
        !member.exists ||
        asRecord(member.data()).status !== 'active'
      ) {
        deny();
      }
      const schoolMember = await tx.get(
        db.collection('schools').doc(schoolId as string).collection('members').doc(uid),
      );
      const schoolMemberData = asRecord(schoolMember.data());
      if (!schoolMember.exists || schoolMemberData.status !== 'active') deny();
      // A trusted school-login stamp binds this membership to the current
      // canonical profile. Do not let a deleted/recreated profile reuse it.
      // Unstamped legacy members remain on the previous access path pending
      // an audited, backwards-compatible rollout of mandatory stamping.
      if (
        ('profileBoundSchoolId' in schoolMemberData || 'profileBoundGeneration' in schoolMemberData) &&
        (
          schoolMemberData.profileBoundSchoolId !== schoolId ||
          typeof schoolMemberData.profileBoundGeneration !== 'string' ||
          schoolMemberData.profileBoundGeneration.length === 0 ||
          schoolMemberData.profileBoundGeneration !== accountData.bindingGeneration ||
          (accountData.schoolId !== schoolId && accountData.primarySchoolId !== schoolId)
        )
      ) deny();
      const manager = PRIVATE_FILE_MANAGER_ROLES.has(String(asRecord(member.data()).role || ''));
      if (scope.kind === 'group-post') {
        const post = await tx.get(groupRef.collection('posts').doc(scope.postId || ''));
        const data = asRecord(post.data());
        // Group posts are hard-deleted; also reject tombstones if present.
        if ((!writing && !post.exists) || data.deletedAt != null || data.deleted === true || data.isDeleted === true || data.status === 'deleted') deny();
        if (writing && post.exists && data.authorId !== uid) deny();
        // The author can preview an uploaded draft. Other group members may
        // download only the precise object referenced by the live post.
        // Finalizing a private upload must not publish a sibling by guessable path.
        if (!writing && data.authorId !== uid && !referencesPrivateFile(data.attachments, scope.path)) deny();
      }
      if (scope.kind === 'assignment' && scope.groupId) {
        const assignmentRef = groupRef.collection('assignments').doc(scope.assignmentId || '');
        const [assignment, submission] = await tx.getAll(
          assignmentRef, assignmentRef.collection('submissions').doc(scope.userId || ''),
        );
        if (!assignment.exists) deny();
        const data = asRecord(assignment.data());
        const previous = asRecord(submission.data());
        // submissionOwnerId uses map.get defaults only for absent fields.
        const owner = 'userId' in previous ? previous.userId : 'uid' in previous ? previous.uid : 'studentId' in previous ? previous.studentId : scope.userId;
        if (writing) {
          // validStudentSubmission: isActiveGroupMember is checked above; path fixes
          // submissionId/userId/groupId/assignmentId. Payload shape, content, status
          // and request.time are enforced when the submission document is written.
          if (scope.userId !== uid) deny();
          // acceptsStudentSubmission: publication, status, deadline and late policy.
          const dueValue = data.dueAt;
          const validDueString = typeof dueValue !== 'string' || (
            /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(dueValue) &&
            Number.isFinite(Date.parse(dueValue.slice(0, 10))) &&
            new Date(dueValue.slice(0, 10)).toISOString().startsWith(dueValue.slice(0, 10))
          );
          const due = dueValue == null || typeof dueValue === 'number' || !validDueString ? null : storyExpiresAtMs(dueValue);
          if (data.published === false || ['draft', 'closed'].includes(String(data.status || '')) ||
            (data.dueAt != null && data.allowLateSubmission !== true && (due === null || Date.now() > due))) deny();
          // Submission update: isSubmissionOwner and submittedAt must still be null.
          if (submission.exists && (owner !== uid || previous.submittedAt != null)) deny();
        } else {
          // A student's finalized but unsubmitted/upload-only object is still private,
          // including from group managers. Grant manager access only to the precise
          // attachment on an actual submitted receipt; owner previews remain possible.
          // Assigned peer reviewers remain excluded from file access.
          if (scope.userId !== uid && (
            !manager || !submission.exists || owner !== scope.userId ||
            previous.submittedAt == null ||
            !referencesPrivateFile(previous.attachments, scope.path)
          )) deny();
        }
      }
      // Legacy uploads must obey the same live submission eligibility as group keys.
      // The global assignments/{id} mirror alone is insufficient for POST/claim.
      if (scope.kind === 'assignment' && !scope.groupId && writing) {
        if (scope.userId !== uid) deny();
        const assignmentRef = groupRef.collection('assignments').doc(scope.assignmentId || '');
        const [assignment, submission] = await tx.getAll(
          assignmentRef, assignmentRef.collection('submissions').doc(scope.userId || ''),
        );
        if (!assignment.exists) deny();
        const data = asRecord(assignment.data());
        const previous = asRecord(submission.data());
        const owner = 'userId' in previous ? previous.userId
          : 'uid' in previous ? previous.uid
            : 'studentId' in previous ? previous.studentId : scope.userId;
        const dueValue = data.dueAt;
        const validDueString = typeof dueValue !== 'string' || (
          /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(dueValue) &&
          Number.isFinite(Date.parse(dueValue.slice(0, 10))) &&
          new Date(dueValue.slice(0, 10)).toISOString().startsWith(dueValue.slice(0, 10))
        );
        const due = dueValue == null || typeof dueValue === 'number' || !validDueString
          ? null : storyExpiresAtMs(dueValue);
        if (
          data.published === false || ['draft', 'closed'].includes(String(data.status || '')) ||
          (data.dueAt != null && data.allowLateSubmission !== true && (due === null || Date.now() > due)) ||
          (submission.exists && (owner !== uid || previous.submittedAt != null))
        ) deny();
      }
      // Legacy assignments/{id}/submissions/{uid}/ paths are still reachable
      // via the GCS HTTP and Web signed-URL handlers. A manager must not
      // download an uploaded draft without the canonical submission receipt.
      if (scope.kind === 'assignment' && !scope.groupId && !writing && scope.userId !== uid) {
        if (!manager) deny();
        const submission = await tx.get(
          groupRef.collection('assignments').doc(scope.assignmentId || '')
            .collection('submissions').doc(scope.userId || ''),
        );
        const previous = asRecord(submission.data());
        const owner = 'userId' in previous ? previous.userId
          : 'uid' in previous ? previous.uid
            : 'studentId' in previous ? previous.studentId : scope.userId;
        if (
          !submission.exists || owner !== scope.userId ||
          previous.submittedAt == null ||
          !referencesPrivateFile(previous.attachments, scope.path)
        ) deny();
      }
      if (
        (writing && scope.kind === 'group-cover' && !manager) ||
        (scope.kind === 'assignment' && !scope.groupId && scope.userId !== uid && (writing || !manager))
      ) {
        deny();
      }
    },
    { readOnly: true },
  );
}
