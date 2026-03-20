export type TenantContext = {
  uid?: string | null;
  schoolId?: string | null;
  groupId?: string | null;
  conversationId?: string | null;
  scope?: string | null;
};

const SCOPED_STORAGE_PREFIX = "campus.scope";

function sanitizeStoragePart(value: string): string {
  const normalized = value.trim().replace(/[^A-Za-z0-9_-]+/g, "-");
  return normalized || "default";
}

function requireSegment(name: string, value: string | null | undefined): string {
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    throw new Error(`Missing required tenant segment: ${name}`);
  }
  return normalized;
}

function normalizeOptionalSegments(segments: Array<string | null | undefined>): string[] {
  return segments
    .map((segment) => String(segment ?? "").trim())
    .filter(Boolean);
}

export function makeScopedStorageKey(feature: string, context: TenantContext = {}): string {
  const parts = [SCOPED_STORAGE_PREFIX, sanitizeStoragePart(feature)];

  if (context.scope) {
    parts.push(sanitizeStoragePart(context.scope));
  }

  parts.push(`u:${sanitizeStoragePart(context.uid ?? "anonymous")}`);
  parts.push(`s:${sanitizeStoragePart(context.schoolId ?? "default")}`);

  return parts.join(".");
}

export function makeScopedStoragePrefix(feature?: string): string {
  if (!feature) {
    return `${SCOPED_STORAGE_PREFIX}.`;
  }
  return `${SCOPED_STORAGE_PREFIX}.${sanitizeStoragePart(feature)}.`;
}

export function buildUserCollectionPath(
  uid: string,
  ...segments: Array<string | null | undefined>
): string[] {
  return ["users", requireSegment("uid", uid), ...normalizeOptionalSegments(segments)];
}

export function buildUserSchoolCollectionPath(
  uid: string,
  schoolId: string,
  ...segments: Array<string | null | undefined>
): string[] {
  return [
    "users",
    requireSegment("uid", uid),
    "schools",
    requireSegment("schoolId", schoolId),
    ...normalizeOptionalSegments(segments),
  ];
}

export function buildSchoolCollectionPath(
  schoolId: string,
  ...segments: Array<string | null | undefined>
): string[] {
  return ["schools", requireSegment("schoolId", schoolId), ...normalizeOptionalSegments(segments)];
}

export function buildGroupCollectionPath(
  groupId: string,
  ...segments: Array<string | null | undefined>
): string[] {
  return ["groups", requireSegment("groupId", groupId), ...normalizeOptionalSegments(segments)];
}

export function buildConversationCollectionPath(
  conversationId: string,
  ...segments: Array<string | null | undefined>
): string[] {
  return [
    "conversations",
    requireSegment("conversationId", conversationId),
    ...normalizeOptionalSegments(segments),
  ];
}

export function buildRootCollectionPath(
  collectionName: string,
  ...segments: Array<string | null | undefined>
): string[] {
  return [requireSegment("collectionName", collectionName), ...normalizeOptionalSegments(segments)];
}
